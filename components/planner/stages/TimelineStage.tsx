import { StagePanel } from "@/components/planner/StagePanel";
import { MonthView } from "@/components/planner/MonthView";
import { CollegeView } from "@/components/planner/CollegeView";
import { TimelineViews } from "@/components/planner/TimelineViews";
import { PlanMenu } from "@/components/planner/PlanMenu";
import { AddOwnTask } from "@/components/planner/OwnTaskControls";
import { OrphanNotice } from "@/components/planner/OrphanNotice";
import { schoolOf } from "@/components/planner/ThisWeek";
import { Term } from "@/components/ui/info-tip";
import { createServerSupabase } from "@/lib/supabase-server";
import { consentView } from "@/lib/planner/store-timeline";
import { GRADE_LABELS } from "@/lib/planner/cycle";
import { orphansToShow } from "@/lib/planner/timeline";
import type { PlanContext } from "@/lib/planner/types";

/**
 * Stage 4, the timeline (specs/planner/timeline.md "Display"): every step by month (default) or by college (the
 * printed view), a "Changed" line for steps whose source disappeared, "Add a step", and the Plan menu (calendar link,
 * one-time .ics, print, texts). A server component; it reads only what the menu needs beyond the PlanContext (whether
 * this person has a live calendar link, and the student's text consent), both with the viewer's own session.
 */
export default async function TimelineStage({ ctx }: { ctx: PlanContext }) {
  const supabase = await createServerSupabase();
  const [links, consent] = await Promise.all([
    supabase.from("plan_calendar_tokens").select("id").eq("list_id", ctx.list.id).is("revoked_at", null).limit(1),
    ctx.student ? consentView({ kind: "student", studentId: ctx.student.id }) : Promise.resolve(null),
  ]);
  const hasLink = (links.data?.length ?? 0) > 0;
  const studentFirst = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;

  const shown = ctx.tasks.filter((t) => !t.dismissed && !t.orphaned && (t.done_at !== null || t.snoozed_until === null || t.snoozed_until <= ctx.today));
  const orphans = orphansToShow(ctx.tasks, ctx.today).map((t) => {
    const college = t.item_id ? schoolOf(ctx, t.item_id)?.name : null;
    return { id: t.id, line: `${college ? `${college}: ` : ""}"${t.title}" is no longer in the newest published dates, so it's off the plan.` };
  });
  const colleges = ctx.items.map((i) => ({ id: i.id, name: ctx.schools[i.unit_id]?.name ?? "A college" }));

  return (
    <StagePanel
      stage={4}
      ctx={ctx}
      actions={
        <div className="flex items-center gap-2">
          {ctx.viewer.canEdit && <AddOwnTask listId={ctx.list.id} colleges={colleges} />}
          <PlanMenu listId={ctx.list.id} hasLink={hasLink} consent={consent} studentId={ctx.student?.id ?? null} studentName={studentFirst} dossierHref={ctx.student ? `/household/${ctx.student.id}/plan/print` : null} />
        </div>
      }
    >
      <div className="hidden print:block">
        <p className="text-sm">
          {studentFirst ? `${studentFirst}'s plan` : "The plan"}, by college · printed {ctx.today}
        </p>
      </div>
      <p className="text-sm text-muted-foreground print:hidden">
        Every step with a date, <Term term="task-assignee">whose it is</Term>, and where the date came from (the ⓘ).{" "}
        {ctx.grade === "unknown" || ctx.grade === "graduated"
          ? "Steps far ahead wait under “Later”."
          : `Showing what matters now (${GRADE_LABELS[ctx.grade].toLowerCase()}); the rest waits under “Later”.`}
      </p>
      <OrphanNotice items={orphans} canEdit={ctx.viewer.canEdit} />
      <TimelineViews month={<MonthView ctx={ctx} tasks={shown} />} college={<CollegeView ctx={ctx} tasks={shown} />} />
      <p className="hidden text-xs text-muted-foreground print:block">
        Sources: each college&apos;s Common Data Set (the ⓘ beside each date on screen names the edition), College Board and ACT test calendars, Federal
        Student Aid, and the Common App.
      </p>
    </StagePanel>
  );
}
