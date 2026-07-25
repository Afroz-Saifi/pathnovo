import type { CanonicalDocument } from "@pathnovo/core";

import { DwgAdapter } from "./dwg.adapter.js";
import type { FormatAdapter, IngestContext } from "./format-adapter.js";
import { PdfNativeAdapter } from "./pdf-native.adapter.js";
import { PdfScannedAdapter } from "./pdf-scanned.adapter.js";

const ADAPTERS: FormatAdapter[] = [
  new PdfNativeAdapter(),
  new PdfScannedAdapter(),
  new DwgAdapter(),
];

export interface DetectionResult {
  adapter: FormatAdapter;
  confidence: number;
}

/** Ask every adapter to probe; the highest confidence wins. */
export async function detectFormat(bytes: Buffer): Promise<DetectionResult> {
  const scored = await Promise.all(
    ADAPTERS.map(async (adapter) => ({ adapter, confidence: await adapter.detect(bytes) })),
  );
  scored.sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];
  if (!best || best.confidence === 0) {
    throw new Error("No adapter recognized the input format");
  }
  return best;
}

/** Resolve format and extract to the canonical model. */
export async function ingestDocument(
  pid: string,
  bytes: Buffer,
  ctx?: Partial<IngestContext>,
): Promise<CanonicalDocument> {
  const { adapter } = await detectFormat(bytes);
  return adapter.extract(bytes, {
    pid,
    scannedTextThreshold: ctx?.scannedTextThreshold ?? 50,
  });
}
