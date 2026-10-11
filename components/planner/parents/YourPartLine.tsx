import { yourPart } from "@/lib/planner/summary";
import { taskDateLabel } from "@/lib/planner/tasks";
import type { PlanContext, PlanTask } from "@/lib/planner/types";

/** The net price calculator a `cost_check` task is asking about, when the college still has one on file. */
function taskUrl(ctx: PlanContext, task: PlanTask): string | null {
  if (task.kind !== "cost_check" || !task.item_id) return null;
  const item = ctx.items.find((i) => i.id === task.item_id);
  if (!item) return null;
  return ctx.schools[item.unit_id]?.links?.price_calculator ?? null;
}

/**
 * "Your part" (specs/planner/parents.md "The parent's tasks"; page.md): the guardian's own first open task for
 * this child, as one line on the plan itself — not the full list (that's the household page's `YourPart`). Nothing
 * when the guardian has no open task for this student, or for the student's own view (parent only).
 */
export function YourPartLine({ ctx, firstName }: { ctx: PlanContext; firstName: string | null }) {
  const studentId = ctx.student?.id ?? null;
  if (!studentId) return null;
  const groups = yourPart([{ studentId, name: firstName, tasks: ctx.tasks }], ctx.today);
  const task = groups[0]?.tasks[0];
  if (!task) return null;
  const date = taskDateLabel(task, ctx.today);
  const url = taskUrl(ctx, task);

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-3xl border-[1.5px] border-foreground bg-card px-4 py-3">
      <span className="inline-flex shrink-0 items-center rounded-full bg-pop px-2.5 py-1 text-xs font-bold text-pop-foreground">Your part</span>
      <p className="min-w-0 flex-1 text-sm font-semibold">
        {task.title}
        {date && <span className="font-normal text-muted-foreground"> by {date}</span>}
      </p>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-semibold text-primary underline-offset-2 hover:underline">
          Open
        </a>
      )}
    </div>
  );
}
