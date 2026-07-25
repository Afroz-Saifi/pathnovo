import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, Maximize2, MessageSquare, X } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import {
  type ComparisonDetail,
  type DeltaEntry,
  getComparison,
  reportMarkdownUrl,
  sheetImageUrl,
} from "../lib/api";
import { cn } from "../lib/utils";

type Category = "added" | "removed" | "modified" | "moved";

const CAT: Record<Category, { label: string; color: string; symbol: string }> = {
  added: { label: "added", color: "hsl(var(--success))", symbol: "+" },
  removed: { label: "removed", color: "hsl(var(--destructive))", symbol: "−" },
  modified: { label: "modified", color: "hsl(var(--warning))", symbol: "~" },
  moved: { label: "moved", color: "hsl(262 65% 58%)", symbol: "⇄" },
};
const CATS: Category[] = ["added", "removed", "modified", "moved"];

/** A "moved" change is really modified/moved — split it into its own bucket. */
function categoryOf(e: DeltaEntry): Category {
  if (e.changeType === "added") return "added";
  if (e.changeType === "removed") return "removed";
  if (e.modifyKind === "moved") return "moved";
  return "modified";
}

interface HoverInfo {
  entry: DeltaEntry;
  x: number;
  y: number;
}

function Overlay({
  id,
  side,
  entries,
  filters,
  minConf,
  selected,
  onSelect,
  onHover,
}: {
  id: string;
  side: "a" | "b";
  entries: DeltaEntry[];
  filters: Set<Category>;
  minConf: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onHover: (h: HoverInfo | null) => void;
}) {
  // When an entry is selected, focus on it — show only that box, hide the rest.
  const boxes = entries
    .filter((e) =>
      selected ? e.id === selected : filters.has(categoryOf(e)) && e.confidence >= minConf,
    )
    .map((e) => ({ e, bbox: side === "a" ? e.bboxA : e.bboxB }))
    .filter((x): x is { e: DeltaEntry; bbox: NonNullable<DeltaEntry["bboxA"]> } => Boolean(x.bbox));

  return (
    <div className="relative w-full overflow-hidden rounded-md border bg-white">
      <img src={sheetImageUrl(id, side)} alt={`sheet ${side}`} className="block w-full" />
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {boxes.map(({ e, bbox }) => {
          const isSel = selected === e.id;
          return (
            <rect
              key={e.id}
              x={bbox.x}
              y={bbox.y}
              width={bbox.w}
              height={bbox.h}
              fill={CAT[categoryOf(e)].color}
              fillOpacity={isSel ? 0.45 : 0.18}
              stroke={CAT[categoryOf(e)].color}
              strokeWidth={isSel ? 2.5 : 1.2}
              vectorEffect="non-scaling-stroke"
              className="pointer-events-auto cursor-pointer"
              onMouseMove={(ev) => onHover({ entry: e, x: ev.clientX, y: ev.clientY })}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(isSel ? null : e.id)}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function ComparePage() {
  const { id = "" } = useParams();
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [filters, setFilters] = useState<Set<Category>>(new Set(CATS));
  const [minConf, setMinConf] = useState(0);
  const [fullscreen, setFullscreen] = useState<"a" | "b" | null>(null);

  const { data, isLoading, error } = useQuery<ComparisonDetail>({
    queryKey: ["comparison", id],
    queryFn: () => getComparison(id),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">Comparison not found.</p>;

  const toggle = (t: Category) =>
    setFilters((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const counts: Record<Category, number> = { added: 0, removed: 0, modified: 0, moved: 0 };
  for (const e of data.entries) counts[categoryOf(e)]++;
  const selectedEntry = selected ? data.entries.find((e) => e.id === selected) : undefined;

  const overlayProps = {
    id,
    entries: data.entries,
    filters,
    minConf,
    selected,
    onSelect: setSelected,
    onHover: setHover,
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">
          {data.pidA} <ArrowRight className="inline h-4 w-4 text-muted-foreground" /> {data.pidB}
        </h1>
        {CATS.map((c) => (
          <span
            key={c}
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ color: CAT[c].color, backgroundColor: `color-mix(in srgb, ${CAT[c].color} 14%, transparent)` }}
          >
            {CAT[c].symbol}
            {counts[c]} {c}
          </span>
        ))}
        <div className="ml-auto flex gap-2">
          <a href={reportMarkdownUrl(id)} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4" /> report.md
            </Button>
          </a>
          <Link to={`/chat/${id}`}>
            <Button variant="outline" size="sm">
              <MessageSquare className="h-4 w-4" /> Chat
            </Button>
          </Link>
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {CATS.map((t) => (
          <label key={t} className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={filters.has(t)} onChange={() => toggle(t)} disabled={Boolean(selected)} />
            <span style={{ color: CAT[t].color }}>■</span>
            {CAT[t].label}
          </label>
        ))}
        <label
          className="flex items-center gap-2 text-muted-foreground"
          title="How sure the delta engine is about each change (0–1). Drag to hide lower-confidence changes from the overlay and the report."
        >
          min confidence {minConf.toFixed(2)}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={minConf}
            onChange={(e) => setMinConf(Number(e.target.value))}
          />
        </label>
        {selectedEntry ? (
          <button
            onClick={() => setSelected(null)}
            className="ml-auto flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
          >
            Focusing 1 change · clear <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {/* body */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_1fr_360px]">
        {(["a", "b"] as const).map((side) => (
          <div key={side} className="flex min-h-0 flex-col gap-1">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{side === "a" ? "PID A · base" : "PID B · revised"}</span>
              <button className="hover:text-foreground" onClick={() => setFullscreen(side)} title="Full screen">
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {data.hasSheets ? (
                <Overlay side={side} {...overlayProps} />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">No rendered sheet for this comparison.</p>
              )}
            </div>
          </div>
        ))}

        {/* scrollable report */}
        <Card className="flex min-h-0 flex-col">
          <div className="flex flex-col gap-2 border-b p-3">
            <span className="font-semibold">Delta report</span>
            <div className="flex flex-wrap gap-1.5">
              {CATS.map((t) => {
                const active = filters.has(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggle(t)}
                    disabled={Boolean(selected)}
                    title={`${active ? "Hide" : "Show"} ${t}`}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-opacity",
                      !active && "opacity-40",
                    )}
                    style={{
                      color: CAT[t].color,
                      borderColor: CAT[t].color,
                      backgroundColor: active ? `color-mix(in srgb, ${CAT[t].color} 12%, transparent)` : "transparent",
                    }}
                  >
                    <span className="font-mono">{CAT[t].symbol}</span>
                    {t} · {counts[t]}
                  </button>
                );
              })}
            </div>
          </div>
          <CardContent className="min-h-0 flex-1 overflow-y-auto p-2">
            {CATS.map((type) => {
              if (!filters.has(type)) return null;
              const rows = data.entries
                .filter((e) => categoryOf(e) === type && e.confidence >= minConf)
                .sort((a, b) => b.confidence - a.confidence);
              if (rows.length === 0) return null;
              return (
                <div key={type} className="mb-2">
                  <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {type} ({rows.length})
                  </div>
                  {rows.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setSelected(selected === e.id ? null : e.id)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                        selected === e.id && "bg-accent ring-1 ring-primary",
                      )}
                    >
                      <span className="font-mono" style={{ color: CAT[categoryOf(e)].color }}>
                        {CAT[categoryOf(e)].symbol}
                      </span>
                      <span className="flex-1">
                        {e.description}
                        {e.modifyKind ? <span className="text-muted-foreground"> ({e.modifyKind})</span> : null}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{e.confidence.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* hover tooltip */}
      {hover ? (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-md border bg-card p-2 text-xs shadow-md"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{
              color: CAT[categoryOf(hover.entry)].color,
              backgroundColor: `color-mix(in srgb, ${CAT[categoryOf(hover.entry)].color} 14%, transparent)`,
            }}
          >
            {CAT[categoryOf(hover.entry)].label}
          </span>
          <p className="mt-1">{hover.entry.description}</p>
          <p className="mt-1 font-mono text-muted-foreground">
            {hover.entry.itemKind} · conf {hover.entry.confidence.toFixed(2)}
          </p>
        </div>
      ) : null}

      {/* fullscreen preview */}
      {fullscreen ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-background/95 p-4" onClick={() => setFullscreen(null)}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">
              {fullscreen === "a" ? `${data.pidA} · base` : `${data.pidB} · revised`}
            </span>
            <Button variant="ghost" size="icon" onClick={() => setFullscreen(null)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto max-w-[1600px]">
              <Overlay side={fullscreen} {...overlayProps} />
            </div>
          </div>
        </div>
      ) : null}

      <Link to="/pairs" className="text-sm text-primary hover:underline">
        ← New comparison
      </Link>
    </div>
  );
}
