import { createHash } from "node:crypto";

import { type Config, deltaConfigSnapshot } from "@pathnovo/config";
import {
  bboxCenter,
  type CanonicalDocument,
  type Comparison,
  type ContentItem,
  type DeltaEntry,
  type DeltaSummary,
  type ItemKind,
  type Registration,
} from "@pathnovo/core";

import { findAnchors } from "./align.js";
import { addedRemovedConfidence, modifiedConfidence } from "./confidence.js";
import { type Match, matchGroup, type Transform } from "./match.js";
import { estimateRegistration, makeTransform } from "./register.js";

const KIND_LABEL: Record<ItemKind, string> = {
  text: "text",
  tag: "tag",
  line_spec: "line",
  note: "note",
  dimension: "dimension",
  table_cell: "cell",
  symbol: "symbol",
  geometry: "geometry",
};

/**
 * The delta engine. Fully deterministic: sheet pairing -> anchor matching ->
 * registration -> per-kind bipartite matching -> classification -> confidence.
 * No LLM in this path; the same inputs and config always yield identical entries.
 */
export function computeDelta(
  docA: CanonicalDocument,
  docB: CanonicalDocument,
  config: Config,
  opts?: { id?: string },
): Comparison {
  const id = opts?.id ?? shortHash(`${docA.pid}__${docB.pid}`);
  const entries: DeltaEntry[] = [];
  const registrations: Registration[] = [];

  const sheetCount = Math.max(docA.sheets.length, docB.sheets.length);
  for (let s = 0; s < sheetCount; s++) {
    const aSheet = docA.sheets[s];
    const bSheet = docB.sheets[s];

    if (!aSheet) {
      for (const b of bSheet!.items) entries.push(addedEntry(b, s));
      registrations.push(identityReg());
      continue;
    }
    if (!bSheet) {
      for (const a of aSheet.items) entries.push(removedEntry(a, s));
      registrations.push(identityReg());
      continue;
    }

    const { pairs: anchors, remainingA, remainingB } = findAnchors(aSheet.items, bSheet.items);
    const reg = estimateRegistration(anchors, config);
    registrations.push(reg);
    const t = makeTransform(reg);

    const fuzzy = matchRemaining(remainingA, remainingB, t, config);

    const allMatches: Match[] = [
      ...anchors.map((p) => ({ a: p.a, b: p.b, cost: 0, margin: 1 })),
      ...fuzzy.matches,
    ];
    for (const m of allMatches) {
      const entry = classifyMatch(m, s, t, config);
      if (entry) entries.push(entry);
    }
    for (const a of fuzzy.unmatchedA) entries.push(removedEntry(a, s));
    for (const b of fuzzy.unmatchedB) entries.push(addedEntry(b, s));
  }

  return {
    id,
    pidA: docA.pid,
    pidB: docB.pid,
    registration: registrations,
    configSnapshot: deltaConfigSnapshot(config),
    entries,
    summary: summarize(entries, config),
  };
}

export type { Transform };

function matchRemaining(
  remainingA: ContentItem[],
  remainingB: ContentItem[],
  t: Transform,
  config: Config,
) {
  const groupsA = groupByKind(remainingA);
  const groupsB = groupByKind(remainingB);
  const kinds = new Set<ItemKind>([...groupsA.keys(), ...groupsB.keys()]);

  const matches: Match[] = [];
  const unmatchedA: ContentItem[] = [];
  const unmatchedB: ContentItem[] = [];
  for (const kind of kinds) {
    const res = matchGroup(groupsA.get(kind) ?? [], groupsB.get(kind) ?? [], t, config);
    matches.push(...res.matches);
    unmatchedA.push(...res.unmatchedA);
    unmatchedB.push(...res.unmatchedB);
  }
  return { matches, unmatchedA, unmatchedB };
}

function classifyMatch(m: Match, sheet: number, t: Transform, config: Config): DeltaEntry | null {
  if (m.a.text !== m.b.text) {
    return {
      id: entryId("modified", sheet, m.a.text, m.b.text),
      changeType: "modified",
      modifyKind: "text",
      itemKind: m.b.kind,
      sheet,
      bboxA: m.a.bbox,
      bboxB: m.b.bbox,
      textA: m.a.text,
      textB: m.b.text,
      description: `Changed ${KIND_LABEL[m.b.kind]} "${m.a.text}" → "${m.b.text}" on sheet ${sheet + 1}`,
      confidence: modifiedConfidence(m.a, m.b, m.margin),
    };
  }
  const ca = t(bboxCenter(m.a.bbox));
  const cb = bboxCenter(m.b.bbox);
  const disp = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  if (disp > config.moveTolerance) {
    return {
      id: entryId("moved", sheet, m.a.text, m.b.text),
      changeType: "modified",
      modifyKind: "moved",
      itemKind: m.b.kind,
      sheet,
      bboxA: m.a.bbox,
      bboxB: m.b.bbox,
      textA: m.a.text,
      textB: m.b.text,
      description: `Moved ${KIND_LABEL[m.b.kind]} "${m.a.text}" on sheet ${sheet + 1}`,
      confidence: modifiedConfidence(m.a, m.b, m.margin),
    };
  }
  return null; // unchanged
}

function addedEntry(b: ContentItem, sheet: number): DeltaEntry {
  return {
    id: entryId("added", sheet, "", b.text),
    changeType: "added",
    itemKind: b.kind,
    sheet,
    bboxB: b.bbox,
    textB: b.text,
    description: `Added ${KIND_LABEL[b.kind]} "${b.text}" on sheet ${sheet + 1}`,
    confidence: addedRemovedConfidence(b),
  };
}

function removedEntry(a: ContentItem, sheet: number): DeltaEntry {
  return {
    id: entryId("removed", sheet, a.text, ""),
    changeType: "removed",
    itemKind: a.kind,
    sheet,
    bboxA: a.bbox,
    textA: a.text,
    description: `Removed ${KIND_LABEL[a.kind]} "${a.text}" on sheet ${sheet + 1}`,
    confidence: addedRemovedConfidence(a),
  };
}

export function summarizeEntries(entries: DeltaEntry[], config: Config): DeltaSummary {
  return summarize(entries, config);
}

function summarize(entries: DeltaEntry[], config: Config): DeltaSummary {
  const byKind: Record<string, number> = {};
  const bySheet: Record<string, number> = {};
  let added = 0;
  let removed = 0;
  let modified = 0;
  let lowConfidence = 0;
  for (const e of entries) {
    if (e.changeType === "added") added++;
    else if (e.changeType === "removed") removed++;
    else modified++;
    byKind[e.itemKind] = (byKind[e.itemKind] ?? 0) + 1;
    const key = String(e.sheet + 1);
    bySheet[key] = (bySheet[key] ?? 0) + 1;
    if (e.confidence < config.matchThreshold) lowConfidence++;
  }
  return { added, removed, modified, byKind, bySheet, lowConfidence };
}

function groupByKind(items: ContentItem[]): Map<ItemKind, ContentItem[]> {
  const m = new Map<ItemKind, ContentItem[]>();
  for (const it of items) {
    const arr = m.get(it.kind);
    if (arr) arr.push(it);
    else m.set(it.kind, [it]);
  }
  return m;
}

function identityReg(): Registration {
  return { scale: 1, offsetX: 0, offsetY: 0, anchorPairs: 0, applied: false };
}

function entryId(kind: string, sheet: number, textA: string, textB: string): string {
  return shortHash(`${kind}|${sheet}|${textA}|${textB}`);
}

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}
