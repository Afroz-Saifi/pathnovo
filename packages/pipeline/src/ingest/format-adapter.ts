import { createHash } from "node:crypto";

import type { CanonicalDocument, SourceFormat } from "@pathnovo/core";

/**
 * The one interface every format plugs in behind. A new format is a new adapter
 * emitting a CanonicalDocument; nothing downstream changes. `detect` is a cheap
 * probe returning 0..1 confidence; the registry asks every adapter and the
 * highest score wins.
 */
export interface FormatAdapter {
  readonly id: SourceFormat;
  detect(bytes: Buffer): Promise<number>;
  extract(bytes: Buffer, ctx: IngestContext): Promise<CanonicalDocument>;
}

export interface IngestContext {
  pid: string;
  /** Below this many extractable chars/page a PDF is treated as scanned. */
  scannedTextThreshold: number;
}

/** Raised by adapters that recognize a format but can't (yet) parse it. */
export class UnsupportedFormatError extends Error {
  constructor(
    public readonly format: string,
    public readonly hint: string,
  ) {
    super(`Unsupported format '${format}': ${hint}`);
    this.name = "UnsupportedFormatError";
  }
}

/** Stable within a document: sha1 over sheet, kind, text, and a quantized bbox. */
export function contentItemId(
  sheet: number,
  kind: string,
  text: string,
  bbox: { x: number; y: number; w: number; h: number },
): string {
  const q = (n: number) => Math.round(n * 1000);
  const key = `${sheet}|${kind}|${text}|${q(bbox.x)},${q(bbox.y)},${q(bbox.w)},${q(bbox.h)}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}
