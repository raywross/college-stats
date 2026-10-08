"use client";

import { useState, useTransition } from "react";
import { setGradYear } from "@/lib/planner/store";

/**
 * The one question the Plan tab asks when a student has no class year (specs/planner/model.md "The cycle year"):
 * every date in the plan is relative to the cycle they apply in. Saved on the student record; the plan regenerates.
 * `years` are the choices around today (the page passes them, so no date is computed in the browser).
 */
export function GradYearPrompt({ studentId, years, canEdit, firstName }: { studentId: string; years: number[]; canEdit: boolean; firstName: string | null }) {
  const [year, setYear] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const who = firstName ? `${firstName}'s` : "your";

  if (!canEdit) {
    return (
      <p className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
        The plan&apos;s dates follow the student&apos;s class year, which isn&apos;t set yet. The student, or a guardian who can edit, can set it here.
      </p>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-2xl border bg-pop/10 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!year) return;
        setError(null);
        startTransition(async () => {
          const result = await setGradYear(studentId, Number(year));
          if (!result.ok) setError(result.message);
        });
      }}
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">
        What is {who} high school class year?
        <span className="text-xs font-normal text-muted-foreground">Every date in the plan follows from it.</span>
        <select value={year} onChange={(e) => setYear(e.target.value)} className="mt-1 h-11 rounded-full border bg-background px-3 text-sm sm:max-w-48" required>
          <option value="">Class of…</option>
          {years.map((y) => (
            <option key={y} value={y}>
              Class of {y}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending || !year} className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        Save
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
