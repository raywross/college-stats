"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { AlarmClockOff, Check } from "lucide-react";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { track } from "@/lib/analytics";
import type { AnyCited } from "@/lib/lineage";
import { snooze, tick, untick } from "@/lib/planner/store";
import { addDays } from "@/lib/planner/stage";
import { assigneeLabel, dateNoteLabel, isOverdue, taskDateLabel } from "@/lib/planner/tasks";
import type { PlanSchool, PlanTask } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

/**
 * One task (specs/planner/model.md "Shared code"; timeline.md "Display"): a tick, the title with its college (or "For
 * every college"), the date with its ⓘ (the college field it came from), the date's note ("Your date", a last-cycle
 * date), whose step it is, and "Snooze a week". Read-only (no tick, no snooze) without edit access. `children` is
 * the slot for later controls on the row (a guardian's nudge, U8).
 *
 * The tick is optimistic: it shows at once and the server's answer (a refresh) confirms it.
 */
export function TaskRow({
  task,
  school,
  cited,
  canEdit,
  today,
  viewer,
  studentFirstName,
  showCollege = true,
  children,
}: {
  task: PlanTask;
  school: Pick<PlanSchool, "unit_id" | "name" | "brand"> | null;
  /** The citation for the task's `source_field` (PlanSchool.cites), when it has one. */
  cited?: unknown;
  canEdit: boolean;
  today: string;
  viewer: { isGuardian: boolean };
  studentFirstName: string | null;
  showCollege?: boolean;
  children?: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(task.done_at !== null);
  const [error, setError] = useState<string | null>(null);
  const overdue = !done && isOverdue(task, today);
  const date = taskDateLabel(task, today);
  const note = dateNoteLabel(task);

  const toggle = () => {
    if (!canEdit) return;
    const next = !done;
    setDone(next);
    setError(null);
    startTransition(async () => {
      const result = next ? await tick(task.id) : await untick(task.id);
      if (!result.ok) {
        setDone(!next);
        setError(result.message);
      } else if (next) track("plan_task_ticked", { kind: task.kind, source: task.source, assignee: task.assignee });
    });
  };

  return (
    <li className={cn("flex items-start gap-3 py-2.5", pending && "opacity-70")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? "Done" : "Mark done"}: ${task.title}`}
        disabled={!canEdit || pending}
        onClick={toggle}
        className={cn(
          "mt-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full sm:size-9",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-full border-2",
            done ? "border-primary bg-primary text-primary-foreground" : overdue ? "border-destructive" : "border-muted-foreground/50",
          )}
        >
          {done && <Check className="size-3.5" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold break-words", done && "text-muted-foreground line-through")}>{task.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {showCollege && <CollegeChip school={school} className="text-xs" />}
          {date && (
            <MetricLabel cited={(cited ?? undefined) as AnyCited | undefined} className={cn(overdue && "font-semibold text-destructive")}>
              <span>
                {overdue ? "Overdue · " : ""}
                {date}
              </span>
            </MetricLabel>
          )}
          <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
            <Term term="task-assignee">{assigneeLabel(task.assignee, viewer, studentFirstName)}</Term>
          </span>
          {note && <span>{note}</span>}
        </div>
        {task.detail && <p className="mt-1 text-xs text-muted-foreground">{task.detail}</p>}
        {task.kind === "cycle" && !viewer.isGuardian && task.key?.includes(":cycle:choose_courses") && (
          <Link href="/plan?tab=scores#plan-courses" className="mt-1 inline-block text-xs font-semibold text-primary hover:underline">
            See next year&apos;s options
          </Link>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
        {children}
      </div>
      {canEdit && !done && (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => void (await snooze(task.id, addDays(today, 7))))}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground sm:size-9"
          aria-label={`Snooze a week: ${task.title}`}
          title="Snooze a week"
        >
          <AlarmClockOff className="size-4" />
        </button>
      )}
    </li>
  );
}
