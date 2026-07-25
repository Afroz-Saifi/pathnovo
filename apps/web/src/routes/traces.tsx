import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { getMetrics, getRun, getRuns, type RunDetail, type RunSummary } from "../lib/api";
import { cn } from "../lib/utils";

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

function Waterfall({ runId }: { runId: string }) {
  const { data } = useQuery<RunDetail>({ queryKey: ["run", runId], queryFn: () => getRun(runId) });
  if (!data) return <p className="text-sm text-muted-foreground">Loading run…</p>;
  const maxDur = Math.max(1, ...data.traceEvents.map((e) => e.durationMs ?? 0));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-mono">{data.id.slice(0, 10)}</span>
        <Badge variant={statusVariant(data.status)}>{data.status}</Badge>
      </div>
      {data.error ? <p className="text-sm text-destructive">{data.error}</p> : null}
      <div className="flex flex-col gap-1">
        {data.traceEvents.map((e) => (
          <div key={e.id} className="grid grid-cols-[24px_180px_1fr] items-center gap-2 text-xs">
            <span className="text-right font-mono text-muted-foreground">{e.sequence}</span>
            <span className="font-mono">{e.eventType}</span>
            <div className="flex items-center gap-2">
              <div className="h-2 rounded-sm bg-primary" style={{ width: `${((e.durationMs ?? 0) / maxDur) * 100}%`, minWidth: e.durationMs ? 4 : 0 }} />
              <span className="whitespace-nowrap text-muted-foreground">{e.durationMs ?? "·"}{e.durationMs ? "ms" : ""}</span>
            </div>
            <div className="col-span-3 pl-[212px] font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(e.attributes)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TracesPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: getMetrics });
  const runs = useQuery<RunSummary[]>({ queryKey: ["runs"], queryFn: getRuns });

  const m = metrics.data;
  const failed = m ? (m.runs.byStatus.failed ?? 0) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="runs" value={m ? `${m.runs.total}${failed ? ` · ${failed} failed` : ""}` : "…"} />
        <MetricCard label="tokens" value={m ? m.tokens.input + m.tokens.output : "…"} />
        <MetricCard label="cost" value={m ? `$${m.tokens.costUsd.toFixed(2)}` : "…"} />
        <MetricCard label="comparisons · entries" value={m ? `${m.deltas.comparisons} · ${m.deltas.entries}` : "…"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Runs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {runs.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet — create a comparison.</p>
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
                  {r.durationMs !== null ? `${r.durationMs}ms` : ""} · {r.events} ev
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Waterfall</CardTitle>
          </CardHeader>
          <CardContent>
            {selected ? (
              <Waterfall runId={selected} />
            ) : (
              <p className="text-sm text-muted-foreground">Select a run to see its trace.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
