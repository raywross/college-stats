/**
 * The record tour's UI wiring (specs/planner/record/steps.md "The steps", "Edit mode"; R2):
 * `components/planner/intake/PlanIntake.tsx` builds its rail from `RECORD_STEPS` (thirteen labels), renders a
 * component for every entry step 0–12, and honors `?back=plan|record`. This repo has no React test renderer wired
 * up for client components, so the rail and the per-step wiring are checked by reading PlanIntake's own source (a
 * "source-level test", the same kind `tests/*-ui.test.mts` and the copy guards already use elsewhere); `moveMajor`
 * (MajorChips' reorder helper) is tested directly, since it's pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RECORD_STEPS } from "../lib/planner/record.ts";
import { moveMajor } from "../lib/majors-search.ts";

const ROOT = join(import.meta.dirname, "..");
const src = readFileSync(join(ROOT, "components/planner/intake/PlanIntake.tsx"), "utf8");

test("RECORD_STEPS has the thirteen entry steps, 0 through 12, Grades and Test required, the rest not", () => {
  assert.deepEqual(RECORD_STEPS.map((s) => s.step), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(RECORD_STEPS.map((s) => s.required), [true, true, false, false, false, false, false, false, false, false, false, false, false]);
});

test("PlanIntake's rail is built from RECORD_STEPS's thirteen labels, plus Review", () => {
  assert.match(src, /RAIL_LABELS:\s*readonly string\[\]\s*=\s*\[\.\.\.RECORD_STEPS\.map\(\(s\)\s*=>\s*s\.rail\),\s*"Review"\]/);
  assert.match(src, /UI_STEPS:\s*readonly IntakeStep\[\]\s*=\s*\[\.\.\.RECORD_STEPS\.map\(\(s\)\s*=>\s*s\.step\),\s*INTAKE_REVIEW\]/);
});

test("planted bad case: a hardcoded nine-label rail (the built intake's own) would fail the guard above", () => {
  const planted = 'const RAIL_LABELS = ["Grades", "Test score", "AP courses", "Sports", "Clubs", "Work", "Connections", "Other", "Review"] as const;';
  assert.doesNotMatch(planted, /RECORD_STEPS\.map/, "sanity: the planted snippet really doesn't read RECORD_STEPS");
});

test("every record step 0–12 has a rendered branch in PlanIntake (grades through recommenders)", () => {
  const directSteps: Record<number, string> = {
    0: "GradesStep",
    1: "TestStep",
    2: "ApStep",
    6: "ConnectionsStep",
    8: "MajorStep",
    9: "BasicsStep",
    10: "WhereStep",
    11: "StoryStep",
    12: "RecommendersStep",
  };
  for (const [step, component] of Object.entries(directSteps)) {
    const re = new RegExp(`step === ${step} && \\(?\\s*<${component}\\b`);
    assert.match(src, re, `step ${step} should render <${component}>`);
  }
  // Steps 3, 4, 5, 7 (Sports, Clubs, Work, Other) render through activityStepAt, not a literal `step === N`.
  assert.match(src, /\{activityStep && <ActivitiesStep\b/);
});

test("planted bad case: a step left unrendered (no branch at all) would fail the guard above", () => {
  const withoutMajorStep = src.replace('{step === 8 && <MajorStep draft={draft} setDraft={setDraft} />}', "");
  assert.doesNotMatch(withoutMajorStep, /step === 8 && <MajorStep\b/);
});

test("the `back` param is honored: saving in edit mode with back=\"record\" returns to the record overview, not the plan", () => {
  assert.match(src, /back === "record" && studentId \? recordPageHref\(studentId\) : back === "inline" \? recordHref\(\{ person \}\) : planHref\(\{ person, tab: null \}\)/, "record page, the record inline on the plan (owner 2026-10-16), or the plan");
  // The save path in edit mode routes through `closeHref`, not a hardcoded planHref.
  assert.match(src, /if \(mode === "edit"\) \{\s*router\.push\(closeHref\);/);
});

test("planted bad case: an edit-mode save that always returns to the plan would fail the guard above", () => {
  const planted = 'if (mode === "edit") { router.push(planHref({ person, tab: null })); }';
  assert.doesNotMatch(planted, /closeHref/, "sanity: the planted snippet ignores back entirely");
});

test("moveMajor swaps a picked major with its neighbor and leaves an out-of-range move unchanged", () => {
  const majors = ["52", "14", "26"] as const;
  assert.deepEqual(moveMajor(majors, 1, -1), ["14", "52", "26"]);
  assert.deepEqual(moveMajor(majors, 0, -1), ["52", "14", "26"]);
  assert.deepEqual(moveMajor(majors, 2, 1), ["52", "14", "26"]);
});

test("planted bad case: a reorder that drops an entry instead of swapping would fail the guard above", () => {
  const majors = ["52", "14", "26"] as const;
  const brokenMove = (list: readonly string[], index: number) => list.filter((_, i) => i !== index);
  assert.notDeepEqual(brokenMove(majors, 1), moveMajor(majors, 1, -1));
});
