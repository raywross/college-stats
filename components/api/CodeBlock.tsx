import { CopyButton } from "./CopyButton";

/** A titled, monospace snippet with a Copy button. Scrolls sideways inside itself, never the page. */
export function CodeBlock({ title, hint, code }: { title: string; hint?: string; code: string }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-muted/40">
      <div className="flex items-center justify-between gap-3 border-b px-3.5 py-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
