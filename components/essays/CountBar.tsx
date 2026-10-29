"use client";

/**
 * The count bar (specs/product/essays/workspace.md "The editor"): words or characters as the prompt's limit counts
 * them, "412 of 650", amber from 95%, red over; sticky at the bottom on phones, beside the field from `lg`. A live
 * region speaks only at a threshold (near, over, short of a minimum), never on every keystroke.
 */
import { countLabel, countState, countStateLine, type CountKind, type EssayLimit } from "@/lib/essays/count";
import { cn } from "@/lib/utils";

const TONE = {
  none: "text-foreground",
  ok: "text-foreground",
  under: "text-amber-700 dark:text-amber-300",
  near: "text-amber-700 dark:text-amber-300",
  over: "text-destructive",
} as const;

const BAR = {
  none: "bg-muted-foreground/40",
  ok: "bg-primary",
  under: "bg-amber-500",
  near: "bg-amber-500",
  over: "bg-destructive",
} as const;

export function CountBar({ count, limit, kind, saveLine, className }: { count: number; limit: EssayLimit | null; kind: CountKind; saveLine?: string | null; className?: string }) {
  const state = countState(count, limit);
  const line = countStateLine(state, count, limit);
  const share = limit ? Math.min(1, count / limit.max) : 0;
  return (
    <div className={cn("rounded-2xl border bg-card/95 px-4 py-2.5 backdrop-blur", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn("font-semibold tabular-nums", TONE[state])}>{countLabel(count, limit, kind)}</p>
        {saveLine && <p className="text-xs text-muted-foreground">{saveLine}</p>}
      </div>
      {limit && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={cn("h-full rounded-full transition-[width]", BAR[state])} style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
      )}
      {limit?.min !== undefined && state !== "under" && <p className="mt-1 text-xs text-muted-foreground">At least {limit.min.toLocaleString("en-US")} {limit.kind}</p>}
      <p className={cn("text-xs", line ? "mt-1" : "sr-only", TONE[state])} aria-live="polite">
        {line ?? ""}
      </p>
    </div>
  );
}

export default CountBar;
