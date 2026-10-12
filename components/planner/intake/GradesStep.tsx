"use client";

import { useState } from "react";
import { HighSchoolPicker } from "@/components/high-schools/HighSchoolPicker";
import { ClassStandingPick } from "@/components/me/ClassStandingPick";
import { RankExpectationPick } from "@/components/me/RankExpectationPick";
import { Headline } from "@/components/planner/intake/Headline";
import {
  classYearOptions,
  effectiveScale,
  gpaCheck,
  INTAKE_SCALES,
  scaleLabel,
  type IntakeDraft,
} from "@/lib/planner/intake";
import { weightedGpaHint, type GpaScale } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

/** Step 0 (intake.md "Grades"): the class-of chips and the GPA field with its detected/overridden scale. */
export function GradesStep({
  draft,
  setDraft,
  today,
  storedGradYear,
}: {
  draft: IntakeDraft;
  setDraft: (next: IntakeDraft) => void;
  today: string;
  storedGradYear: number | null;
}) {
  const [scaleOpen, setScaleOpen] = useState(draft.scaleOverride !== null);
  const years = classYearOptions(today, storedGradYear);
  const check = gpaCheck(draft);
  const scale = effectiveScale(draft);
  const weightedHint = weightedGpaHint(Number(draft.gpa.trim()) || null, scale, draft.weightedGpa.trim() === "" ? null : Number(draft.weightedGpa.trim()));

  const pickScale = (s: GpaScale) => {
    setDraft({ ...draft, scaleOverride: s });
    setScaleOpen(true);
  };

  return (
    <div className="space-y-8">
      <Headline lead="Start with your" pop="grades" />

      <div className="space-y-2.5">
        <p className="text-sm font-semibold">Class of</p>
        <div className="flex flex-wrap gap-2">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={draft.classYear === y}
              onClick={() => setDraft({ ...draft, classYear: y })}
              className={cn(
                "min-h-11 rounded-full border px-5 text-base font-bold",
                draft.classYear === y ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        <p className="text-sm font-semibold">GPA</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch lg:items-center">
          <input
            type="text"
            inputMode="decimal"
            placeholder="92.5"
            value={draft.gpa}
            onChange={(e) => setDraft({ ...draft, gpa: e.target.value })}
            aria-label="GPA"
            className="h-16 w-full rounded-2xl border px-4 font-display text-3xl font-extrabold outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-40"
          />

          {/* Phone: a scale button that reveals the chips. Desktop: the chips, always visible. */}
          <div className="lg:hidden">
            {!scaleOpen ? (
              <button
                type="button"
                onClick={() => setScaleOpen(true)}
                className="flex min-h-16 flex-col justify-center rounded-2xl border px-4 py-2 text-left hover:bg-muted"
              >
                <span className="text-xs text-muted-foreground">{check.caption}</span>
                <span className="font-semibold">{scaleLabel(scale)}</span>
                <span className="text-xs font-semibold text-primary">Change</span>
              </button>
            ) : (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="GPA scale">
                {INTAKE_SCALES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scale === s}
                    onClick={() => pickScale(s)}
                    className={cn(
                      "min-h-11 rounded-full border px-4 text-sm font-semibold",
                      scale === s ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                    )}
                  >
                    {scaleLabel(s)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="hidden rounded-full border bg-card p-0.5 text-sm font-semibold lg:inline-flex" role="radiogroup" aria-label="GPA scale">
            {INTAKE_SCALES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scale === s}
                onClick={() => pickScale(s)}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full px-4 whitespace-nowrap",
                  scale === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {scaleLabel(s)}
              </button>
            ))}
          </div>
        </div>
        <p className={cn("text-sm", check.tone === "amber" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{check.hint}</p>
      </div>

      <div className="space-y-2.5">
        <label htmlFor="intake-weightedGpa" className="text-sm font-semibold">
          Weighted GPA · optional
        </label>
        <input
          id="intake-weightedGpa"
          type="text"
          inputMode="decimal"
          placeholder="4.4"
          value={draft.weightedGpa}
          onChange={(e) => setDraft({ ...draft, weightedGpa: e.target.value })}
          aria-label="Weighted GPA"
          className="h-12 w-full rounded-2xl border px-4 text-lg font-semibold outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-40"
        />
        <p className="text-sm text-muted-foreground">Many schools weight honors and AP grades; if yours does, add it.</p>
        {weightedHint && <p className="text-sm text-amber-700 dark:text-amber-400">{weightedHint}</p>}
      </div>

      <div className="space-y-2.5">
        <ClassStandingPick
          classStanding={draft.classStanding}
          classRankPercentile={draft.classRankPercentile}
          onChange={(v) => setDraft({ ...draft, classStanding: v.classStanding, classRankPercentile: v.classRankPercentile })}
        />
      </div>

      <div className="space-y-2.5">
        <RankExpectationPick
          rankExpectation={draft.rankExpectation}
          classStanding={draft.classStanding}
          onChange={(v) => setDraft({ ...draft, rankExpectation: v })}
        />
      </div>

      <div className="space-y-2.5">
        <label htmlFor="intake-highSchool" className="text-sm font-semibold">
          High school · optional
        </label>
        {/* Delegated native "input" events (not React's onChange, which also fires for the picker's own programmatic
            updates on a pick) catch only the student's own typing, so free text invalidates a previous pick the same
            way the picker's own internal state does. */}
        <div
          onInput={(e) => {
            const target = e.target as HTMLInputElement;
            if (target.name !== "intake-highSchool") return;
            setDraft({ ...draft, highSchool: target.value, highSchoolId: null });
          }}
        >
          <HighSchoolPicker
            idName="intake-highSchoolId"
            nameName="intake-highSchool"
            defaultId={draft.highSchoolId}
            defaultName={draft.highSchool}
            onSelect={(hit) => setDraft({ ...draft, highSchool: hit.name, highSchoolId: hit.id })}
          />
        </div>
      </div>
    </div>
  );
}
