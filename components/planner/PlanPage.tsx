import { getAccount } from "@/lib/auth";
import { scheduleStudentReadLog, type PersonPage } from "@/lib/households";
import { myHome } from "@/lib/home-store";
import { getOrCreateDefaultList, myLists } from "@/lib/lists";
import { createServerSupabase } from "@/lib/supabase-server";
import { profileFor } from "@/lib/student-profile-store";
import { effectiveGradYear } from "@/lib/student-profile";
import { generatorInputFor, planContextFrom, PlannerSetupError, readPlan, readTasks, todayIso, writeMerge } from "@/lib/planner/context";
import { generateTasks, mergeTasks } from "@/lib/planner/tasks";
import type { PlanContext, Stage } from "@/lib/planner/types";
import { GradYearPrompt } from "@/components/planner/GradYearPrompt";
import { PlanOpened } from "@/components/planner/PlanOpened";
import { StageStrip } from "@/components/planner/StageStrip";
import { ThisWeek } from "@/components/planner/ThisWeek";
import { Term } from "@/components/ui/info-tip";
import ListStage from "@/components/planner/stages/ListStage";
import RoundsStage from "@/components/planner/stages/RoundsStage";
import ActionsStage from "@/components/planner/stages/ActionsStage";
import TimelineStage from "@/components/planner/stages/TimelineStage";
import ApplyStage from "@/components/planner/stages/ApplyStage";
import OffersStage from "@/components/planner/stages/OffersStage";

const PANELS: Record<Stage, (props: { ctx: PlanContext }) => React.ReactNode> = {
  1: ListStage,
  2: RoundsStage,
  3: ActionsStage,
  4: TimelineStage,
  5: ApplyStage,
  6: OffersStage,
};

type StudentPerson = Extract<PersonPage, { kind: "student" }>;

/**
 * The Plan tab's frame (specs/planner/model.md "Where it lives"), under the person area on a student's page:
 *
 *   [class year prompt, when the student has none]
 *   stage strip: six pills with a count each (?stage=N opens another)
 *   the open stage's panel (components/planner/stages/*)
 *   This week
 *   the timeline's month view (TimelineStage), unless the timeline is the open panel
 *
 * A server component. It reads the plan once with the viewer's session, regenerates the tasks (cheap and idempotent:
 * a data publish moves dates; only someone who can edit writes), builds the PlanContext, and hands it to the panels.
 * A guardian's view is logged for the student, like their list and numbers.
 */
export async function PlanPage({ personId, person, stage }: { personId: string; person: StudentPerson; stage: Stage | null }) {
  const { student, canEdit, relation } = person.access;
  const owner = { kind: "student" as const, id: student.id };
  const lists = await myLists(owner);
  let listId: string | null = lists.find((l) => l.is_default)?.id ?? lists[0]?.id ?? null;
  if (!listId && canEdit) listId = (await getOrCreateDefaultList(owner))?.id ?? null;
  const first = student.display_name?.trim().split(/\s+/)[0] || null;

  if (!listId) {
    return (
      <section className="rounded-3xl border bg-card p-5 sm:p-6">
        <h2 className="font-display text-xl font-bold">No list yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">The plan starts from {first ? `${first}'s` : "the"} list. Colleges added from a college&apos;s page, Explore, or Compare show up there.</p>
      </section>
    );
  }

  const supabase = await createServerSupabase();
  const [account, profile, home] = await Promise.all([getAccount(), profileFor(student.id), myHome()]);
  if (relation === "guardian") await scheduleStudentReadLog(student.id, "plan_tasks");
  const gradYear = profile ? effectiveGradYear(profile.data.basics, student.grad_year) : student.grad_year;
  const today = todayIso();

  let plan;
  try {
    plan = await readPlan(supabase, listId);
  } catch (err) {
    if (err instanceof PlannerSetupError) {
      return (
        <section className="rounded-3xl border bg-card p-5 sm:p-6">
          <h2 className="font-display text-xl font-bold">The plan isn&apos;t set up yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">The planner&apos;s tables haven&apos;t been added to the database. The list still works.</p>
        </section>
      );
    }
    throw err;
  }
  if (!plan) return null;

  const input = await generatorInputFor(plan, { gradYear, profile: profile?.data ?? null, home, today });
  if (canEdit && (await writeMerge(supabase, listId, mergeTasks(plan.tasks, generateTasks(input))))) {
    plan = { ...plan, tasks: await readTasks(supabase, listId) };
  }
  const ctx = planContextFrom(input, plan, {
    student: { id: student.id, display_name: student.display_name, grad_year: gradYear, user_id: student.user_id },
    home,
    viewer: {
      userId: account?.user.id ?? "",
      firstName: account?.profile.display_name?.trim().split(/\s+/)[0] || null,
      canEdit,
      relation: relation === "self" ? "self" : "guardian",
      isGuardian: relation === "guardian",
    },
  });
  const open = stage ?? ctx.current;
  const Panel = PANELS[open];
  const thisYear = Number(today.slice(0, 4));

  return (
    <div className="space-y-6">
      <PlanOpened stage={open} />
      {gradYear === null && (
        <GradYearPrompt studentId={student.id} years={[0, 1, 2, 3, 4, 5].map((n) => thisYear + n)} canEdit={canEdit} firstName={relation === "self" ? null : first} />
      )}
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {relation === "self" ? "Your" : first ? `${first}'s` : "The"} <Term term="plan">plan</Term>, in six <Term term="stage">stages</Term>. Open any of
          them; they&apos;re a map, not a gate.
        </p>
        <StageStrip ctx={ctx} open={open} basePath={`/household/${personId}/plan`} />
      </div>
      <Panel ctx={ctx} />
      <ThisWeek ctx={ctx} />
      {open !== 4 && <TimelineStage ctx={ctx} />}
    </div>
  );
}
