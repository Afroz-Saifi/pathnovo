import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * The LLM is swappable behind one interface. Chat/vision/judge models resolve
 * through the configured provider; each provider reads its own API key from the
 * environment (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY).
 * Embeddings stay on OpenAI (the provider whose key ships here).
 */
export const PROVIDERS = ["openai", "anthropic", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const CHAT_MODELS: Record<Provider, string[]> = {
  openai: [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5",
    "o3-mini",
    "o1-mini",
  ],
  anthropic: [
    "claude-haiku-4-5",
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-sonnet-4-6",
  ],
  google: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
};

export const EMBEDDING_MODELS = ["text-embedding-3-small", "text-embedding-3-large"];

export function isProvider(p: string): p is Provider {
  return (PROVIDERS as readonly string[]).includes(p);
}

/** Resolve a chat/completion model for the configured provider. */
export function resolveChatModel(provider: string, modelId: string): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropic(modelId);
    case "google":
      return google(modelId);
    default:
      return openai(modelId);
  }
}
