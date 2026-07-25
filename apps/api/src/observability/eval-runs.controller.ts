import { randomUUID } from "node:crypto";

import { Body, Controller, Post, Req } from "@nestjs/common";

import { RunService } from "./run.service.js";

interface DeltaScore {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  missed?: string[];
  spurious?: string[];
}

interface ChatScore {
  groundedness: { pass: number; total: number };
  correctness: { pass: number; total: number };
  refusal: { pass: number; total: number };
}

interface EvalBody {
  delta?: DeltaScore;
  deltaScanned?: DeltaScore;
  chat?: ChatScore | null;
}

const ratio = (x?: { pass: number; total: number }) => (x && x.total > 0 ? x.pass / x.total : 0);

/**
 * The eval harness runs out-of-process (a tsx script), so it reports its
 * scorecard here. Recording it as an "eval" run puts the metrics in the same
 * trace store as everything else — inspectable in the trace viewer and
 * comparable over time.
 */
@Controller("eval/runs")
export class EvalRunsController {
  constructor(private readonly runs: RunService) {}

  @Post()
  async record(@Body() body: EvalBody, @Req() req: { id?: string }) {
    const run = await this.runs.start("eval", { requestId: req.id ?? randomUUID() });

    const emitDelta = async (pair: string, d?: DeltaScore) => {
      if (!d) return;
      await run.emit("eval_delta_scored", {
        pair,
        precision: round(d.precision),
        recall: round(d.recall),
        f1: round(d.f1),
        tp: d.tp,
        fp: d.fp,
        fn: d.fn,
        missed: (d.missed ?? []).slice(0, 10).join(" | "),
        spurious: (d.spurious ?? []).slice(0, 10).join(" | "),
      });
    };
    await emitDelta("native/native", body.delta);
    await emitDelta("native/scanned", body.deltaScanned);

    if (body.chat) {
      await run.emit("eval_chat_scored", {
        groundedness: round(ratio(body.chat.groundedness)),
        correctness: round(ratio(body.chat.correctness)),
        refusal: round(ratio(body.chat.refusal)),
      });
    }

    await run.finish("ok");
    return { runId: run.runId };
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
