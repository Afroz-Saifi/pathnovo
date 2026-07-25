import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { askChat, type Citation } from "../lib/api";
import { cn } from "../lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  confidence?: "grounded" | "partial" | "not_found";
}

const CONF_VARIANT = {
  grounded: "success",
  partial: "warning",
  not_found: "muted",
} as const;

export function ChatPage() {
  const { id = "" } = useParams();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: (q: string) => askChat(id, q, sessionId),
    onSuccess: (res) => {
      setSessionId(res.sessionId);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.answer, citations: res.citations, confidence: res.confidence },
      ]);
    },
  });

  function send() {
    const q = input.trim();
    if (!q || mutation.isPending) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    mutation.mutate(q);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Link to={`/compare/${id}`} className="text-sm text-primary hover:underline">
          <ArrowLeft className="mr-1 inline h-4 w-4" />
          Compare
        </Link>
        <span className="text-sm text-muted-foreground">· grounded chat over both revisions + the delta</span>
      </div>

      <div className="flex min-h-[50vh] flex-col gap-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask what changed, or about either revision. Answers are grounded with citations; unsupported
            questions are refused.
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <Card className={cn("max-w-[80%]", m.role === "user" && "bg-accent")}>
              <CardContent className="p-3 text-sm">
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.citations && m.citations.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.citations.map((c, j) => (
                      <span
                        key={j}
                        title={c.quote}
                        className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                      >
                        {c.source}
                        {c.sheet !== null ? ` · s${c.sheet + 1}` : ""}
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.confidence ? (
                  <div className="mt-2">
                    <Badge variant={CONF_VARIANT[m.confidence]}>{m.confidence.replace("_", " ")}</Badge>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ))}
        {mutation.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> thinking…
          </div>
        ) : null}
        {mutation.isError ? (
          <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about either revision or what changed…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button onClick={send} disabled={!input.trim() || mutation.isPending}>
          <Send className="h-4 w-4" />
          Send
        </Button>
      </div>
    </div>
  );
}
