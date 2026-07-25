import { openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";

/** Embed many texts in one call. Returns vectors + token usage for telemetry. */
export async function embedTexts(
  texts: string[],
  model: string,
): Promise<{ embeddings: number[][]; tokens: number }> {
  if (texts.length === 0) return { embeddings: [], tokens: 0 };
  const { embeddings, usage } = await embedMany({ model: openai.embedding(model), values: texts });
  return { embeddings, tokens: usage?.tokens ?? 0 };
}

/** Embed a single query. */
export async function embedQuery(
  text: string,
  model: string,
): Promise<{ embedding: number[]; tokens: number }> {
  const { embedding, usage } = await embed({ model: openai.embedding(model), value: text });
  return { embedding, tokens: usage?.tokens ?? 0 };
}
