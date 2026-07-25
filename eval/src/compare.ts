import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Diff two eval result files so a change can be shown to help or hurt. */
interface Result {
  delta: { precision: number; recall: number; f1: number };
  chat: {
    groundedness: { pass: number; total: number };
    correctness: { pass: number; total: number };
    refusal: { pass: number; total: number };
  } | null;
}

function ratio(x: { pass: number; total: number } | undefined): number {
  return x && x.total > 0 ? x.pass / x.total : 0;
}

function arrow(delta: number): string {
  if (Math.abs(delta) < 1e-9) return "=";
  return delta > 0 ? `▲ +${delta.toFixed(2)}` : `▼ ${delta.toFixed(2)}`;
}

function main(): void {
  const [a, b] = process.argv.slice(2).filter((x) => x !== "--");
  if (!a || !b) {
    console.error("usage: eval:compare <baseline.json> <candidate.json>");
    process.exit(1);
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const base = JSON.parse(readFileSync(resolve(cwd, a), "utf8")) as Result;
  const cand = JSON.parse(readFileSync(resolve(cwd, b), "utf8")) as Result;

  console.log(`\n${a}  →  ${b}`);
  console.log(`  delta F1       ${cand.delta.f1.toFixed(2)}   ${arrow(cand.delta.f1 - base.delta.f1)}`);
  console.log(
    `  groundedness   ${ratio(cand.chat?.groundedness).toFixed(2)}   ${arrow(ratio(cand.chat?.groundedness) - ratio(base.chat?.groundedness))}`,
  );
  console.log(
    `  correctness    ${ratio(cand.chat?.correctness).toFixed(2)}   ${arrow(ratio(cand.chat?.correctness) - ratio(base.chat?.correctness))}`,
  );
  console.log(
    `  refusal        ${ratio(cand.chat?.refusal).toFixed(2)}   ${arrow(ratio(cand.chat?.refusal) - ratio(base.chat?.refusal))}\n`,
  );
}

main();
