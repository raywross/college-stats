/**
 * The plan's one top line (components/planner/PlanPeople.tsx; specs/planner/redesign/page.md "The people line";
 * owner, 2026-10-12): initials per student, the selected one expanded with name, class, numbers, and Edit; the status
 * text, the name heading, "Your part", and "nothing due" gone from the top. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initialsOf, numbersLine } from "../lib/planner/plan-frame.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

test("initials: first and last word, one letter for one name, ? for none", () => {
  assert.equal(initialsOf("Alex QA"), "AQ");
  assert.equal(initialsOf("Maya Jane Ross"), "MR");
  assert.equal(initialsOf("maya"), "M");
  assert.equal(initialsOf("  Hayden   Ross "), "HR");
  assert.equal(initialsOf("Émile Zola"), "ÉZ");
  assert.equal(initialsOf(null), "?");
  assert.equal(initialsOf(""), "?");
  assert.equal(initialsOf("(Sam)"), "S");
});

test("the numbers line reads as entered", () => {
  assert.equal(numbersLine("99.2/100", 3.7, "ACT 23"), "GPA 99.2/100 · ACT 23");
  assert.equal(numbersLine(null, 3.8213, "SAT 1390"), "GPA 3.82 · SAT 1390");
  assert.equal(numbersLine("3.9", null, null), "GPA 3.9 · Not testing");
  assert.equal(numbersLine(null, null, "SAT 1200"), "No GPA yet · SAT 1200");
  assert.equal(numbersLine(null, null, null), "No numbers yet");
});

test("the line: circles link to each plan, the selected one is a button with aria-expanded and the full name, Edit goes to the record, nothing wraps", () => {
  const src = read("components", "planner", "PlanPeople.tsx");
  assert.match(src, /aria-expanded=\{showDetail\}/);
  assert.match(src, /aria-label=\{name\}/);
  assert.match(src, /aria-label=\{`Show \$\{advisorTitle\(name\)\}`\}/);
  assert.match(src, /href=\{shown\.editHref\}/, "Edit from the loaded detail, or a tapped child's while theirs loads (U20)");
  // The record overview's label (record/steps.md "The people line"), not the retired "Edit {name}'s grades, test, and courses".
  assert.match(src, /aria-label=\{p\.studentId \? `\$\{name\}'s record` : "Your record"\}/);
  assert.doesNotMatch(src, /grades, test, and courses/);
  assert.match(src, /size-11/, "44px circles");
  assert.match(src, /truncate/);
  assert.doesNotMatch(src, /flex-wrap/);
  assert.match(src, /PLAN_CHILD_COOKIE = "plan_child"/, "a pick is remembered for the next visit");
  assert.match(src, /rememberChild\(p\.studentId\)/);
  const page = read("app", "advisor", "page.tsx");
  assert.match(page, /editHref: canEdit \? recordHref\(\{ person \}\) : null/, "Edit expands the record on the plan page (owner, 2026-10-16)");
  assert.match(page, /planHref\(\{ person, setup: true, step: where \}\)/, "the next step opens the intake on that step");
  // No GPA or test score on the chip (owner, 2026-10-12): the progress ring and one next step instead.
  assert.doesNotMatch(page, /numbersLine|gpaAsEntered|TEST_LABEL/);
  assert.match(src, /<ProgressRing /);
  assert.match(src, /"Profile complete"/);
  assert.match(page, /<PlanPeople people=\{\[self\]\}/, "a student sees the same line with just their own chip");
});

test("the top of the plan no longer shows the status text, the name heading, Your part, or nothing due", () => {
  const frame = read("components", "planner", "PlanFrame.tsx");
  assert.doesNotMatch(frame, /PlanHeaderCard|YourPartLine|NothingDue/);
  for (const f of ["PlanHeaderCard.tsx", "ChildSwitcher.tsx", "parents/NothingDue.tsx", "parents/YourPartLine.tsx"]) assert.equal(existsSync(join(ROOT, "components", "planner", f)), false, f);
  assert.doesNotMatch(read("app", "advisor", "page.tsx"), /shortSummaryLine|summaryLine/);
  // The helpers behind them stay.
  assert.match(read("lib", "planner", "plan-frame.ts"), /export function shortSummaryLine/);
  assert.match(read("lib", "planner", "plan-frame.ts"), /export function seasonWords/);
  assert.match(read("lib", "planner", "summary.ts"), /export function yourPart/);
});
