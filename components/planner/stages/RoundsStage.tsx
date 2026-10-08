import { StagePanel } from "@/components/planner/StagePanel";
import { PriorityList } from "@/components/planner/stages/PriorityList";
import { RoundsTable } from "@/components/planner/stages/RoundsTable";
import { Term } from "@/components/ui/info-tip";
import { priorityAttribution } from "@/lib/planner/store-rounds";
import { hasPriorities, priorityOrder, proposeRounds, roundsSummary, standingFor, type MoneyInput, type Standing } from "@/lib/planner/rounds";
import type { PlanContext } from "@/lib/planner/types";

/**
 * Stage 2, priorities and rounds (specs/planner/early-rounds.md). A server component: it works out the standing per
 * college (the suggested category stands in for chances, owner assumption 2), the money input (no estimator yet,
 * owner assumption 3: the family's max average cost from the profile), and the proposal, then hands them to the
 * client ranking and table. Once the plan is accepted the ranking folds away and the summary line leads.
 */
export default async function RoundsStage({ ctx }: { ctx: PlanContext }) {
  const items = ctx.items;
  if (items.length === 0) {
    return (
      <StagePanel stage={2} ctx={ctx}>
        <p className="text-sm text-muted-foreground">Add colleges to the list first; this stage then lays out each one&apos;s rounds and dates.</p>
      </StagePanel>
    );
  }
  const standing: Record<string, Standing> = Object.fromEntries(items.map((i) => [i.id, standingFor(i, ctx.schools[i.unit_id])]));
  const money: MoneyInput = { limit: ctx.profile?.preferences.maxAverageCost ?? null, estimates: {} };
  const proposal = proposeRounds(items, ctx.schools, standing, money);
  const accepted = ctx.list.rounds_plan_accepted_at !== null;
  const summary = accepted ? roundsSummary(items, ctx.schools) : null;
  const attribution = await priorityAttribution(ctx.list.id, ctx.student?.user_id ?? null);
  const rows = priorityOrder(items).map((i) => ({ id: i.id, dream: i.dream, school: ctx.schools[i.unit_id] ?? { unit_id: i.unit_id, name: i.unit_id, brand: undefined } }));
  const ranked = hasPriorities(items);
  const ranking = <PriorityList key={rows.map((r) => r.id).join(",")} listId={ctx.list.id} rows={rows} canEdit={ctx.viewer.canEdit} attribution={attribution} />;
  const schools = Object.fromEntries(items.filter((i) => ctx.schools[i.unit_id]).map((i) => [i.unit_id, ctx.schools[i.unit_id]]));

  return (
    <StagePanel stage={2} ctx={ctx}>
      <p className="text-sm text-muted-foreground">
        Who gets the early applications: <Term term="early-decision">early decision</Term> at one college (<Term term="binding">binding</Term>),{" "}
        <Term term="early-decision-ii">ED II</Term> at one more if the first says no, <Term term="single-choice-early-action">restrictive early action</Term> at one, and{" "}
        <Term term="early-action">early action</Term> wherever it&apos;s offered. Every line below says why; you decide.
      </p>
      {summary && (
        <p className="rounded-2xl bg-muted/60 px-3 py-2 text-sm font-semibold">
          <span className="text-muted-foreground">Your rounds: </span>
          {summary}
        </p>
      )}
      {accepted ? (
        <details className="rounded-2xl border px-3 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Your ranking</summary>
          <div className="pt-2 pb-1">{ranking}</div>
        </details>
      ) : (
        <section aria-label="Your ranking" className="space-y-2">
          <h3 className="font-display text-base font-bold">{ranked ? "Your ranking" : "First, rank the list"}</h3>
          {ranking}
        </section>
      )}
      <section aria-label="Rounds by college" className="space-y-2">
        <h3 className="font-display text-base font-bold">{accepted ? "Rounds" : "Proposed rounds"}</h3>
        <RoundsTable
          key={proposal.order.join(",")}
          listId={ctx.list.id}
          items={items}
          schools={schools}
          standing={standing}
          money={money}
          proposal={proposal}
          accepted={accepted}
          canEdit={ctx.viewer.canEdit}
        />
      </section>
    </StagePanel>
  );
}
