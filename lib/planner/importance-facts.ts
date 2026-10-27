/**
 * `ImportanceFacts` built the same way everywhere (build-plan.md "R1b"): `NextSteps.tsx`, `ParentNextSteps.tsx`, and
 * `app/advisor/page.tsx`'s `detailFor` all call this rather than assembling the shape themselves, so a `reach_score`
 * move reads the same list deadlines wherever it's ranked. The deadlines come from `view.rows` the way
 * `guides-server.ts`'s `loadTestGuide` already builds them for the test guide, so the two never disagree.
 * Pure; client-safe.
 */
import { ROUND_SHORT } from "./rounds.ts";
import type { ListDeadline } from "./test-guide.ts";
import type { PlanContext } from "./types.ts";
import type { PlanView } from "./plan-view.ts";
import type { ImportanceFacts } from "./importance.ts";

export function importanceFactsFrom(ctx: Pick<PlanContext, "season" | "today" | "gradYear" | "profile" | "cycle">, view: Pick<PlanView, "rows">): ImportanceFacts {
  const listDeadlines: ListDeadline[] = view.rows
    .filter((r) => !r.item.withdrawn_on && r.deadline && r.school)
    .map((r) => ({ name: r.school!.name, round: ROUND_SHORT[r.round], iso: r.deadline!.iso }));
  return { season: ctx.season, today: ctx.today, gradYear: ctx.gradYear, profile: ctx.profile, cycle: ctx.cycle, listDeadlines };
}
