import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { loadConfig } from "@pathnovo/config";
import {
  computeDelta,
  computeGeometryDelta,
  ingestDocument,
  summarizeEntries,
  toJSON,
  toMarkdown,
  UnsupportedFormatError,
} from "@pathnovo/pipeline";

/**
 * Slice-1 CLI: ingest two documents, compute the delta, write the report.
 *   pnpm --filter @pathnovo/api delta -- <pidA.pdf> <pidB.pdf>
 */
async function main(): Promise<void> {
  const [aPath, bPath] = process.argv.slice(2).filter((a) => a !== "--");
  if (!aPath || !bPath) {
    console.error("usage: delta <pidA.(pdf)> <pidB.(pdf)>");
    process.exit(1);
  }

  const config = loadConfig();
  const pid = (p: string) => basename(p, extname(p));
  // pnpm runs the script from the package dir; resolve paths against the
  // directory the command was actually invoked from.
  const base = process.env.INIT_CWD ?? process.cwd();

  const bytesA = readFileSync(resolve(base, aPath));
  const bytesB = readFileSync(resolve(base, bPath));
  const docA = await ingestDocument(pid(aPath), bytesA);
  const docB = await ingestDocument(pid(bPath), bytesB);
  const comparison = computeDelta(docA, docB, config);

  if (config.geomEnabled) {
    const geom = await computeGeometryDelta(bytesA, bytesB, comparison);
    if (geom.length > 0) {
      comparison.entries = [...comparison.entries, ...geom];
      comparison.summary = summarizeEntries(comparison.entries, config);
    }
  }

  const outDir = resolve(base, "out", comparison.id);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "delta-report.json"), toJSON(comparison));
  writeFileSync(resolve(outDir, "delta-report.md"), toMarkdown(comparison));

  const s = comparison.summary;
  console.log(`${pid(aPath)} → ${pid(bPath)}`);
  console.log(`${s.added} added, ${s.removed} removed, ${s.modified} modified` + (s.lowConfidence ? ` (${s.lowConfidence} low-confidence)` : ""));
  console.log(`→ ${outDir}/delta-report.{md,json}`);
}

main().catch((err) => {
  if (err instanceof UnsupportedFormatError) {
    console.error(`Unsupported input: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
