import { Injectable, Logger } from "@nestjs/common";
import { type Config, loadConfig } from "@pathnovo/config";
import type { CanonicalDocument, Comparison } from "@pathnovo/core";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";
import type { RunContext } from "../observability/run.service.js";
import { buildChunks } from "./chunking.js";
import { embedTexts } from "./embeddings.js";
import { costUsd } from "./pricing.js";

/** Builds retrieval chunks for a comparison, embeds them, and stores them. */
@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);
  private readonly config: Config = loadConfig();

  constructor(private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return Boolean(this.config.openaiApiKey);
  }

  async indexComparison(
    comparison: Comparison,
    docA: CanonicalDocument,
    docB: CanonicalDocument,
    run?: RunContext,
  ): Promise<number> {
    if (!this.enabled) {
      this.logger.warn("OPENAI_API_KEY unset — skipping chunk indexing");
      return 0;
    }
    const inputs = buildChunks(comparison, docA, docB, this.config.chunkTargetChars);
    const { embeddings, tokens } = await embedTexts(
      inputs.map((c) => c.text),
      this.config.embeddingModel,
    );

    await this.prisma.chunk.createMany({
      data: inputs.map((c, i) => ({
        comparisonId: comparison.id,
        sourceType: c.sourceType,
        sheet: c.sheet,
        text: c.text,
        refs: c.refs as unknown as Prisma.InputJsonValue,
        embedding: embeddings[i] ?? [],
      })),
    });

    if (run) {
      await run.recordUsage({
        provider: "openai",
        model: this.config.embeddingModel,
        inputTokens: tokens,
        costUsd: costUsd(this.config.embeddingModel, tokens),
      });
    }
    return inputs.length;
  }
}
