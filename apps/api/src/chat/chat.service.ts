import { Injectable, NotFoundException } from "@nestjs/common";
import type { Config } from "@pathnovo/config";
import { generateObject, generateText } from "ai";
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
/** Per-message cap when replaying history, so a long list can't dominate context. */
const HISTORY_MSG_CHARS = 1200;
const SPATIAL_Q = /\b(near|around|close to|beside|next to|located|where\b)/i;
const PAGINATION_Q = /\b(more|next|continue|rest|following|another|remaining)\b/i;
/** "is that all?" style follow-ups about the current enumeration. */
const STATUS_Q = /(just these|that'?s it|is that all|anything else|any other|all of them|nothing else|complete\?)/i;
const LIST_CUE_Q = /\b(list|every|each|enumerate|how many|show me|give me|any (more|other)|other than|all)\b/i;

/** "how many …" wants a number, not a list. */
const COUNT_Q = /\b(how many|how much|count of|count|number of|total)\b/i;

/** Item kinds a user might name in a question. */
const KIND_WORDS: Array<[RegExp, string, string]> = [
  [/\b(draw|geometr|shape|symbol|valve|pipe route)/i, "geometry", "drawing/geometry element"],
  [/\bnotes?\b/i, "note", "note"],
  [/\b(tags?|equipment|instrument)\b/i, "tag", "tag"],
  [/\b(line specs?|line numbers?|line ids?|specs?)\b/i, "line_spec", "line spec"],
  [/\b(dimensions?|sizes?)\b/i, "dimension", "dimension"],
  [/\b(cells?|nozzles?)\b/i, "table_cell", "cell"],
];

function itemKindOf(q: string): { kind: string; label: string } | null {
  for (const [re, kind, label] of KIND_WORDS) if (re.test(q)) return { kind, label };
  return null;
}

/** Reader-significance order for enumeration: identifiers first, loose text last. */
const KIND_PRIORITY = ["tag", "line_spec", "note", "dimension", "table_cell", "symbol", "geometry", "text"];
const KIND_RANK = (k: string): number => {
  const i = KIND_PRIORITY.indexOf(k);
  return i === -1 ? KIND_PRIORITY.length : i;
};

/** Human labels for item kinds, used in count breakdowns. */
const KIND_LABELS: Record<string, string> = {
  geometry: "drawing/geometry elements",
  note: "notes",
  tag: "tags",
  line_spec: "line specs",
  dimension: "dimensions",
  table_cell: "cells",
  symbol: "symbols",
  text: "text items",
};

function enumCategory(q: string): EnumCat | null {
  if (/\bmov/i.test(q)) return "moved";
  if (/\b(remov|delet)/i.test(q)) return "removed";
  if (/\b(add|new|addition)/i.test(q)) return "added";
  // Note: bare "change(s)" means ALL changes ("what changed?"), so only explicit
  // modification words select the modified category.
  if (/\b(modif|updat|edit|revis|changed to)/i.test(q)) return "modified";
  return null;
}

/**
 * Any word that refers to the delta. Used for ROUTING (does this question ask
 * about changes at all?) — distinct from enumCategory, which picks a specific
 * category and deliberately ignores bare "change(s)".
 */
const CHANGE_WORD = /\b(chang|add|remov|delet|modif|revis|mov|updat|new)/i;

/** A bulk enumeration / pagination request (vs. a specific, answerable question). */
function isEnumerationQuestion(q: string): boolean {
  if (SPATIAL_Q.test(q)) return false;
  if (PAGINATION_Q.test(q)) return true;
  if (COUNT_Q.test(q)) return true;
  // No trailing \b — "whats removed?" must match as well as "what is removed?".
  return LIST_CUE_Q.test(q) || (CHANGE_WORD.test(q) && /\b(what|which|any|tell)/i.test(q));
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
      // Bulk enumeration ("what is added", "list all removed", "show more") and
      // "is that all?" follow-ups are paginated reads of the delta — answered
      // deterministically from the DB, no LLM.
      const priorEnum = sessionId
        ? await this.prisma.chatSession.findUnique({ where: { id: sessionId }, select: { enumType: true } })
        : null;
      if (isEnumerationQuestion(question) || (STATUS_Q.test(question) && priorEnum?.enumType)) {
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

      // Multi-turn: replay the last N turns so follow-ups resolve.
      const history = await this.loadHistory(sessionId, this.config.historyMaxTurns);

      await run.emit("llm_call_started", {
        "gen_ai.system": this.config.llmProvider,
        "gen_ai.request.model": this.config.llmModel,
        history_turns: Math.floor(history.length / 2),
      });
      const t0 = Date.now();

      const runGen = () =>
        generateObject({
          model: resolveChatModel(this.config.llmProvider, this.config.llmModel),
          schema: AnswerSchema,
          maxTokens: maxOutput,
          system: SYSTEM_PROMPT,
          messages: [...history, { role: "user" as const, content: userPrompt }],
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
          // Prompt (system + replayed history + current turn) and completion, for
          // inspection in the trace viewer (size-capped).
          "gen_ai.prompt": [
            SYSTEM_PROMPT,
            ...history.map((m) => `[${m.role}] ${m.content}`),
            `[user] ${userPrompt}`,
          ]
            .join("\n\n")
            .slice(0, 8000),
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

  /**
   * Prior turns of this session, oldest-first, for multi-turn context — so a
   * follow-up like "just these?" or "and the removed ones?" resolves against
   * what was already said. Capped by HISTORY_MAX_TURNS; long answers (a 60-item
   * enumeration) are truncated so history can't crowd out the retrieved context.
   */
  private async loadHistory(
    sessionId: string | undefined,
    maxTurns: number,
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    if (!sessionId || maxTurns <= 0) return [];
    const rows = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: maxTurns * 2, // a turn = user + assistant
    });
    return rows
      .reverse()
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content.length > HISTORY_MSG_CHARS ? `${m.content.slice(0, HISTORY_MSG_CHARS)}…` : m.content,
      }));
  }

  /** Deterministic count answer, with a per-kind breakdown when no kind is named. */
  private async countAnswer(
    comparisonId: string,
    cat: EnumCat | null,
    kindAsked: { kind: string; label: string } | null,
  ): Promise<string> {
    const base = { comparisonId, ...catFilter(cat) };
    const verb = cat ?? "changed";
    const catTotal = await this.prisma.deltaEntry.count({ where: base });

    if (kindAsked) {
      const n = await this.prisma.deltaEntry.count({ where: { ...base, itemKind: kindAsked.kind } });
      const plural = n === 1 ? "" : "s";
      return `**${n}** ${kindAsked.label}${plural} ${cat ? `were ${cat}` : "changed"}${
        catTotal ? ` — out of ${catTotal} ${verb} item${catTotal === 1 ? "" : "s"} in total.` : "."
      }`;
    }

    const grouped = await this.prisma.deltaEntry.groupBy({
      by: ["itemKind"],
      where: base,
      _count: { _all: true },
    });
    const breakdown = grouped
      .map((g) => ({ kind: g.itemKind, n: g._count._all }))
      .sort((a, b) => b.n - a.n)
      .map((g) => `- ${KIND_LABELS[g.kind] ?? g.kind}: **${g.n}**`)
      .join("\n");
    return catTotal === 0
      ? `No ${verb} items in this comparison.`
      : `**${catTotal}** item${catTotal === 1 ? "" : "s"} ${cat ? cat : "changed"}:\n\n${breakdown}`;
  }

  /** Deterministic, paginated enumeration straight from delta_entries. */
  private async enumerate(
    comparisonId: string,
    question: string,
    sessionId: string | undefined,
    run: Awaited<ReturnType<RunService["start"]>>,
  ) {
    const session = await this.resolveSession(comparisonId, sessionId);

    // "is that all?" — report progress against the current enumeration.
    if (STATUS_Q.test(question) && !enumCategory(question) && session.enumType) {
      const cat = session.enumType as EnumCat;
      const total = await this.prisma.deltaEntry.count({ where: { comparisonId, ...catFilter(cat) } });
      const shown = Math.min(session.enumOffset, total);
      const facts =
        shown >= total
          ? `Yes — that's the complete set: all **${total}** ${cat} items.`
          : `No — you've seen **${shown} of ${total}** ${cat} items. Ask "show more" for the next ${Math.min(ENUM_PAGE, total - shown)}.`;
      await run.emit("retrieval_completed", { vector_hits: 0, fts_hits: 0, fused_k: 0 });
      return this.finishEnum(run, session, comparisonId, question, facts, "grounded");
    }

    const pagination = PAGINATION_Q.test(question);
    let cat = enumCategory(question);
    if (pagination && !cat && session.enumType) cat = session.enumType as EnumCat;
    const kindAsked = itemKindOf(question);
    const kindFilter = kindAsked ? { itemKind: kindAsked.kind } : {};

    // "how many …" wants a number (optionally broken down), not a list.
    if (COUNT_Q.test(question) && !pagination) {
      const facts = await this.countAnswer(comparisonId, cat, kindAsked);
      await run.emit("retrieval_completed", { vector_hits: 0, fts_hits: 0, fused_k: 0 });
      return this.finishEnum(run, session, comparisonId, question, facts, "grounded");
    }

    const where = { comparisonId, ...catFilter(cat), ...kindFilter };
    const offset = pagination && session.enumType === (cat ?? null) ? session.enumOffset : 0;

    // Rank by how much a reader cares: identifiers and notes first, generic text
    // fragments last — so page 1 isn't full of "[]" and single characters.
    const all = await this.prisma.deltaEntry.findMany({
      where,
      select: { id: true, itemKind: true, changeType: true, textA: true, textB: true, description: true },
    });
    all.sort((a, b) => KIND_RANK(a.itemKind) - KIND_RANK(b.itemKind) || a.id.localeCompare(b.id));
    const total = all.length;
    const rows = all.slice(offset, offset + ENUM_PAGE);
    await run.emit("retrieval_completed", { vector_hits: 0, fts_hits: 0, fused_k: rows.length });

    const label = cat ?? "change";
    const noun = kindAsked ? `${label} ${kindAsked.label}` : `${label} item`;
    let answer: string;
    let confidence: string;
    if (rows.length === 0) {
      answer = offset > 0 ? `That's all — you've seen all ${total} ${noun}s.` : `No ${noun}s found.`;
      confidence = total > 0 ? "grounded" : "not_found";
    } else {
      const items = rows.map((e, i) => {
        const changed = e.changeType === "modified" && e.textA && e.textB && e.textA !== e.textB;
        const name = changed
          ? `${e.textA} → ${e.textB}`
          : e.itemKind === "geometry"
            ? e.description
            : e.textB || e.textA || e.description;
        const kindTag = kindAsked ? "" : ` _(${e.itemKind.replace("_", " ")})_`;
        return `${offset + i + 1}. ${name}${kindTag}`;
      });
      const end = offset + rows.length;
      const cap = noun.charAt(0).toUpperCase() + noun.slice(1);
      answer = `**${cap}s ${offset + 1}–${end} of ${total}:**\n\n${items.join("\n")}`;
      answer += end < total ? `\n\n_Ask "show more" for the next ${Math.min(ENUM_PAGE, total - end)}._` : `\n\n_That's all ${total}._`;
      confidence = "grounded";
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { enumType: cat ?? null, enumOffset: end },
      });
    }

    return this.finishEnum(run, session, comparisonId, question, answer, confidence);
  }

  /**
   * Finish an enumeration turn. In "llm" mode (default) the deterministic result
   * is handed to the model as authoritative facts and it writes the reply — so
   * the user gets a real answer (grouped, summarised, in their own terms) while
   * completeness still comes from the delta table. "direct" mode returns the
   * deterministic text verbatim. Falls back to the facts if the model fails.
   */
  private async finishEnum(
    run: Awaited<ReturnType<RunService["start"]>>,
    session: { id: string },
    comparisonId: string,
    question: string,
    facts: string,
    confidence: string,
  ) {
    let answer = facts;
    if (this.config.enumMode === "llm") {
      try {
        answer = await this.composeFromFacts(question, facts, run);
      } catch {
        // keep the deterministic text — never fail a turn over formatting
      }
    }
    await this.persistTurn(session.id, question, answer, [], confidence);
    await run.finish("ok", { comparisonId });
    return { answer, citations: [] as Citation[], confidence, sessionId: session.id, runId: run.runId };
  }

  /** Ask the model to answer the question from the supplied delta facts. */
  private async composeFromFacts(
    question: string,
    facts: string,
    run: Awaited<ReturnType<RunService["start"]>>,
  ): Promise<string> {
    const isReasoning = /^(o1|o3|gpt-5)/i.test(this.config.llmModel);
    const system =
      `You answer questions about the delta between two revisions of an engineering document.\n` +
      `The DELTA FACTS below come from the system's delta database and are complete and authoritative for what was asked.\n` +
      `Rules:\n` +
      `- Use only those facts. Never invent, drop, or renumber items.\n` +
      `- If the user asked for the "main" or "important" changes, or a summary: group by kind, call out patterns ` +
      `(e.g. a systematic tag renumbering), give the totals, and cite a few concrete examples rather than pasting everything.\n` +
      `- If the user asked to list or enumerate: present all the listed items, keeping their text exactly.\n` +
      `- If a "show more" hint or a total is present, preserve that information.\n` +
      `- Reply in concise markdown. No preamble about being an AI.`;
    await run.emit("llm_call_started", {
      "gen_ai.system": this.config.llmProvider,
      "gen_ai.request.model": this.config.llmModel,
    });
    const t0 = Date.now();
    const { text, usage } = await generateText({
      model: resolveChatModel(this.config.llmProvider, this.config.llmModel),
      maxTokens: isReasoning ? 8000 : 4000,
      system,
      prompt: `DELTA FACTS:\n${facts}\n\nQuestion: ${question}`,
      ...(isReasoning ? {} : { temperature: this.config.llmTemperature }),
    });
    const inTok = usage?.promptTokens ?? 0;
    const outTok = usage?.completionTokens ?? 0;
    await run.emit(
      "llm_call_completed",
      {
        "gen_ai.system": this.config.llmProvider,
        "gen_ai.request.model": this.config.llmModel,
        "gen_ai.usage.input_tokens": inTok,
        "gen_ai.usage.output_tokens": outTok,
        "gen_ai.prompt": `${system}\n\nDELTA FACTS:\n${facts}\n\nQuestion: ${question}`.slice(0, 8000),
        "gen_ai.completion": text.slice(0, 4000),
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
    return text.trim() || facts;
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
    // Only the model itself declaring it can't answer — or answering with no
    // attempt to cite at all — is "not_found". If it cited but the quotes failed
    // verification, the answer exists yet is unverified: that's "partial", not
    // "not found" (which reads as "no answer" next to a real one).
    if (!isEnum && valid.length === 0) {
      confidence = object.citations.length === 0 ? "not_found" : "partial";
    }
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
- Set confidence to "grounded" when fully supported by citations, "partial" when only partly supported.
- Earlier turns of this conversation are provided. Use them to resolve follow-ups
  and references ("just these?", "and the removed ones?", "what about that valve?")
  instead of asking the user to repeat themselves. Grounding still comes only from
  the context blocks of the CURRENT turn.`;

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
