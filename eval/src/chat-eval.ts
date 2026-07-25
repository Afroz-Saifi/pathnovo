/**
 * Chat metrics against the running API. Groundedness and refusal are mechanical
 * (no judge needed): an answerable question must come back grounded with at
 * least one valid citation; a trap question must be refused. Correctness uses
 * expected-fact substring matching — deterministic and judge-free.
 */
export interface QA {
  question: string;
  answerable: boolean;
  expectContains?: string[];
}

interface ChatResponse {
  answer: string;
  citations: Array<{ source: string }>;
  confidence: "grounded" | "partial" | "not_found";
}

export interface ChatRow {
  question: string;
  answerable: boolean;
  confidence: string;
  grounded: boolean;
  correct: boolean;
  refused: boolean;
  pass: boolean;
}

export interface ChatScore {
  rows: ChatRow[];
  groundedness: { pass: number; total: number };
  correctness: { pass: number; total: number };
  refusal: { pass: number; total: number };
}

export async function evalChat(apiUrl: string, comparisonId: string, qas: QA[]): Promise<ChatScore> {
  const rows: ChatRow[] = [];
  for (const qa of qas) {
    const res = await fetch(`${apiUrl}/comparisons/${comparisonId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: qa.question }),
    });
    const data = (await res.json()) as ChatResponse;

    const grounded = data.confidence !== "not_found" && data.citations.length > 0;
    const refused = data.confidence === "not_found";
    const correct = qa.answerable
      ? (qa.expectContains ?? []).every((f) => data.answer.toLowerCase().includes(f.toLowerCase()))
      : refused;
    const pass = qa.answerable ? grounded && correct : refused;

    rows.push({
      question: qa.question,
      answerable: qa.answerable,
      confidence: data.confidence,
      grounded,
      correct,
      refused,
      pass,
    });
  }

  const answerable = rows.filter((r) => r.answerable);
  const traps = rows.filter((r) => !r.answerable);
  return {
    rows,
    groundedness: { pass: answerable.filter((r) => r.grounded).length, total: answerable.length },
    correctness: { pass: answerable.filter((r) => r.correct).length, total: answerable.length },
    refusal: { pass: traps.filter((r) => r.refused).length, total: traps.length },
  };
}
