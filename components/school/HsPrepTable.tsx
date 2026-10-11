"use client";

import Link from "next/link";
import { useState } from "react";
import { useMyCourses } from "@/components/me/useMyCourses";
import { LocalCoursesSheet } from "@/components/profile/LocalCoursesSheet";
import { MetricLabel } from "@/components/ui/info-tip";
import { gradeNow, HS_ROW_SUBJECT, youText, youYears } from "@/lib/chances/courses";
import { noteText } from "@/lib/chances/notes";
import { HS_SUBJECT_ROWS } from "@/lib/cds/application-logistics-display";
import type { AnyCited } from "@/lib/lineage";
import type { CourseEntry } from "@/lib/chances/types";
import { coreAnswered, emptyCoreAtTopLevel, type CoreAtTopLevel } from "@/lib/student-profile";

export interface HsPrepTableRow {
  label: string;
  required: number | null;
  recommended: number | null;
  lab?: { required: number | null; recommended: number | null };
}

const units = (v: number | null) => (v === null ? "–" : String(v));

/**
 * Subjects where the college recommends more years than the visitor's list shows and a year of choosing remains
 * (course-plan.md "On the college profile"): "Science: 4 recommended, you're on track for 3." then a link to the plan.
 * The suggestions themselves live in the planner; nothing about them is decided here.
 */
function fallShort(rows: HsPrepTableRow[], courses: CourseEntry[], core: CoreAtTopLevel, gradYear: number | null): { subject: string; before: string; link: string }[] {
  const grade = gradeNow(gradYear, new Date().toISOString().slice(0, 10));
  if (grade === null || grade > 11) return [];
  const out: { subject: string; before: string; link: string }[] = [];
  for (const r of rows) {
    const key = HS_SUBJECT_ROWS.find((x) => x.label === r.label)?.key;
    const subject = key ? HS_ROW_SUBJECT[key] : undefined;
    if (!subject || r.recommended === null) continue;
    const you = youYears(courses, core, subject);
    if (!you || you.years >= r.recommended) continue;
    const text = noteText({ key: "course_plan.profile_line", values: { subject: r.label, recommended: r.recommended, have: you.years } });
    const tail = " See next year's options in your plan.";
    out.push({ subject: r.label, before: text.endsWith(tail) ? `${text.slice(0, -tail.length)} ` : text, link: text.endsWith(tail) ? tail.trim() : "" });
  }
  return out;
}

/**
 * The years-of-each-subject table in "What you'll need in high school", with a **You** column counted from the
 * visitor's course list and core-subject answers (specs/chances/rigor-in-context.md "On the college profile"): the
 * years the list can count for the subject, with planned ones marked ("3 (1 planned)"). Subjects the list can't count
 * say "add your courses to compare". The college's own columns are rendered as before; the page is static, so the
 * list arrives after mount (useMyCourses) and the column appears only once there is one.
 */
export function HsPrepTable({
  rows,
  showReq,
  showRec,
  required,
  recommended,
  citedRequired,
  citedRecommended,
}: {
  rows: HsPrepTableRow[];
  showReq: boolean;
  showRec: boolean;
  required: { total: number | null; summed: boolean };
  recommended: { total: number | null; summed: boolean };
  citedRequired: AnyCited;
  citedRecommended: AnyCited;
}) {
  const mine = useMyCourses();
  const [open, setOpen] = useState(false);
  const core = mine.coreAtTopLevel ?? emptyCoreAtTopLevel();
  const hasList = mine.status === "ready" && (mine.courses.length > 0 || coreAnswered(core));
  const unknown = noteText({ key: "rigor.you_unknown", values: {} });
  const shortLines = hasList && showRec ? fallShort(rows, mine.courses, core, mine.gradYear) : [];

  return (
    <>
      <table className="mt-4 w-full max-w-md text-sm">
        <caption className="sr-only">Years of each high school subject</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5 font-medium">Years of</th>
            {showReq && (
              <th className="py-1.5 text-right font-medium">
                <MetricLabel cited={citedRequired}>Required</MetricLabel>
              </th>
            )}
            {showRec && (
              <th className="py-1.5 text-right font-medium">
                <MetricLabel cited={citedRecommended}>Recommended</MetricLabel>
              </th>
            )}
            {hasList && <th className="py-1.5 pl-3 text-right font-semibold text-foreground">You</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = HS_SUBJECT_ROWS.find((s) => s.label === r.label)?.key;
            const subject = key ? HS_ROW_SUBJECT[key] : undefined;
            const you = hasList && subject ? youYears(mine.courses, core, subject) : null;
            return (
              <tr key={r.label} className="border-b border-dashed last:border-0">
                <td className="py-1.5">
                  {r.label}
                  {r.lab && <span className="text-xs text-muted-foreground"> (lab: {[showReq && units(r.lab.required), showRec && units(r.lab.recommended)].filter(Boolean).join(" / ")})</span>}
                </td>
                {showReq && <td className="py-1.5 text-right tabular-nums">{units(r.required)}</td>}
                {showRec && <td className="py-1.5 text-right tabular-nums">{units(r.recommended)}</td>}
                {hasList && (
                  <td className="py-1.5 pl-3 text-right tabular-nums">
                    {you ? (
                      <span className="font-semibold">{youText(you)}</span>
                    ) : subject ? (
                      <span className="inline-block max-w-[6.5rem] text-[11px] leading-tight text-muted-foreground">{unknown}</span>
                    ) : (
                      "–"
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          <tr className="border-t font-semibold">
            <td className="py-1.5">Total</td>
            {showReq && (
              <td className="py-1.5 text-right tabular-nums">
                {units(required.total)}
                {required.summed && "*"}
              </td>
            )}
            {showRec && (
              <td className="py-1.5 text-right tabular-nums">
                {units(recommended.total)}
                {recommended.summed && "*"}
              </td>
            )}
            {hasList && <td />}
          </tr>
        </tbody>
      </table>
      {hasList && <p className="mt-1 text-xs text-muted-foreground">You: the years your course list and core-subject answers show, not a transcript.</p>}
      {shortLines.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs">
          {shortLines.map((l) => (
            <li key={l.subject}>
              {l.before}
              {mine.signedIn ? (
                <Link href="/plan?tab=scores#plan-courses" className="font-semibold text-primary hover:underline">
                  {l.link}
                </Link>
              ) : (
                l.link
              )}
            </li>
          ))}
        </ul>
      )}
      {mine.status === "ready" && !hasList && (
        <p className="mt-2 text-xs">
          {mine.signedIn ? (
            <Link href="/me" className="font-semibold text-primary hover:underline">
              Add your courses to compare
            </Link>
          ) : (
            <>
              <button type="button" onClick={() => setOpen(true)} className="font-semibold text-primary hover:underline">
                Add your courses to compare
              </button>
              <LocalCoursesSheet open={open} onOpenChange={setOpen} />
            </>
          )}
        </p>
      )}
    </>
  );
}
