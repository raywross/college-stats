import type { ReactNode } from "react";
import { STAGES } from "@/lib/planner/stage";
import type { PlanContext, Stage } from "@/lib/planner/types";

/**
 * The frame every stage panel sits in (specs/planner/model.md "Where it lives"): a card with the stage's number,
 * name, and count as its heading, then the panel's content, one column on phones. Stage units render their content
 * inside it so the panels look alike.
 */
export function StagePanel({ stage, ctx, children, actions }: { stage: Stage; ctx: Pick<PlanContext, "stages">; children: ReactNode; actions?: ReactNode }) {
  const info = STAGES.find((s) => s.stage === stage)!;
  return (
    <section aria-labelledby={`plan-stage-${stage}`} className="rounded-3xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`plan-stage-${stage}`} className="font-display text-xl font-bold sm:text-2xl">
            <span className="mr-1.5 text-muted-foreground tabular-nums">{stage}</span>
            {info.label}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{ctx.stages[stage].count}</p>
        </div>
        {actions}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/** A stage panel whose unit isn't built yet: the frame works from day one. */
export function ComingSoon({ stage, ctx, what }: { stage: Stage; ctx: Pick<PlanContext, "stages">; what: string }) {
  return (
    <StagePanel stage={stage} ctx={ctx}>
      <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">Coming in this build</p>
        <p className="mt-1">{what}</p>
      </div>
    </StagePanel>
  );
}
