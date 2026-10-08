import { TimelineTaskRow } from "@/components/planner/TimelineTaskRow";
import { groupByMonth } from "@/lib/planner/tasks";
import { splitFold } from "@/lib/planner/timeline";
import type { PlanContext, PlanTask } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

function monthTitle(key: string): string {
  if (key === "overdue") return "Overdue";
  if (key === "undated") return "No date";
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** One month's tasks: open ones as rows, done ones folded under a count. */
function MonthGroup({ id, title, tasks, ctx, warn }: { id: string; title: string; tasks: PlanTask[]; ctx: PlanContext; warn?: boolean }) {
  const open = tasks.filter((t) => t.done_at === null);
  const done = tasks.filter((t) => t.done_at !== null);
  return (
    <section aria-labelledby={id}>
      <h3
        id={id}
        className={cn(
          "sticky top-[calc(env(safe-area-inset-top,0px)+var(--header-offset,0px))] z-10 -mx-1 bg-card px-1 py-1.5 text-sm font-bold sm:static",
          warn && "text-destructive",
        )}
      >
        {title}
        <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{open.length}</span>
      </h3>
      {open.length > 0 && (
        <ul className="divide-y">
          {open.map((t) => (
            <TimelineTaskRow key={t.id} task={t} ctx={ctx} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="mt-1 text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted-foreground sm:min-h-8">
            {done.length} done
          </summary>
          <ul className="divide-y opacity-80">
            {done.map((t) => (
              <TimelineTaskRow key={t.id} task={t} ctx={ctx} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * The month view (specs/planner/timeline.md "Display"): every task grouped by month, overdue ones first in the
 * warning color, done ones folded under a count, windows as bars, and tasks past the grade's horizon folded under
 * "Later" (lib/planner/timeline.ts splitFold). The month heading sticks on phones. A server component; each row is
 * U1's client TaskRow (tick, date with its ⓘ, whose step, snooze a week).
 */
export function MonthView({ ctx, tasks }: { ctx: PlanContext; tasks: PlanTask[] }) {
  const { now, later } = splitFold(tasks, ctx.grade, ctx.today);
  const groups = groupByMonth(now, ctx.today);
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No steps yet. They appear as colleges go on the list and their dates are published.</p>;
  }
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <MonthGroup key={g.key} id={`plan-month-${g.key}`} title={monthTitle(g.key)} tasks={g.tasks} ctx={ctx} warn={g.key === "overdue"} />
      ))}
      {later.length > 0 && (
        <details className="rounded-2xl border border-dashed p-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold sm:min-h-8">
            Later <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{later.length}</span>
            <span className="ml-2 text-xs font-normal text-muted-foreground">further ahead than this part of the year needs</span>
          </summary>
          <div className="mt-3 space-y-5">
            {groupByMonth(later, ctx.today).map((g) => (
              <MonthGroup key={g.key} id={`plan-later-${g.key}`} title={monthTitle(g.key)} tasks={g.tasks} ctx={ctx} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
