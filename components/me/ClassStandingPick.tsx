"use client";

import { useState } from "react";
import type { ClassStanding } from "@/lib/chances/types";
import { sanitizeClassStanding } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

const PICKS: { value: ClassStanding; label: string }[] = [
  { value: "top1", label: "Top 1%" },
  { value: "top5", label: "Top 5%" },
  { value: "top10", label: "Top 10%" },
  { value: "top25", label: "Top quarter" },
  { value: "top50", label: "Top half" },
  { value: "lower", label: "Lower half" },
];

/**
 * The class-standing pick (inputs-beyond-academics.md "Class standing"), under GPA: picking a chip sets
 * `classRankPercentile` from CLASS_STANDING_PERCENTILE (`sanitizeClassStanding`, so the form and the server agree).
 * Posts both `classStanding` and `classRankPercentile` as hidden fields the way `CoursePickerField` posts `courses`.
 *
 * Asks the student's own perceived place among their peers, not their school's official rank (owner, 2026-10-12:
 * "We don't need the student to enter 'my high school doesn't rank'… get rid of them entering the actual
 * percentile"): no "my school doesn't rank" option, and no typed-percentile field — a student who doesn't know their
 * school's numbers still has a sense of where they stand.
 */
export function ClassStandingPick({
  classStanding,
  classRankPercentile,
  disabled,
  onChange,
}: {
  classStanding: ClassStanding | null;
  classRankPercentile: number | null;
  disabled?: boolean;
  /** Called with every change, in addition to the hidden fields, for a caller that needs the live pick (the rank-
   * expectation consistency hint on /me, the intake draft's single source of truth on the Grades step). */
  onChange?: (next: { classStanding: ClassStanding | null; classRankPercentile: number | null }) => void;
}) {
  const [value, setValue] = useState(() => sanitizeClassStanding(classStanding, classRankPercentile));
  const update = (next: { classStanding: ClassStanding | null; classRankPercentile: number | null }) => {
    setValue(next);
    onChange?.(next);
  };

  return (
    <div>
      <span className="block text-sm font-semibold">Where do you think you stand in your class? (optional)</span>
      <p className="mt-0.5 mb-1.5 text-xs text-muted-foreground">Your best guess among classmates; colleges see the real numbers.</p>
      <div className="flex flex-wrap gap-2">
        {PICKS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={disabled}
            aria-pressed={value.classStanding === p.value}
            onClick={() => update(sanitizeClassStanding(p.value, null))}
            className={cn(
              "inline-flex min-h-10 items-center rounded-full border px-3 py-1.5 text-left text-sm leading-tight transition-colors disabled:opacity-50",
              value.classStanding === p.value ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-background hover:bg-muted",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input type="hidden" name="classStanding" value={value.classStanding ?? ""} />
      <input type="hidden" name="classRankPercentile" value={value.classRankPercentile ?? ""} />
    </div>
  );
}
