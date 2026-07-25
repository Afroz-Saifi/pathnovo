import type { ItemKind } from "@pathnovo/core";

/**
 * Deterministic kind classification, regex-tuned on the seed P&IDs. Typed kinds
 * give the delta engine stable anchors (tags, line specs) and give chat domain
 * vocabulary. Order matters: most specific first.
 */

const EQUIPMENT_TAG = /^\d{1,3}-[A-Z]{1,4}-?\d{3,5}[A-Z]?$/; // 26-KA-9023, 26-CX-9021
const INSTRUMENT_TAG = /^[A-Z]{2,4}\s?\d{3,5}[A-Z]?$/; // PIT9016, TIT9025A
const LINE_SPEC = /\d(\/\d)?"-[A-Z]{2}-\d/; // 3/4"-DC-57-9005-FC11S
const NOTE = /^NOTE\s?\d+/i;
const DIMENSION = /^\d+(\.\d+)?("|”)?\s?[xX×]\s?\d+/; // 4"x8, 3x6
const TABLE_CELLISH = /^[A-Z]{1,3}\d{3,4}$/; // Nxxxx nozzle refs like N3227

export function classifyKind(text: string): ItemKind {
  const t = text.trim();
  if (LINE_SPEC.test(t)) return "line_spec";
  if (EQUIPMENT_TAG.test(t)) return "tag";
  if (NOTE.test(t)) return "note";
  if (DIMENSION.test(t)) return "dimension";
  if (INSTRUMENT_TAG.test(t)) return "tag";
  if (TABLE_CELLISH.test(t)) return "table_cell";
  return "text";
}

/** Parse an equipment tag into structured parts for attrs (best-effort). */
export function tagAttrs(text: string): Record<string, string> | undefined {
  const m = /^(\d{1,3})-([A-Z]{1,4})-?(\d{3,5}[A-Z]?)$/.exec(text.trim());
  if (!m) return undefined;
  return { area: m[1]!, type: m[2]!, num: m[3]! };
}
