import type { CanonicalDocument, Comparison } from "@pathnovo/core";

/**
 * Retrieval chunks come from three source families: PID A content, PID B
 * content, and the delta report. Document items are grouped into ~N-char
 * blocks (keeping their ids for citation); each delta entry becomes its own
 * chunk so "what changed?" answers can cite a specific change.
 */
export interface ChunkInput {
  sourceType: "pidA" | "pidB" | "delta";
  sheet: number | null;
  text: string;
  refs: string[];
}

function chunkDoc(
  doc: CanonicalDocument,
  sourceType: "pidA" | "pidB",
  targetChars: number,
): ChunkInput[] {
  const chunks: ChunkInput[] = [];
  for (const sheet of doc.sheets) {
    let buf: string[] = [];
    let refs: string[] = [];
    let len = 0;
    const flush = () => {
      if (buf.length === 0) return;
      chunks.push({ sourceType, sheet: sheet.index, text: buf.join(" · "), refs });
      buf = [];
      refs = [];
      len = 0;
    };
    for (const item of sheet.items) {
      buf.push(item.text);
      refs.push(item.id);
      len += item.text.length + 3;
      if (len >= targetChars) flush();
    }
    flush();
  }
  return chunks;
}

function chunkDelta(comparison: Comparison): ChunkInput[] {
  return comparison.entries.map((e, i) => {
    const parts = [e.description];
    if (e.textA) parts.push(`was: ${e.textA}`);
    if (e.textB) parts.push(`now: ${e.textB}`);
    return {
      sourceType: "delta" as const,
      sheet: e.sheet,
      text: parts.join(" | "),
      refs: [`${comparison.id}:${i}`],
    };
  });
}

export function buildChunks(
  comparison: Comparison,
  docA: CanonicalDocument,
  docB: CanonicalDocument,
  targetChars: number,
): ChunkInput[] {
  return [
    ...chunkDoc(docA, "pidA", targetChars),
    ...chunkDoc(docB, "pidB", targetChars),
    ...chunkDelta(comparison),
  ];
}
