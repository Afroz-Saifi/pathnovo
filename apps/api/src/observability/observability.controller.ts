import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import { MetricsService } from "./metrics.service.js";

@Controller()
export class ObservabilityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  @Get("metrics")
  async getMetrics() {
    return this.metrics.snapshot();
  }

  @Get("runs")
  async listRuns(@Query("limit") limit?: string) {
    const take = Math.min(Number(limit ?? 50) || 50, 200);
    const runs = await this.prisma.run.findMany({
      orderBy: { startedAt: "desc" },
      take,
      include: { _count: { select: { traceEvents: true, usageEvents: true } } },
    });
    return runs.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      pidA: r.pidA,
      pidB: r.pidB,
      comparisonId: r.comparisonId,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      events: r._count.traceEvents,
      error: r.error,
    }));
  }

  @Get("runs/:id")
  async getRun(@Param("id") id: string) {
    const run = await this.prisma.run.findUnique({
      where: { id },
      include: {
        traceEvents: { orderBy: { sequence: "asc" } },
        usageEvents: true,
      },
    });
    if (!run) throw new NotFoundException(`run ${id} not found`);
    return run;
  }
}
