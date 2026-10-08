import { CalendarCheck } from "lucide-react";
import { TaskRow } from "@/components/planner/TaskRow";
import { thisWeek } from "@/lib/planner/tasks";
import type { PlanContext } from "@/lib/planner/types";

/**
 * This week (specs/planner/model.md "Where it lives"; timeline.md "Display"): open tasks due in the next seven days
 * or overdue, overdue first, at most eight, then "and 4 more". Stays on screen whichever stage panel is open. A
 * server component; each row is a client TaskRow.
 */
export function ThisWeek({ ctx }: { ctx: PlanContext }) {
  const { tasks, more } = thisWeek(ctx.tasks, ctx.today);
  const studentFirst = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  return (
    <section aria-labelledby="plan-this-week" className="rounded-3xl border bg-card p-4 sm:p-5">
      <h2 id="plan-this-week" className="flex items-center gap-2 font-display text-lg font-bold">
        <CalendarCheck className="size-5 text-primary" aria-hidden />
        This week
      </h2>
      {tasks.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing due in the next seven days.</p>
      ) : (
        <ul className="mt-1 divide-y">
          {tasks.map((t) => {
            const school = t.item_id ? schoolOf(ctx, t.item_id) : null;
            return (
              <TaskRow
                key={t.id}
                task={t}
                school={school}
                cited={t.source_field && school ? school.cites[t.source_field] : undefined}
                canEdit={ctx.viewer.canEdit}
                today={ctx.today}
                viewer={ctx.viewer}
                studentFirstName={studentFirst}
              />
            );
          })}
        </ul>
      )}
      {more > 0 && <p className="mt-2 text-sm text-muted-foreground">and {more} more on the timeline below</p>}
    </section>
  );
}

/** The college a task's item points at, through the list. */
export function schoolOf(ctx: Pick<PlanContext, "items" | "schools">, itemId: string) {
  const item = ctx.items.find((i) => i.id === itemId);
  return item ? (ctx.schools[item.unit_id] ?? null) : null;
}
