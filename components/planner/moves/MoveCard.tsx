"use client";

/**
 * The default move card (specs/planner/next-steps/seasons.md "The Next steps tab"; build-plan.md "Cards"): title,
 * why (the college fact cited with ⓘ through its date when the task names one), the date or "this season" (overdue
 * in the calendar's warning color, only for a dated move), the assignee chip when it isn't the viewer, one button
 * from `task.action`, **Done** and **Not now**. Every other kind without its own entry in `registry.tsx` renders
 * this card. Read-only (no Done, no Not now, no action button) without `ctx.viewer.canEdit`: the labels stay, just
 * not tappable, so a guardian without edit access reads the same card the student does.
 *
 * `onDone`/`onSkip` are the parent's (NextSteps.tsx): this card is presentational plus the one action link, and
 * leaves the write, the optimism, and the fold-with-undo to whoever placed it on the page.
 */
import Link from "next/link";
import { useEffect } from "react";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import type { AnyCited } from "@/lib/lineage";
import { planHref } from "@/lib/planner/plan-tabs";
import { assigneeLabel, isOverdue, taskDateLabel } from "@/lib/planner/tasks";
import type { PlanContext, PlanTask } from "@/lib/planner/types";
import { cn } from "@/lib/utils";
import type { MoveCardProps } from "./types";

/** The person param for `planHref` from inside a card: null for a signed-in student's own plan, else the child's id. */
export function personFor(ctx: PlanContext): string | null {
  return ctx.viewer.relation === "self" ? null : (ctx.student?.id ?? null);
}

/** The school a task's college fact comes from, when it has one (item_id → PlanItem → PlanSchool). */
function schoolFor(task: Pick<PlanTask, "item_id">, ctx: PlanContext) {
  if (!task.item_id) return undefined;
  const item = ctx.items.find((i) => i.id === task.item_id);
  return item ? ctx.schools[item.unit_id] : undefined;
}

const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold sm:min-h-9";
const PRIMARY = cn(BUTTON, "bg-foreground text-background");
const SECONDARY = cn(BUTTON, "ring-1 ring-border hover:bg-muted");
const READONLY = cn(BUTTON, "cursor-default text-muted-foreground opacity-60");

/** The one button `task.action` gives beyond Done and Not now (seasons.md: "one button plus Not now"); null for a
 *  tick action (Done already is that button) and for the other units' action kinds that don't yet (or won't) carry
 *  their own card, where the title alone stands in. `story` (the junior-spring brag-sheet entry) and `open_row`
 *  (a college's row) both go through here even though `story` and `ed_decide` tasks have their own cards elsewhere,
 *  since a `playbook` task can still carry either action. */
function ActionLink({ task, ctx }: { task: PlanTask; ctx: PlanContext }) {
  const action = task.action;
  if (!action) return null;
  const person = personFor(ctx);
  switch (action.kind) {
    case "href":
      return (
        <a href={action.href} target="_blank" rel="noreferrer" className={SECONDARY}>
          Open
        </a>
      );
    case "open_intake":
      return (
        <Link href={planHref({ person, setup: true, step: action.step })} className={SECONDARY}>
          Open
        </Link>
      );
    case "open_tab":
      return (
        <Link href={planHref({ person, tab: action.tab })} className={SECONDARY}>
          Open
        </Link>
      );
    case "open_row": {
      // PlanList reads `row`/`panel` and opens that row's drawer on that panel (ed-opportunities.md; U2's
      // `edRowHref()` builds the same shape for the pill's own "See why"). planHref always leaves a `tab=colleges`
      // in the string, so appending with `&` is safe.
      const panel = action.panel ? `&panel=${action.panel}` : "";
      return (
        <Link href={`${planHref({ person, tab: "colleges" })}&row=${action.itemId}${panel}`} className={SECONDARY}>
          See the college
        </Link>
      );
    }
    case "story": {
      // The Numbers page's story section (U7, StorySection.tsx); the same route for self and a guardian (NUMBERS in
      // moves-catalog.ts goes there too, unconditionally on the student id, not the viewer).
      const studentId = ctx.student?.id;
      return studentId ? (
        <Link href={`/household/${studentId}/numbers#story`} className={SECONDARY}>
          Open
        </Link>
      ) : null;
    }
    default:
      return null;
  }
}

export function MoveCard({ task, ctx, onDone, onSkip, pending }: MoveCardProps) {
  // Once per card on mount (seasons.md "Rules"): a fresh instance (a new task id) fires again, a re-render of the
  // same one doesn't.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mounted card, by task id
  useEffect(() => {
    track("plan_move_shown", { kind: task.kind, season: task.season ?? ctx.season });
  }, [task.id]);

  const canEdit = ctx.viewer.canEdit;
  const date = taskDateLabel(task, ctx.today);
  const overdue = isOverdue(task, ctx.today);
  const school = schoolFor(task, ctx);
  const cited = task.source_field && school ? (school.cites[task.source_field] as AnyCited | undefined) : undefined;
  const viewerAssignee = ctx.viewer.isGuardian ? "guardian" : "student";
  const showAssignee = task.assignee !== viewerAssignee;
  const firstName = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;

  return (
    <div className="rounded-3xl bg-card p-4 ring-1 ring-border" id={`move-${task.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">{task.title}</p>
        <MetricLabel cited={cited} className={cn("shrink-0 text-sm text-muted-foreground", overdue && "font-semibold text-destructive")}>
          <span>
            {overdue ? "Overdue · " : ""}
            {date ?? "this season"}
          </span>
        </MetricLabel>
      </div>
      {task.detail && <p className="mt-1 text-sm text-muted-foreground">{task.detail}</p>}
      {showAssignee && (
        <span className="mt-1.5 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          <Term term="task-assignee">{assigneeLabel(task.assignee, { isGuardian: ctx.viewer.isGuardian }, firstName)}</Term>
        </span>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionLink task={task} ctx={ctx} />
        {canEdit ? (
          <>
            <button type="button" className={PRIMARY} disabled={pending} onClick={() => onDone(task)}>
              Done
            </button>
            <button type="button" className={SECONDARY} disabled={pending} onClick={() => onSkip(task)}>
              Not now
            </button>
          </>
        ) : (
          <>
            <span className={READONLY}>Done</span>
            <span className={READONLY}>Not now</span>
          </>
        )}
      </div>
    </div>
  );
}

export default MoveCard;
