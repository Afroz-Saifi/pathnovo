import type { ContentItem } from "@pathnovo/core";

/**
 * Confidence composition. Source confidence flows through (OCR-derived changes
 * are systematically less certain than native-text ones), and for modifications
 * the match margin damps ambiguous assignments. Values are carried, not invented.
 */

export function addedRemovedConfidence(item: ContentItem): number {
  return round(item.confidence);
}

export function modifiedConfidence(a: ContentItem, b: ContentItem, margin: number): number {
  const source = Math.min(a.confidence, b.confidence);
  return round(source * (0.5 + 0.5 * margin));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
