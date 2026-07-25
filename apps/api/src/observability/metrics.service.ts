import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot() {
    const [runs, events, usage, comparisons, entries] = await Promise.all([
      this.prisma.run.findMany({ select: { kind: true, status: true } }),
      this.prisma.traceEvent.findMany({
        where: { durationMs: { not: null } },
        select: { eventType: true, durationMs: true },
      }),
      this.prisma.usageEvent.aggregate({
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      }),
      this.prisma.comparison.count(),
      this.prisma.deltaEntry.count(),
    ]);

    return {
      runs: {
        total: runs.length,
        byStatus: tally(runs.map((r) => r.status)),
        byKind: tally(runs.map((r) => r.kind)),
      },
      latencyMsByStage: latencyByStage(events),
      tokens: {
        input: usage._sum.inputTokens ?? 0,
        output: usage._sum.outputTokens ?? 0,
        costUsd: round(usage._sum.costUsd ?? 0),
      },
      deltas: { comparisons, entries },
    };
  }
}

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function latencyByStage(
  events: Array<{ eventType: string; durationMs: number | null }>,
): Record<string, { p50: number; p95: number; count: number }> {
  const groups = new Map<string, number[]>();
  for (const e of events) {
    if (e.durationMs === null) continue;
    const arr = groups.get(e.eventType) ?? [];
    arr.push(e.durationMs);
    groups.set(e.eventType, arr);
  }
  const out: Record<string, { p50: number; p95: number; count: number }> = {};
  for (const [stage, values] of groups) {
    values.sort((a, b) => a - b);
    out[stage] = { p50: percentile(values, 0.5), p95: percentile(values, 0.95), count: values.length };
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx] ?? 0;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
