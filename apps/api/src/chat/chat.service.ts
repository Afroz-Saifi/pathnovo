import { Injectable, NotFoundException } from "@nestjs/common";
import type { Config } from "@pathnovo/config";
import { generateObject } from "ai";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { ConfigService } from "../config/config.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RunService } from "../observability/run.service.js";
import { resolveChatModel } from "./model-catalog.js";
import { costUsd } from "./pricing.js";
import { type RetrievedChunk, RetrievalService } from "./retrieval.service.js";

const AnswerSchema = z.object({
  answer: z.string(),
  citations: z
    .array(
      z.object({
        ref: z.string().describe("the [n] label of the supporting context block"),
        quote: z.string().describe("the exact supporting snippet copied from that block"),
      }),
    )
    .describe("every claim must be backed by a citation"),
  confidence: z.enum(["grounded", "partial", "not_found"]),
});

export interface Citation {
  source: string;
  sheet: number | null;
  ref: string;
  refs: string[];
  quote: string;
}

type EnumCat = "added" | "removed" | "modified" | "moved";
const ENUM_PAGE = 60;
const SPATIAL_Q = /\b(near|around|close to|beside|next to|located|where\b)/i;
const PAGINATION_Q = /\b(more|next|continue|rest|following|another|remaining)\b/i;
const LIST_CUE_Q = /\b(list|every|each|enumerate|how many|show me|give me|any (more|other)|other than|all)\b/i;

function enumCategory(q: string): EnumCat | null {
  if (/\bmov/i.test(q)) return "moved";
  if (/\b(remov|delet)/i.test(q)) return "removed";
  if (/\b(add|new|addition)/i.test(q)) return "added";
  if (/\b(modif|chang|updat|edit|revis)/i.test(q)) return "modified";
  return null;
}

/** A bulk enumeration / pagination request (vs. a specific, answerable question). */
function isEnumerationQuestion(q: string): boolean {
  if (SPATIAL_Q.test(q)) return false;
  if (PAGINATION_Q.test(q)) return true;
  const cat = enumCategory(q);
  return LIST_CUE_Q.test(q) || (cat !== null && /\b(what|which|any)\b/i.test(q));
}

/** Prisma where-filter for a change category. */
function catFilter(cat: EnumCat | null): Record<string, unknown> {
  if (cat === "added") return { changeType: "added" };
  if (cat === "removed") return { changeType: "removed" };
  if (cat === "moved") return { changeType: "modified", modifyKind: "moved" };
  if (cat === "modified") return { changeType: "modified", modifyKind: { not: "moved" } };
  return {};
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
    private readonly runs: RunService,
    private readonly configService: ConfigService,
  ) {}

  private get config(): Config {
    return this.configService.get();
  }

  async ask(comparisonId: string, question: string, requestId: string, sessionId?: string) {
    const comparison = await this.prisma.comparison.findUnique({ where: { id: comparisonId } });
    if (!comparison) throw new NotFoundException(`comparison ${comparisonId} not found`);

    const run = await this.runs.start("chat", { requestId, pidA: comparison.pidA, pidB: comparison.pidB });
    try {
      // Bulk enumeration ("what is added", "list all removed", "show more") is a
      // paginated read of the delta — answered deterministically, no LLM.
      if (isEnumerationQuestion(question)) {
        return await this.enumerate(comparisonId, question, sessionId, run);
      }

      const retrieved = await run.span(
        "retrieval_completed",
        () => this.retrieval.retrieve(comparisonId, question),
        (r) => ({ vector_hits: r.vectorHits, fts_hits: r.ftsHits, fused_k: r.chunks.length }),
      );
      if (retrieved.queryTokens > 0) {
        await run.recordUsage({
          provider: "openai",
          model: this.config.embeddingModel,
          inputTokens: retrieved.queryTokens,
          costUsd: costUsd(this.config.embeddingModel, retrieved.queryTokens),
        });
      }

      const context = renderContext(retrieved.chunks);
      const enumNote =
        retrieved.enumTotal !== undefined
          ? `\n\nThe user asked to enumerate. The context contains ${retrieved.chunks.length} of ${retrieved.enumTotal} matching changes. List every one in the context as a concise item (its name/text only). ${retrieved.enumCapped ? `State that there are ${retrieved.enumTotal} in total and these are the first ${retrieved.chunks.length}.` : "This is the complete set."} For a long list you do NOT need a citation per item — a few representative citations to the delta blocks are enough; set confidence to "grounded".`
          : "";
      const userPrompt = `Context blocks:\n${context}${enumNote}\n\nQuestion: ${question}`;
      // Reasoning models (o1/o3/gpt-5) reject a custom temperature and spend
      // the token budget on hidden reasoning, so give them much more room and
      // omit temperature.
      const isReasoning = /^(o1|o3|gpt-5)/i.test(this.config.llmModel);
      // Enumerations list many items — give them plenty of output room.
      const baseMax = retrieved.enumTotal !== undefined ? Math.max(this.config.llmMaxOutputTokens, 6000) : this.config.llmMaxOutputTokens;
      const maxOutput = isReasoning ? Math.max(baseMax, 8000) : baseMax;

      await run.emit("llm_call_started", {
        "gen_ai.system": this.config.llmProvider,
        "gen_ai.request.model": this.config.llmModel,
      });
      const t0 = Date.now();

      const runGen = () =>
        generateObject({
          model: resolveChatModel(this.config.llmProvider, this.config.llmModel),
          schema: AnswerSchema,
          maxTokens: maxOutput,
          system: SYSTEM_PROMPT,
          prompt: userPrompt,
          ...(isReasoning ? {} : { temperature: this.config.llmTemperature }),
        });

      // A model can return an unparseable response; retry once, then degrade
      // gracefully to a friendly "couldn't answer" rather than hard-failing.
      let object: z.infer<typeof AnswerSchema>;
      let usage: { promptTokens?: number; completionTokens?: number } | undefined;
      try {
        const res = await runGen();
        object = res.object;
        usage = res.usage;
      } catch {
        try {
          const res = await runGen();
          object = res.object;
          usage = res.usage;
        } catch (err) {
          return this.gracefulFailure(run, comparisonId, question, err as Error, sessionId, t0);
        }
      }

      const inTok = usage?.promptTokens ?? 0;
      const outTok = usage?.completionTokens ?? 0;
      await run.emit(
        "llm_call_completed",
        {
          "gen_ai.system": this.config.llmProvider,
          "gen_ai.request.model": this.config.llmModel,
          "gen_ai.usage.input_tokens": inTok,
          "gen_ai.usage.output_tokens": outTok,
          // Prompt + completion for inspection in the trace viewer (size-capped).
          "gen_ai.prompt": `${SYSTEM_PROMPT}\n\n${userPrompt}`.slice(0, 6000),
          "gen_ai.completion": JSON.stringify(object).slice(0, 4000),
        },
        { durationMs: Date.now() - t0 },
      );
      await run.recordUsage({
        provider: this.config.llmProvider,
        model: this.config.llmModel,
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: costUsd(this.config.llmModel, inTok, outTok),
      });

      const { citations, confidence } = await this.validate(
        object,
        retrieved.chunks,
        run,
        retrieved.enumTotal !== undefined,
      );
      const session = await this.resolveSession(comparisonId, sessionId);
      await this.persistTurn(session.id, question, object.answer, citations, confidence);

      await run.finish("ok", { comparisonId });
      return { answer: object.answer, citations, confidence, sessionId: session.id, runId: run.runId };
    } catch (err) {
      await run.finish("failed", { error: (err as Error).message });
      throw err;
    }
  }

  /** Deterministic, paginated enumeration straight from delta_entries. */
  private async enumerate(
    comparisonId: string,
    question: string,
    sessionId: string | undefined,
    run: Awaited<ReturnType<RunService["start"]>>,
  ) {
    const session = await this.resolveSession(comparisonId, sessionId);
    const pagination = PAGINATION_Q.test(question);
    let cat = enumCategory(question);
    if (pagination && !cat && session.enumType) cat = session.enumType as EnumCat;
    const where = { comparisonId, ...catFilter(cat) };
    const offset = pagination && session.enumType === (cat ?? null) ? session.enumOffset : 0;

    const total = await this.prisma.deltaEntry.count({ where });
    const rows = await this.prisma.deltaEntry.findMany({
      where,
      orderBy: { id: "asc" },
      skip: offset,
      take: ENUM_PAGE,
    });
    await run.emit("retrieval_completed", { vector_hits: 0, fts_hits: 0, fused_k: rows.length });

    const label = cat ?? "change";
    let answer: string;
    let confidence: string;
    if (rows.length === 0) {
      answer = offset > 0 ? `That's all — you've seen all ${total} ${label} items.` : `No ${label} items found.`;
      confidence = total > 0 ? "grounded" : "not_found";
    } else {
      const items = rows.map((e, i) => {
        const name = e.textB || e.textA || e.description;
        return `${offset + i + 1}. ${name}${e.itemKind === "geometry" ? " _(geometry)_" : ""}`;
      });
      const end = offset + rows.length;
      const cap = label.charAt(0).toUpperCase() + label.slice(1);
      answer = `**${cap} items ${offset + 1}–${end} of ${total}:**\n\n${items.join("\n")}`;
      answer += end < total ? `\n\n_Ask "show more" for the next ${Math.min(ENUM_PAGE, total - end)}._` : `\n\n_That's all ${total}._`;
      confidence = "grounded";
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { enumType: cat ?? null, enumOffset: end },
      });
    }

    await this.persistTurn(session.id, question, answer, [], confidence);
    await run.finish("ok", { comparisonId });
    return { answer, citations: [] as Citation[], confidence, sessionId: session.id, runId: run.runId };
  }

  private async validate(
    object: z.infer<typeof AnswerSchema>,
    chunks: RetrievedChunk[],
    run: Awaited<ReturnType<RunService["start"]>>,
    isEnum = false,
  ): Promise<{ citations: Citation[]; confidence: string }> {
    const valid: Citation[] = [];
    for (const c of object.citations) {
      const idx = Number.parseInt(c.ref, 10) - 1;
      const chunk = chunks[idx];
      if (!chunk) {
        await run.emit("citation_validation_failed", { ref: c.ref, reason: "unknown ref" });
        continue;
      }
      if (!quoteSupportedBy(chunk.text, c.quote)) {
        await run.emit("citation_validation_failed", { ref: c.ref, reason: "quote not in source" });
        continue;
      }
      valid.push({ source: chunk.sourceType, sheet: chunk.sheet, ref: chunk.id, refs: chunk.refs, quote: c.quote });
    }

    let confidence = object.confidence as string;
    if (confidence === "grounded" && valid.length < object.citations.length) confidence = "partial";
    // For an enumeration the delta list itself is the grounding, so zero explicit
    // citations shouldn't force "not_found".
    if (!isEnum && confidence !== "not_found" && valid.length === 0) confidence = "not_found";
    return { citations: valid, confidence };
  }

  /** Degrade a model/parse failure into a friendly, traced answer (no hard error). */
  private async gracefulFailure(
    run: Awaited<ReturnType<RunService["start"]>>,
    comparisonId: string,
    question: string,
    err: Error,
    sessionId: string | undefined,
    t0: number,
  ) {
    await run.emit(
      "stage_failed",
      { stage: "llm_call_completed", error_type: err.name || "LlmError", message: err.message },
      { durationMs: Date.now() - t0 },
    );
    const answer =
      "I couldn't produce a grounded answer for that — the model returned an unparseable response. " +
      "Try rephrasing, or switch the chat model to gpt-4o-mini in Config.";
    const session = await this.resolveSession(comparisonId, sessionId);
    await this.persistTurn(session.id, question, answer, [], "error");
    await run.finish("ok", { comparisonId });
    return { answer, citations: [] as Citation[], confidence: "error", sessionId: session.id, runId: run.runId };
  }

  /** Most-recent chat session for a comparison, with its messages (for reload). */
  async getHistory(comparisonId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: { comparisonId },
      orderBy: { createdAt: "desc" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session) return { sessionId: null, messages: [] };
    return {
      sessionId: session.id,
      messages: session.messages.map((m) => ({
        role: m.role,
        content: m.content,
        citations: m.citations ?? [],
        confidence: m.confidence,
      })),
    };
  }

  private async resolveSession(comparisonId: string, sessionId?: string) {
    if (sessionId) {
      const existing = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
      if (existing) return existing;
    }
    return this.prisma.chatSession.create({ data: { comparisonId } });
  }

  private async persistTurn(
    sessionId: string,
    question: string,
    answer: string,
    citations: Citation[],
    confidence: string,
  ): Promise<void> {
    await this.prisma.chatMessage.create({ data: { sessionId, role: "user", content: question } });
    await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: answer,
        citations: citations as unknown as Prisma.InputJsonValue,
        confidence,
      },
    });
  }
}

const SYSTEM_PROMPT = `You answer questions about two revisions (PID A = base, PID B = revised) of an engineering document and the computed delta between them.
Rules:
- Use ONLY the provided context blocks. Never use outside knowledge.
- Back every claim with a citation: set "ref" to the [n] label of the supporting block and copy the exact supporting text into "quote".
- If the context does not support an answer, set confidence to "not_found" and say you cannot answer from these documents. Do not guess.
- Set confidence to "grounded" when fully supported by citations, "partial" when only partly supported.`;

function renderContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => `[${c.label}] (${c.sourceType}${c.sheet !== null ? `, sheet ${c.sheet + 1}` : ""}) ${c.text}`)
    .join("\n");
}

/** Normalized-substring check with a token-overlap fallback. */
function quoteSupportedBy(source: string, quote: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const s = norm(source);
  const q = norm(quote);
  if (q.length === 0) return false;
  if (s.includes(q)) return true;
  const qTokens = q.split(" ").filter((t) => t.length >= 2);
  if (qTokens.length === 0) return false;
  const hit = qTokens.filter((t) => s.includes(t)).length;
  return hit / qTokens.length >= 0.6;
}
