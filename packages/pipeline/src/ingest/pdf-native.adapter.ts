import type { CanonicalDocument, ContentItem } from "@pathnovo/core";

import { classifyKind, tagAttrs } from "./classify.js";
import { contentItemId, type FormatAdapter, type IngestContext } from "./format-adapter.js";
import { normalizeText } from "./normalize.js";
import { loadPdfPages, meanCharsPerPage, type RawPage, type RawTextRun } from "./pdf.js";

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

/**
 * Merge fragmented pdfjs text runs into logical items: cluster runs into lines
 * by vertical position, then within a line join x-adjacent runs so split tokens
 * (e.g. a tag broken into "26" "-KA-" "9023") reassemble before classification.
 */
function mergeRuns(runs: RawTextRun[]): RawTextRun[] {
  if (runs.length === 0) return [];
  const heights = runs.map((r) => r.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] ?? 1;
  const lineTol = medianH * 0.6;

  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: RawTextRun[][] = [];
  for (const run of sorted) {
    const line = lines[lines.length - 1];
    const ref = line?.[0];
    if (line && ref && Math.abs(run.y - ref.y) <= lineTol) line.push(run);
    else lines.push([run]);
  }

  const out: RawTextRun[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let cur: RawTextRun | undefined;
    for (const run of line) {
      if (!cur) {
        cur = { ...run };
        continue;
      }
      const gap = run.x - (cur.x + cur.w);
      if (gap < medianH * 0.9) {
        const sep = gap > medianH * 0.15 ? " " : "";
        const right = Math.max(cur.x + cur.w, run.x + run.w);
        cur.str += sep + run.str;
        cur.x = Math.min(cur.x, run.x);
        cur.w = right - cur.x;
        cur.h = Math.max(cur.h, run.h);
        cur.y = Math.min(cur.y, run.y);
      } else {
        out.push(cur);
        cur = { ...run };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}
