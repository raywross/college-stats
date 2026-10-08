import Link from "next/link";
import { Check } from "lucide-react";
import { STAGES } from "@/lib/planner/stage";
import type { PlanContext, Stage } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

/**
 * The stage strip (specs/planner/model.md "Where it lives"): six pills across the top of the Plan tab, each with its
 * count ("Rounds · 2 to decide", "Apply · 3 of 8 in"); the open one is ink-filled. Each pill is a link to
 * `?stage=N`, so opening another stage swaps only the panel (the strip and This week stay). Phones: one sideways row
 * that snaps pill by pill and bleeds to the screen edge (the people strip's pattern, specs/mobile.md), 44 px tall.
 */
export function StageStrip({ ctx, open, basePath }: { ctx: Pick<PlanContext, "stages" | "current">; open: Stage; basePath: string }) {
  return (
    <nav aria-label="Plan stages">
      <ol className="flex gap-2 pb-1 max-sm:-mx-4 max-sm:snap-x max-sm:snap-mandatory max-sm:overflow-x-auto max-sm:scroll-px-4 max-sm:px-4 sm:flex-wrap">
        {STAGES.map((s) => {
          const { state, count } = ctx.stages[s.stage];
          const active = s.stage === open;
          return (
            <li key={s.stage} className="flex shrink-0 snap-start">
              <Link
                href={s.stage === ctx.current ? basePath : `${basePath}?stage=${s.stage}`}
                aria-current={active ? "page" : undefined}
                scroll={false}
                className={cn(
                  "inline-flex min-h-11 flex-col justify-center rounded-2xl border px-3.5 py-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active ? "border-foreground bg-foreground text-background" : "bg-card hover:border-primary/40 hover:bg-muted/60",
                  !active && state === "not_yet" && "text-muted-foreground",
                )}
              >
                <span className="flex items-center gap-1 text-sm leading-tight font-semibold">
                  {state === "done" && <Check className="size-3.5" aria-label="done" />}
                  <span className="tabular-nums opacity-60">{s.stage}</span> {s.label}
                </span>
                <span className={cn("text-[11px] leading-tight whitespace-nowrap", active ? "text-background/75" : "text-muted-foreground")}>{count}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
