import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render assistant answers as Markdown (lists, tables, bold, code, links). */
export function Markdown({ children }: { children: string }) {
  return (
    <div
      className={
        "prose prose-sm max-w-none text-foreground " +
        "prose-p:my-1.5 prose-headings:mb-1 prose-headings:mt-2 " +
        "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 " +
        "prose-pre:my-2 prose-pre:bg-muted prose-pre:text-foreground " +
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none " +
        "prose-a:text-primary prose-strong:text-foreground prose-headings:text-foreground " +
        "prose-th:text-foreground prose-td:py-1"
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
