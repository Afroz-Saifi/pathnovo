import { Injectable } from "@nestjs/common";
import type { Config } from "@pathnovo/config";

import { ConfigService } from "../config/config.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { embedQuery } from "./embeddings.js";

export interface RetrievedChunk {
  label: number; // 1-based, used for citation
  id: string;
  sourceType: string;
  sheet: number | null;
  text: string;
  refs: string[];
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  vectorHits: number;
  ftsHits: number;
  queryTokens: number;
  /** Set when the question asks to enumerate a change type. */
  enumTotal?: number;
  enumCapped?: boolean;
}

const CHANGE_INTENT = /\b(chang|add|remov|delet|modif|revis|differ|new|mov|updat)/i;
const ENUM_CAP = 60;

// Explicit "give me the whole set" cues.
const LIST_CUE = /\b(list|every|each|enumerate|how many|show me|give me|any (more|other)|other than|all)\b/i;
// A spatial/specific qualifier → the user wants a targeted answer, not the full set.
const SPATIAL = /\b(near|around|close to|beside|next to|located|where\b)/i;
// A change type + an interrogative ("what/which/any is added") also means enumerate.
const INTERROGATIVE = /\b(what|which|any)\b/i;

function changeTypeOf(q: string): "added" | "removed" | "modified" | null {
  if (/\b(remov|delet)/i.test(q)) return "removed";
  if (/\b(add|new|addition)/i.test(q)) return "added";
  if (/\b(modif|chang|updat|edit|revis|move)/i.test(q)) return "modified";
  return null;
}

/** Does the question ask to enumerate a whole change set (vs. a specific ask)? */
function isEnumeration(q: string): boolean {
  if (SPATIAL.test(q)) return false;
  const type = changeTypeOf(q);
  return LIST_CUE.test(q) || (type !== null && INTERROGATIVE.test(q));
}

function chunkIsType(text: string, type: "added" | "removed" | "modified"): boolean {
  if (type === "added") return text.startsWith("Added");
  if (type === "removed") return text.startsWith("Removed");
  return text.startsWith("Changed") || text.startsWith("Moved");
}

@Injectable()
export class RetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private get config(): Config {
    return this.configService.get();
  }

  async retrieve(comparisonId: string, question: string): Promise<RetrievalResult> {
    const rows = await this.prisma.chunk.findMany({ where: { comparisonId } });
    if (rows.length === 0) return { chunks: [], vectorHits: 0, ftsHits: 0, queryTokens: 0 };

    const { embedding: qvec, tokens } = await embedQuery(question, this.config.embeddingModel);

    // Enumeration path — "list all removed" needs every matching delta entry,
    // not just the top-K, so pull the full set (capped) directly.
    if (isEnumeration(question)) {
      const type = changeTypeOf(question);
      const deltas = rows.filter(
        (r) => r.sourceType === "delta" && (type === null || chunkIsType(r.text, type)),
      );
      const capped = deltas.slice(0, ENUM_CAP);
      return {
        chunks: capped.map((r, i) => ({
          label: i + 1,
          id: r.id,
          sourceType: r.sourceType,
          sheet: r.sheet,
          text: r.text,
          refs: r.refs as string[],
        })),
        vectorHits: 0,
        ftsHits: 0,
        queryTokens: tokens,
        enumTotal: deltas.length,
        enumCapped: deltas.length > ENUM_CAP,
      };
    }

    // Semantic leg — cosine similarity.
    const vector = rows
      .map((r) => ({ id: r.id, score: cosine(qvec, r.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.vectorTop);

    // Keyword leg — exact token overlap (P&ID identifiers live or die on this).
    const qTokens = tokenize(question);
    const keyword = rows
      .map((r) => ({ id: r.id, score: keywordScore(qTokens, r.text) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.ftsTop);

    // Reciprocal Rank Fusion, with a delta-family boost on change questions.
    const boostDelta = CHANGE_INTENT.test(question);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const fused = new Map<string, number>();
    const addRanks = (list: Array<{ id: string }>) => {
      list.forEach((item, i) => {
        fused.set(item.id, (fused.get(item.id) ?? 0) + 1 / (this.config.rrfK + i + 1));
      });
    };
    addRanks(vector);
    addRanks(keyword);
    if (boostDelta) {
      for (const [id, r] of byId) {
        if (r.sourceType === "delta") fused.set(id, (fused.get(id) ?? 0) + 1 / this.config.rrfK);
      }
    }

    const chunks = [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.config.retrievalK)
      .map(([id], i): RetrievedChunk => {
        const r = byId.get(id)!;
        return { label: i + 1, id, sourceType: r.sourceType, sheet: r.sheet, text: r.text, refs: r.refs as string[] };
      });

    return { chunks, vectorHits: vector.length, ftsHits: keyword.length, queryTokens: tokens };
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function tokenize(q: string): string[] {
  return (q.toLowerCase().match(/[a-z0-9][a-z0-9/"'-]*/g) ?? []).filter((t) => t.length >= 2);
}

function keywordScore(tokens: string[], text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const t of tokens) if (lower.includes(t)) score += 1;
  return score;
}
