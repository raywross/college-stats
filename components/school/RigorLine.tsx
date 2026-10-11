"use client";

import Link from "next/link";
import { useState } from "react";
import { useMyCourses } from "@/components/me/useMyCourses";
import { LocalCoursesSheet } from "@/components/profile/LocalCoursesSheet";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { noteText } from "@/lib/chances/notes";
import type { AnyCited } from "@/lib/lineage";

/**
 * Your courses against this college's school (specs/chances/rigor-in-context.md "On the college profile"), under the
 * GPA checker. A signed-in student with courses sees the reading's sentence and one line tying it to this college's
 * own rating of course rigor; a visitor sees "Check your courses", which opens the same picker with the high school
 * kept in the browser, then the same sentence. The college profile is static, so the list arrives after mount
 * (useMyCourses) and the reading's sentences come from the server: nothing here knows how a reading is decided.
 */
export function RigorLine({ college, rating }: { college: string; rating: { label: string; cited: AnyCited } | null }) {
  const mine = useMyCourses();
  const [open, setOpen] = useState(false);
  if (mine.status !== "ready") return null;

  const view = mine.view;
  const hasList = view !== null && (mine.courses.length > 0 || view.sentences.length > 0);
  if (mine.signedIn && !hasList) return null;
  // A list kept in the browser whose reading hasn't come back yet: wait rather than flash the prompt.
  if (!mine.signedIn && view === null && mine.courses.length > 0) return null;

  return (
    <div className="mt-4 rounded-2xl border bg-muted/30 p-3 text-sm sm:p-4">
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
        <Term term="course-rigor">Your courses</Term>
      </p>
      {hasList ? (
        <>
          <p className="mt-1">{view.sentences[0]}</p>
          {view.sentences.slice(1).map((t) => (
            <p key={t} className="mt-1 text-muted-foreground">
              {t}
            </p>
          ))}
          {rating && (
            <p className="mt-2 text-muted-foreground">
              <MetricLabel cited={rating.cited}>{noteText({ key: "rigor.college_rating", values: { college, rating: rating.label } })}</MetricLabel>
            </p>
          )}
          <p className="mt-2">
            {mine.signedIn ? (
              <Link href="/me" className="text-xs font-semibold text-primary hover:underline">
                Edit your courses
              </Link>
            ) : (
              <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-primary hover:underline">
                Edit your courses
              </button>
            )}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-muted-foreground">{noteText({ key: "rigor.prompt_signed_out", values: {} })}</p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-2 inline-flex min-h-11 items-center rounded-full border bg-background px-4 text-sm font-semibold hover:bg-muted"
          >
            Check your courses
          </button>
        </>
      )}
      {!mine.signedIn && <LocalCoursesSheet open={open} onOpenChange={setOpen} />}
    </div>
  );
}
