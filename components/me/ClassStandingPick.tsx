"use client";

import { useState } from "react";
import { CLASS_STANDING_PERCENTILE } from "@/lib/chances/levels";
import type { ClassStanding } from "@/lib/chances/types";
import { sanitizeClassStanding } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

const PICKS: { value: ClassStanding; label: string }[] = [
  { value: "top1", label: "Valedictorian or salutatorian" },
  { value: "top5", label: "Top 5%" },
  { value: "top10", label: "Top 10%" },
  { value: "top25", label: "Top quarter" },
  { value: "top50", label: "Top half" },
  { value: "lower", label: "Lower half" },
  { value: "no_rank", label: "My school doesn't rank / I don't know" },
];

/**
 * The class-standing pick (inputs-beyond-academics.md "Class standing"), under GPA: picking a chip sets
 * `classRankPercentile` from CLASS_STANDING_PERCENTILE; typing a percentile that exactly matches one of the table's
 * values picks that chip back (`sanitizeClassStanding`, so the form and the server agree). Posts both
 * `classStanding` and `classRankPercentile` as hidden fields the way `CoursePickerField` posts `courses`.
 */
export function ClassStandingPick({
  classStanding,
  classRankPercentile,
  disabled,
}: {
  classStanding: ClassStanding | null;
  classRankPercentile: number | null;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(() => sanitizeClassStanding(classStanding, classRankPercentile));

  return (
    <div>
      <span className="block text-sm font-semibold">Class standing (optional)</span>
      <p className="mt-0.5 mb-1.5 text-xs text-muted-foreground">Some colleges weigh rank, and some states guarantee admission by rank.</p>
      <div className="flex flex-wrap gap-2">
        {PICKS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={disabled}
            aria-pressed={value.classStanding === p.value}
            onClick={() => setValue(sanitizeClassStanding(p.value, null))}
            className={cn(
              "inline-flex min-h-10 items-center rounded-full border px-3 py-1.5 text-left text-sm leading-tight transition-colors disabled:opacity-50",
              value.classStanding === p.value ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-background hover:bg-muted",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" htmlFor="classRankPercentileInput">
        or your percentile, if you know it:
        <input
          id="classRankPercentileInput"
          type="number"
          min={1}
          max={100}
          disabled={disabled}
          value={value.classStanding === null ? (value.classRankPercentile ?? "") : ""}
          onChange={(e) => setValue(sanitizeClassStanding(null, e.currentTarget.value === "" ? null : Number(e.currentTarget.value)))}
          placeholder={value.classStanding !== null ? String(CLASS_STANDING_PERCENTILE[value.classStanding] ?? "") : ""}
          className="h-9 w-20 rounded-lg border border-input bg-background px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 disabled:opacity-60"
        />
      </label>
      <input type="hidden" name="classStanding" value={value.classStanding ?? ""} />
      <input type="hidden" name="classRankPercentile" value={value.classRankPercentile ?? ""} />
    </div>
  );
}
