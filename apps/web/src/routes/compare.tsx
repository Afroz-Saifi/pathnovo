import { useParams } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

// Fleshed out in the next breakpoint (report + delta overlay).
export function ComparePage() {
  const { id } = useParams();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparison {id}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Compare view lands next.</p>
      </CardContent>
    </Card>
  );
}
