import { ApplyPlatformToggle } from "@/components/planner/ApplyPlatformToggle";
import { CollegeApplyCard } from "@/components/planner/CollegeApplyCard";
import { StagePanel } from "@/components/planner/StagePanel";
import { TaskRow } from "@/components/planner/TaskRow";
import { groupByPlatform, orderForApply, PLATFORM_LABELS } from "@/lib/planner/requirements";
import { dayLabel, nextTask } from "@/lib/planner/tasks";
import type { PlanContext } from "@/lib/planner/types";

/**
 * Stage 5 (specs/planner/applications.md): a card per college in deadline order, each with the requirements list,
 * the sub-tasks, the status (and outcome) picker, the portal, and the fee line; a "By platform" toggle regroups the
 * same cards. Any shared tasks (one transcript request, the Common App essay) show first. A server component; the
 * cards' interactive pieces are client children with only what they need.
 */
export default function ApplyStage({ ctx }: { ctx: PlanContext }) {
  const items = ctx.items.filter((i) => Boolean(ctx.schools[i.unit_id]));
  const ordered = orderForApply(items, ctx.schools);
  const studentFirstName = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  const shared = ctx.tasks.filter((t) => t.item_id === null && (t.kind === "transcript" || t.kind === "supplement"));
  const applyTasks = ctx.tasks.filter((t) => t.kind === "apply" || t.kind === "ed2_conditional");
  const next = nextTask(applyTasks, ctx.today);
  const nextSchool = next?.item_id ? ctx.schools[ctx.items.find((i) => i.id === next.item_id)?.unit_id ?? ""] : null;

  if (items.length === 0) {
    return (
      <StagePanel stage={5} ctx={ctx}>
        <p className="text-sm text-muted-foreground">Add a college to the list to see what it needs here.</p>
      </StagePanel>
    );
  }

  const cardFor = (item: (typeof ordered)[number]) => (
    <CollegeApplyCard
      key={item.id}
      item={item}
      school={ctx.schools[item.unit_id]}
      tasks={ctx.tasks}
      profile={ctx.profile}
      canEdit={ctx.viewer.canEdit}
      today={ctx.today}
      viewer={ctx.viewer}
      studentFirstName={studentFirstName}
    />
  );

  const byPlatform = groupByPlatform(ordered);

  return (
    <StagePanel stage={5} ctx={ctx}>
      <p className="text-sm text-muted-foreground">
        {ctx.stages[5].count}
        {next && nextSchool ? ` · next: ${nextSchool.name}, ${dayLabel(next.due_on!, ctx.today)}` : ""}
      </p>

      {shared.length > 0 && (
        <div className="rounded-2xl border p-3 sm:p-4">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Shared across your list</p>
          <ul className="divide-y">
            {shared.map((task) => (
              <TaskRow key={task.id} task={task} school={null} canEdit={ctx.viewer.canEdit} today={ctx.today} viewer={ctx.viewer} studentFirstName={studentFirstName} showCollege={false} />
            ))}
          </ul>
        </div>
      )}

      <ApplyPlatformToggle
        byDeadline={<ul className="space-y-3">{ordered.map(cardFor)}</ul>}
        byPlatform={
          <div className="space-y-4">
            {byPlatform.map((group) => (
              <div key={group.platform ?? "none"}>
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                  {group.platform ? PLATFORM_LABELS[group.platform] : "Not set yet"}: {group.items.length} college{group.items.length === 1 ? "" : "s"}
                </p>
                <ul className="space-y-3">{group.items.map(cardFor)}</ul>
              </div>
            ))}
          </div>
        }
      />
    </StagePanel>
  );
}
