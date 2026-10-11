"use client";

import { useMemo, useState, useTransition } from "react";
import type { NumbersFormProps } from "@/components/planner/tabs/types";
import { GroupChip } from "@/components/planner/GroupChip";
import { useEstimates } from "@/components/planner/useEstimates";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Slider } from "@/components/ui/slider";
import { Term } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import { planView } from "@/lib/planner/plan-view";
import { applyNumbers, parseNumbers, type PlanNumbers } from "@/lib/planner/plan-writes";
import { setNumbers } from "@/lib/planner/store-plan";
import { TEST_LABEL, TEST_MAX, TEST_MIN, TEST_STEP } from "@/lib/planner/standing";
import { emptyProfile, GPA_SCALES, type GpaScale, type StudentProfileData, type TestFocus } from "@/lib/student-profile";

/** The input's max: a 4.0-scale GPA above 4.0 is weighted, and the plan reads it as a range (gpa.md "The design" 3). */
const GPA_MAX: Record<GpaScale, number> = { "4.0": 5, "5.0": 5, "100": 100 };

/** The numbers form's own state, shared with FirstTimeSetup's first step. */
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
 * practice checkbox. Used by both NumbersForm and FirstTimeSetup's first step. */
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
          <Input id="plan-gpa" type="number" step="0.01" min={0} max={GPA_MAX[gpaScale]} value={gpa} onChange={(e) => setGpa(e.target.value)} className="w-24" />
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

/** The list, re-sorted live with the draft numbers (standing.md "The numbers": "the student watches the list
 * re-sort as they drag the slider"). The estimate is asked of the server shortly after the numbers stop changing
 * (useEstimates), and the previous groups stay on screen until the answer arrives; nothing is written until Save. */
export function LivePreview({ draft, ctx, view }: { draft: NumbersDraft; ctx: NumbersFormProps["ctx"]; view: NumbersFormProps["view"] }) {
  const draftProfile = useMemo(() => (draft.parsed ? applyNumbers(ctx.profile ?? emptyProfile(), draft.parsed) : ctx.profile), [draft.parsed, ctx.profile]);
  const unitIds = useMemo(() => ctx.items.filter((i) => ctx.schools[i.unit_id]).map((i) => i.unit_id), [ctx.items, ctx.schools]);
  const { results, loading } = useEstimates(draftProfile, unitIds, view.estimates);
  const preview = useMemo(() => planView({ items: ctx.items, schools: ctx.schools, profile: draftProfile, estimates: results, today: ctx.today }), [ctx.items, ctx.schools, ctx.today, draftProfile, results]);
  if (preview.rows.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-2xl border bg-muted/30 p-3" aria-busy={loading}>
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Your list, sorted by these numbers</p>
      <ul className="space-y-1">
        {preview.rows.map((r) => (
          <li key={r.item.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{r.school?.name ?? r.item.unit_id}</span>
            <GroupChip group={r.group} auto={r.groupAuto} canEdit={false} onCycle={() => {}} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The numbers form: GPA, which test, the score, practice (specs/planner/redesign/standing.md "The numbers"), in the
 * plan's header card (U2 renders it inline, passing `onClose`). Parents with edit access can use it too.
 */
export default function NumbersForm({ ctx, view, onClose }: NumbersFormProps) {
  const draft = useNumbersDraft(ctx.profile);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canEdit = ctx.viewer.canEdit;
  const studentId = ctx.student?.id ?? null;

  const save = () => {
    if (!studentId || !draft.parsed) {
      setError("Check the numbers: one of them is out of range.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setNumbers(studentId, draft.parsed!);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (draft.parsed!.focus) track("plan_numbers_set", { test: draft.parsed!.focus, practice: draft.parsed!.practice });
      onClose?.();
    });
  };

  return (
    <section className="space-y-4 rounded-3xl border bg-card p-5 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-bold">Your numbers</h2>
        <p className="text-sm text-muted-foreground">
          We use them to sort your colleges into Reach, Target, and Likely. You can change any of it later.
        </p>
      </div>
      <NumbersFields draft={draft} />
      <LivePreview draft={draft} ctx={ctx} view={view} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {canEdit && (
        <div className="flex items-center gap-2">
          <button type="button" disabled={pending} onClick={save} className="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="h-10 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
              Cancel
            </button>
          )}
        </div>
      )}
    </section>
  );
}
