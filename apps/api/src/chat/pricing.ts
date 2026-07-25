/** Static per-model USD price table (per 1M tokens). Feeds usage_events.costUsd. */
const PRICES: Record<string, { input: number; output: number }> = {
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

export function costUsd(model: string, inputTokens: number, outputTokens = 0): number {
  const p = PRICES[model] ?? { input: 0, output: 0 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
