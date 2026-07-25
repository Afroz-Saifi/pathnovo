import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

// Fleshed out in a later breakpoint (runs list + waterfall + metrics).
export function TracesPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Traces</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Runs, waterfall, and metrics land next.</p>
      </CardContent>
    </Card>
  );
}
