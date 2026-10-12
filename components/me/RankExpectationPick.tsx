"use client";

import { useState } from "react";
import type { ClassStanding, RankExpectation } from "@/lib/chances/types";
import { rankExpectationHint } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

const PICKS: { value: RankExpectation | null; label: string }[] = [
  { value: null, label: "None" },
  { value: "salutatorian", label: "Salutatorian" },
  { value: "valedictorian", label: "Valedictorian" },
];

/**
 * "Do you expect to be valedictorian or salutatorian?" (inputs-beyond-academics.md, method/standing.md "Revision 1"):
 * worded as an expectation, since it's only known after senior year. Valedictorian is usually top 1% class standing,
 * salutatorian top 5%; when the pick disagrees with the `classStanding` passed in, a hint asks the student to fix
 * one (`rankExpectationHint`), never auto-changing either side. Posts `rankExpectation` as a hidden field, like
 * ClassStandingPick, and calls `onChange` on every pick for a caller that needs it live (the intake's draft).
 */
export function RankExpectationPick({
  rankExpectation,
  classStanding,
  disabled,
  onChange,
}: {
  rankExpectation: RankExpectation | null;
  classStanding: ClassStanding | null;
  disabled?: boolean;
  onChange?: (next: RankExpectation | null) => void;
}) {
  const [value, setValue] = useState(rankExpectation);
  const pick = (v: RankExpectation | null) => {
    setValue(v);
    onChange?.(v);
  };
  const hint = rankExpectationHint(classStanding, value);

  return (
    <div>
      <span className="block text-sm font-semibold">Do you expect to be valedictorian or salutatorian?</span>
      <p className="mt-0.5 mb-1.5 text-xs text-muted-foreground">You won&apos;t know for sure until senior year &mdash; tell us what you expect.</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Rank expectation">
        {PICKS.map((p) => (
          <button
            key={p.label}
            type="button"
            role="radio"
            aria-checked={value === p.value}
            disabled={disabled}
            onClick={() => pick(p.value)}
            className={cn(
              "inline-flex min-h-10 items-center rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50",
              value === p.value ? "border-primary bg-primary/10 text-primary" : "bg-background hover:bg-muted",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">{hint}</p>}
      <input type="hidden" name="rankExpectation" value={value ?? ""} />
    </div>
  );
}
