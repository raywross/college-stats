import { ExternalLink } from "lucide-react";
import { MetricLabel } from "@/components/ui/info-tip";
import { TaskRow } from "@/components/planner/TaskRow";
import { WindowBar } from "@/components/planner/WindowBar";
import { OwnTaskControls } from "@/components/planner/OwnTaskControls";
import { NudgeButton } from "@/components/planner/parents/NudgeButton";
import { schoolOf } from "@/components/planner/ThisWeek";
import { entryForTask } from "@/lib/planner/generators/cycle";
import { isOpen } from "@/lib/planner/tasks";
import type { AnyCited } from "@/lib/lineage";
import type { PlanContext, PlanTask } from "@/lib/planner/types";

/**
 * One task in the timeline's month and college views: U1's TaskRow (tick, date with its ⓘ, whose step, snooze) plus
 * what the timeline adds under it: a window's bar across its months, the source of a shared date (the cycle file's
 * link), the ⓘ for the application fee in an apply task's detail, and Edit/Delete on the family's own tasks.
 */
export function TimelineTaskRow({ task, ctx, showCollege = true }: { task: PlanTask; ctx: PlanContext; showCollege?: boolean }) {
  const school = task.item_id ? schoolOf(ctx, task.item_id) : null;
  const cited = task.source_field && school ? school.cites[task.source_field] : undefined;
  const entry = task.source === "cycle" ? entryForTask(ctx.cycle.entries, task.key) : null;
  const feeCite = (task.kind === "apply" || task.kind === "ed2_conditional") && school ? school.cites["admissions.application_fee"] : undefined;
  const studentFirst = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  return (
    <TaskRow
      task={task}
      school={school}
      cited={cited}
      canEdit={ctx.viewer.canEdit}
      today={ctx.today}
      viewer={ctx.viewer}
      studentFirstName={studentFirst}
      showCollege={showCollege}
    >
      {task.window_start && task.window_end && <WindowBar start={task.window_start} end={task.window_end} today={ctx.today} />}
      {(entry !== null || feeCite !== undefined) && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {feeCite ? (
            <MetricLabel cited={feeCite as AnyCited}>
              <span>Fee</span>
            </MetricLabel>
          ) : null}
          {entry && (
            <a href={entry.source} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center gap-1 hover:text-primary print:hidden">
              Where this date comes from
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </p>
      )}
      {task.source === "own" && ctx.viewer.canEdit && (
        <OwnTaskControls
          task={{ id: task.id, title: task.title, due_on: task.due_on, assignee: task.assignee, item_id: task.item_id }}
          colleges={ctx.items.map((i) => ({ id: i.id, name: ctx.schools[i.unit_id]?.name ?? "A college" }))}
        />
      )}
      <NudgeButton
        taskId={task.id}
        taskTitle={task.title}
        nudges={ctx.nudges.filter((n) => n.task_id === task.id)}
        viewerIsGuardian={ctx.viewer.isGuardian}
        viewerUserId={ctx.viewer.userId}
        viewerFirstName={ctx.viewer.firstName}
        studentFirstName={studentFirst}
        studentHasAccount={ctx.student?.user_id != null}
        studentNudgeEmailsOff={false}
        taskOpen={isOpen(task, ctx.today)}
        today={ctx.today}
      />
    </TaskRow>
  );
}
