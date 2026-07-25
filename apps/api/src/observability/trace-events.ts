/**
 * Trace-event catalogue with mandatory attributes per type. The emitter checks
 * these on every event (throws in dev/test, warns in prod) so a trace can never
 * silently lose the fields cost accounting and eval replay depend on. Attribute
 * names follow OTel GenAI conventions (`gen_ai.*`) with a `pathnovo.*` extension.
 */

export const TRACE_EVENT_TYPES = [
  "ingest_started",
  "format_detected",
  "canonical_persisted",
  "delta_computed",
  "geometry_diff",
  "comparison_persisted",
  "chunks_indexed",
  "stage_failed",
  // chat path (later slices)
  "retrieval_completed",
  "llm_call_started",
  "llm_call_completed",
  "citation_validation_failed",
  // eval harness
  "eval_delta_scored",
  "eval_chat_scored",
] as const;

export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

export type AttrValue = string | number | boolean | null;
export type Attributes = Record<string, AttrValue>;

export const MANDATORY_ATTRIBUTES: Record<TraceEventType, readonly string[]> = {
  ingest_started: ["pid"],
  format_detected: ["pid", "adapter", "detect_confidence"],
  canonical_persisted: ["pid", "items"],
  delta_computed: ["added", "removed", "modified", "anchor_pairs"],
  geometry_diff: ["geometry_changes"],
  comparison_persisted: ["comparisonId", "entries"],
  chunks_indexed: ["chunks"],
  stage_failed: ["stage", "error_type"],
  retrieval_completed: ["vector_hits", "fts_hits", "fused_k"],
  llm_call_started: ["gen_ai.system", "gen_ai.request.model"],
  llm_call_completed: [
    "gen_ai.system",
    "gen_ai.request.model",
    "gen_ai.usage.input_tokens",
    "gen_ai.usage.output_tokens",
  ],
  citation_validation_failed: ["ref", "reason"],
  eval_delta_scored: ["pair", "precision", "recall", "f1"],
  eval_chat_scored: ["groundedness", "correctness", "refusal"],
};

export class MissingTraceAttributeError extends Error {
  constructor(
    public readonly eventType: TraceEventType,
    public readonly missing: string[],
  ) {
    super(`Trace event '${eventType}' is missing mandatory attributes: ${missing.join(", ")}`);
    this.name = "MissingTraceAttributeError";
  }
}

/** Return the mandatory attribute keys absent from `attributes` (empty = ok). */
export function checkMandatoryAttributes(eventType: TraceEventType, attributes: Attributes): string[] {
  const required = MANDATORY_ATTRIBUTES[eventType] ?? [];
  return required.filter((key) => attributes[key] === undefined || attributes[key] === null);
}
