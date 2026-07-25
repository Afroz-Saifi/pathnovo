import type { Config } from "@pathnovo/config";
import { bboxCenter, type ContentItem } from "@pathnovo/core";
import { distance } from "fastest-levenshtein";

/** Point transform mapping A-space -> B-space (from registration). */
export type Transform = (p: { x: number; y: number }) => { x: number; y: number };

export interface Match {
  a: ContentItem;
  b: ContentItem;
  cost: number;
  /** Gap to the runner-up assignment for a's row (0 ambiguous .. 1 clear). */
  margin: number;
}

export interface GroupMatchResult {
  matches: Match[];
  unmatchedA: ContentItem[];
  unmatchedB: ContentItem[];
}

const SPATIAL_NORM = 0.5; // normalized distance that saturates the spatial term
const MAX_MATCH_DIST = 0.2; // hard gate: items farther apart than this can't be the same item
const HUNGARIAN_MAX = 150; // above this, fall back to greedy (keeps it fast)
const BIG = 10;

function textSim(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - distance(a, b) / max;
}

/** Pair cost within a kind group. Lower is a better match; BIG means ineligible. */
export function pairCost(a: ContentItem, b: ContentItem, t: Transform, c: Config): number {
  const ca = t(bboxCenter(a.bbox));
  const cb = bboxCenter(b.bbox);
  const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  // Hard spatial gate: two items far apart on the sheet are not the same item,
  // so they must surface as a genuine add + remove, never a forced modify.
  if (dist > MAX_MATCH_DIST) return BIG;
  const spatial = Math.min(1, dist / SPATIAL_NORM);
  return c.wText * (1 - textSim(a.text, b.text)) + c.wSpatial * spatial;
}

/** Optimal (Hungarian) or greedy assignment within one kind group. */
export function matchGroup(
  aItems: ContentItem[],
  bItems: ContentItem[],
  t: Transform,
  c: Config,
): GroupMatchResult {
  if (aItems.length === 0 || bItems.length === 0) {
    return { matches: [], unmatchedA: [...aItems], unmatchedB: [...bItems] };
  }
  const big = Math.max(aItems.length, bItems.length);
  return big <= HUNGARIAN_MAX
    ? hungarianMatch(aItems, bItems, t, c)
    : greedyMatch(aItems, bItems, t, c);
}

function costMatrix(
  aItems: ContentItem[],
  bItems: ContentItem[],
  t: Transform,
  c: Config,
): Float64Array {
  const rows = aItems.length;
  const cols = bItems.length;
  const m = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      m[i * cols + j] = pairCost(aItems[i]!, bItems[j]!, t, c);
    }
  }
  return m;
}

function runnerUp(cost: Float64Array, row: number, cols: number, chosenCol: number): number {
  let best = Infinity;
  for (let j = 0; j < cols; j++) {
    if (j === chosenCol) continue;
    const v = cost[row * cols + j]!;
    if (v < best) best = v;
  }
  return best === Infinity ? 1 : best;
}

function hungarianMatch(
  aItems: ContentItem[],
  bItems: ContentItem[],
  t: Transform,
  c: Config,
): GroupMatchResult {
  const rows = aItems.length;
  const cols = bItems.length;
  const cost = costMatrix(aItems, bItems, t, c);
  const assign = hungarian(cost, rows, cols); // row -> col (or -1)

  const matches: Match[] = [];
  const usedB = new Set<number>();
  const unmatchedA: ContentItem[] = [];
  for (let i = 0; i < rows; i++) {
    const j = assign[i]!;
    const cell = j >= 0 ? cost[i * cols + j]! : BIG;
    if (j >= 0 && cell <= c.matchThreshold) {
      const margin = Math.max(0, Math.min(1, runnerUp(cost, i, cols, j) - cell));
      matches.push({ a: aItems[i]!, b: bItems[j]!, cost: cell, margin });
      usedB.add(j);
    } else {
      unmatchedA.push(aItems[i]!);
    }
  }
  const unmatchedB = bItems.filter((_, j) => !usedB.has(j));
  return { matches, unmatchedA, unmatchedB };
}

/** Greedy mutual-best fallback for large groups. Deterministic. */
function greedyMatch(
  aItems: ContentItem[],
  bItems: ContentItem[],
  t: Transform,
  c: Config,
): GroupMatchResult {
  const cols = bItems.length;
  const cost = costMatrix(aItems, bItems, t, c);
  const pairs: Array<{ i: number; j: number; cost: number }> = [];
  for (let i = 0; i < aItems.length; i++) {
    for (let j = 0; j < cols; j++) {
      const v = cost[i * cols + j]!;
      if (v <= c.matchThreshold) pairs.push({ i, j, cost: v });
    }
  }
  pairs.sort((x, y) => x.cost - y.cost || x.i - y.i || x.j - y.j);

  const takenA = new Set<number>();
  const takenB = new Set<number>();
  const matches: Match[] = [];
  for (const p of pairs) {
    if (takenA.has(p.i) || takenB.has(p.j)) continue;
    takenA.add(p.i);
    takenB.add(p.j);
    const margin = Math.max(0, Math.min(1, runnerUp(cost, p.i, cols, p.j) - p.cost));
    matches.push({ a: aItems[p.i]!, b: bItems[p.j]!, cost: p.cost, margin });
  }
  const unmatchedA = aItems.filter((_, i) => !takenA.has(i));
  const unmatchedB = bItems.filter((_, j) => !takenB.has(j));
  return { matches, unmatchedA, unmatchedB };
}

/**
 * Kuhn-Munkres (Hungarian) minimal-cost assignment, O(n^3), on a rectangular
 * cost matrix padded to square with BIG. Returns row -> col (-1 if unassigned
 * or padded). Uses flat typed arrays so indexing stays number, not number|undef.
 */
function hungarian(cost: Float64Array, rows: number, cols: number): Int32Array {
  const n = Math.max(rows, cols);
  const a = new Float64Array(n * n);
  a.fill(BIG);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) a[i * n + j] = cost[i * cols + j]!;

  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1); // p[j] = row (1-based) assigned to col j
  const way = new Int32Array(n + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = -1;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[(i0 - 1) * n + (j - 1)]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          const pj = p[j]!;
          u[pj] = u[pj]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = new Int32Array(rows).fill(-1);
  for (let j = 1; j <= n; j++) {
    const row = p[j]! - 1;
    const col = j - 1;
    if (row >= 0 && row < rows && col < cols) result[row] = col;
  }
  return result;
}
