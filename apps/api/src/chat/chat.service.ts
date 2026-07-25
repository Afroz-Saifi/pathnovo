import { openai } from "@ai-sdk/openai";
import { Injectable, NotFoundException } from "@nestjs/common";
import { type Config, loadConfig } from "@pathnovo/config";
import { generateObject } from "ai";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { PrismaService } from "../prisma/prisma.service.js";
import { RunService } from "../observability/run.service.js";
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

@Injectable()
export class ChatService {
  private readonly config: Config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
    private readonly runs: RunService,
  ) {}

  async ask(comparisonId: string, question: string, requestId: string, sessionId?: string) {
    const comparison = await this.prisma.comparison.findUnique({ where: { id: comparisonId } });
    if (!comparison) throw new NotFoundException(`comparison ${comparisonId} not found`);

    const run = await this.runs.start("chat", { requestId, pidA: comparison.pidA, pidB: comparison.pidB });
    try {
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
      const userPrompt = `Context blocks:\n${context}\n\nQuestion: ${question}`;
      await run.emit("llm_call_started", {
        "gen_ai.system": "openai",
        "gen_ai.request.model": this.config.llmModel,
      });
      const t0 = Date.now();
      const { object, usage } = await generateObject({
        model: openai(this.config.llmModel),
        schema: AnswerSchema,
        temperature: this.config.llmTemperature,
        maxTokens: this.config.llmMaxOutputTokens,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
      });
      const inTok = usage?.promptTokens ?? 0;
      const outTok = usage?.completionTokens ?? 0;
      await run.emit(
        "llm_call_completed",
        {
          "gen_ai.system": "openai",
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
        provider: "openai",
        model: this.config.llmModel,
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: costUsd(this.config.llmModel, inTok, outTok),
      });

      const { citations, confidence } = await this.validate(object, retrieved.chunks, run);
      const session = await this.resolveSession(comparisonId, sessionId);
      await this.persistTurn(session.id, question, object.answer, citations, confidence);

      await run.finish("ok", { comparisonId });
      return { answer: object.answer, citations, confidence, sessionId: session.id, runId: run.runId };
    } catch (err) {
      await run.finish("failed", { error: (err as Error).message });
      throw err;
    }
  }

  private async validate(
    object: z.infer<typeof AnswerSchema>,
    chunks: RetrievedChunk[],
    run: Awaited<ReturnType<RunService["start"]>>,
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
    if (confidence !== "not_found" && valid.length === 0) confidence = "not_found";
    return { citations: valid, confidence };
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
