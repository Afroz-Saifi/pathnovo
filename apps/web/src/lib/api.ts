const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export interface DeltaSummary {
  added: number;
  removed: number;
  modified: number;
  byKind: Record<string, number>;
  bySheet: Record<string, number>;
  lowConfidence: number;
}

export interface DeltaEntry {
  id: string;
  changeType: "added" | "removed" | "modified";
  modifyKind?: "text" | "moved" | "resized" | null;
  itemKind: string;
  sheet: number;
  bboxA?: { x: number; y: number; w: number; h: number } | null;
  bboxB?: { x: number; y: number; w: number; h: number } | null;
  textA?: string | null;
  textB?: string | null;
  description: string;
  confidence: number;
}

export interface CreateResult {
  comparisonId: string;
  runId: string;
  summary: DeltaSummary;
}

export interface ComparisonDetail {
  id: string;
  pidA: string;
  pidB: string;
  summary: DeltaSummary;
  entries: DeltaEntry[];
  hasSheets: boolean;
}

export interface ComparisonListItem {
  id: string;
  pidA: string;
  pidB: string;
  summary: DeltaSummary;
  createdAt: string;
  entries: number;
  hasChat: boolean;
}

export async function listComparisons(): Promise<ComparisonListItem[]> {
  return json(await fetch(`${API}/comparisons`));
}

export function sheetImageUrl(id: string, side: "a" | "b", index = 0): string {
  return `${API}/comparisons/${id}/sheet/${side}/${index}`;
}

export interface ConfigGroup {
  name: string;
  items: Array<{ key: string; env: string; value: string | number | boolean; desc: string }>;
}

export async function getConfig(): Promise<{ groups: ConfigGroup[] }> {
  return json(await fetch(`${API}/config`));
}

export interface RunSummary {
  id: string;
  kind: string;
  status: string;
  pidA: string | null;
  pidB: string | null;
  comparisonId: string | null;
  startedAt: string;
  durationMs: number | null;
  events: number;
  error: string | null;
}

export interface TraceEvent {
  id: string;
  sequence: number;
  eventType: string;
  attributes: Record<string, unknown>;
  durationMs: number | null;
}

export interface RunDetail extends Omit<RunSummary, "events" | "durationMs"> {
  finishedAt: string | null;
  traceEvents: TraceEvent[];
  usageEvents: Array<{ provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }>;
}

export interface Metrics {
  runs: { total: number; byStatus: Record<string, number>; byKind: Record<string, number> };
  latencyMsByStage: Record<string, { p50: number; p95: number; count: number }>;
  tokens: { input: number; output: number; costUsd: number };
  deltas: { comparisons: number; entries: number };
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function createComparison(a: File, b: File): Promise<CreateResult> {
  const fd = new FormData();
  fd.append("a", a);
  fd.append("b", b);
  return json(await fetch(`${API}/comparisons`, { method: "POST", body: fd }));
}

export async function getComparison(id: string): Promise<ComparisonDetail> {
  return json(await fetch(`${API}/comparisons/${id}`));
}

export function reportMarkdownUrl(id: string): string {
  return `${API}/comparisons/${id}/report.md`;
}

export async function getRuns(): Promise<RunSummary[]> {
  return json(await fetch(`${API}/runs?limit=50`));
}

export async function getRun(id: string): Promise<RunDetail> {
  return json(await fetch(`${API}/runs/${id}`));
}

export async function getMetrics(): Promise<Metrics> {
  return json(await fetch(`${API}/metrics`));
}

export interface Citation {
  source: string;
  sheet: number | null;
  ref: string;
  refs: string[];
  quote: string;
}

export interface ChatAnswer {
  answer: string;
  citations: Citation[];
  confidence: "grounded" | "partial" | "not_found";
  sessionId: string;
  runId: string;
}

export async function askChat(
  comparisonId: string,
  question: string,
  sessionId?: string,
): Promise<ChatAnswer> {
  return json(
    await fetch(`${API}/comparisons/${comparisonId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, sessionId }),
    }),
  );
}
