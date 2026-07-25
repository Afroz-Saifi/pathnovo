import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { type ConfigItem, getConfig, resetConfig, updateConfig } from "../lib/api";

function Field({
  item,
  draft,
  onChange,
}: {
  item: ConfigItem;
  draft: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  const value = draft ?? item.value;
  if (!item.editable) {
    return <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{String(item.value)}</span>;
  }

  const selectClass =
    "w-40 rounded border bg-background px-2 py-0.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  // Boolean → On/Off dropdown.
  if (item.type === "boolean") {
    return (
      <select
        className={selectClass}
        value={value ? "on" : "off"}
        onChange={(e) => onChange(e.target.value === "on")}
      >
        <option value="on">on</option>
        <option value="off">off</option>
      </select>
    );
  }

  // Known choices → dropdown.
  if (item.options && item.options.length > 0) {
    return (
      <select className={selectClass} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {item.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  // Free numeric / text value.
  return (
    <input
      type={item.type === "number" ? "number" : "text"}
      value={String(value)}
      step="any"
      onChange={(e) => onChange(item.type === "number" ? Number(e.target.value) : e.target.value)}
      className="w-32 rounded border bg-background px-2 py-0.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

export function ConfigPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});

  const save = useMutation({
    mutationFn: () => updateConfig(draft),
    onSuccess: (res) => {
      qc.setQueryData(["config"], res);
      setDraft({});
    },
  });

  const reset = useMutation({
    mutationFn: resetConfig,
    onSuccess: (res) => {
      qc.setQueryData(["config"], res);
      setDraft({});
    },
  });

  const dirty = Object.keys(draft).length > 0;
  const anyOverride = data?.groups.some((g) => g.items.some((i) => i.overridden));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Configuration</h1>
          <p className="text-sm text-muted-foreground">
            Edit tunable settings live — changes apply to the next operation and persist. Secret and
            boot-time vars (API key, database) are read-only.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!anyOverride || reset.isPending}
            onClick={() => reset.mutate()}
          >
            {reset.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Reset defaults
          </Button>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save {dirty ? `(${Object.keys(draft).length})` : ""}
          </Button>
        </div>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.groups.map((group) => (
          <Card key={group.name}>
            <div className="border-b p-4 font-semibold">{group.name}</div>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <tbody>
                  {group.items.map((it) => (
                    <tr key={it.key} className="border-b last:border-0">
                      <td className="px-4 py-2 align-top">
                        <div className="flex items-center gap-1.5 font-medium">
                          {it.key}
                          {it.overridden ? <Badge variant="warning">overridden</Badge> : null}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">{it.env}</div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <Field item={it} draft={draft[it.env]} onChange={(v) => setDraft((d) => ({ ...d, [it.env]: v }))} />
                      </td>
                      <td className="px-4 py-2 align-top text-xs text-muted-foreground">{it.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
