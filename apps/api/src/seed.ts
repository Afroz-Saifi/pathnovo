import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "@pathnovo/config";
import { computeDelta, ingestDocument } from "@pathnovo/pipeline";
import { Prisma, PrismaClient } from "@prisma/client";

import { buildChunks } from "./chat/chunking.js";
import { embedTexts } from "./chat/embeddings.js";

/**
 * Seed the demo comparison on container boot so `docker compose up` lands a
 * ready-to-explore pair (compare + chat). Idempotent and non-fatal: any error
 * is logged and the server still starts.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const config = loadConfig();
  const dir = resolve(process.cwd(), "../../data/samples/pair-1");

  const bytesA = readFileSync(resolve(dir, "revA.pdf"));
  const bytesB = readFileSync(resolve(dir, "revB.pdf"));
  const docA = await ingestDocument("revA", bytesA);
  const docB = await ingestDocument("revB", bytesB);
  const c = computeDelta(docA, docB, config);

  await prisma.comparison.deleteMany({ where: { id: c.id } });
  await prisma.comparison.create({
    data: {
      id: c.id,
      pidA: c.pidA,
      pidB: c.pidB,
      registration: c.registration as unknown as Prisma.InputJsonValue,
      configSnapshot: c.configSnapshot as unknown as Prisma.InputJsonValue,
      summary: c.summary as unknown as Prisma.InputJsonValue,
      pdfA: bytesA,
      pdfB: bytesB,
    },
  });
  await prisma.deltaEntry.createMany({
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

  if (config.openaiApiKey) {
    const inputs = buildChunks(c, docA, docB, config.chunkTargetChars);
    const { embeddings } = await embedTexts(inputs.map((x) => x.text), config.embeddingModel);
    await prisma.chunk.createMany({
      data: inputs.map((x, i) => ({
        comparisonId: c.id,
        sourceType: x.sourceType,
        sheet: x.sheet,
        text: x.text,
        refs: x.refs as unknown as Prisma.InputJsonValue,
        embedding: embeddings[i] ?? [],
      })),
    });
    console.log(`seeded comparison ${c.id}: ${c.entries.length} entries, ${inputs.length} chunks`);
  } else {
    console.log(`seeded comparison ${c.id}: ${c.entries.length} entries (no key — chunks skipped)`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("seed failed (continuing):", (e as Error).message);
  process.exit(0);
});
