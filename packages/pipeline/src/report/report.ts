import type { Comparison, DeltaEntry } from "@pathnovo/core";

/**
 * One renderer, two projections from the same Comparison: machine-readable JSON
 * and human-readable Markdown. The Markdown is also the retrievable source that
 * grounded chat cites for "what changed?" questions.
 */

export function toJSON(comparison: Comparison): string {
  return JSON.stringify(comparison, null, 2);
}

const SYMBOL: Record<DeltaEntry["changeType"], string> = {
  added: "+",
  removed: "−",
  modified: "~",
};

export function toMarkdown(comparison: Comparison): string {
  const { summary, entries, pidA, pidB, id } = comparison;
  const total = summary.added + summary.removed + summary.modified;
  const sheets = Object.keys(summary.bySheet).length;

  const lines: string[] = [];
  lines.push(`# Delta report — ${pidA} → ${pidB}`);
  lines.push("");
  lines.push(`Comparison \`${id}\`.`);
  lines.push("");
  lines.push(
    `**${total} change${total === 1 ? "" : "s"}** across ${sheets} sheet${sheets === 1 ? "" : "s"}: ` +
      `${summary.added} added, ${summary.removed} removed, ${summary.modified} modified.`,
  );
  lines.push("");
  lines.push("| by kind | count |");
  lines.push("| --- | --- |");
  for (const [kind, n] of Object.entries(summary.byKind).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${kind} | ${n} |`);
  }
  lines.push("");

  const bySheet = groupBy(entries, (e) => e.sheet);
  for (const [sheet, group] of [...bySheet.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`## Sheet ${sheet + 1}`);
    lines.push("");
    for (const type of ["added", "removed", "modified"] as const) {
      const rows = group.filter((e) => e.changeType === type);
      if (rows.length === 0) continue;
      lines.push(`### ${cap(type)} (${rows.length})`);
      lines.push("");
      for (const e of rows.sort((a, b) => b.confidence - a.confidence)) {
        lines.push(`- ${SYMBOL[e.changeType]} ${describe(e)}  \`conf ${e.confidence.toFixed(2)}\``);
      }
      lines.push("");
    }
  }

  const low = entries
    .filter((e) => e.confidence < 0.5)
    .sort((a, b) => a.confidence - b.confidence);
  if (low.length > 0) {
    lines.push(`## ⚠ Low confidence (${low.length}) — review suggested`);
    lines.push("");
    for (const e of low) {
      lines.push(`- ${describe(e)}  \`conf ${e.confidence.toFixed(2)}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function describe(e: DeltaEntry): string {
  const loc = e.modifyKind ? ` _(${e.modifyKind})_` : "";
  return `${e.description}${loc}`;
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const arr = m.get(key(it));
    if (arr) arr.push(it);
    else m.set(key(it), [it]);
  }
  return m;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
