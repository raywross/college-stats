/**
 * The Next steps tab for the sample student: a presentational twin of `NextSteps` and `MoveCard`
 * (components/planner/), which need a `PlanContext`, the router, and the task store. Same header (the season and class
 * year, "How this season works"), same card (`rounded-3xl bg-card p-4 ring-1 ring-border`, title, "this season" with
 * the college fact's ⓘ, the why, the corner `⋯`, the guide's own button words). Nothing here writes or links into a
 * plan: the buttons and the menu are drawn, not wired, since the sample has no guide to open.
 */
import { MetricLabel } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import type { SampleMove } from "./sample";

const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold";
const PRIMARY = cn(BUTTON, "bg-foreground text-background");

export function SampleMoveCard({ move, index = 0 }: { move: SampleMove; index?: number }) {
  return (
    <div className="splash-rise animate-rise rounded-3xl bg-card p-4 ring-1 ring-border" style={{ animationDelay: `${120 + index * 110}ms` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 font-semibold">{move.title}</p>
          <MetricLabel cited={move.cite ?? undefined} className="shrink-0 text-sm text-muted-foreground">
            <span>this season</span>
          </MetricLabel>
        </div>
        <span aria-hidden className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-lg leading-none text-muted-foreground">
          ⋯
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{move.why}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <span className={PRIMARY}>{move.button}</span>
      </div>
    </div>
  );
}

export function SampleNow({ heading, moves }: { heading: string; moves: SampleMove[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-semibold">{heading}</p>
        <span className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-primary ring-1 ring-border">How this season works</span>
      </div>
      <div className="space-y-3">
        {moves.map((m, i) => (
          <SampleMoveCard key={m.title} move={m} index={i} />
        ))}
      </div>
    </div>
  );
}
