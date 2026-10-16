/**
 * Your record (lib/planner/record.ts, lib/planner/intake.ts steps 8–12; specs/planner/record/steps.md, build-plan.md
 * "R1a Record data"): the thirteen steps and their copy, the unlock lines, the step summaries the rail and the
 * overview share, `recordProgress` for planted profiles, the links, and every new step's save: draft → save → the
 * server's check → profile → draft, a skipped step leaving its field untouched, and a guardian's story step keeping the
 * stored story. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RECORD_DONE,
  RECORD_LABEL,
  RECORD_REVIEW,
  RECORD_STEPS,
  SECTION_RECORD_STEP,
  SECTION_UNLOCK,
  recordHref,
  recordNeeded,
  recordPageHref,
  recordProgress,
  recordTitle,
  stepSummary,
  type RecordSection,
} from "../lib/planner/record.ts";
import {
  applyIntake,
  draftFromProfile,
  INTAKE_DONE,
  INTAKE_REVIEW,
  intakeToSave,
  maxCostCheck,
  maxCostOf,
  parseIntakeSave,
  reviewLines,
  stepValid,
  type IntakeDraft,
  type IntakeSave,
} from "../lib/planner/intake.ts";
import { SECTION_STEP } from "../lib/planner/profile-progress.ts";
import { emptyProfile, profileForViewer, redactStoryForGuardian, sanitizeProfile, type RecommenderEntry, type StudentProfileData } from "../lib/student-profile.ts";

const TODAY = "2026-10-16";
const ROOT = join(import.meta.dirname, "..");
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const teacher = (over: Partial<RecommenderEntry> = {}): RecommenderEntry => ({
  id: "r1",
  name: "Ms. Ruiz",
  subject: "English",
  courseId: null,
  years: [11],
  rank: 1,
  status: "thinking",
  askedOn: null,
  agreedOn: null,
  invitedOn: null,
  ...over,
});

/** A profile with the first two steps in (what the tour needs to save at all). */
function base(): StudentProfileData {
  const p = emptyProfile();
  p.basics.gradYear = 2028;
  p.academics.gpa = 3.7;
  p.tests.focus = "sat";
  p.tests.satTotal = 1350;
  return sanitizeProfile(p);
}

/** The whole save path, as the browser and the server run it: draft → intakeToSave → JSON → parseIntakeSave → applyIntake. */
function save(profile: StudentProfileData, d: IntakeDraft): StudentProfileData {
  const out = intakeToSave(d);
  assert.ok(out, "the draft saves");
  const parsed = parseIntakeSave(JSON.parse(JSON.stringify(out)));
  assert.ok(parsed, "the server accepts it");
  return applyIntake(profile, parsed, TODAY);
}

const open = (p: StudentProfileData, relation?: "self" | "guardian") => draftFromProfile(p, p.basics.gradYear, TODAY, { relation });

/* ------------------------------------------------------------------ */
/* The steps                                                           */
/* ------------------------------------------------------------------ */

test("RECORD_STEPS: the thirteen entry steps in order, one per section, Review 13 and Done 14", () => {
  assert.equal(RECORD_STEPS.length, 13);
  RECORD_STEPS.forEach((s, i) => assert.equal(s.step, i));
  assert.deepEqual(
    RECORD_STEPS.map((s) => s.rail),
    ["Grades", "Test score", "AP courses", "Sports", "Clubs", "Work", "Connections", "Other", "Major", "Basics", "Where you'd go", "Your story", "Recommenders"],
  );
  assert.deepEqual(
    RECORD_STEPS.map((s) => s.section),
    ["grades", "test", "courses", "sports", "clubs", "work", "connections", "other", "major", "basics", "where", "story", "recommenders"],
  );
  assert.equal(RECORD_REVIEW, 13);
  assert.equal(RECORD_DONE, 14);
  assert.equal(INTAKE_REVIEW, RECORD_REVIEW, "the built names alias the record's");
  assert.equal(INTAKE_DONE, RECORD_DONE);
  // Each section's step agrees with the people line's (profile-progress SECTION_STEP).
  for (const s of RECORD_STEPS) {
    assert.equal(SECTION_STEP[s.section], s.step, s.section);
    assert.equal(SECTION_RECORD_STEP[s.section], s.step);
  }
});

test("only grades and test are required; every other step never blocks Continue", () => {
  assert.deepEqual(
    RECORD_STEPS.filter((s) => s.required).map((s) => s.step),
    [0, 1],
  );
  const d = open(emptyProfile());
  for (const s of RECORD_STEPS.filter((x) => !x.required)) assert.equal(stepValid(d, s.step), true, `step ${s.step}`);
  assert.equal(stepValid(d, 0), false);
});

test("each step's copy: a headline, one line under 90 characters, two or three sentences of why, no digits", () => {
  const hasDigit = (s: string) => /\d/.test(s);
  const sentences = (s: string) => s.split(/(?<=[.?!])\s+(?=[A-Z])/).length;
  // The guard itself catches a planted bad case.
  assert.equal(hasDigit("Most students pick 2 teachers."), true);
  assert.equal(sentences("One. Two. Three. Four."), 4);
  for (const s of RECORD_STEPS) {
    assert.ok(s.headline.lead && s.headline.pop, `step ${s.step} headline`);
    assert.ok(s.line.length > 0 && s.line.length < 90, `step ${s.step} line: ${s.line.length}`);
    const n = sentences(s.why);
    assert.ok(n >= 2 && n <= 3, `step ${s.step} why has ${n} sentences`);
    for (const text of [s.line, s.why, s.headline.lead, s.headline.pop, s.headline.tail ?? ""]) assert.equal(hasDigit(text), false, text);
    assert.doesNotMatch(s.why, /\bodds\b/i);
  }
});

test("the built steps' headlines match the components' <Headline /> calls (R2 reads them from RECORD_STEPS)", () => {
  const file: Record<number, string> = {
    0: "components/planner/intake/GradesStep.tsx",
    1: "components/planner/intake/TestStep.tsx",
    2: "components/planner/intake/ApStep.tsx",
    6: "components/planner/intake/ConnectionsStep.tsx",
  };
  for (const [step, path] of Object.entries(file)) {
    const h = RECORD_STEPS[Number(step)].headline;
    const call = `<Headline lead="${h.lead}" pop="${h.pop}"${h.tail ? ` tail="${h.tail}"` : ""} />`;
    assert.ok(src(path).includes(call), `${path}: ${call}`);
  }
  const activities = src("components/planner/intake/ActivitiesStep.tsx");
  for (const step of [3, 4, 5, 7]) {
    const h = RECORD_STEPS[step].headline;
    assert.ok(activities.includes(`{ lead: "${h.lead}", pop: "${h.pop}"`), `activity step ${step}`);
  }
  // The new steps' headlines from steps.md.
  assert.deepEqual(RECORD_STEPS[8].headline, { lead: "What might you", pop: "study?" });
  assert.deepEqual(RECORD_STEPS[9].headline, { lead: "A few", pop: "basics" });
  assert.deepEqual(RECORD_STEPS[10].headline, { lead: "Where would you", pop: "go?" });
  assert.deepEqual(RECORD_STEPS[11].headline, { lead: "Your", pop: "story" });
  assert.deepEqual(RECORD_STEPS[12].headline, { lead: "Your", pop: "recommenders" });
});

test("SECTION_UNLOCK: one line per section, never a score or a count (no digits), never the word odds", () => {
  const sections = RECORD_STEPS.map((s) => s.section);
  assert.deepEqual(Object.keys(SECTION_UNLOCK).sort(), [...sections].sort());
  const bad = (line: string) => /\d|%|\bodds\b/i.test(line);
  assert.equal(bad("Add a major: unlocks 3 matches"), true, "the guard catches a planted digit");
  for (const [section, line] of Object.entries(SECTION_UNLOCK)) {
    assert.ok(line.trim().length > 0, section);
    assert.equal(bad(line), false, `${section}: ${line}`);
  }
  assert.match(SECTION_UNLOCK.major, /like your list/);
  assert.match(SECTION_UNLOCK.where, /Fits my preferences/);
  assert.match(SECTION_UNLOCK.clubs, /depth over a long list/);
});

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

test("stepSummary: the built rail summaries, unchanged", () => {
  const d = open(base());
  assert.equal(stepSummary(d, 0), "Class of 2028 · GPA 3.7");
  assert.equal(stepSummary(d, 1), "SAT 1350");
  assert.equal(stepSummary({ ...d, test: "none" }, 1), "Not testing");
  assert.equal(stepSummary(d, 2), null);
  assert.equal(stepSummary(d, 6), null);
  assert.equal(stepSummary({ ...d, activitiesNone: { connections: true } }, 6), "None");
  assert.equal(stepSummary(d, RECORD_REVIEW), null);
  assert.equal(stepSummary(d, RECORD_DONE), null);
});

test("stepSummary: the new steps (the brief's examples)", () => {
  const d = open(base());
  assert.equal(stepSummary(d, 8), "Undecided");
  assert.equal(stepSummary({ ...d, majors: ["14", "11"] }, 8), "Engineering, Computer science");
  assert.equal(stepSummary(d, 9), null);
  assert.equal(stepSummary({ ...d, stateOfResidence: "NC" }, 9), "NC · fee waiver: not sure");
  assert.equal(stepSummary({ ...d, stateOfResidence: "OUTSIDE_US", feeWaiverEligible: true }, 9), "Outside the US · fee waiver: yes");
  assert.equal(stepSummary(d, 10), null);
  assert.equal(stepSummary({ ...d, sizes: ["medium"], settings: ["suburb"], statesOrRegions: ["Southeast"] }, 10), "Mid-sized, suburban, Southeast");
  assert.equal(stepSummary({ ...d, maxAverageCost: "35000" }, 10), null, "the rail leaves the cost to the review line");
  assert.equal(stepSummary(d, 11), "Not yet");
  assert.equal(stepSummary({ ...d, story: "a".repeat(199) }, 11), "Not yet");
  assert.equal(stepSummary({ ...d, story: "a".repeat(200) }, 11), "Written");
  assert.equal(stepSummary({ ...d, story: null, storyWritten: true }, 11), "Written", "a guardian's draft reads the stored state");
  assert.equal(stepSummary(d, 12), "Not yet");
  assert.equal(stepSummary({ ...d, recommenders: [teacher(), teacher({ id: "r2", status: "asked", rank: 2 })] }, 12), "2 teachers, 1 asked");
  assert.equal(stepSummary({ ...d, recommenders: [teacher()] }, 12), "1 teacher");
});

test("reviewLines: one row per new step, with the brief's wording", () => {
  const d: IntakeDraft = {
    ...open(base()),
    majors: ["14", "11"],
    stateOfResidence: "NC",
    firstGeneration: false,
    sizes: ["medium"],
    settings: ["suburb"],
    statesOrRegions: ["Southeast"],
    maxAverageCost: "$35,000",
    recommenders: [teacher(), teacher({ id: "r2", rank: 2 })],
  };
  const rows = reviewLines(d, TODAY).filter((l) => l.step >= 8);
  assert.deepEqual(rows, [
    { step: 8, label: "Major", value: "Engineering, Computer science" },
    { step: 9, label: "Basics", value: "NC · fee waiver: not sure · first generation: no" },
    { step: 10, label: "Where you'd go", value: "Mid-sized, suburban, Southeast, up to $35,000" },
    { step: 11, label: "Your story", value: "Not yet" },
    { step: 12, label: "Recommenders", value: "2 teachers" },
  ]);
  assert.equal(reviewLines({ ...d, earlyRoundInterest: "ed" }, TODAY).find((l) => l.step === 10)?.value, "Mid-sized, suburban, Southeast, up to $35,000, early decision");
});

/* ------------------------------------------------------------------ */
/* recordProgress                                                      */
/* ------------------------------------------------------------------ */

test("recordProgress: nothing in (and no profile at all)", () => {
  for (const p of [null, emptyProfile()]) {
    const r = recordProgress(p);
    assert.equal(r.total, 13);
    assert.equal(r.done, 0);
    assert.deepEqual(
      r.rows.map((x) => x.step),
      RECORD_STEPS.map((s) => s.step),
    );
    for (const row of r.rows) assert.equal(row.unlock, SECTION_UNLOCK[row.section]);
  }
});

test("recordProgress: a partial record (grades, test, clubs as None, a major, the state)", () => {
  const p = base();
  p.academics.classStanding = "top25";
  p.academics.activitiesNone = { clubs: true };
  p.plans.intendedMajors = ["14"];
  p.basics.stateOfResidence = "NC";
  const r = recordProgress(p);
  const done = Object.fromEntries(r.rows.map((x) => [x.section, x.done])) as Record<RecordSection, boolean>;
  assert.deepEqual(
    Object.entries(done)
      .filter(([, v]) => v)
      .map(([k]) => k),
    ["grades", "test", "clubs", "major", "basics"],
  );
  assert.equal(r.done, 5);
  const row = (s: RecordSection) => r.rows.find((x) => x.section === s)!;
  assert.equal(row("grades").summary, "Class of 2028 · GPA 3.7");
  assert.equal(row("major").summary, "Engineering");
  assert.equal(row("basics").summary, "NC · fee waiver: not sure");
  assert.equal(row("clubs").summary, "None");
  assert.equal(row("where").summary, null);
  assert.equal(row("story").summary, "Not yet");
});

test("recordProgress: a full record, and a guardian's view of it (story Written, never the text)", () => {
  const p = base();
  p.basics.highSchool = "Riverside High";
  p.basics.stateOfResidence = "NC";
  p.academics.classStanding = "top10";
  p.academics.courses = [{ id: "c1", kind: "ap", key: "ap_biology", name: null, subject: "science", year: 10, status: "taken", grades: { s1: null, s2: null, final: null }, exam: 4 }];
  p.academics.activitiesNone = { sports: true, clubs: true, work: true, other: true, connections: true };
  p.plans.intendedMajors = ["26"];
  p.preferences.settings = ["town"];
  p.story = { narrative: "I build things. ".repeat(20), updatedAt: "2026-09-01" };
  p.recommenders = [teacher({ status: "asked" })];
  const full = sanitizeProfile(p);
  const r = recordProgress(full);
  assert.equal(r.done, 13);
  assert.equal(r.total, 13);
  assert.equal(r.rows.find((x) => x.section === "story")!.summary, "Written");
  assert.equal(r.rows.find((x) => x.section === "recommenders")!.summary, "1 teacher, 1 asked");
  // A guardian's copy is redacted (profileForViewer); the row still reads Written and nothing carries the text.
  const g = recordProgress(profileForViewer(full, "guardian"), { relation: "guardian" });
  assert.equal(g.done, 13);
  assert.equal(g.rows.find((x) => x.section === "story")!.summary, "Written");
  assert.doesNotMatch(JSON.stringify(g), /I build things/);
});

/* ------------------------------------------------------------------ */
/* Links and names                                                     */
/* ------------------------------------------------------------------ */

test("recordHref, recordPageHref, recordTitle, recordNeeded", () => {
  assert.equal(recordHref({ person: null }), "/plan?record=1");
  assert.equal(recordHref({ person: "abc", step: 8, back: "record" }), "/plan?for=abc&record=1&step=8&back=record");
  assert.equal(recordHref({ person: null, step: 0, back: "plan" }), "/plan?record=1&step=0&back=plan");
  assert.equal(recordHref({ person: null, step: RECORD_REVIEW }), "/plan?record=1", "Review is where edit mode opens anyway");
  assert.equal(recordPageHref("1b2c"), "/household/1b2c/record");
  assert.equal(RECORD_LABEL, "Your record");
  assert.equal(recordTitle(null), "Your record");
  assert.equal(recordTitle("Jordan"), "Jordan's record");
  const student = { id: "s1", grad_year: 2028 } as never;
  assert.equal(recordNeeded({ student, profile: null }), true);
  assert.equal(recordNeeded({ student, profile: base() }), false);
  assert.equal(recordNeeded({ student: null, profile: null }), false);
});

test("record.ts and majors-search.ts are pure and client-safe (no server imports)", () => {
  for (const path of ["lib/planner/record.ts", "lib/majors-search.ts"]) {
    const text = src(path);
    assert.doesNotMatch(text, /"use server"|server-only|supabase|next\/headers|from "node:/, path);
  }
});

/* ------------------------------------------------------------------ */
/* Saving steps 8–12                                                   */
/* ------------------------------------------------------------------ */

test("each new step round-trips: draft → save → server check → profile → draft", () => {
  const start = base();
  const edits: [string, Partial<IntakeDraft>, (p: StudentProfileData) => unknown, unknown][] = [
    ["major", { majors: ["14", "11", "27"] }, (p) => p.plans.intendedMajors, ["14", "11", "27"]],
    ["basics", { stateOfResidence: "NC", feeWaiverEligible: true, firstGeneration: false }, (p) => [p.basics.stateOfResidence, p.basics.feeWaiverEligible, p.academics.firstGeneration], ["NC", true, false]],
    [
      "where",
      { sizes: ["small", "medium"], settings: ["town"], statesOrRegions: ["NC", "Southeast"], types: ["public"], maxAverageCost: "$35,000", earlyRoundInterest: "ea" },
      (p) => [p.preferences.sizes, p.preferences.settings, p.preferences.statesOrRegions, p.preferences.types, p.preferences.maxAverageCost, p.plans.earlyRoundInterest],
      [["small", "medium"], ["town"], ["NC", "Southeast"], ["public"], 35000, "ea"],
    ],
    ["story", { story: "  I fix bikes for neighbors.\r\nIt started with mine.  " }, (p) => p.story, { narrative: "I fix bikes for neighbors.\nIt started with mine.", updatedAt: TODAY }],
    ["recommenders", { recommenders: [teacher({ id: "a", rank: 2 }), teacher({ id: "b", name: "Mr. Lee", rank: 1, status: "asked", askedOn: "2026-09-02" })] }, (p) => p.recommenders.map((r) => [r.id, r.rank]), [["b", 1], ["a", 2]]],
  ];
  for (const [name, edit, read, want] of edits) {
    const saved = save(start, { ...open(start), ...edit });
    assert.deepEqual(read(saved), want, name);
    // Read back and saved again unchanged: the same profile (the built round-trip rule).
    const again = save(saved, open(saved));
    assert.deepEqual(again, saved, `${name}: an unchanged save gives back the same profile`);
  }
});

test("a skipped step leaves its field untouched: an unchanged draft saves the same profile, and a save without the new fields keeps them", () => {
  const p = base();
  p.plans.intendedMajors = ["52"];
  p.basics.stateOfResidence = "TX";
  p.basics.feeWaiverEligible = false;
  p.academics.firstGeneration = true;
  p.preferences = { sizes: ["large"], settings: ["city"], statesOrRegions: ["West", "free text kept"], maxAverageCost: 41000, types: ["private-nonprofit"] };
  p.plans.earlyRoundInterest = "ed";
  p.story = { narrative: "s".repeat(240), updatedAt: "2026-08-01T10:00:00Z" };
  p.recommenders = [teacher()];
  const stored = sanitizeProfile(p);
  assert.deepEqual(save(stored, open(stored)), stored, "every step skipped");
  // A client from before these steps sends none of the new fields: each keeps its stored value.
  const old = intakeToSave(open(stored))!;
  const legacy: Record<string, unknown> = { ...old };
  for (const k of ["majors", "stateOfResidence", "feeWaiverEligible", "firstGeneration", "sizes", "settings", "statesOrRegions", "types", "maxAverageCost", "earlyRoundInterest", "story", "recommenders"]) delete legacy[k];
  const parsed = parseIntakeSave(legacy)!;
  assert.equal(parsed.majors, undefined);
  assert.deepEqual(applyIntake(stored, parsed, TODAY), stored);
  // A cost that isn't a number is left out (the stored limit stays); an emptied one clears it.
  assert.equal(save(stored, { ...open(stored), maxAverageCost: "lots" }).preferences.maxAverageCost, 41000);
  assert.equal(save(stored, { ...open(stored), maxAverageCost: "" }).preferences.maxAverageCost, null);
});

test("the story step for a guardian keeps the stored story: the draft carries null, the save keeps it, updatedAt and all", () => {
  const p = base();
  p.story = { narrative: "My own words. ".repeat(20).trim(), updatedAt: "2026-08-01T10:00:00Z" };
  const stored = sanitizeProfile(p);
  const asGuardian = draftFromProfile(stored, 2028, TODAY, { relation: "guardian" });
  assert.equal(asGuardian.story, null);
  assert.equal(asGuardian.storyWritten, true);
  // The guardian's own (redacted) copy opens the same way without being told.
  const redacted = { ...stored, story: redactStoryForGuardian(stored.story) };
  assert.equal(open(redacted).story, null);
  assert.equal(open(redacted).storyWritten, true);
  // Saving the guardian's draft against the stored profile (store-plan restores it for a guardian) keeps the story.
  const saved = save(stored, { ...asGuardian, majors: ["26"] });
  assert.deepEqual(saved.story, stored.story);
  assert.deepEqual(saved.plans.intendedMajors, ["26"]);
  // A student's unchanged story keeps its date; a changed one is dated today; emptied clears it.
  assert.deepEqual(save(stored, open(stored)).story, stored.story);
  assert.equal(save(stored, { ...open(stored), story: "New words." }).story?.updatedAt, TODAY);
  assert.equal(save(stored, { ...open(stored), story: "   " }).story, null);
});

test("parseIntakeSave checks the new fields the way sanitizeProfile does", () => {
  const good = intakeToSave(open(base()))!;
  const parsed = parseIntakeSave({
    ...good,
    majors: ["14", "nope", "14", "11", "26", "52"],
    stateOfResidence: "  NC ",
    feeWaiverEligible: "maybe",
    firstGeneration: true,
    sizes: ["huge", "small"],
    settings: ["suburb", 3],
    statesOrRegions: ["NC", "x".repeat(40)],
    types: ["public", "castle"],
    maxAverageCost: 9_000_000,
    earlyRoundInterest: "rd",
    story: { narrative: "not a string" },
    recommenders: [{ name: "" }, { name: "Ms. Ruiz", status: "bogus" }],
  } as unknown) as IntakeSave;
  assert.ok(parsed);
  assert.deepEqual(parsed.majors, ["14", "11", "26"], "unknown dropped, deduped, at most three");
  assert.equal(parsed.stateOfResidence, "NC");
  assert.equal(parsed.feeWaiverEligible, null);
  assert.equal(parsed.firstGeneration, true);
  assert.deepEqual(parsed.sizes, ["small"]);
  assert.deepEqual(parsed.settings, ["suburb"]);
  assert.deepEqual(parsed.statesOrRegions, ["NC"]);
  assert.deepEqual(parsed.types, ["public"]);
  assert.equal(parsed.maxAverageCost, null);
  assert.equal(parsed.earlyRoundInterest, null);
  assert.equal(parsed.story, undefined, "a story that isn't text reads as left out");
  assert.equal(parsed.recommenders?.length, 1);
  assert.equal(parsed.recommenders?.[0].status, "thinking");
  // The new steps never make the save itself fail.
  assert.ok(parseIntakeSave({ ...good, majors: "Engineering", recommenders: "x" }));
});

test("maxCostOf and maxCostCheck: dollars as typed, never blocking", () => {
  assert.equal(maxCostOf(""), null);
  assert.equal(maxCostOf("35000"), 35000);
  assert.equal(maxCostOf("$35,000"), 35000);
  assert.equal(maxCostOf(" $ 35,000.50 "), 35001);
  assert.ok(Number.isNaN(maxCostOf("35k")));
  assert.ok(Number.isNaN(maxCostOf("500000")));
  assert.ok(Number.isNaN(maxCostOf("-5")));
  assert.deepEqual(maxCostCheck("35,000"), { ok: true, hint: null });
  assert.equal(maxCostCheck("lots").ok, false);
  assert.equal(stepValid({ ...open(base()), maxAverageCost: "lots" }, 10), true);
});
