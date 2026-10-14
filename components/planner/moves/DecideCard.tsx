"use client";

/**
 * The choice (specs/planner/next-steps/applying.md "The moves"): before a choice, `decide_by` shows the admitted
 * colleges as chips with "I'm going to {College}" (ChooseButton → choose, built: deposit, withdrawals, the summer
 * list); once chosen, the `deposit` task (generators/offers.ts) shows the chosen college's deposit reminder with
 * "Change the choice". A guardian with edit access can tap, attributed (ChooseButton itself gates on canEdit); a
 * read-only guardian sees the same chips and dates without a button.
 */
import { ChooseButton } from "@/components/planner/ChooseButton";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { MetricLabel } from "@/components/ui/info-tip";
import type { AnyCited } from "@/lib/lineage";
import { isEdChoice, isPending } from "@/lib/planner/generators/offers";
import { taskDateLabel } from "@/lib/planner/tasks";
import type { MoveCardProps } from "./types";

export function DecideCard({ task, ctx }: MoveCardProps) {
  const canEdit = ctx.viewer.canEdit;
  const date = taskDateLabel(task, ctx.today);

  if (task.kind === "deposit") {
    const item = ctx.items.find((i) => i.id === task.item_id) ?? null;
    const school = item ? ctx.schools[item.unit_id] : null;
    if (!item || !school) return null;
    const cited = (task.source_field ? school.cites[task.source_field] : undefined) as AnyCited | undefined;
    return (
      <div className="rounded-xl bg-card p-4 ring-1 ring-border">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-semibold">
            <MetricLabel cited={cited}>{task.title}</MetricLabel>
          </p>
          {date && <span className="shrink-0 text-sm text-muted-foreground">{date}</span>}
        </div>
        {task.detail && <p className="mt-1 text-sm text-muted-foreground">{task.detail}</p>}
        <div className="mt-3">
          <ChooseButton itemId={item.id} unitId={item.unit_id} collegeName={school.name} ed={false} others={0} chosen canEdit={canEdit} />
        </div>
      </div>
    );
  }

  // decide_by: the admitted colleges as chips.
  const admitted = ctx.items.filter((i) => i.outcome === "admitted" && !i.withdrawn_on);
  const othersOpen = (itemId: string) => ctx.items.filter((i) => i.id !== itemId && !i.withdrawn_on && (isPending(i) || i.outcome === "admitted" || i.outcome === "waitlisted")).length;

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">{task.title}</p>
        {date && <span className="shrink-0 text-sm text-muted-foreground">{date}</span>}
      </div>
      {task.detail && <p className="mt-1 text-sm text-muted-foreground">{task.detail}</p>}
      {admitted.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No admits yet to choose from.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {admitted.map((item) => {
            const school = ctx.schools[item.unit_id];
            return (
              <li key={item.id} className="flex items-center gap-2 rounded-full border px-3 py-1.5">
                <CollegeChip school={school ?? null} size="xs" />
                <ChooseButton itemId={item.id} unitId={item.unit_id} collegeName={school?.name ?? "this college"} ed={isEdChoice(item)} others={othersOpen(item.id)} canEdit={canEdit} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default DecideCard;
