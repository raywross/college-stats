"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import NumbersForm from "@/components/planner/NumbersForm";
import { PlanCoursesSheet } from "@/components/planner/PlanCoursesSheet";
import { Term } from "@/components/ui/info-tip";
import { TEST_LABEL } from "@/lib/planner/standing";
import type { PlanContext } from "@/lib/planner/types";
import type { PlanView } from "@/lib/planner/plan-view";

/**
 * The header card (specs/planner/redesign/page.md "The page"): the student's initial in their household color,
 * "Your plan" or "Maya's plan", the class year and the season in words, and the numbers as one tappable line that
 * opens the numbers form in place. No completeness meter. A parent with edit access can use it too
 * (household-hub.md's edit switch; the open question page.md leaves for the owner, answered yes per its own
 * recommendation).
 */
export function PlanHeaderCard({
  ctx,
  view,
  relation,
  firstName,
  season,
  color,
}: {
  ctx: PlanContext;
  view: PlanView;
  relation: "self" | "guardian";
  firstName: string | null;
  season: string;
  color: string;
}) {
  const [editing, setEditing] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const courseCount = ctx.profile?.academics.courses.length ?? 0;
  const title = relation === "self" ? "Your plan" : `${firstName ?? "Their"}'s plan`;
  const initial = (relation === "self" ? "Y" : firstName?.[0]?.toUpperCase()) ?? "S";
  const gradYear = ctx.student?.grad_year ?? null;
  const practice = Boolean(ctx.profile?.tests.practice) && view.student.test !== null;
  const numbersLine = (
    <>
      <span className="font-semibold">{view.student.gpa !== null ? `GPA ${view.student.gpa.toFixed(2)}` : "No GPA yet"}</span>
      <span className="text-muted-foreground">·</span>
      <span className="font-semibold">
        {view.student.test ? `${TEST_LABEL[view.student.test.kind]} ${view.student.test.score}${practice ? " · practice" : ""}` : "Not testing"}
      </span>
    </>
  );

  return (
    <div className="rounded-3xl border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-base font-bold text-white" style={{ background: color }} aria-hidden>
          {initial}
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold leading-tight">
            <Term term="plan">{title}</Term>
          </h1>
          <p className="text-sm text-muted-foreground">
            {gradYear ? `Class of ${gradYear} · ` : ""}
            {season}
          </p>
        </div>
      </div>
      {editing ? (
        <div className="mt-4">
          <NumbersForm ctx={ctx} view={view} onClose={() => setEditing(false)} />
        </div>
      ) : ctx.viewer.canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-4 flex min-h-11 flex-wrap items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2 text-left text-sm hover:bg-muted"
        >
          {numbersLine}
          <Pencil className="ml-1 size-3.5 text-muted-foreground" aria-hidden />
        </button>
      ) : (
        <p className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2 text-sm">{numbersLine}</p>
      )}
      {!editing && ctx.viewer.canEdit && (
        <>
          <button
            type="button"
            onClick={() => setCoursesOpen(true)}
            className="mt-2 flex min-h-11 w-full flex-wrap items-center gap-x-2 rounded-2xl px-3 py-2 text-left text-sm hover:bg-muted/60"
          >
            <span className="font-semibold">
              {courseCount > 0 ? `${relation === "self" ? "Your" : `${firstName ?? "Their"}'s`} courses (${courseCount})` : `Add ${relation === "self" ? "your" : `${firstName ?? "their"}'s`} courses (optional)`}
            </span>
            <span className="text-muted-foreground">{courseCount > 0 ? "Edit" : "Helps at colleges where most students have top GPAs."}</span>
          </button>
          <PlanCoursesSheet ctx={ctx} open={coursesOpen} onOpenChange={setCoursesOpen} name={relation === "self" ? null : firstName} />
        </>
      )}
    </div>
  );
}
