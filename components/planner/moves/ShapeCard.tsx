"use client";

/**
 * The list-shape move's card (specs/planner/next-steps/list-shape.md "Gap moves"): kind `shape_gap` (a student
 * move) or `shape_cost` (the parent's affordability check). Title and why (the count line) come straight from the
 * task; the one button follows `task.action` — `show_rail` opens a `CollegeRail` inline ("Show some"), `href`
 * opens the college's calculator (the parent's case), `open_intake` sends an unsorted list to the numbers step,
 * `open_tab` opens Colleges for "Review the list", and no button at all for the informational total_off fact.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CollegeRail } from "@/components/planner/CollegeRail";
import { taskDateLabel, assigneeLabel } from "@/lib/planner/tasks";
import { planHref } from "@/lib/planner/plan-tabs";
import { track } from "@/lib/analytics";
import type { MoveCardProps } from "./types";

export function ShapeCard({ task, ctx, onDone, onSkip, pending }: MoveCardProps) {
  const router = useRouter();
  const [railOpen, setRailOpen] = useState(false);
  const date = taskDateLabel(task, ctx.today);
  const assignee = assigneeLabel(task.assignee, ctx.viewer, ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null);
  const showAssignee = !(task.assignee === "student" && !ctx.viewer.isGuardian) && !(task.assignee === "guardian" && ctx.viewer.isGuardian);
  const action = task.action;

  // Fires once per card mount (a fresh card each regeneration carries a new key/id), not on every re-render.
  useEffect(() => {
    if (action?.kind === "show_rail") track("plan_shape_gap_shown", { gap: action.gap, season: task.season ?? "unknown" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  function openRail() {
    if (action?.kind !== "show_rail") return;
    setRailOpen(true);
    track("plan_rail_opened", { level: action.level });
  }

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border" id={`move-${task.id}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">{task.title}</p>
        <span className="shrink-0 text-sm text-muted-foreground">{date ?? "this season"}</span>
      </div>
      {task.detail && <p className="mt-1 text-sm text-muted-foreground">{task.detail}</p>}
      {showAssignee && <p className="mt-1 text-xs text-muted-foreground">{assignee}</p>}

      {action?.kind === "show_rail" && !railOpen && (
        <button type="button" className="mt-3 min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background" onClick={openRail}>
          Show some
        </button>
      )}
      {action?.kind === "show_rail" && railOpen && ctx.student && (
        <div className="mt-3">
          <CollegeRail
            listId={ctx.list.id}
            studentId={ctx.student.id}
            level={action.level}
            gap={action.gap}
            canEdit={ctx.viewer.canEdit}
            showCost={(ctx.profile?.preferences.maxAverageCost ?? null) !== null}
            onAdded={() => router.refresh()}
          />
        </div>
      )}
      {action?.kind === "href" && (
        <a href={action.href} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-sm font-semibold text-background">
          Check the cost
        </a>
      )}
      {action?.kind === "open_intake" && (
        <a href={planHref({ person: ctx.student?.id, setup: true, step: action.step })} className="mt-3 inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-sm font-semibold text-background">
          Add your numbers
        </a>
      )}
      {action?.kind === "open_tab" && (
        <a href={planHref({ person: ctx.student?.id, tab: action.tab })} className="mt-3 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ring-1 ring-border">
          Review the list
        </a>
      )}

      {ctx.viewer.canEdit && (
        <div className="mt-3 flex gap-2">
          <button type="button" className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background" disabled={pending} onClick={() => onDone(task)}>
            Done
          </button>
          <button type="button" className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-border" disabled={pending} onClick={() => onSkip(task)}>
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

export default ShapeCard;
