import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "../components/ui/card";
import { type ConfigGroup, getConfig } from "../lib/api";

export function ConfigPage() {
  const { data, isLoading } = useQuery({ queryKey: ["config"], queryFn: getConfig });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Effective settings — every value is an env var (see <code>.env.example</code>); change it there
          and restart. The API key is never shown.
        </p>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.groups.map((group: ConfigGroup) => (
          <Card key={group.name}>
            <div className="border-b p-4 font-semibold">{group.name}</div>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <tbody>
                  {group.items.map((it) => (
                    <tr key={it.key} className="border-b last:border-0">
                      <td className="px-4 py-2 align-top">
                        <div className="font-medium">{it.key}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{it.env}</div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{String(it.value)}</span>
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
