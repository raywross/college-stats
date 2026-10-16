/**
 * The record overview, its routes, and the account section (components/record/{RecordOverview,RecordRow}.tsx;
 * app/household/[person]/{record,numbers}/page.tsx; app/account/page.tsx; specs/planner/record/steps.md "The
 * overview", "Parents can edit"; build-plan.md "R3"). Source-level guards: `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* The numbers route redirects                                         */
/* ------------------------------------------------------------------ */

test("/household/[person]/numbers redirects to the record overview, and no longer renders a form", () => {
  const src = read("app", "household", "[person]", "numbers", "page.tsx");
  assert.match(src, /redirect\(`\/household\/\$\{id\}\/record`\)/);
  assert.doesNotMatch(src, /StudentNumbers|ProfileForm|CompletenessMeter/);
});

test("the record route reuses the Numbers page's loader (personPage, profileFor, the guardian read log)", () => {
  const src = read("app", "household", "[person]", "record", "page.tsx");
  assert.match(src, /personPage\(id\)/);
  assert.match(src, /profileFor\(person\.access\.student\.id\)/);
  assert.match(src, /scheduleStudentReadLog\(profile\.student\.id, "student_profiles"\)/);
  // R6 (reading.md): the overview also takes the plan load, for "How Quad reads your record right now".
  assert.match(src, /<RecordOverview profile=\{profile\} plan=\{plan\} \/>/);
  // Metadata: "Their record" for a guardian, "Your record" for the student.
  assert.match(src, /"Their record"/);
  assert.match(src, /"Your record"/);
});

test("/me keeps redirecting to the student's own record, not the old numbers page", () => {
  const src = read("app", "me", "page.tsx");
  assert.doesNotMatch(src, /\/numbers/);
  assert.match(src, /`\/household\/\$\{wanted\}\/record`/);
  assert.match(src, /`\/household\/\$\{own\.id\}\/record`/);
});

/* ------------------------------------------------------------------ */
/* The person header's labels                                          */
/* ------------------------------------------------------------------ */

test("PersonHeader's segmented control reads Plan | Record, not Plan | Numbers", () => {
  const src = read("components", "account", "PersonHeader.tsx");
  assert.match(src, /export type PersonTab = "list" \| "record";/);
  assert.match(src, /\{ value: "record", label: "Record", href: `\/household\/\$\{id\}\/record` \}/);
  assert.doesNotMatch(src, /"numbers"|"Numbers"/);
});

/* ------------------------------------------------------------------ */
/* The account section                                                 */
/* ------------------------------------------------------------------ */

test("/account has a Parents can edit section under Household, for a student with at least one guardian", () => {
  const src = read("app", "account", "page.tsx");
  const householdAt = src.indexOf('id="household"');
  const parentsAt = src.indexOf('id="parents-can-edit"');
  assert.ok(householdAt > -1, "the Household section exists");
  assert.ok(parentsAt > householdAt, "Parents can edit comes after Household");
  assert.match(src, /guardians\.length > 0/);
  assert.match(src, /<ParentsCanEdit on=\{guardians\.every\(\(g\) => g\.can_edit\)\} guardians=\{guardians\.length\} bare \/>/);
});

test("ParentsCanEdit's bare prop drops its own card chrome so the section's doesn't double up", () => {
  const src = read("components", "account", "ParentsCanEdit.tsx");
  assert.match(src, /bare\s*=\s*false/);
  const bareAt = src.indexOf("if (bare) {");
  const sectionAt = src.indexOf("<section");
  assert.ok(bareAt > -1 && sectionAt > -1, "both a bare branch and a <section> exist");
  // The one <section> tag is the default (non-bare) branch's, reached only after the bare branch already returned
  // a plain fragment (`</>`), not a <section>.
  const bareBranch = src.slice(bareAt, sectionAt);
  assert.match(bareBranch, /<>[\s\S]*<\/>/, "the bare branch returns a plain fragment");
  assert.doesNotMatch(bareBranch, /<section/);
});

/* ------------------------------------------------------------------ */
/* The overview's rows come from recordProgress; nothing else on the page */
/* ------------------------------------------------------------------ */

test("RecordOverview builds its rows from recordProgress, not a form or a plan card", () => {
  const src = read("components", "record", "RecordOverview.tsx");
  assert.match(src, /recordProgress\(profile\.data/);
  assert.match(src, /How complete is this/);
  assert.match(src, /Fill it in/);
  assert.match(src, /Everything a college reads about you, in one place\./);
  // Nothing from the built form or meter, and no "Open in the plan"/course/test links.
  assert.doesNotMatch(src, /ProfileForm|CompletenessMeter|StudentNumbers/);
  assert.doesNotMatch(src, /Open in the plan/);
  assert.doesNotMatch(src, /guideHref\("courses"/);
  assert.doesNotMatch(src, /guideHref\("test"/);
  // Your story and Recommenders link their guide, not the tour step.
  assert.match(src, /guideHref\("story", \{ person, from: "profile" \}\)/);
  assert.match(src, /guideHref\("recommenders", \{ person, from: "profile" \}\)/);
  // A guardian without edit access sees no Edit/Add (the tour-step rows only; the href is null).
  assert.match(src, /href=\{profile\.canEdit \? recordHref/);
  // Telemetry: the client island mounts once.
  assert.match(src, /<RecordOverviewOpened viewer=/);
});

test("RecordOverviewOpened reports record_overview_opened once on mount, viewer only", () => {
  const src = read("components", "record", "RecordOverviewOpened.tsx");
  assert.match(src, /"use client"/);
  assert.match(src, /useEffect\(\(\) => \{\s*track\("record_overview_opened", \{ viewer \}\);/);
});

test("the overview carries no number from the estimate: no digit in an unlock line, no score, no percentage", () => {
  const record = read("lib", "planner", "record.ts");
  const start = record.indexOf("export const SECTION_UNLOCK");
  const unlockBlock = record.slice(start, record.indexOf("};", start));
  assert.doesNotMatch(unlockBlock, /\d/, "no digit anywhere in an unlock line's text");
});

/* ------------------------------------------------------------------ */
/* The people line (the ring reads recordProgress; Edit opens the overview) */
/* ------------------------------------------------------------------ */

test("the plan's detailFrom builds its ring from recordProgress and its Edit link from recordPageHref", () => {
  const src = read("app", "plan", "page.tsx");
  assert.match(src, /import \{ recordHref, recordProgress, type RecordBack \} from "@\/lib\/planner\/record";/);
  assert.match(src, /<RecordInline profile=\{profile\} plan=\{loaded\} person=\{null\} \/>/, "record=1 expands the record on the plan page (owner, 2026-10-16)");
  assert.match(src, /const record = recordProgress\(profile\);/);
  assert.match(src, /done: record\.done, total: record\.total/);
  assert.match(src, /editHref: canEdit \? recordHref\(\{ person \}\) : null/);
});
