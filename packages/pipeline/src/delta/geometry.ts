import { createHash } from "node:crypto";

import type { BBox, Comparison, DeltaEntry, Registration } from "@pathnovo/core";

import { renderPdfToPixels, type RenderedPixels } from "../ingest/pdf.js";

/**
 * Image-based geometry diff. Text diffing misses non-text changes — a moved
 * valve, a re-routed pipe, an added symbol. We render both sheets, align them
 * with the text-anchor registration, compare ink coverage on a normalized grid,
 * and emit added/removed/modified GEOMETRY regions. Regions that coincide with a
 * text change are dropped (already reported), so this is purely the drawing's
 * non-text delta.
 */

const GEOM_DPI = 100;
const GRID_W = 200; // grid columns; rows derived from page aspect
const INK = 0.12; // darkness above this = the cell has drawing on it
const DIFF_THRESHOLD = 0.18; // per-cell darkness change to count as a difference
const MIN_REGION_CELLS = 6; // ignore specks
const TEXT_OVERLAP = 0.25; // region dropped if it overlaps a text change this much

type Grid = { d: Float32Array; cols: number; rows: number };

export async function computeGeometryDelta(
  pdfA: Buffer,
  pdfB: Buffer,
  comparison: Comparison,
): Promise<DeltaEntry[]> {
  const pagesA = await renderPdfToPixels(pdfA, GEOM_DPI);
  const pagesB = await renderPdfToPixels(pdfB, GEOM_DPI);
  const entries: DeltaEntry[] = [];
  const sheets = Math.min(pagesA.length, pagesB.length);

  for (let s = 0; s < sheets; s++) {
    const reg = comparison.registration[s] ?? identity();
    const cols = GRID_W;
    const rows = Math.max(1, Math.round((GRID_W * pagesA[s]!.height) / pagesA[s]!.width));
    const gridA = darknessGrid(pagesA[s]!, cols, rows, identity());
    const gridB = darknessGrid(pagesB[s]!, cols, rows, reg);

    // Classify changed cells: 1 added, 2 removed, 3 modified.
    const cls = new Uint8Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) {
      const dA = gridA.d[i]!;
      const dB = gridB.d[i]!;
      if (Math.abs(dA - dB) < DIFF_THRESHOLD) continue;
      if (dB >= INK && dA < INK) cls[i] = 1;
      else if (dA >= INK && dB < INK) cls[i] = 2;
      else cls[i] = 3;
    }

    const textBoxes = comparison.entries
      .filter((e) => e.sheet === s)
      .map((e) => e.bboxB ?? e.bboxA)
      .filter((b): b is BBox => Boolean(b));

    for (const region of connectedRegions(cls, cols, rows)) {
      if (region.cells.length < MIN_REGION_CELLS) continue;
      const bbox = regionBBox(region, cols, rows);
      if (textBoxes.some((tb) => overlapFraction(bbox, tb) > TEXT_OVERLAP)) continue;

      const changeType = majorityChange(region.cells, cls);
      const conf = Math.min(1, region.meanDiff * 2);
      entries.push({
        id: shortHash(`geom|${s}|${bbox.x.toFixed(3)}|${bbox.y.toFixed(3)}`),
        changeType,
        modifyKind: changeType === "modified" ? "text" : undefined,
        itemKind: "geometry",
        sheet: s,
        bboxA: changeType === "added" ? undefined : bbox,
        bboxB: changeType === "removed" ? undefined : bbox,
        description: `${cap(changeType)} drawing/geometry near (${pct(bbox.x)}, ${pct(bbox.y)}) on sheet ${s + 1}`,
        confidence: Math.round(conf * 100) / 100,
      });
    }
  }

  return entries;
}

/** Mean darkness per grid cell, sampling `img` through transform `t` (A→B space). */
function darknessGrid(img: RenderedPixels, cols: number, rows: number, t: Registration): Grid {
  const d = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u0 = t.scale * (i / cols) + t.offsetX;
      const u1 = t.scale * ((i + 1) / cols) + t.offsetX;
      const v0 = t.scale * (j / rows) + t.offsetY;
      const v1 = t.scale * ((j + 1) / rows) + t.offsetY;
      d[j * cols + i] = meanDarkness(img, u0, v0, u1, v1);
    }
  }
  return { d, cols, rows };
}

function meanDarkness(img: RenderedPixels, u0: number, v0: number, u1: number, v1: number): number {
  const x0 = Math.max(0, Math.floor(u0 * img.width));
  const x1 = Math.min(img.width, Math.ceil(u1 * img.width));
  const y0 = Math.max(0, Math.floor(v0 * img.height));
  const y1 = Math.min(img.height, Math.ceil(v1 * img.height));
  if (x1 <= x0 || y1 <= y0) return 0; // outside the page → blank
  let sum = 0;
  let n = 0;
  const stepX = Math.max(1, Math.floor((x1 - x0) / 6));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 6));
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      sum += img.darkness[y * img.width + x]!;
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

interface Region {
  cells: number[];
  meanDiff: number;
}

/**
 * 4-connected components over changed cells. The mask is dilated by one cell
 * first so a hollow symbol (a rectangle outline with a blank centre) clusters
 * into one region instead of separate edges; classification/bbox still use only
 * the truly-changed cells.
 */
function connectedRegions(cls: Uint8Array, cols: number, rows: number): Region[] {
  const active = new Uint8Array(cols * rows);
  for (let idx = 0; idx < cols * rows; idx++) {
    if (cls[idx] === 0) continue;
    const x = idx % cols;
    const y = (idx / cols) | 0;
    active[idx] = 1;
    if (x > 0) active[idx - 1] = 1;
    if (x < cols - 1) active[idx + 1] = 1;
    if (y > 0) active[idx - cols] = 1;
    if (y < rows - 1) active[idx + cols] = 1;
  }

  const seen = new Uint8Array(cols * rows);
  const regions: Region[] = [];
  const stack: number[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (!active[start] || seen[start]) continue;
    const component: number[] = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      component.push(idx);
      const x = idx % cols;
      const y = (idx / cols) | 0;
      const nbrs = [
        x > 0 ? idx - 1 : -1,
        x < cols - 1 ? idx + 1 : -1,
        y > 0 ? idx - cols : -1,
        y < rows - 1 ? idx + cols : -1,
      ];
      for (const nb of nbrs) {
        if (nb >= 0 && !seen[nb] && active[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    // Keep only the genuinely-changed cells for bbox + classification.
    const cells = component.filter((c) => cls[c] !== 0);
    if (cells.length > 0) regions.push({ cells, meanDiff: DIFF_THRESHOLD + 0.2 });
  }
  return regions;
}

function regionBBox(region: Region, cols: number, rows: number): BBox {
  let minX = cols;
  let minY = rows;
  let maxX = 0;
  let maxY = 0;
  for (const idx of region.cells) {
    const x = idx % cols;
    const y = (idx / cols) | 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1);
    maxY = Math.max(maxY, y + 1);
  }
  return { x: minX / cols, y: minY / rows, w: (maxX - minX) / cols, h: (maxY - minY) / rows };
}

function majorityChange(cells: number[], cls: Uint8Array): DeltaEntry["changeType"] {
  let added = 0;
  let removed = 0;
  for (const c of cells) {
    if (cls[c] === 1) added++;
    else if (cls[c] === 2) removed++;
  }
  if (added > removed * 1.5) return "added";
  if (removed > added * 1.5) return "removed";
  return "modified";
}

function overlapFraction(a: BBox, b: BBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  const inter = (x1 - x0) * (y1 - y0);
  const areaA = a.w * a.h;
  return areaA === 0 ? 0 : inter / areaA;
}

function identity(): Registration {
  return { scale: 1, offsetX: 0, offsetY: 0, anchorPairs: 0, applied: false };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
