import { Body, Controller, Delete, Get, Patch } from "@nestjs/common";
import type { Config } from "@pathnovo/config";

import { CHAT_MODELS, EMBEDDING_MODELS, PROVIDERS } from "../chat/model-catalog.js";
import { ConfigService } from "./config.service.js";

interface Setting {
  key: string;
  env: string;
  value: string | number | boolean;
  type: "number" | "boolean" | "string";
  desc: string;
  editable: boolean;
  overridden: boolean;
  /** Fixed choices → the UI renders a dropdown. */
  options?: string[];
}

// Provider + model dropdowns are provider-aware and driven by `catalog` in the
// response; only static option sets live here.
const OPTIONS: Record<string, string[]> = {
  OCR_LANG: ["eng"],
};

// [key, env, description] — key indexes into Config; env is the var name.
const SPECS: Array<{ group: string; items: Array<[keyof Config | "apiKey", string, string]> }> = [
  {
    group: "LLM",
    items: [
      ["llmProvider", "LLM_PROVIDER", "AI SDK provider (swap seam)"],
      ["llmModel", "LLM_MODEL", "Chat answers + delta enrichment"],
      ["visionModel", "VISION_MODEL", "OCR-assist crops"],
      ["judgeModel", "JUDGE_MODEL", "Eval judge"],
      ["embeddingModel", "EMBEDDING_MODEL", "Chunk + query embeddings"],
      ["llmTemperature", "LLM_TEMPERATURE", "All LLM calls"],
      ["llmMaxOutputTokens", "LLM_MAX_OUTPUT_TOKENS", "Per answer/enrichment"],
      ["llmTimeoutMs", "LLM_TIMEOUT_MS", "LLM call timeout"],
      ["llmMaxRetries", "LLM_MAX_RETRIES", "Backoff retries on 429/5xx"],
      ["contextTokenBudget", "CONTEXT_TOKEN_BUDGET", "Prompt-assembly budget"],
      ["historyMaxTurns", "HISTORY_MAX_TURNS", "Multi-turn chat memory"],
      ["runTokenCeiling", "RUN_TOKEN_CEILING", "Per-run token ceiling"],
      ["apiKey", "OPENAI_API_KEY", "Secret — never returned; set via .env"],
    ],
  },
  {
    group: "Ingestion",
    items: [
      ["scannedTextThreshold", "SCANNED_TEXT_THRESHOLD", "Chars/page below → scanned"],
      ["ocrDpi", "OCR_DPI", "OCR render resolution"],
      ["ocrLang", "OCR_LANG", "Tesseract language"],
      ["visionAssist", "VISION_ASSIST", "LLM re-read of low-conf OCR"],
      ["visionAssistThreshold", "VISION_ASSIST_THRESHOLD", "OCR conf below → vision assist"],
      ["visionMaxCropsPerSheet", "VISION_MAX_CROPS_PER_SHEET", "Bounded assist cost"],
    ],
  },
  {
    group: "Delta engine",
    items: [
      ["matchThreshold", "MATCH_THRESHOLD", "Max cost to accept a match"],
      ["moveTolerance", "MOVE_TOLERANCE", "Displacement → 'moved'"],
      ["wText", "W_TEXT", "Text-similarity weight"],
      ["wSpatial", "W_SPATIAL", "Spatial-distance weight"],
      ["wKind", "W_KIND", "Kind-mismatch weight"],
      ["anchorMinPairs", "ANCHOR_MIN_PAIRS", "Min anchors for registration"],
      ["enrich", "ENRICH", "LLM description enrichment"],
      ["geomEnabled", "GEOM_ENABLED", "Image-based geometry diff (non-text changes)"],
    ],
  },
  {
    group: "Retrieval",
    items: [
      ["chunkTargetChars", "CHUNK_TARGET_CHARS", "Target chunk size"],
      ["vectorTop", "VECTOR_TOP", "Semantic candidates"],
      ["ftsTop", "FTS_TOP", "Keyword candidates"],
      ["rrfK", "RRF_K", "Reciprocal-rank-fusion constant"],
      ["retrievalK", "RETRIEVAL_K", "Chunks per answer"],
    ],
  },
  {
    group: "Database",
    items: [["databaseUrl", "DATABASE_URL", "Postgres connection (redacted)"]],
  },
];

@Controller("config")
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  get() {
    return this.build();
  }

  @Patch()
  async update(@Body() body: Record<string, unknown>) {
    await this.config.update(body);
    return this.build();
  }

  @Delete()
  async reset() {
    await this.config.reset();
    return this.build();
  }

  private build() {
    const c = this.config.get();
    const overridden = new Set(this.config.overriddenEnvKeys());
    return {
      catalog: {
        providers: [...PROVIDERS],
        chatModels: CHAT_MODELS,
        embeddingModels: EMBEDDING_MODELS,
      },
      groups: SPECS.map((spec) => ({
        name: spec.group,
        items: spec.items.map(([key, env, desc]): Setting => {
          let value: string | number | boolean;
          if (key === "apiKey") value = c.openaiApiKey ? "set" : "unset";
          else if (env === "DATABASE_URL") value = c.databaseUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@");
          else value = c[key] as string | number | boolean;
          const type = typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string";
          const base = OPTIONS[env];
          // Keep a custom env-set value selectable so it isn't lost.
          const options =
            base && typeof value === "string" && !base.includes(value) ? [value, ...base] : base;
          return {
            key: String(key),
            env,
            value,
            type,
            desc,
            editable: this.config.isEditable(env) && key !== "apiKey",
            overridden: overridden.has(env),
            ...(options ? { options } : {}),
          };
        }),
      })),
    };
  }
}
