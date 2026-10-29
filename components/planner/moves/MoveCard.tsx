"use client";

/**
 * The default move card (specs/planner/v3/now.md "The tab"; next-steps/seasons.md "The Next steps tab"): title, why
 * (the college fact cited with ⓘ through its date when the task names one), the date or "this season" (overdue in the
 * calendar's warning color, only for a dated move), the assignee chip when it isn't the viewer, and **one button**:
 * the move's guide when it has one (`guideFor`, the guide's own words: "Help me build it"), else the built button from
 * `task.action`. **Done** and **Skip for now** live in the card's corner menu (`⋯`), only with edit access; a
 * guardian with edit access skips too (owner, 2026-10-16), attributed by `dismissed_by`. Without
 * `ctx.viewer.canEdit` the card has no menu; its button still opens the guide (read-only) or the link. Every kind
 * without its own entry in `registry.tsx` renders this card.
 *
 * `onDone`/`onSkip` are the parent's (NextSteps.tsx): this card is presentational plus the one link, and leaves the
 * write, the optimism, and the fold-with-undo to whoever placed it on the page.
 *
 * A guardian sees exactly the student's card (owner, 2026-10-16: "make it so that it works the same for both parents
 * and students, using the student view"): the same title, the same assignee chip, the same corner menu.
 */
import Link from "next/link";
import { useEffect, useRef } from "react";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import type { AnyCited } from "@/lib/lineage";
import { guideFor, guideHref } from "@/lib/planner/guides";
import { isReachScoreMove, nextTestNote } from "@/lib/planner/moves";
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

const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold";
const PRIMARY = cn(BUTTON, "bg-foreground text-background");
const SECONDARY = cn(BUTTON, "ring-1 ring-border hover:bg-muted");
const MENU_ITEM = "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold hover:bg-muted disabled:opacity-60";

/** The move's guide button, when it has a guide (plan v3 review note 1): a link to the guide page with the move open. */
function GuideLink({ task, ctx }: { task: PlanTask; ctx: PlanContext }) {
  const guide = guideFor(task);
  if (!guide) return null;
  return (
    <Link href={guide.hrefFor(task, { person: personFor(ctx), items: ctx.items })} className={PRIMARY}>
      {guide.button}
    </Link>
  );
}

/**
 * Done and Skip for now, folded into a corner menu (now.md "The tab"): a `<details>` whose `⋯` summary is a 44px,
 * keyboard-reachable button. Picking an item closes the menu.
 */
function CornerMenu({ task, title, onDone, onSkip, pending }: { task: PlanTask; title: string; onDone: (t: PlanTask) => void; onSkip: (t: PlanTask) => void; pending: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pick = (fn: (t: PlanTask) => void) => {
    if (ref.current) ref.current.open = false;
    fn(task);
  };
  return (
    <details ref={ref} className="relative shrink-0">
      <summary
        aria-label={`More for ${title}`}
        className="-mr-2 -mt-2 flex size-11 cursor-pointer list-none items-center justify-center rounded-full text-lg leading-none text-muted-foreground hover:bg-muted marker:hidden [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden>⋯</span>
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-44 rounded-xl bg-popover p-1 shadow-lg ring-1 ring-border">
        <button type="button" className={MENU_ITEM} disabled={pending} onClick={() => pick(onDone)}>
          Done
        </button>
        {/* A parent with edit access skips too (owner, 2026-10-16: "there's no way to dismiss them"); attributed by dismissed_by. */}
        <button type="button" className={MENU_ITEM} disabled={pending} onClick={() => pick(onSkip)}>
          Skip for now
        </button>
      </div>
    </details>
  );
}

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
      // A page of the site's own (the essay workspace) opens in place, for the child this plan is for.
      if (action.href.startsWith("/")) {
        return (
          <Link href={person ? `${action.href}?for=${person}` : action.href} className={PRIMARY}>
            Open
          </Link>
        );
      }
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
      // PlanList reads `row`/`panel=ed` and opens that row's ED dialog (ed-opportunities.md; EdDecideCard's
      // `edRowHref()` builds the same shape). Every other kind of row task has its own guide now (plan v3
      // build-plan.md U2b), so any other panel value (or none) renders no button here. planHref always leaves a
      // `tab=colleges` in the string, so appending with `&` is safe.
      if (action.panel !== "ed") return null;
      return (
        <Link href={`${planHref({ person, tab: "colleges" })}&row=${action.itemId}&panel=ed`} className={SECONDARY}>
          See the college
        </Link>
      );
    }
    case "story": {
      // The story guide (Your record, 2026-10-16: the Numbers page and its story section are gone).
      const studentId = ctx.student?.id;
      return studentId ? (
        <Link href={guideHref("story", { person: personFor(ctx), from: "card" })} className={SECONDARY}>
          Open
        </Link>
      ) : null;
    }
    default:
      return null;
  }
}

export function MoveCard({ task, ctx, onDone, onSkip, pending, rank }: MoveCardProps) {
  // Once per card on mount (seasons.md "Rules"): a fresh instance (a new task id) fires again, a re-render of the
  // same one doesn't. R1b (ranking.md "Rules"): `rank` is the card's 1-based position in Now, undefined for a card
  // outside the ranked set (Your part, a parent's rows).
  useEffect(() => {
    track("plan_move_shown", { kind: task.kind, season: task.season ?? ctx.season, rank: rank ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mounted card, by task id
  }, [task.id]);

  const canEdit = ctx.viewer.canEdit;
  const date = taskDateLabel(task, ctx.today);
  const overdue = isOverdue(task, ctx.today);
  const school = schoolFor(task, ctx);
  const cited = task.source_field && school ? (school.cites[task.source_field] as AnyCited | undefined) : undefined;
  const showAssignee = task.assignee !== "student";
  const firstName = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  const title = task.title;
  // The picked test date folds into "Work toward your {target}" (owner, 2026-10-16): the soonest one, as an italic line.
  const testNote = isReachScoreMove(task) ? nextTestNote(ctx.tasks, ctx.today, ctx.profile?.tests.registeredDates ?? []) : null;

  const guide = guideFor(task);

  return (
    <div className="rounded-3xl bg-card p-4 ring-1 ring-border" id={`move-${task.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 font-semibold">{title}</p>
          <MetricLabel cited={cited} className={cn("shrink-0 text-sm text-muted-foreground", overdue && "font-semibold text-destructive")}>
            <span>
              {overdue ? "Overdue · " : ""}
              {date ?? "this season"}
            </span>
          </MetricLabel>
        </div>
        {canEdit && <CornerMenu task={task} title={title} onDone={onDone} onSkip={onSkip} pending={pending} />}
      </div>
      {task.detail && <p className="mt-1 text-sm text-muted-foreground">{task.detail}</p>}
      {testNote && <p className="mt-1 text-sm text-muted-foreground italic">{testNote}</p>}
      {showAssignee && (
        <span className="mt-1.5 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          <Term term="task-assignee">{assigneeLabel(task.assignee, { isGuardian: false }, firstName)}</Term>
        </span>
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2 empty:hidden">{guide ? <GuideLink task={task} ctx={ctx} /> : <ActionLink task={task} ctx={ctx} />}</div>
    </div>
  );
}

export default MoveCard;
