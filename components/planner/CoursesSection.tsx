"use client";

import Link from "next/link";
import { useState } from "react";
import { CoursesNextYearSlot } from "@/components/planner/CoursesNextYearSlot";
import { PlanCoursesSheet } from "@/components/planner/PlanCoursesSheet";
import { SourceTip, Term } from "@/components/ui/info-tip";
import { courseName, groupByYear, KIND_LABELS, thirdPerson } from "@/lib/chances/courses";
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import type { CourseEntry } from "@/lib/chances/types";
import { cn } from "@/lib/utils";

/** "S1 A · S2 A- · Final A", or the exam score; empty for a course with no grades yet. */
function gradeText(c: CourseEntry): string {
  const g = c.grades;
  const parts = [g.s1 && `S1 ${g.s1}`, g.s2 && `S2 ${g.s2}`, g.final && `Final ${g.final}`, c.exam !== null && `AP exam ${c.exam}`].filter((x): x is string => !!x);
  return parts.join(" · ");
}

/**
 * The Scores tab's Courses section (specs/chances/rigor-in-context.md "In the planner"): the reading, the list by year
 * with grades, the school's offering with its source, and the slot for next year's suggestions. Shown for a student who
 * has entered courses. Third person for a parent. The reading's sentences come from the server (ctx.rigor); AP exam
 * scores are on the rows only when the viewer may see them (lib/planner/load.ts strips a parent's copy).
 */
export default function CoursesSection({ ctx, view }: { ctx: PlanContext; view: PlanView }) {
  const [editing, setEditing] = useState(false);
  const courses = ctx.profile?.academics.courses ?? [];
  const rigor = ctx.rigor ?? null;
  const isGuardian = ctx.viewer.isGuardian;
  const first = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  const name = isGuardian ? first : null;
  if (courses.length === 0 && !rigor) return null;

  const say = (t: string) => (isGuardian ? thirdPerson(t, first) : t);
  const offering = rigor?.offering ?? null;

  return (
    <section className="space-y-3 rounded-3xl border bg-card p-5" aria-labelledby="plan-courses">
      <div className="flex items-start justify-between gap-3">
        <h2 id="plan-courses" className="font-display text-lg font-bold">
          <Term term="course-rigor">{isGuardian && first ? `${first}'s courses` : "Your courses"}</Term>
        </h2>
        {ctx.viewer.canEdit && (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex h-9 shrink-0 items-center rounded-full border px-3 text-xs font-semibold hover:bg-muted">
            Edit courses
          </button>
        )}
      </div>

      {rigor && (
        <div className="space-y-1 text-sm">
          <p>{say(rigor.sentences[0])}</p>
          {rigor.sentences.slice(1).map((t) => (
            <p key={t} className="text-muted-foreground">
              {say(t)}
            </p>
          ))}
        </div>
      )}

      {courses.length > 0 && (
        <div className="space-y-3">
          {groupByYear(courses).map((g) => (
            <div key={g.year}>
              <p className="mb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">{g.year}th grade</p>
              <ul className="divide-y rounded-2xl border">
                {g.rows.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                    <span className="min-w-0 break-words">
                      <span className="font-semibold">{courseName(c)}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">{KIND_LABELS[c.kind]}</span>
                      {c.status !== "taken" && (
                        <span className={cn("ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", c.status === "planned" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                          {c.status === "planned" ? "planned" : "in progress"}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{gradeText(c)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {offering && (
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <Link href={`/high-schools/${offering.hsId}`} className="font-semibold text-foreground hover:text-primary hover:underline">
            {offering.hsName}
          </Link>
          <span aria-hidden>·</span>
          <span>{offering.lines.map(say).join(" ")}</span>
          {offering.cite && <SourceTip cited={offering.cite} />}
        </p>
      )}

      <CoursesNextYearSlot ctx={ctx} view={view} />
      {ctx.viewer.canEdit && <PlanCoursesSheet ctx={ctx} open={editing} onOpenChange={setEditing} name={name} />}
    </section>
  );
}
