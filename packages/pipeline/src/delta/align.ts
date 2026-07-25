import type { ContentItem } from "@pathnovo/core";

export interface AnchorResult {
  pairs: Array<{ a: ContentItem; b: ContentItem }>;
  remainingA: ContentItem[];
  remainingB: ContentItem[];
}

const ANCHOR_KINDS = new Set(["tag", "line_spec"]);

/**
 * Anchor matching — the stable skeleton. Pair items whose normalized text is
 * identical AND unique on both sides, restricted to high-uniqueness kinds
 * (tags, line specs). These are what stay put across a revision, so they seed
 * registration and are removed from the pool the fuzzy matcher then works on.
 */
export function findAnchors(aItems: ContentItem[], bItems: ContentItem[]): AnchorResult {
  const indexUnique = (items: ContentItem[]) => {
    const seen = new Map<string, ContentItem | null>();
    for (const it of items) {
      if (!ANCHOR_KINDS.has(it.kind)) continue;
      seen.set(it.text, seen.has(it.text) ? null : it); // null marks non-unique
    }
    return seen;
  };

  const aByText = indexUnique(aItems);
  const bByText = indexUnique(bItems);

  const pairs: AnchorResult["pairs"] = [];
  const pairedA = new Set<ContentItem>();
  const pairedB = new Set<ContentItem>();
  for (const [text, a] of aByText) {
    if (!a) continue;
    const b = bByText.get(text);
    if (!b) continue;
    pairs.push({ a, b });
    pairedA.add(a);
    pairedB.add(b);
  }

  return {
    pairs,
    remainingA: aItems.filter((it) => !pairedA.has(it)),
    remainingB: bItems.filter((it) => !pairedB.has(it)),
  };
}
