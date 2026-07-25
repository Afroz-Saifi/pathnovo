import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, MessageSquare } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { type ComparisonDetail, type DeltaEntry, getComparison, reportMarkdownUrl } from "../lib/api";
import { cn } from "../lib/utils";

type ChangeType = DeltaEntry["changeType"];

const TYPE_STYLE: Record<ChangeType, { badge: "success" | "destructive" | "warning"; fill: string; symbol: string }> = {
  added: { badge: "success", fill: "hsl(var(--success))", symbol: "+" },
  removed: { badge: "destructive", fill: "hsl(var(--destructive))", symbol: "−" },
  modified: { badge: "warning", fill: "hsl(var(--warning))", symbol: "~" },
};

function Sheet({
  title,
  entries,
  side,
  selected,
  onSelect,
}: {
  title: string;
  entries: DeltaEntry[];
  side: "A" | "B";
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  // On the base sheet show removed + modified (bboxA); on revised show added + modified (bboxB).
  const boxes = entries
    .map((e) => {
      const bbox = side === "A" ? e.bboxA : e.bboxB;
      return bbox ? { e, bbox } : null;
    })
    .filter((x): x is { e: DeltaEntry; bbox: NonNullable<DeltaEntry["bboxA"]> } => x !== null);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <svg viewBox="0 0 100 70.7" className="w-full rounded-md border bg-muted/30" role="img">
        {boxes.map(({ e, bbox }) => {
          const style = TYPE_STYLE[e.changeType];
          const isSel = selected === e.id;
          return (
            <rect
              key={e.id}
              x={bbox.x * 100}
              y={bbox.y * 70.7}
              width={Math.max(bbox.w * 100, 1.5)}
              height={Math.max(bbox.h * 70.7, 1)}
              fill={style.fill}
              fillOpacity={isSel ? 0.5 : 0.22}
              stroke={style.fill}
              strokeWidth={isSel ? 0.6 : 0.3}
              className="cursor-pointer"
              onClick={() => onSelect(isSel ? null : e.id)}
            />
          );
        })}
      </svg>
    </div>
  );
}

function EntryRow({
  entry,
  selected,
  onSelect,
}: {
  entry: DeltaEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = TYPE_STYLE[entry.changeType];
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <span className="font-mono" style={{ color: style.fill }}>
        {style.symbol}
      </span>
      <span className="flex-1">
        {entry.description}
        {entry.modifyKind ? <span className="text-muted-foreground"> ({entry.modifyKind})</span> : null}
      </span>
      <span className="font-mono text-xs text-muted-foreground">{entry.confidence.toFixed(2)}</span>
    </button>
  );
}

export function ComparePage() {
  const { id = "" } = useParams();
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery<ComparisonDetail>({
    queryKey: ["comparison", id],
    queryFn: () => getComparison(id),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">Comparison not found.</p>;

  const s = data.summary;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">
          {data.pidA} <ArrowRight className="inline h-4 w-4 text-muted-foreground" /> {data.pidB}
        </h1>
        <Badge variant="success">+{s.added} added</Badge>
        <Badge variant="destructive">−{s.removed} removed</Badge>
        <Badge variant="warning">~{s.modified} modified</Badge>
        <div className="ml-auto flex gap-2">
          <a href={reportMarkdownUrl(id)} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4" /> report.md
            </Button>
          </a>
          <Button variant="outline" size="sm" disabled>
            <MessageSquare className="h-4 w-4" /> Chat (soon)
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr_380px]">
        <Sheet title="PID A · base" entries={data.entries} side="A" selected={selected} onSelect={setSelected} />
        <Sheet title="PID B · revised" entries={data.entries} side="B" selected={selected} onSelect={setSelected} />
        <Card>
          <CardHeader>
            <CardTitle>Delta report</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-0.5">
            {(["added", "removed", "modified"] as ChangeType[]).map((type) => {
              const rows = data.entries
                .filter((e) => e.changeType === type)
                .sort((a, b) => b.confidence - a.confidence);
              if (rows.length === 0) return null;
              return (
                <div key={type} className="mb-2">
                  <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {type} ({rows.length})
                  </div>
                  {rows.map((e) => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      selected={selected === e.id}
                      onSelect={() => setSelected(selected === e.id ? null : e.id)}
                    />
                  ))}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Link to="/pairs" className="text-sm text-primary hover:underline">
        ← New comparison
      </Link>
    </div>
  );
}
