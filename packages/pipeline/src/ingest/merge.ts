/**
 * Merge fragmented text runs into logical items: cluster runs into lines by
 * vertical position, then join x-adjacent runs so split tokens reassemble.
 * Shared by the native adapter (pdfjs runs) and the scanned adapter (OCR words)
 * so both produce the SAME granularity — e.g. "NOTE 16" as one item, not two —
 * which is what lets a native revision align with a scanned one.
 */
export interface MergeRun {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional per-run confidence (OCR); merged as the minimum. */
  confidence?: number;
}

export function mergeRuns(runs: MergeRun[]): MergeRun[] {
  if (runs.length === 0) return [];
  const heights = runs.map((r) => r.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] ?? 1;
  const lineTol = medianH * 0.6;

  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: MergeRun[][] = [];
  for (const run of sorted) {
    const line = lines[lines.length - 1];
    const ref = line?.[0];
    if (line && ref && Math.abs(run.y - ref.y) <= lineTol) line.push(run);
    else lines.push([run]);
  }

  const out: MergeRun[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let cur: MergeRun | undefined;
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
        if (run.confidence !== undefined) {
          cur.confidence = Math.min(cur.confidence ?? 1, run.confidence);
        }
      } else {
        out.push(cur);
        cur = { ...run };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}
