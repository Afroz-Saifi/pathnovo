import { z } from "zod";

/**
 * Single source of truth for configuration. Every threshold, model name, and
 * limit named in the design lives here as a zod-validated env var with a
 * default — parsed once, fail-fast on boot. Config-over-hardcoding: nothing
 * downstream reads process.env directly.
 */

const onOff = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : ["on", "true", "1", "yes"].includes(v.toLowerCase())));

const ConfigSchema = z.object({
  // ── LLM (only external service; swappable behind one interface) ──
  llmProvider: z.string().default("openai"),
  llmModel: z.string().default("gpt-4o-mini"),
  visionModel: z.string().default("gpt-4o"),
  judgeModel: z.string().default("gpt-4o"),
  embeddingModel: z.string().default("text-embedding-3-small"),
  llmTemperature: z.coerce.number().default(0),
  llmMaxOutputTokens: z.coerce.number().int().default(1200),
  llmTimeoutMs: z.coerce.number().int().default(60000),
  llmMaxRetries: z.coerce.number().int().default(2),
  contextTokenBudget: z.coerce.number().int().default(16000),
  historyMaxTurns: z.coerce.number().int().default(6),
  runTokenCeiling: z.coerce.number().int().default(60000),
  openaiApiKey: z.string().optional(),

  // ── Database ──
  databaseUrl: z.string().default("postgresql://postgres:postgres@localhost:5432/pathnovo"),

  // ── Ingestion ──
  scannedTextThreshold: z.coerce.number().int().default(50),
  ocrDpi: z.coerce.number().int().default(300),
  ocrLang: z.string().default("eng"),
  visionAssist: onOff(true),
  visionAssistThreshold: z.coerce.number().default(0.6),
  visionMaxCropsPerSheet: z.coerce.number().int().default(12),

  // ── Delta engine (deterministic; snapshotted per comparison) ──
  matchThreshold: z.coerce.number().default(0.55),
  moveTolerance: z.coerce.number().default(0.008),
  wText: z.coerce.number().default(0.5),
  wSpatial: z.coerce.number().default(0.35),
  wKind: z.coerce.number().default(0.15),
  anchorMinPairs: z.coerce.number().int().default(4),
  enrich: onOff(true),

  // ── Retrieval ──
  chunkTargetChars: z.coerce.number().int().default(300),
  vectorTop: z.coerce.number().int().default(20),
  ftsTop: z.coerce.number().int().default(20),
  rrfK: z.coerce.number().int().default(60),
  retrievalK: z.coerce.number().int().default(8),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Parse config from an env bag (defaults to process.env). Throws on invalid values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    llmProvider: env.LLM_PROVIDER,
    llmModel: env.LLM_MODEL,
    visionModel: env.VISION_MODEL,
    judgeModel: env.JUDGE_MODEL,
    embeddingModel: env.EMBEDDING_MODEL,
    llmTemperature: env.LLM_TEMPERATURE,
    llmMaxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    llmMaxRetries: env.LLM_MAX_RETRIES,
    contextTokenBudget: env.CONTEXT_TOKEN_BUDGET,
    historyMaxTurns: env.HISTORY_MAX_TURNS,
    runTokenCeiling: env.RUN_TOKEN_CEILING,
    openaiApiKey: env.OPENAI_API_KEY,
    databaseUrl: env.DATABASE_URL,
    scannedTextThreshold: env.SCANNED_TEXT_THRESHOLD,
    ocrDpi: env.OCR_DPI,
    ocrLang: env.OCR_LANG,
    visionAssist: env.VISION_ASSIST,
    visionAssistThreshold: env.VISION_ASSIST_THRESHOLD,
    visionMaxCropsPerSheet: env.VISION_MAX_CROPS_PER_SHEET,
    matchThreshold: env.MATCH_THRESHOLD,
    moveTolerance: env.MOVE_TOLERANCE,
    wText: env.W_TEXT,
    wSpatial: env.W_SPATIAL,
    wKind: env.W_KIND,
    anchorMinPairs: env.ANCHOR_MIN_PAIRS,
    enrich: env.ENRICH,
    chunkTargetChars: env.CHUNK_TARGET_CHARS,
    vectorTop: env.VECTOR_TOP,
    ftsTop: env.FTS_TOP,
    rrfK: env.RRF_K,
    retrievalK: env.RETRIEVAL_K,
  });
}

/** The delta-engine subset — stored in every comparison for reproducibility. */
export function deltaConfigSnapshot(c: Config): Record<string, number> {
  return {
    matchThreshold: c.matchThreshold,
    moveTolerance: c.moveTolerance,
    wText: c.wText,
    wSpatial: c.wSpatial,
    wKind: c.wKind,
    anchorMinPairs: c.anchorMinPairs,
  };
}
