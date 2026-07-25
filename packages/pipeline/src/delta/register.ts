import type { Config } from "@pathnovo/config";
import { bboxCenter, type ContentItem, type Registration } from "@pathnovo/core";

import type { Transform } from "./match.js";

/**
 * Estimate a uniform similarity transform (scale + translation, no rotation)
 * mapping A-space -> B-space by least squares over the anchor pairs. This
 * absorbs global drift between revisions (notably scanner scale/offset) so the
 * spatial term in matching becomes meaningful. Falls back to identity when
 * there are too few anchors to trust.
 */
export function estimateRegistration(
  pairs: Array<{ a: ContentItem; b: ContentItem }>,
  c: Config,
): Registration {
  const identity: Registration = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    anchorPairs: pairs.length,
    applied: false,
  };
  if (pairs.length < c.anchorMinPairs) return identity;

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
  if (den < 1e-9) return identity;

  const scale = num / den;
  if (!Number.isFinite(scale) || scale <= 0) return identity;

  return {
    scale,
    offsetX: meanBx - scale * meanAx,
    offsetY: meanBy - scale * meanAy,
    anchorPairs: n,
    applied: true,
  };
}

export function makeTransform(reg: Registration): Transform {
  return (p) => ({ x: reg.scale * p.x + reg.offsetX, y: reg.scale * p.y + reg.offsetY });
}
