import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "@pathnovo/config";
import { computeDelta, ingestDocument } from "@pathnovo/pipeline";

import { type ChatScore, evalChat, type QA } from "./chat-eval.js";
import { type DeltaScore, type ExpectedEntry, scoreDelta } from "./delta-prf.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evalRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_URL = process.env.API_URL ?? "http://localhost:3001";

async function runDelta(): Promise<DeltaScore> {
  const dir = resolve(repoRoot, "data/samples/pair-1");
  const config = loadConfig();
  const docA = await ingestDocument("revA", readFileSync(resolve(dir, "revA.pdf")));
  const docB = await ingestDocument("revB", readFileSync(resolve(dir, "revB.pdf")));
  const comparison = computeDelta(docA, docB, config);
  const expected = JSON.parse(readFileSync(resolve(dir, "expected-delta.json"), "utf8")) as ExpectedEntry[];
  return scoreDelta(comparison.entries, expected);
}

async function apiUp(): Promise<boolean> {
  try {
    const r = await fetch(`${API_URL}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function createComparison(): Promise<string> {
  const dir = resolve(repoRoot, "data/samples/pair-1");
  const fd = new FormData();
  fd.append("a", new Blob([readFileSync(resolve(dir, "revA.pdf"))]), "revA.pdf");
  fd.append("b", new Blob([readFileSync(resolve(dir, "revB.pdf"))]), "revB.pdf");
  const r = await fetch(`${API_URL}/comparisons`, { method: "POST", body: fd });
  const data = (await r.json()) as { comparisonId: string };
  return data.comparisonId;
}

function pct(pass: number, total: number): string {
  return total === 0 ? "n/a" : `${Math.round((pass / total) * 100)}% (${pass}/${total})`;
}

async function main(): Promise<void> {
  const delta = await runDelta();

  let chat: ChatScore | null = null;
  if (await apiUp()) {
    const comparisonId = await createComparison();
    const qas = JSON.parse(readFileSync(resolve(evalRoot, "datasets/qa.json"), "utf8")) as QA[];
    chat = await evalChat(API_URL, comparisonId, qas);
  }

  // ── Scorecard ──
  const line = "─".repeat(52);
  console.log(`\n${line}`);
  console.log(" Pathnovo eval scorecard");
  console.log(line);
  console.log(" Delta (pair-1, native/native)");
  console.log(
    `   P ${delta.precision.toFixed(2)}  R ${delta.recall.toFixed(2)}  F1 ${delta.f1.toFixed(2)}` +
      `   (tp ${delta.tp}, fp ${delta.fp}, fn ${delta.fn})`,
  );
  if (chat) {
    console.log(" Chat");
    console.log(`   groundedness  ${pct(chat.groundedness.pass, chat.groundedness.total)}`);
    console.log(`   correctness   ${pct(chat.correctness.pass, chat.correctness.total)}`);
    console.log(`   refusal       ${pct(chat.refusal.pass, chat.refusal.total)}`);
  } else {
    console.log(" Chat: skipped (API not reachable at " + API_URL + ")");
  }

  const failures = [
    ...delta.missed.map((k) => `delta FN: ${k}`),
    ...delta.spurious.map((k) => `delta FP: ${k}`),
    ...(chat?.rows.filter((r) => !r.pass).map((r) => `chat: "${r.question}" (conf ${r.confidence})`) ?? []),
  ];
  console.log(" Failures");
  if (failures.length === 0) console.log("   (none on this set)");
  else for (const f of failures) console.log(`   ${f}`);
  console.log(`${line}\n`);

  // ── Persist for regression comparison ──
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(evalRoot, "results");
  mkdirSync(outDir, { recursive: true });
  const result = { timestamp: stamp, delta, chat };
  writeFileSync(resolve(outDir, `${stamp}.json`), JSON.stringify(result, null, 2));
  console.log(`wrote results/${stamp}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
