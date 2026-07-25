import type { Config } from "@pathnovo/config";
import { bboxCenter, type ContentItem, type Registration } from "@pathnovo/core";

import type { Transform } from "./match.js";

type Pair = { a: ContentItem; b: ContentItem };

const IDENTITY = (pairs: Pair[]): Registration => ({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  anchorPairs: pairs.length,
  applied: false,
});

/** Residual to reject outlier anchors from the fit (normalized units). */
const RESIDUAL_TOL = 0.02;

/**
 * Estimate a uniform similarity transform (scale + translation, no rotation)
 * mapping A-space -> B-space by least squares over the anchor pairs. A single
 * consensus pass drops outlier anchors (e.g. a tag that genuinely moved) before
 * the final fit, so one moved anchor can't drag the whole transform and make
 * every unchanged item look moved. Falls back to identity when too few anchors.
 */
export function estimateRegistration(pairs: Pair[], c: Config): Registration {
  if (pairs.length < c.anchorMinPairs) return IDENTITY(pairs);

  const first = fitLeastSquares(pairs);
  if (!first.applied) return first;

  const t = makeTransform(first);
  const inliers = pairs.filter((p) => residual(t, p) <= RESIDUAL_TOL);
  if (inliers.length >= c.anchorMinPairs && inliers.length < pairs.length) {
    return fitLeastSquares(inliers);
  }
  return first;
}

function fitLeastSquares(pairs: Pair[]): Registration {
  const ca = pairs.map((p) => bboxCenter(p.a.bbox));
  const cb = pairs.map((p) => bboxCenter(p.b.bbox));
  const n = pairs.length;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / n;
  const meanAx = mean(ca.map((p) => p.x));
  const meanAy = mean(ca.map((p) => p.y));
  const meanBx = mean(cb.map((p) => p.x));
  const meanBy = mean(cb.map((p) => p.y));

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dax = ca[i]!.x - meanAx;
    const day = ca[i]!.y - meanAy;
    num += dax * (cb[i]!.x - meanBx) + day * (cb[i]!.y - meanBy);
    den += dax * dax + day * day;
  }
  if (den < 1e-9) return IDENTITY(pairs);

  const scale = num / den;
  if (!Number.isFinite(scale) || scale <= 0) return IDENTITY(pairs);

  return {
    scale,
    offsetX: meanBx - scale * meanAx,
    offsetY: meanBy - scale * meanAy,
    anchorPairs: n,
    applied: true,
  };
}

function residual(t: Transform, p: Pair): number {
  const a = t(bboxCenter(p.a.bbox));
  const b = bboxCenter(p.b.bbox);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function makeTransform(reg: Registration): Transform {
  return (p) => ({ x: reg.scale * p.x + reg.offsetX, y: reg.scale * p.y + reg.offsetY });
}
