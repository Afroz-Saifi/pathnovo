import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MessageSquare, Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { type ComparisonListItem, listComparisons } from "../lib/api";

export function ComparisonsPage() {
  const { data, isLoading } = useQuery<ComparisonListItem[]>({
    queryKey: ["comparisons"],
    queryFn: listComparisons,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Comparisons</h1>
        <Link to="/pairs">
          <Button size="sm">
            <Plus className="h-4 w-4" /> New comparison
          </Button>
        </Link>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {data && data.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No comparisons yet.{" "}
            <Link to="/pairs" className="text-primary hover:underline">
              Create one
            </Link>
            .
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {data?.map((c) => (
          <Link key={c.id} to={`/compare/${c.id}`}>
            <Card className="transition-colors hover:border-primary/50">
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{c.pidA}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{c.pidB}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success">+{c.summary.added}</Badge>
                  <Badge variant="destructive">−{c.summary.removed}</Badge>
                  <Badge variant="warning">~{c.summary.modified}</Badge>
                  {c.hasChat ? (
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <MessageSquare className="h-3.5 w-3.5" /> chat ready
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{c.entries} changes</span>
                  <span>{new Date(c.createdAt).toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
