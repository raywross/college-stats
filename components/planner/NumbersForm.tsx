"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Slider } from "@/components/ui/slider";
import { Term } from "@/components/ui/info-tip";
import { TEST_LABEL, TEST_MAX, TEST_MIN, TEST_STEP } from "@/lib/planner/standing";
import { parseNumbers, type PlanNumbers } from "@/lib/planner/plan-writes";
import { gpaMaxFor, GPA_SCALES, type GpaScale, type StudentProfileData, type TestFocus } from "@/lib/student-profile";

/** The input's max: a 4.0-scale GPA above 4.0 is weighted, and the plan reads it as a range (gpa.md "The design" 3). */

/** The numbers form's own state, used by SignedOutPlan's numbers step. */
export function useNumbersDraft(profile: StudentProfileData | null) {
  const [gpa, setGpa] = useState(profile?.academics.gpa !== null && profile?.academics.gpa !== undefined ? String(profile.academics.gpa) : "");
  const [gpaScale, setGpaScale] = useState<GpaScale>(profile?.academics.gpaScale ?? "4.0");
  const [scaleOpen, setScaleOpen] = useState((profile?.academics.gpaScale ?? "4.0") !== "4.0");
  const [focus, setFocus] = useState<TestFocus | null>(profile?.tests.focus ?? null);
  const initialScore = profile?.tests.focus === "sat" ? profile.tests.satTotal : profile?.tests.focus === "act" ? profile.tests.actComposite : null;
  const [score, setScore] = useState(initialScore !== null && initialScore !== undefined ? String(initialScore) : "");
  const [practice, setPractice] = useState(profile?.tests.practice ?? false);

  const parsed: PlanNumbers | null = parseNumbers({
    gpa: gpa.trim() === "" ? null : Number(gpa),
    gpaScale,
    focus,
    score: score.trim() === "" ? null : Number(score),
    practice,
  });

  return { gpa, setGpa, gpaScale, setGpaScale, scaleOpen, setScaleOpen, focus, setFocus, score, setScore, practice, setPractice, parsed };
}

export type NumbersDraft = ReturnType<typeof useNumbersDraft>;

/** standing.md "The numbers": GPA (+ scale behind "Different scale?"), SAT · ACT · Not testing, the score, and the
 * practice checkbox. Used by SignedOutPlan's numbers step. */
export function NumbersFields({ draft }: { draft: NumbersDraft }) {
  const { gpa, setGpa, gpaScale, setGpaScale, scaleOpen, setScaleOpen, focus, setFocus, score, setScore, practice, setPractice } = draft;
  const scoreNum = focus === "sat" || focus === "act" ? Number(score) || TEST_MIN[focus] : null;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="plan-gpa" className="text-sm font-semibold">
          {gpaScale === "5.0" ? <Term term="weighted-gpa">Weighted GPA</Term> : <Term term="unweighted-gpa">Unweighted GPA</Term>}
        </label>
        <div className="flex items-center gap-3">
          <Input id="plan-gpa" type="number" step="0.01" min={0} max={gpaMaxFor(gpaScale)} value={gpa} onChange={(e) => setGpa(e.target.value)} className="w-24" />
          {!scaleOpen && (
            <button type="button" onClick={() => setScaleOpen(true)} className="text-xs font-semibold text-primary hover:underline">
              Different scale?
            </button>
          )}
        </div>
        {scaleOpen && (
          <SegmentedControl
            value={gpaScale}
            onChange={setGpaScale}
            label="GPA scale"
            options={GPA_SCALES.map((s) => ({ value: s.value, label: s.label }))}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Use the unweighted GPA from your transcript if you can. A <Term term="weighted-gpa">weighted GPA</Term> can only be placed roughly.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-semibold">Which test</p>
        <SegmentedControl<TestFocus>
          value={(focus ?? "") as TestFocus}
          onChange={setFocus}
          label="Which test"
          options={[
            { value: "sat", label: "SAT" },
            { value: "act", label: "ACT" },
            { value: "none", label: "Not testing" },
          ]}
        />
        <p className="text-xs text-muted-foreground">Most students pick one and work on it. If you haven&apos;t taken it yet, use a practice score.</p>
      </div>

      {(focus === "sat" || focus === "act") && (
        <div className="space-y-1.5">
          <label htmlFor="plan-score" className="text-sm font-semibold">
            {TEST_LABEL[focus]} score
          </label>
          <div className="flex items-center gap-4">
            <Slider
              value={[scoreNum ?? TEST_MIN[focus]]}
              min={TEST_MIN[focus]}
              max={TEST_MAX[focus]}
              step={TEST_STEP[focus]}
              onValueChange={(v) => setScore(String(Array.isArray(v) ? v[0] : v))}
              className="max-w-56"
            />
            <Input id="plan-score" type="number" min={TEST_MIN[focus]} max={TEST_MAX[focus]} step={TEST_STEP[focus]} value={score} onChange={(e) => setScore(e.target.value)} className="w-20" />
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} className="size-3.5 accent-primary" />
            It&apos;s a practice score
          </label>
        </div>
      )}
    </div>
  );
}
