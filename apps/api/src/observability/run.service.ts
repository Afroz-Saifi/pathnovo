import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import {
  type Attributes,
  checkMandatoryAttributes,
  MissingTraceAttributeError,
  type TraceEventType,
} from "./trace-events.js";

export type RunKind = "ingest" | "delta" | "chat" | "eval";

export interface UsageRecord {
  traceEventId?: string;
  provider: string;
  model: string;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/**
 * A live run handle. Emits sequenced trace events, times stages, records LLM
 * usage, and closes the run. `span` wraps a stage so success emits a timed
 * event and failure emits a traced `stage_failed` before rethrowing — nothing
 * is swallowed.
 */
export interface RunContext {
  readonly runId: string;
  emit(eventType: TraceEventType, attributes: Attributes, opts?: EmitOpts): Promise<string>;
  span<T>(
    eventType: TraceEventType,
    fn: () => Promise<T>,
    attrs: (result: T) => Attributes,
  ): Promise<T>;
  recordUsage(usage: UsageRecord): Promise<void>;
  finish(status: "ok" | "failed", patch?: { comparisonId?: string; error?: string }): Promise<void>;
}

interface EmitOpts {
  parentEventId?: string;
  durationMs?: number;
}

@Injectable()
export class RunService {
  private readonly logger = new Logger(RunService.name);
  private readonly sequence = new Map<string, number>();
  private readonly strict = process.env.NODE_ENV !== "production";

  constructor(private readonly prisma: PrismaService) {}

  async start(
    kind: RunKind,
    opts: { requestId: string; pidA?: string; pidB?: string },
  ): Promise<RunContext> {
    const run = await this.prisma.run.create({
      data: {
        kind,
        status: "running",
        requestId: opts.requestId,
        pidA: opts.pidA ?? null,
        pidB: opts.pidB ?? null,
      },
    });
    this.sequence.set(run.id, 0);
    return this.makeContext(run.id);
  }

  private makeContext(runId: string): RunContext {
    const emit = async (
      eventType: TraceEventType,
      attributes: Attributes,
      opts: EmitOpts = {},
    ): Promise<string> => {
      const missing = checkMandatoryAttributes(eventType, attributes);
      if (missing.length > 0) {
        if (this.strict) throw new MissingTraceAttributeError(eventType, missing);
        this.logger.warn(`trace '${eventType}' missing attrs: ${missing.join(", ")}`);
      }
      const seq = this.sequence.get(runId) ?? 0;
      this.sequence.set(runId, seq + 1);
      const ev = await this.prisma.traceEvent.create({
        data: {
          runId,
          sequence: seq,
          eventType,
          attributes,
          parentEventId: opts.parentEventId ?? null,
          durationMs: opts.durationMs ?? null,
        },
      });
      return ev.id;
    };

    const span = async <T>(
      eventType: TraceEventType,
      fn: () => Promise<T>,
      attrs: (result: T) => Attributes,
    ): Promise<T> => {
      const t0 = Date.now();
      try {
        const result = await fn();
        await emit(eventType, attrs(result), { durationMs: Date.now() - t0 });
        return result;
      } catch (err) {
        const e = err as Error;
        await emit(
          "stage_failed",
          { stage: eventType, error_type: e.name, message: e.message },
          { durationMs: Date.now() - t0 },
        );
        throw err;
      }
    };

    const recordUsage = async (usage: UsageRecord): Promise<void> => {
      await this.prisma.usageEvent.create({
        data: {
          runId,
          traceEventId: usage.traceEventId ?? null,
          provider: usage.provider,
          model: usage.model,
          inputTokens: usage.inputTokens ?? 0,
          cachedTokens: usage.cachedTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          costUsd: usage.costUsd ?? 0,
        },
      });
    };

    const finish = async (
      status: "ok" | "failed",
      patch: { comparisonId?: string; error?: string } = {},
    ): Promise<void> => {
      await this.prisma.run.update({
        where: { id: runId },
        data: {
          status,
          finishedAt: new Date(),
          comparisonId: patch.comparisonId ?? null,
          error: patch.error ?? null,
        },
      });
      this.sequence.delete(runId);
    };

    return { runId, emit, span, recordUsage, finish };
  }
}
