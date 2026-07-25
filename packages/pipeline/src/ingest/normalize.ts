import type { ItemKind } from "@pathnovo/core";

/** Collapse whitespace; uppercase for identifier-like kinds so revisions align. */
export function normalizeText(kind: ItemKind, raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (kind === "tag" || kind === "line_spec" || kind === "dimension") {
    return collapsed.toUpperCase();
  }
  return collapsed;
}
