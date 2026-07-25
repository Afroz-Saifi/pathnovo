# Pathnovo — Document Delta & Grounded Chat

Ingest two revisions of a technical document (native PDF, scanned PDF, or DWG), compute a
**structured delta** between them, render a **delta report**, and **chat** grounded in both
documents and the delta — with citations, observability, and an evaluation harness.

> Applied AI Engineer take-home. Built as a TypeScript monorepo.
> **See [DEMO.md](DEMO.md) for a walkthrough** (delta + grounded chat + trace + eval scorecard).

## Status

Built vertically, one runnable slice at a time.

- [x] **Slice 1 — Core delta on native PDFs**: ingest a native PDF → canonical representation →
      deterministic delta engine → Markdown + JSON report, runnable from a CLI.
- [x] **Slice 2 — API + persistence + observability**: NestJS + Prisma + Postgres; POST two PDFs →
      traced ingest → delta → persisted comparison; runs / trace_events / usage_events with mandatory
      OTel-style attributes; `/metrics`; failures surfaced as `stage_failed`.
- [x] **Slice 3 — Web UI** (React 19 + shadcn/ui + lucide): `/pairs` upload, `/compare/:id` with a
      located delta overlay (boxes drawn from normalized bboxes) + grouped report, `/traces` with runs
      list, event waterfall, and metric cards.
- [x] **Slice 4 — Grounded chat**: chunk indexing (OpenAI embeddings) at comparison time; hybrid
      retrieval (cosine + keyword + RRF, delta-boosted on change questions); AI SDK answers with a zod
      citation schema, post-validated; refuses unsupported questions; `/chat/:id` UI with citation
      chips + confidence badge; fully traced with token/cost usage.
- [x] **Slice 5a — Eval harness** (`make eval`): delta precision/recall/F1 against exact ground truth
      (in-process), plus chat groundedness / correctness / refusal against the running API; prints a
      scorecard, writes timestamped results, and diffs two runs (`make eval-compare`) for regressions.
- [x] **`docker compose up` one-command**: Postgres + API container, migrate + seed the demo pair on boot.
- [x] **Slice 5b — Scanned-PDF OCR adapter** (tesseract.js): renders pages, OCRs words with boxes +
      confidence, merged to the same granularity as the native path. All 3 formats now real. The eval
      shows the honest native/native (F1 1.00) vs native/scanned (F1 ~0.77) split.

## Architecture (one idea)

Every input format is normalized into one **canonical representation** (sheets → typed, located
content items with normalized bounding boxes + confidence). Everything downstream — delta, report,
chat, eval — reads only that model, so a new format is one new adapter and nothing else changes.

```
PID A ─┐                                            ┌─ delta-report.md
       ├─► ingest ─► canonical ─► delta engine ─────┤
PID B ─┘   (adapters)   (model)   (align→classify)  └─ delta-report.json
```

## Requirements

- Node 22 (`.nvmrc`), pnpm 9 (`corepack enable`)
- Docker (from slice 2, for Postgres)
- An OpenAI API key (from slice 4, for chat/eval) — copy `.env.example` to `.env`

## Quick start

```bash
corepack enable
pnpm install
```

Compute a delta between two native PDFs from the CLI (slice 1):

```bash
pnpm --filter @pathnovo/api delta -- <pidA.pdf> <pidB.pdf>
# → writes out/<comparison-id>/delta-report.{md,json}
```

Or the traced API — one command brings up Postgres + the API, runs migrations, and
seeds the demo comparison (put your `OPENAI_API_KEY` in `.env` first for chat):

```bash
docker compose up
```

```bash
# the demo pair is pre-seeded; or POST your own two revisions:
curl -F "a=@data/samples/pair-1/revA.pdf" -F "b=@data/samples/pair-1/revB.pdf" \
  http://localhost:3001/comparisons
# then: GET /comparisons/:id/report.md · GET /runs/:id (trace waterfall) · GET /metrics
# chat:  POST /comparisons/:id/chat  {"question":"what changed?"}
```

And the web UI (slice 3):

```bash
pnpm --filter @pathnovo/web dev   # http://localhost:5173 — pairs · compare · traces
```

Run the eval scorecard (slice 5 — chat metrics need the API running):

```bash
make eval          # delta P/R/F1 + chat groundedness/correctness/refusal → scorecard
```

## Layout

```
packages/core      canonical model + delta types (zod) — the shared contract
packages/config    zod-validated env + thresholds (single source of truth)
packages/pipeline  ingest adapters + canonical builder + delta engine + report
apps/api           CLI now; NestJS API + observability from slice 2
apps/web           React + shadcn/ui UI from slice 3
scripts            sample-pair synthesis (also emits eval ground truth)
data/samples       document pairs + provenance
```

## Design decisions & trade-offs

Detailed in the design doc (kept out of this repo). Headlines: the delta engine is **deterministic**
(alignment → classification, LLM isolated to description-only enrichment); the LLM provider is
**swappable** behind one interface; observability mirrors a production trace-store pattern.
