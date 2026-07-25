import type { DeltaEntry } from "@pathnovo/core";

/**
 * Delta precision / recall / F1. Predicted entries are matched to ground-truth
 * entries by (changeType, normalized text) — added on textB, removed/modified
 * on textA. Unmatched predictions are false positives (invented changes);
 * unmatched truth entries are false negatives (missed changes).
 */
export interface ExpectedEntry {
  changeType: "added" | "removed" | "modified";
  modifyKind?: string;
  itemKind: string;
  textA?: string;
  textB?: string;
}

export interface DeltaScore {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  missed: string[];
  spurious: string[];
}

function keyOf(e: { changeType: string; textA?: string | null; textB?: string | null }): string {
  const text = e.changeType === "added" ? e.textB : e.textA;
  return `${e.changeType}|${(text ?? "").toUpperCase().replace(/\s+/g, " ").trim()}`;
}

export function scoreDelta(predicted: DeltaEntry[], expected: ExpectedEntry[]): DeltaScore {
  const expKeys = new Map<string, number>();
  for (const e of expected) expKeys.set(keyOf(e), (expKeys.get(keyOf(e)) ?? 0) + 1);

  const remaining = new Map(expKeys);
  let tp = 0;
  const spurious: string[] = [];
  for (const p of predicted) {
    const k = keyOf(p);
    const count = remaining.get(k) ?? 0;
    if (count > 0) {
      tp += 1;
      remaining.set(k, count - 1);
    } else {
      spurious.push(k);
    }
  }
  const missed: string[] = [];
  for (const [k, count] of remaining) for (let i = 0; i < count; i++) missed.push(k);

  const fp = spurious.length;
  const fn = missed.length;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1, missed, spurious };
}
