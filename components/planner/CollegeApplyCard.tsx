import { ApplyCardControls } from "@/components/planner/ApplyCardControls";
import { ApplyStatusControl } from "@/components/planner/ApplyStatusControl";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { TaskRow } from "@/components/planner/TaskRow";
import { MetricLabel } from "@/components/ui/info-tip";
import type { AnyCited } from "@/lib/lineage";
import { requirementsFor } from "@/lib/planner/requirements";
import type { PlanContext, PlanItem, PlanSchool, PlanTask, TaskKind } from "@/lib/planner/types";
import type { StudentProfileData } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

const SUBTASK_KINDS: ReadonlySet<TaskKind> = new Set([
  "fee",
  "send_scores",
  "transcript",
  "recommendation",
  "supplement",
  "submit",
  "portal_setup",
  "portal_check",
  "aid_forms",
  "continued_interest",
  "waitlist_accept",
  "waitlist_deposit_elsewhere",
]);

/**
 * One college's Apply-stage card (specs/planner/applications.md "Display"): the requirements list with a ⓘ each,
 * the generated sub-tasks folded under "What's left" on phones, the status (and outcome) picker, the portal link,
 * and the rest of the controls. A withdrawn application greys out and shows only its status.
 */
export function CollegeApplyCard({
  item,
  school,
  tasks,
  profile,
  canEdit,
  today,
  viewer,
  studentFirstName,
}: {
  item: PlanItem;
  school: PlanSchool;
  tasks: PlanTask[];
  profile: StudentProfileData | null;
  canEdit: boolean;
  today: string;
  viewer: PlanContext["viewer"];
  studentFirstName: string | null;
}) {
  const requirements = requirementsFor(item, school, profile);
  const subtasks = tasks.filter((t) => t.item_id === item.id && SUBTASK_KINDS.has(t.kind)).sort((a, b) => a.position - b.position);
  const withdrawn = item.withdrawn_on !== null;
  const openCount = subtasks.filter((t) => t.done_at === null && !t.dismissed).length;

  return (
    <li className={cn("rounded-2xl border p-3 sm:p-4", withdrawn && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CollegeChip school={school} size="sm" link />
        <ApplyStatusControl itemId={item.id} status={item.status} outcome={item.outcome} canEdit={canEdit && !withdrawn} />
      </div>

      {withdrawn ? (
        <p className="mt-2 text-xs text-muted-foreground">Withdrawn{item.withdrawn_on ? ` ${item.withdrawn_on}` : ""}.</p>
      ) : (
        <>
          <ul className="mt-3 space-y-1.5 text-sm">
            {requirements.map((req) => (
              <li key={req.key} className={cn(!req.published && "text-muted-foreground italic")}>
                <MetricLabel cited={(req.cite ? school.cites[req.cite] : undefined) as AnyCited | undefined}>
                  <span className="font-semibold text-foreground">{req.label}:</span> {req.text}
                </MetricLabel>
              </li>
            ))}
          </ul>

          <div className="mt-3">
            <ApplyCardControls item={item} canEdit={canEdit} />
          </div>

          {subtasks.length > 0 && (
            <details className="mt-3 rounded-xl border" open={false}>
              <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-muted-foreground select-none">
                What&apos;s left ({openCount} of {subtasks.length})
              </summary>
              <ul className="divide-y border-t px-1">
                {subtasks.map((task) => (
                  <TaskRow key={task.id} task={task} school={school} canEdit={canEdit} today={today} viewer={viewer} studentFirstName={studentFirstName} showCollege={false} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </li>
  );
}
