# Demo — Document Delta & Grounded Chat

A ~3-minute walkthrough: ingest two document revisions, compute a structured
delta, chat grounded in both documents + the delta, inspect the trace, and run
the eval scorecard. Every output below is real, copied from a run of this repo.

## 0. Start the stack

```bash
# put your key in .env first (chat + embeddings): cp .env.example .env, add OPENAI_API_KEY
docker compose up
```

One command brings up Postgres + the API, runs migrations, and **seeds the demo
comparison** (the container logs `seeded comparison … : 6 entries, 8 chunks`).
The web UI runs alongside with `pnpm --filter @pathnovo/web dev` (→ http://localhost:5173).

The sample pair is synthetic and controlled — `data/samples/pair-1/` — with these
injected changes from rev A → rev B: **added** `26-PV-9099`, `NOTE 45`; **removed**
`2"-VF-43-9008-AS20S-00`, `NOTE 20`; **modified** `4"-PV-…` → `6"-PV-…` (text) and
`26-CX-9021` (moved).

## 1. Compute a delta

CLI (no API needed — pure pipeline):

```bash
pnpm --filter @pathnovo/api delta -- data/samples/pair-1/revA.pdf data/samples/pair-1/revB.pdf
```

```
revA → revB
2 added, 2 removed, 2 modified
→ out/01af9bebc6a7cc05/delta-report.{md,json}
```

The rendered report (`report.md`) — the engine recovered exactly the injected changes:

```markdown
# Delta report — revA → revB

**6 changes** across 1 sheet: 2 added, 2 removed, 2 modified.

## Sheet 1
### Added (2)
- + Added note "NOTE 45" on sheet 1  `conf 1.00`
- + Added tag "26-PV-9099" on sheet 1  `conf 1.00`
### Removed (2)
- − Removed line "2"-VF-43-9008-AS20S-00" on sheet 1  `conf 1.00`
- − Removed note "NOTE 20" on sheet 1  `conf 1.00`
### Modified (2)
- ~ Moved tag "26-CX-9021" on sheet 1 _(moved)_  `conf 1.00`
- ~ Changed line "4"-PV-26-9020-FC11S-38" → "6"-PV-26-9020-FC11S-38" on sheet 1 _(text)_  `conf 0.99`
```

Via the API instead (also persists + traces the run):

```bash
curl -F "a=@data/samples/pair-1/revA.pdf" -F "b=@data/samples/pair-1/revB.pdf" \
  http://localhost:3001/comparisons
```

In the **web UI** (`/compare/:id`): side-by-side base/revised panels draw each change
as a box positioned from its bbox (red removed, green added, amber modified); clicking
a report entry highlights its box on both panels.

## 2. Grounded chat

```bash
curl -X POST http://localhost:3001/comparisons/01af9bebc6a7cc05/chat \
  -H "content-type: application/json" \
  -d '{"question":"Did anything change near the export compressor, and is 26-PV-9099 new?"}'
```

```
confidence: grounded
answer: Yes, there were changes near the export compressor. The line
  "4"-PV-26-9020-FC11S-38" was changed to "6"-PV-26-9020-FC11S-38" and the tag
  "26-PV-9099" was added, indicating that it is new.
citations:
  - delta · sheet 1 :: Changed line "4"-PV-…" → "6"-PV-…" | was: 4"-PV-… | now: 6"-PV-…
  - delta · sheet 1 :: Added tag "26-PV-9099" on sheet 1 | now: 26-PV-9099
```

Every claim is backed by a citation whose quote is **post-validated** against the
retrieved source. Unsupported questions are refused rather than answered:

```bash
curl -X POST http://localhost:3001/comparisons/01af9bebc6a7cc05/chat \
  -H "content-type: application/json" -d '{"question":"What is the NPSH rating of the pump?"}'
```

```
confidence: not_found
answer: I cannot answer from these documents.
citations: []
```

In the web UI (`/chat/:id`): answers render with citation chips (quote on hover) and a
confidence badge.

## 3. Observability — one traced request

Every request is a run of sequenced trace events with timings and token/cost usage
(`GET /runs/:id`). The chat request above:

```
run … | chat | ok
  #0 retrieval_completed     701ms  {"fused_k": 8, "fts_hits": 3, "vector_hits": 8}
  #1 llm_call_started               {"gen_ai.system": "openai", "gen_ai.request.model": "gpt-4o-mini"}
  #2 llm_call_completed     3139ms  {… "gen_ai.usage.input_tokens": 847, "gen_ai.usage.output_tokens": 199}
usage:
   text-embedding-3-small  19 in            $0.000000
   gpt-4o-mini             847 in / 199 out $0.000246
```

`GET /metrics` aggregates per-stage p50/p95 latency, token/cost totals, and delta
counts. The web UI `/traces` renders the runs list, waterfall, and metric cards.

**Failures are visible, not swallowed** — POST an unsupported format and the run is
marked `failed` with a `stage_failed` event:

```bash
printf 'AC1015\x00\x00fake' > /tmp/fake.dwg
curl -F "a=@/tmp/fake.dwg" -F "b=@/tmp/fake.dwg" http://localhost:3001/comparisons   # → 500
# GET /runs → newest run: status "failed", error UnsupportedFormatError, with a
#   stage_failed trace event {stage: canonical_persisted, error_type: UnsupportedFormatError}
```

## 4. Eval scorecard

```bash
make eval      # delta P/R/F1 in-process; chat metrics when the API is running
```

```
────────────────────────────────────────────────────
 Pathnovo eval scorecard
────────────────────────────────────────────────────
 Delta
   native/native    P 1.00  R 1.00  F1 1.00   (tp 6, fp 0, fn 0)
   native/scanned   P 0.71  R 0.83  F1 0.77   (tp 5, fp 2, fn 1)
 Chat
   groundedness  100% (4/4)
   correctness   100% (4/4)
   refusal       100% (2/2)
 Failures
   delta FN (scanned): modified|4"-PV-26-9020-FC11S-38
   delta FP (scanned): modified|8"-PV-26-9007-FC11S-08
   delta FP (scanned): removed|4"-PV-26-9020-FC11S-38
────────────────────────────────────────────────────
```

This is the honest headline: on the native pair the deterministic engine is exact
(F1 1.00); on the **scanned** pair (`data/samples/pair-2/`, rev B rasterized and run
through the OCR adapter) OCR misreads drop F1 to ~0.77, and the failing entries are
named. `make eval-compare A=<a>.json B=<b>.json` diffs two runs so a change can be
shown to help or hurt.

## What to look at in the code

- `packages/core` — the canonical model + delta types (the seam everything reads).
- `packages/pipeline/src/ingest` — the format adapters (native, scanned OCR, DWG stub).
- `packages/pipeline/src/delta` — anchors → registration → Hungarian matching → confidence.
- `apps/api/src/observability` — the trace store with mandatory-attribute enforcement.
- `apps/api/src/chat` — hybrid retrieval (cosine + keyword + RRF) and cited, validated answers.
- `eval/` — the scorecard.
