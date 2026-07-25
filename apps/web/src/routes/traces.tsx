import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { getMetrics, getRun, getRuns, type RunDetail, type RunSummary, type TraceEvent } from "../lib/api";
import { cn } from "../lib/utils";

const KIND_ORDER = ["delta", "chat"];

function statusVariant(status: string): "success" | "destructive" | "warning" {
  return status === "ok" ? "success" : status === "failed" ? "destructive" : "warning";
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function EventRow({ e, maxDur }: { e: TraceEvent; maxDur: number }) {
  const [open, setOpen] = useState(false);
  const attrs = e.attributes as Record<string, unknown>;
  const prompt = attrs["gen_ai.prompt"] as string | undefined;
  const completion = attrs["gen_ai.completion"] as string | undefined;
  const isFailure = e.eventType === "stage_failed";

  return (
    <div className={cn("rounded-md border", isFailure && "border-destructive/40")}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="w-5 text-right font-mono text-muted-foreground">{e.sequence}</span>
        <span className={cn("font-mono", isFailure && "text-destructive")}>{e.eventType}</span>
        <div className="ml-2 flex flex-1 items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-muted">
            <div className="h-full bg-primary" style={{ width: `${((e.durationMs ?? 0) / maxDur) * 100}%` }} />
          </div>
          <span className="w-14 text-right text-muted-foreground">
            {e.durationMs !== null ? `${e.durationMs}ms` : "·"}
          </span>
        </div>
      </button>
      {open ? (
        <div className="border-t px-3 py-2 text-[11px]">
          {prompt ? (
            <div className="mb-2">
              <div className="mb-1 font-semibold text-muted-foreground">prompt</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono">{prompt}</pre>
            </div>
          ) : null}
          {completion ? (
            <div className="mb-2">
              <div className="mb-1 font-semibold text-muted-foreground">completion</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono">{completion}</pre>
            </div>
          ) : null}
          <div className="mb-1 font-semibold text-muted-foreground">attributes</div>
          <pre className="overflow-auto rounded bg-muted p-2 font-mono">
            {JSON.stringify(
              Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== "gen_ai.prompt" && k !== "gen_ai.completion")),
              null,
              2,
            )}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function RunDetailView({ runId }: { runId: string }) {
  const { data } = useQuery<RunDetail>({ queryKey: ["run", runId], queryFn: () => getRun(runId) });
  if (!data) return <p className="text-sm text-muted-foreground">Loading run…</p>;
  const maxDur = Math.max(1, ...data.traceEvents.map((e) => e.durationMs ?? 0));
  const tokens = data.usageEvents.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0);
  const cost = data.usageEvents.reduce((s, u) => s + u.costUsd, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono">{data.id.slice(0, 12)}</span>
        <Badge variant={statusVariant(data.status)}>{data.status}</Badge>
        <span className="text-muted-foreground">{data.kind}</span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {tokens} tok · ${cost.toFixed(6)}
        </span>
      </div>
      {data.error ? <p className="text-sm text-destructive">{data.error}</p> : null}
      <div className="flex flex-col gap-1.5">
        {data.traceEvents.map((e) => (
          <EventRow key={e.id} e={e} maxDur={maxDur} />
        ))}
      </div>
      {data.usageEvents.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          <div className="mb-1 font-semibold uppercase tracking-wide">Usage</div>
          {data.usageEvents.map((u, i) => (
            <div key={i} className="font-mono">
              {u.model}: {u.inputTokens} in / {u.outputTokens} out · ${u.costUsd.toFixed(6)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TracesPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState<string>("all");
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: getMetrics });
  const runs = useQuery<RunSummary[]>({
    queryKey: ["runs", kind],
    queryFn: () => getRuns(kind === "all" ? undefined : kind),
  });

  const m = metrics.data;
  const failed = m ? (m.runs.byStatus.failed ?? 0) : 0;
  // Only show tabs for kinds that actually exist, so no tab is ever empty.
  const byKind = m?.runs.byKind ?? {};
  const kinds = [
    "all",
    ...KIND_ORDER.filter((k) => byKind[k]),
    ...Object.keys(byKind).filter((k) => !KIND_ORDER.includes(k)),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="runs" value={m ? `${m.runs.total}${failed ? ` · ${failed} failed` : ""}` : "…"} />
        <MetricCard label="tokens" value={m ? m.tokens.input + m.tokens.output : "…"} />
        <MetricCard label="cost" value={m ? `$${m.tokens.costUsd.toFixed(4)}` : "…"} />
        <MetricCard label="comparisons · entries" value={m ? `${m.deltas.comparisons} · ${m.deltas.entries}` : "…"} />
      </div>

      <div className="flex gap-1">
        {kinds.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              "rounded-md px-3 py-1 text-sm capitalize transition-colors",
              kind === k ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {k}
            {k !== "all" ? <span className="ml-1 text-xs text-muted-foreground">{byKind[k]}</span> : null}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card>
          <div className="border-b p-4 font-semibold">Runs</div>
          <CardContent className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto p-2">
            {runs.data?.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">No runs.</p>
            ) : null}
            {runs.data?.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                  selected === r.id && "bg-accent",
                )}
              >
                <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
                <span className="text-muted-foreground">{r.kind}</span>
                <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                {r.status === "failed" ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> : null}
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {r.durationMs !== null ? `${r.durationMs}ms` : ""}
                  {r.costUsd > 0 ? ` · $${r.costUsd.toFixed(4)}` : ""}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <div className="border-b p-4 font-semibold">Run detail</div>
          <CardContent className="max-h-[70vh] overflow-y-auto p-4">
            {selected ? (
              <RunDetailView runId={selected} />
            ) : (
              <p className="text-sm text-muted-foreground">Select a run to see its trace, prompts, and cost.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
