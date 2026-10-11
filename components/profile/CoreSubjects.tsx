"use client";

import { resolveCore, SUBJECT_LABELS } from "@/lib/chances/courses";
import type { CourseEntry } from "@/lib/chances/types";
import { CORE_SUBJECT_KEYS, CORE_YEARS, type CoreAtTopLevel, type CoreSubject, type CoreYear } from "@/lib/student-profile";

/**
 * The core-subject question (rigor-in-context.md "The core-subject question"): "Were your English, math, science,
 * history, and language classes the most advanced your school offered?" for 11th and 12th grade. Pre-checked from
 * the list wherever it has an AP, IB, or dual-enrollment course for that subject and year, so most students only
 * confirm; it still matters on its own at a school with no AP in a subject, where only the student knows the top
 * level was honors or regular. An answer the student gives is kept as given.
 */
export function CoreSubjects({
  courses,
  value,
  onChange,
  disabled,
}: {
  courses: readonly CourseEntry[];
  value: CoreAtTopLevel;
  onChange: (next: CoreAtTopLevel) => void;
  disabled?: boolean;
}) {
  const checked = resolveCore(courses, value);
  const toggle = (year: CoreYear, subject: CoreSubject) => onChange({ ...value, [year]: { ...value[year], [subject]: !checked[year][subject] } });

  return (
    <fieldset className="rounded-2xl border bg-card p-3 sm:p-4">
      <legend className="px-1 text-sm font-semibold">Were your core classes the most advanced your school offered?</legend>
      <p className="mb-2 text-xs text-muted-foreground">
        For 11th and 12th grade. Checked from your list where it has an AP, IB, or dual-enrollment course; uncheck a year when your school had something more advanced, or check one it doesn&apos;t show.
      </p>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1">
        <span aria-hidden />
        {CORE_YEARS.map((y) => (
          <span key={y} className="w-14 text-center text-xs font-semibold text-muted-foreground">
            {y}th
          </span>
        ))}
        {CORE_SUBJECT_KEYS.map((s) => (
          <div key={s} className="contents">
            <span className="text-sm">{SUBJECT_LABELS[s]}</span>
            {CORE_YEARS.map((y) => (
              <label key={y} className="flex h-11 w-14 cursor-pointer items-center justify-center">
                <input
                  type="checkbox"
                  checked={checked[y][s]}
                  disabled={disabled}
                  onChange={() => toggle(y, s)}
                  aria-label={`${SUBJECT_LABELS[s]}, ${y}th grade, most advanced offered`}
                  className="size-5 accent-primary"
                />
              </label>
            ))}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
