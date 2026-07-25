import type { CanonicalDocument, ContentItem, Sheet } from "@pathnovo/core";
import Tesseract from "tesseract.js";

import { classifyKind, tagAttrs } from "./classify.js";
import { contentItemId, type FormatAdapter, type IngestContext } from "./format-adapter.js";
import { mergeRuns, type MergeRun } from "./merge.js";
import { normalizeText } from "./normalize.js";
import { meanCharsPerPage, renderPdfToImages } from "./pdf.js";

const ADAPTER_VERSION = "1.0.0";
const MIN_WORD_CONFIDENCE = 0.3; // drop OCR noise below this

/**
 * Scanned-PDF adapter. Detection is real (a %PDF with a near-empty text layer);
 * extraction rasterizes each page and runs Tesseract OCR to recover word-level
 * text, bounding boxes, and per-word confidence — which flow through to the
 * canonical model and, ultimately, delta confidence.
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

  async extract(bytes: Buffer, ctx: IngestContext): Promise<CanonicalDocument> {
    const dpi = ctx.ocrDpi ?? 300;
    const lang = ctx.ocrLang ?? "eng";
    const pages = await renderPdfToImages(bytes, dpi);

    const sheets: Sheet[] = [];
    const warnings: CanonicalDocument["extraction"]["warnings"] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      const { data } = await Tesseract.recognize(page.png, lang);
      // OCR words -> raw runs (pixel coords), then merge with the SAME logic the
      // native adapter uses, so a scanned "NOTE 16" becomes one item like native.
      const runs: MergeRun[] = [];
      for (const w of data.words ?? []) {
        const confidence = Math.max(0, Math.min(1, (w.confidence ?? 0) / 100));
        if (w.text.trim() === "" || confidence < MIN_WORD_CONFIDENCE) continue;
        runs.push({
          str: w.text.trim(),
          x: w.bbox.x0,
          y: w.bbox.y0,
          w: w.bbox.x1 - w.bbox.x0,
          h: w.bbox.y1 - w.bbox.y0,
          confidence,
        });
      }

      const items: ContentItem[] = [];
      for (const run of mergeRuns(runs)) {
        const rawText = run.str.trim();
        if (rawText === "") continue;
        const kind = classifyKind(rawText);
        const text = normalizeText(kind, rawText);
        const bbox = {
          x: run.x / page.width,
          y: run.y / page.height,
          w: run.w / page.width,
          h: run.h / page.height,
        };
        const attrs = kind === "tag" ? tagAttrs(text) : undefined;
        items.push({
          id: contentItemId(i, kind, text, bbox),
          kind,
          text,
          bbox,
          confidence: run.confidence ?? 1,
          source: { extractor: "tesseract" },
          ...(attrs ? { attrs } : {}),
        });
      }
      if (items.length === 0) {
        warnings.push({ code: "ocr_empty", message: `no text recovered on sheet ${i + 1}`, sheet: i });
      }
      sheets.push({ index: i, size: { w: page.width, h: page.height, units: "px" }, items });
    }

    return {
      pid: ctx.pid,
      sourceFormat: "pdf-scanned",
      sheets,
      extraction: { adapter: "pdf-scanned", version: ADAPTER_VERSION, warnings },
    };
  }
}
