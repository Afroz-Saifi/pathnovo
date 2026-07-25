import type { CanonicalDocument, ContentItem } from "@pathnovo/core";

import { classifyKind, tagAttrs } from "./classify.js";
import { contentItemId, type FormatAdapter, type IngestContext } from "./format-adapter.js";
import { mergeRuns } from "./merge.js";
import { normalizeText } from "./normalize.js";
import { loadPdfPages, meanCharsPerPage, type RawPage } from "./pdf.js";

const ADAPTER_VERSION = "1.0.0";

export class PdfNativeAdapter implements FormatAdapter {
  readonly id = "pdf-native" as const;

  async detect(bytes: Buffer): Promise<number> {
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return 0;
    try {
      const mean = await meanCharsPerPage(bytes);
      // Rich text layer ⇒ confidently native. Scale toward 1 by ~200 chars/page.
      return Math.max(0, Math.min(1, mean / 200));
    } catch {
      return 0;
    }
  }

  async extract(bytes: Buffer, ctx: IngestContext): Promise<CanonicalDocument> {
    const pages = await loadPdfPages(bytes);
    const sheets = pages.map((page, index) => ({
      index,
      size: { w: page.width, h: page.height, units: "pt" as const },
      items: buildItems(page, index),
    }));

    return {
      pid: ctx.pid,
      sourceFormat: "pdf-native",
      sheets,
      extraction: { adapter: "pdf-native", version: ADAPTER_VERSION, warnings: [] },
    };
  }
}

function buildItems(page: RawPage, sheetIndex: number): ContentItem[] {
  const merged = mergeRuns(page.runs);
  const items: ContentItem[] = [];
  for (const run of merged) {
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
      id: contentItemId(sheetIndex, kind, text, bbox),
      kind,
      text,
      bbox,
      confidence: 1,
      source: { extractor: "pdfjs" },
      ...(attrs ? { attrs } : {}),
    });
  }
  return items;
}
