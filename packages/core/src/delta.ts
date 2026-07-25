import { z } from "zod";

import { BBoxSchema, ItemKindSchema } from "./canonical.js";

/**
 * The structured delta from PID A (base) to PID B (revised): a set of typed,
 * located, described changes with confidence. Produced deterministically by
 * the delta engine; each entry is independently citable by chat and matchable
 * by the eval harness, so entries are persisted as rows, not just JSON blobs.
 */

export const CHANGE_TYPES = ["added", "removed", "modified"] as const;
export const ChangeTypeSchema = z.enum(CHANGE_TYPES);
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const MODIFY_KINDS = ["text", "moved", "resized"] as const;
export const ModifyKindSchema = z.enum(MODIFY_KINDS);
export type ModifyKind = (typeof MODIFY_KINDS)[number];

export const DeltaEntrySchema = z.object({
  id: z.string(),
  changeType: ChangeTypeSchema,
  /** Present only when changeType === "modified". */
  modifyKind: ModifyKindSchema.optional(),
  itemKind: ItemKindSchema,
  sheet: z.number().int().nonnegative(),
  bboxA: BBoxSchema.optional(),
  bboxB: BBoxSchema.optional(),
  textA: z.string().optional(),
  textB: z.string().optional(),
  /** Deterministic template; LLM-polished only when enrichment is on. */
  description: z.string(),
  confidence: z.number().min(0).max(1),
});
export type DeltaEntry = z.infer<typeof DeltaEntrySchema>;

/** Similarity transform mapping A-space -> B-space (absorbs revision drift). */
export const RegistrationSchema = z.object({
  scale: z.number(),
  offsetX: z.number(),
  offsetY: z.number(),
  anchorPairs: z.number().int().nonnegative(),
  applied: z.boolean(),
});
export type Registration = z.infer<typeof RegistrationSchema>;

export const DeltaSummarySchema = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  modified: z.number().int().nonnegative(),
  byKind: z.record(z.number().int().nonnegative()),
  bySheet: z.record(z.number().int().nonnegative()),
  lowConfidence: z.number().int().nonnegative(),
});
export type DeltaSummary = z.infer<typeof DeltaSummarySchema>;

/** The full comparison artifact — the source of truth for both report projections. */
export const ComparisonSchema = z.object({
  id: z.string(),
  pidA: z.string(),
  pidB: z.string(),
  registration: z.array(RegistrationSchema),
  /** The threshold/weight config snapshot used, for reproducibility. */
  configSnapshot: z.record(z.unknown()),
  entries: z.array(DeltaEntrySchema),
  summary: DeltaSummarySchema,
});
export type Comparison = z.infer<typeof ComparisonSchema>;
