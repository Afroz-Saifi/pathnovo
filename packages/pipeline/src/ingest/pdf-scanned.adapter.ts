import type { CanonicalDocument } from "@pathnovo/core";

import {
  UnsupportedFormatError,
  type FormatAdapter,
  type IngestContext,
} from "./format-adapter.js";
import { meanCharsPerPage } from "./pdf.js";

/**
 * Scanned-PDF seam. Detection is real (a %PDF with a near-empty text layer);
 * the OCR extract path (tesseract + optional vision assist) lands in slice 5,
 * so for now it fails loud and typed rather than silently.
 */
export class PdfScannedAdapter implements FormatAdapter {
  readonly id = "pdf-scanned" as const;

  async detect(bytes: Buffer): Promise<number> {
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return 0;
    try {
      const mean = await meanCharsPerPage(bytes);
      return mean < 50 ? 0.9 : 0.05;
    } catch {
      return 0;
    }
  }

  async extract(_bytes: Buffer, _ctx: IngestContext): Promise<CanonicalDocument> {
    throw new UnsupportedFormatError(
      "pdf-scanned",
      "OCR adapter (tesseract + vision assist) lands in a later slice",
    );
  }
}
