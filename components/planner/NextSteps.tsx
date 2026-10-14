/**
 * The Next steps tab (specs/planner/next-steps/seasons.md "The Next steps tab"). STUB written by U1 Foundation so the
 * tab works end to end: the season and class year, Now's titles with their dates as a plain list, and how many more
 * this season. Server component. U1b replaces it with the full tab (cards from components/planner/moves/registry.tsx,
 * the folds, the explainer sheet, a guardian's Your part, `?move=` scrolling).
 */
import { nowMoves } from "@/lib/planner/moves";
import { SEASON_EXPLAINER } from "@/lib/planner/moves-catalog";
import { SEASON_LABELS } from "@/lib/planner/seasons";
import { taskDateLabel } from "@/lib/planner/tasks";
import type { PlanContext } from "@/lib/planner/types";

export function NextSteps({ ctx, viewer }: { ctx: PlanContext; viewer: "student" | "guardian" }) {
  const groups = nowMoves(ctx.tasks, { season: ctx.season, gradYear: ctx.gradYear, today: ctx.today, viewer });
  const classOf = ctx.gradYear !== null ? ` · Class of ${ctx.gradYear}` : "";
  return (
    <section aria-labelledby="next-steps-heading" className="space-y-3">
      <h2 id="next-steps-heading" className="text-lg font-semibold">
        {SEASON_LABELS[ctx.season]}
        {classOf}
      </h2>
      {groups.now.length === 0 ? (
        <p className="text-muted-foreground">Nothing to do this season. Enjoy it.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl bg-card ring-1 ring-border">
          {groups.now.map((t) => (
            <li key={t.id} id={`move-${t.id}`} className="flex items-baseline justify-between gap-3 px-4 py-3">
              <span className="font-medium">{t.title}</span>
              <span className="shrink-0 text-sm text-muted-foreground">{taskDateLabel(t, ctx.today) ?? "this season"}</span>
            </li>
          ))}
        </ul>
      )}
      {groups.more.length > 0 && <p className="text-sm text-muted-foreground">More this season ({groups.more.length})</p>}
      <p className="text-sm text-muted-foreground">{SEASON_EXPLAINER[ctx.season].lead}</p>
    </section>
  );
}

export default NextSteps;
