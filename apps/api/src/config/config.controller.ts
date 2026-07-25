import { Controller, Get } from "@nestjs/common";
import { type Config, loadConfig } from "@pathnovo/config";

interface Setting {
  key: string;
  env: string;
  value: string | number | boolean;
  desc: string;
}

/**
 * Read-only view of the effective configuration, grouped and described.
 * Every value is an env var (see .env.example); the secret is never returned.
 */
@Controller("config")
export class ConfigController {
  @Get()
  get(): { groups: Array<{ name: string; items: Setting[] }> } {
    const c: Config = loadConfig();
    const dbRedacted = c.databaseUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@");
    return {
      groups: [
        {
          name: "LLM",
          items: [
            { key: "provider", env: "LLM_PROVIDER", value: c.llmProvider, desc: "AI SDK provider (swap seam)" },
            { key: "model", env: "LLM_MODEL", value: c.llmModel, desc: "Chat answers + delta enrichment" },
            { key: "visionModel", env: "VISION_MODEL", value: c.visionModel, desc: "OCR-assist crops" },
            { key: "judgeModel", env: "JUDGE_MODEL", value: c.judgeModel, desc: "Eval judge" },
            { key: "embeddingModel", env: "EMBEDDING_MODEL", value: c.embeddingModel, desc: "Chunk + query embeddings" },
            { key: "temperature", env: "LLM_TEMPERATURE", value: c.llmTemperature, desc: "All LLM calls" },
            { key: "maxOutputTokens", env: "LLM_MAX_OUTPUT_TOKENS", value: c.llmMaxOutputTokens, desc: "Per answer/enrichment" },
            { key: "timeoutMs", env: "LLM_TIMEOUT_MS", value: c.llmTimeoutMs, desc: "LLM call timeout" },
            { key: "maxRetries", env: "LLM_MAX_RETRIES", value: c.llmMaxRetries, desc: "Backoff retries on 429/5xx" },
            { key: "contextTokenBudget", env: "CONTEXT_TOKEN_BUDGET", value: c.contextTokenBudget, desc: "Prompt-assembly budget" },
            { key: "historyMaxTurns", env: "HISTORY_MAX_TURNS", value: c.historyMaxTurns, desc: "Multi-turn chat memory" },
            { key: "runTokenCeiling", env: "RUN_TOKEN_CEILING", value: c.runTokenCeiling, desc: "Per-run token ceiling" },
            { key: "apiKey", env: "OPENAI_API_KEY", value: c.openaiApiKey ? "set" : "unset", desc: "Secret — never returned" },
          ],
        },
        {
          name: "Ingestion",
          items: [
            { key: "scannedTextThreshold", env: "SCANNED_TEXT_THRESHOLD", value: c.scannedTextThreshold, desc: "Chars/page below → scanned" },
            { key: "ocrDpi", env: "OCR_DPI", value: c.ocrDpi, desc: "OCR render resolution" },
            { key: "ocrLang", env: "OCR_LANG", value: c.ocrLang, desc: "Tesseract language" },
            { key: "visionAssist", env: "VISION_ASSIST", value: c.visionAssist, desc: "LLM re-read of low-conf OCR" },
            { key: "visionAssistThreshold", env: "VISION_ASSIST_THRESHOLD", value: c.visionAssistThreshold, desc: "OCR conf below → vision assist" },
            { key: "visionMaxCropsPerSheet", env: "VISION_MAX_CROPS_PER_SHEET", value: c.visionMaxCropsPerSheet, desc: "Bounded assist cost" },
          ],
        },
        {
          name: "Delta engine",
          items: [
            { key: "matchThreshold", env: "MATCH_THRESHOLD", value: c.matchThreshold, desc: "Max cost to accept a match" },
            { key: "moveTolerance", env: "MOVE_TOLERANCE", value: c.moveTolerance, desc: "Displacement → 'moved'" },
            { key: "wText", env: "W_TEXT", value: c.wText, desc: "Text-similarity weight" },
            { key: "wSpatial", env: "W_SPATIAL", value: c.wSpatial, desc: "Spatial-distance weight" },
            { key: "wKind", env: "W_KIND", value: c.wKind, desc: "Kind-mismatch weight" },
            { key: "anchorMinPairs", env: "ANCHOR_MIN_PAIRS", value: c.anchorMinPairs, desc: "Min anchors for registration" },
            { key: "enrich", env: "ENRICH", value: c.enrich, desc: "LLM description enrichment" },
          ],
        },
        {
          name: "Retrieval",
          items: [
            { key: "chunkTargetChars", env: "CHUNK_TARGET_CHARS", value: c.chunkTargetChars, desc: "Target chunk size" },
            { key: "vectorTop", env: "VECTOR_TOP", value: c.vectorTop, desc: "Semantic candidates" },
            { key: "ftsTop", env: "FTS_TOP", value: c.ftsTop, desc: "Keyword candidates" },
            { key: "rrfK", env: "RRF_K", value: c.rrfK, desc: "Reciprocal-rank-fusion constant" },
            { key: "retrievalK", env: "RETRIEVAL_K", value: c.retrievalK, desc: "Chunks per answer" },
          ],
        },
        {
          name: "Database",
          items: [{ key: "url", env: "DATABASE_URL", value: dbRedacted, desc: "Postgres connection (redacted)" }],
        },
      ],
    };
  }
}
