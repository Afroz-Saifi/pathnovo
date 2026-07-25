import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

import { Injectable } from "@nestjs/common";
import { type Config, loadConfig } from "@pathnovo/config";
import type { CanonicalDocument, Comparison, DeltaEntry } from "@pathnovo/core";
import { computeDelta, detectFormat, toMarkdown } from "@pathnovo/pipeline";
import { Prisma } from "@prisma/client";

import { IndexingService } from "../chat/indexing.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { RunContext } from "../observability/run.service.js";
import { RunService } from "../observability/run.service.js";

export interface UploadedDoc {
  buffer: Buffer;
  originalname: string;
}

@Injectable()
export class ComparisonsService {
  private readonly config: Config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: RunService,
    private readonly indexing: IndexingService,
  ) {}

  async createFromFiles(a: UploadedDoc, b: UploadedDoc, requestId: string) {
    const pidA = pid(a.originalname);
    const pidB = pid(b.originalname);
    const run = await this.runs.start("delta", { requestId, pidA, pidB });
    try {
      const docA = await this.ingestAndPersist(run, pidA, a);
      const docB = await this.ingestAndPersist(run, pidB, b);

      const comparison = await run.span(
        "delta_computed",
        async () => computeDelta(docA, docB, this.config),
        (c) => ({
          added: c.summary.added,
          removed: c.summary.removed,
          modified: c.summary.modified,
          anchor_pairs: c.registration[0]?.anchorPairs ?? 0,
          registration_scale: c.registration[0]?.scale ?? 1,
        }),
      );

      await this.persistComparison(comparison);
      await run.emit("comparison_persisted", {
        comparisonId: comparison.id,
        entries: comparison.entries.length,
      });

      await run.span(
        "chunks_indexed",
        () => this.indexing.indexComparison(comparison, docA, docB, run),
        (chunks) => ({ chunks }),
      );

      await run.finish("ok", { comparisonId: comparison.id });

      return { comparisonId: comparison.id, runId: run.runId, summary: comparison.summary };
    } catch (err) {
      await run.finish("failed", { error: (err as Error).message });
      throw err;
    }
  }

  private async ingestAndPersist(
    run: RunContext,
    pidValue: string,
    file: UploadedDoc,
  ): Promise<CanonicalDocument> {
    await run.emit("ingest_started", { pid: pidValue });
    const det = await detectFormat(file.buffer);
    await run.emit("format_detected", {
      pid: pidValue,
      adapter: det.adapter.id,
      detect_confidence: round(det.confidence),
    });

    return run.span(
      "canonical_persisted",
      async () => {
        const doc = await det.adapter.extract(file.buffer, {
          pid: pidValue,
          scannedTextThreshold: this.config.scannedTextThreshold,
        });
        await this.prisma.document.create({
          data: {
            pid: pidValue,
            format: doc.sourceFormat,
            revisionLabel: doc.revisionLabel ?? null,
            filename: file.originalname,
            sha256: createHash("sha256").update(file.buffer).digest("hex"),
            pageCount: doc.sheets.length,
            canonical: doc as unknown as Prisma.InputJsonValue,
            warnings: doc.extraction.warnings as unknown as Prisma.InputJsonValue,
          },
        });
        return doc;
      },
      (doc) => ({
        pid: pidValue,
        items: doc.sheets.reduce((s, sh) => s + sh.items.length, 0),
      }),
    );
  }

  private async persistComparison(c: Comparison): Promise<void> {
    // Re-ingesting the same pair yields the same deterministic id; replace it
    // (cascade clears prior entries, chunks, and chat) so runs are idempotent.
    await this.prisma.comparison.deleteMany({ where: { id: c.id } });
    await this.prisma.comparison.create({
      data: {
        id: c.id,
        pidA: c.pidA,
        pidB: c.pidB,
        registration: c.registration as unknown as Prisma.InputJsonValue,
        configSnapshot: c.configSnapshot as unknown as Prisma.InputJsonValue,
        summary: c.summary as unknown as Prisma.InputJsonValue,
      },
    });
    await this.prisma.deltaEntry.createMany({
      data: c.entries.map((e, i) => ({
        id: `${c.id}:${i}`,
        comparisonId: c.id,
        changeType: e.changeType,
        modifyKind: e.modifyKind ?? null,
        itemKind: e.itemKind,
        sheet: e.sheet,
        bboxA: (e.bboxA as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        bboxB: (e.bboxB as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        textA: e.textA ?? null,
        textB: e.textB ?? null,
        description: e.description,
        confidence: e.confidence,
      })),
    });
  }

  async getComparison(id: string) {
    return this.prisma.comparison.findUnique({ where: { id }, include: { entries: true } });
  }

  async getReportMarkdown(id: string): Promise<string | null> {
    const row = await this.prisma.comparison.findUnique({ where: { id }, include: { entries: true } });
    if (!row) return null;
    const comparison: Comparison = {
      id: row.id,
      pidA: row.pidA,
      pidB: row.pidB,
      registration: row.registration as Comparison["registration"],
      configSnapshot: row.configSnapshot as Comparison["configSnapshot"],
      summary: row.summary as Comparison["summary"],
      entries: row.entries.map(
        (e): DeltaEntry => ({
          id: e.id,
          changeType: e.changeType as DeltaEntry["changeType"],
          modifyKind: (e.modifyKind ?? undefined) as DeltaEntry["modifyKind"],
          itemKind: e.itemKind as DeltaEntry["itemKind"],
          sheet: e.sheet,
          bboxA: (e.bboxA as DeltaEntry["bboxA"]) ?? undefined,
          bboxB: (e.bboxB as DeltaEntry["bboxB"]) ?? undefined,
          textA: e.textA ?? undefined,
          textB: e.textB ?? undefined,
          description: e.description,
          confidence: e.confidence,
        }),
      ),
    };
    return toMarkdown(comparison);
  }
}

function pid(filename: string): string {
  return basename(filename, extname(filename));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
