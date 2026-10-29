/**
 * The package's order and content (lib/essays/docx.ts; the Essays build brief "U4 Round trip and package"): the
 * Common App's main essay first, then the Coalition's prompts, then the college's own in page order; the
 * activities list in the Common App's shape at the end; the normalizer applied to whatever an import brings in.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activitiesForPackage, packageDocxBuffer, packagePromptRefs, packageTxt, textFromDocx, type PackageEssay } from "../lib/essays/docx.ts";
import { collegeRef, essaysOf, MAIN_REF, type SchoolEssaysLocal } from "../lib/essays/prompts.ts";
import { normalizeText } from "../lib/essays/normalize.ts";
import type { ActivityEntry } from "../lib/chances/types.ts";

const WAKE = "199847";

const promptRow = (n: number, kind: string, text: string) => ({ id: `${WAKE}:2026-27:${n}`, text, kind, limit: { kind: "words", max: 150 }, required: true, applies_to: "all", quote: text.slice(0, 20) });

const ESSAYS: SchoolEssaysLocal = essaysOf({
  essays: {
    cycle: "2026-27",
    status: "published",
    source_url: "https://admissions.wfu.edu/essays",
    retrieved: "2026-09-01",
    prompts: [promptRow(1, "why_us", "Why Wake Forest?"), promptRow(2, "optional", "A community you belong to.")],
  },
})!;

const COALITION_PROMPTS = [{ id: "platform:coalition:1", text: "Tell a story.", kind: "essay" as const, limit: { kind: "words" as const, max: 500 }, required: true, applies_to: "all" as const, quote: "Tell a story" }];

/* ------------------------------------------------------------------ */
/* packagePromptRefs: the order                                        */
/* ------------------------------------------------------------------ */

test("the Common App's main essay comes first when the college takes it", () => {
  const refs = packagePromptRefs(ESSAYS, { commonApp: true, coalitionPrompts: [] });
  assert.deepEqual(refs, [MAIN_REF, collegeRef(`${WAKE}:2026-27:1`), collegeRef(`${WAKE}:2026-27:2`)]);
});

test("the Coalition's prompts come after the Common App's and before the college's own", () => {
  const refs = packagePromptRefs(ESSAYS, { commonApp: true, coalitionPrompts: COALITION_PROMPTS });
  assert.deepEqual(refs, [MAIN_REF, "platform:coalition:1", collegeRef(`${WAKE}:2026-27:1`), collegeRef(`${WAKE}:2026-27:2`)]);
});

test("a college with no Common App and no Coalition gets just its own prompts, in page order", () => {
  const refs = packagePromptRefs(ESSAYS, { commonApp: false, coalitionPrompts: [] });
  assert.deepEqual(refs, [collegeRef(`${WAKE}:2026-27:1`), collegeRef(`${WAKE}:2026-27:2`)]);
});

test("a college with no supplement and no platform gets an empty list, not a crash", () => {
  assert.deepEqual(packagePromptRefs(null, { commonApp: false, coalitionPrompts: [] }), []);
  const none = essaysOf({ essays: { cycle: "2026-27", status: "none", source_url: "https://umich.edu", retrieved: "2026-09-01", prompts: [] } });
  assert.deepEqual(packagePromptRefs(none, { commonApp: true, coalitionPrompts: [] }), [MAIN_REF]);
});

/* ------------------------------------------------------------------ */
/* The package's content: every prompt under its own heading, unstarted ones say so, activities last */
/* ------------------------------------------------------------------ */

const essayItem = (title: string, body: string, started: boolean): PackageEssay => ({ title, promptText: `Prompt for ${title}`, limit: { kind: "words", max: 150 }, required: true, body, started });

test("packageTxt keeps the essays in the order given and puts activities last", () => {
  const essays = [essayItem("The Common App essay", "My story.", true), essayItem("Why Wake Forest?", "", false)];
  const activities = activitiesForPackage([
    { id: "a1", name: "Varsity soccer", kind: "sport", years: [10, 11, 12], roles: { 12: "leader" }, titles: { 12: "Captain" }, hoursPerWeek: 10, recognition: null, relatedToMajor: false } as ActivityEntry,
  ]);
  const txt = packageTxt({ collegeName: "Wake Forest University", essays, activities });
  const essayPos = txt.indexOf("My story.");
  const notStartedPos = txt.indexOf("Not started yet.");
  const activitiesPos = txt.indexOf("Activities");
  assert.ok(essayPos > -1 && notStartedPos > essayPos && activitiesPos > notStartedPos, txt);
  assert.match(txt, /Varsity soccer — Sport · Captain · Grades 10th, 11th, 12th · 10 hrs\/wk/);
});

test("the .docx package's text keeps the same order", async () => {
  const essays = [essayItem("First prompt", "First draft.", true), essayItem("Second prompt", "", false)];
  const buffer = await packageDocxBuffer({ collegeName: "Wake Forest University", essays, activities: [] });
  const text = await textFromDocx(buffer);
  const firstPos = text.indexOf("First draft.");
  const secondPos = text.indexOf("Second prompt");
  assert.ok(firstPos > -1 && secondPos > firstPos);
  assert.match(text, /Not started yet\./);
});

/* ------------------------------------------------------------------ */
/* activitiesForPackage: the Common App's shape from the record's own activities                   */
/* ------------------------------------------------------------------ */

test("activitiesForPackage drops an activity with no years picked, and skips a bare 'Member' title", () => {
  const activities: ActivityEntry[] = [
    { id: "a1", name: "Debate club", kind: "club", years: [], roles: {}, titles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false },
    { id: "a2", name: "Robotics", kind: "club", years: [11, 12], roles: { 12: "member" }, titles: {}, hoursPerWeek: 5, recognition: null, relatedToMajor: true },
  ];
  const out = activitiesForPackage(activities);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Robotics");
  assert.equal(out[0].roleTitle, null);
  assert.deepEqual(out[0].years, ["11th", "12th"]);
  assert.equal(out[0].hoursPerWeek, 5);
});

/* ------------------------------------------------------------------ */
/* The normalizer applied on import (the round trip rule: everything stored goes through it)        */
/* ------------------------------------------------------------------ */

test("an imported body is normalized the same way a typed one is", () => {
  const pasted = "Line one.\r\nLine two with a non breaking space.\r\n";
  assert.equal(normalizeText(pasted), "Line one.\nLine two with a non breaking space.\n");
});
