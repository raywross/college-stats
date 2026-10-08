import { CollegeChip } from "@/components/planner/CollegeChip";
import { TimelineTaskRow } from "@/components/planner/TimelineTaskRow";
import { groupByCollege } from "@/lib/planner/tasks";
import type { PlanContext, PlanTask } from "@/lib/planner/types";

function Progress({ tasks }: { tasks: PlanTask[] }) {
  const done = tasks.filter((t) => t.done_at !== null).length;
  return (
    <span className="text-sm text-muted-foreground tabular-nums">
      {done} of {tasks.length} done
    </span>
  );
}

/**
 * The college view (specs/planner/timeline.md "Display"), the one that prints: "For every college" first (the shared
 * steps: FAFSA, test dates, windows), then a card per college with its steps in order and a progress count. A college
 * with no published dates says so and points at "Add a step" for the family's own date.
 */
export function CollegeView({ ctx, tasks }: { ctx: PlanContext; tasks: PlanTask[] }) {
  const { shared, byItem } = groupByCollege(tasks, ctx.items);
  const withTasks = new Set(byItem.map((g) => g.itemId));
  const quiet = ctx.items.filter((i) => !withTasks.has(i.id) && !i.withdrawn_on);
  return (
    <div className="grid gap-4 print:block print:space-y-4">
      {shared.length > 0 && (
        <section aria-labelledby="plan-college-shared" className="rounded-2xl border p-4 break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="plan-college-shared" className="font-display text-lg font-bold">
              For every college
            </h3>
            <Progress tasks={shared} />
          </div>
          <ul className="mt-1 divide-y">
            {shared.map((t) => (
              <TimelineTaskRow key={t.id} task={t} ctx={ctx} showCollege={false} />
            ))}
          </ul>
        </section>
      )}
      {byItem.map((g) => {
        const item = ctx.items.find((i) => i.id === g.itemId)!;
        const school = ctx.schools[item.unit_id] ?? null;
        return (
          <section key={g.itemId} aria-label={school?.name ?? "A college"} className="rounded-2xl border p-4 break-inside-avoid">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CollegeChip school={school} size="sm" link className="text-base" />
              <Progress tasks={g.tasks} />
            </div>
            <ul className="mt-1 divide-y">
              {g.tasks.map((t) => (
                <TimelineTaskRow key={t.id} task={t} ctx={ctx} showCollege={false} />
              ))}
            </ul>
          </section>
        );
      })}
      {quiet.length > 0 && (
        <section aria-label="Colleges without dates" className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground break-inside-avoid">
          <p className="font-semibold text-foreground">No published dates yet</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {quiet.map((i) => (
              <li key={i.id}>
                <CollegeChip school={ctx.schools[i.unit_id] ?? null} />
              </li>
            ))}
          </ul>
          <p className="mt-2">The college hasn&apos;t published these dates in its Common Data Set; add your own with &ldquo;Add a step&rdquo;.</p>
        </section>
      )}
    </div>
  );
}
