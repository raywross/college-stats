import { Check, Minus, X } from "lucide-react";
import { reportLines, reportTally, type ReportLine } from "@/lib/admin/report-words";

/**
 * A change's report (specs/product/admin-redesign.md "Data"): the counts and checks the run wrote, as a list
 * (lib/admin/report-words.ts `reportLines`), with the raw text under Details. A check shows its outcome in words as
 * well as its icon ("Passed", "Failed", "Noted"), so color is never the only signal. Server-rendered; no state.
 */
export function ChangeReport({ text }: { text: string }) {
  const lines = reportLines(text);
  const tally = reportTally(lines);
  return (
    <div className="space-y-3">
      {tally.counts + tally.checks === 0 ? (
        <p className="text-sm text-muted-foreground">The report holds no counts or checks to list; its text is under Details.</p>
      ) : (
        <ReportList lines={lines} />
      )}
      <details className="rounded-xl border border-border">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold">Details</summary>
        <pre className="max-h-96 overflow-auto border-t border-border p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{text}</pre>
      </details>
    </div>
  );
}

const OUTCOME = {
  pass: { word: "Passed", Icon: Check, cls: "text-emerald-700 dark:text-emerald-300" },
  fail: { word: "Failed", Icon: X, cls: "text-destructive" },
  note: { word: "Noted", Icon: Minus, cls: "text-muted-foreground" },
} as const;

function ReportList({ lines }: { lines: ReportLine[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {lines.map((l, i) => {
        switch (l.kind) {
          case "heading":
            return (
              <li key={i} className="pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase first:pt-0">
                {l.text}
              </li>
            );
          case "count":
            return (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{l.label}:</span>
                <span className="font-semibold tabular-nums">{l.value}</span>
              </li>
            );
          case "check": {
            const o = OUTCOME[l.ok === true ? "pass" : l.ok === false ? "fail" : "note"];
            return (
              <li key={i} className="flex items-start gap-2">
                <o.Icon className={`mt-0.5 size-4 shrink-0 ${o.cls}`} aria-hidden />
                <span>
                  <span className={`font-semibold ${o.cls}`}>{o.word}:</span> <span className="font-semibold">{l.label}</span>
                  {l.detail && l.detail !== l.label && <span className="text-muted-foreground"> · {l.detail}</span>}
                </span>
              </li>
            );
          }
          case "row":
            return (
              <li key={i} className="rounded-lg bg-muted/30 px-2.5 py-1.5 break-words">
                {l.facts.map((f, k) => (
                  <span key={k}>
                    {k > 0 && <span className="text-muted-foreground"> · </span>}
                    <span className="text-muted-foreground">{f.label}: </span>
                    {f.value}
                  </span>
                ))}
              </li>
            );
          case "more":
            return (
              <li key={i} className="text-muted-foreground">
                … and {l.count.toLocaleString("en-US")} more {l.count === 1 ? "row" : "rows"}, in the text under Details.
              </li>
            );
          case "note":
            return (
              <li key={i} className="text-muted-foreground">
                {l.text}
              </li>
            );
        }
      })}
    </ul>
  );
}
