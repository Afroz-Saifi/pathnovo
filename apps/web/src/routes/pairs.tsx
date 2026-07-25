import { useMutation } from "@tanstack/react-query";
import { FileText, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { createComparison } from "../lib/api";

function FileSlot({
  label,
  file,
  onPick,
}: {
  label: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  return (
    <label className="flex cursor-pointer flex-col gap-2 rounded-lg border border-dashed p-5 transition-colors hover:border-primary/60">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {file ? <FileText className="h-5 w-5 text-primary" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
        <span className="truncate text-sm font-medium">{file ? file.name : "Choose a PDF…"}</span>
      </div>
      <input
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export function PairsPage() {
  const navigate = useNavigate();
  const [a, setA] = useState<File | null>(null);
  const [b, setB] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: () => createComparison(a!, b!),
    onSuccess: (res) => navigate(`/compare/${res.comparisonId}`),
  });

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Compare two revisions</CardTitle>
          <p className="text-sm text-muted-foreground">
            Upload PID A (base) and PID B (revised). The pipeline ingests both, computes the delta, and
            traces the run.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FileSlot label="PID A — base revision" file={a} onPick={setA} />
          <FileSlot label="PID B — revised" file={b} onPick={setB} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button disabled={!a || !b || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Ingest + compute delta
          </Button>
          {mutation.isError ? (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Try the committed sample pair:
            <br />
            <code className="text-[11px]">data/samples/pair-1/revA.pdf</code> and{" "}
            <code className="text-[11px]">revB.pdf</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
