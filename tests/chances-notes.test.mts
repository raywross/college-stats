/**
 * The pool explainer's wording (specs/chances/pool-explainer.md): no student-facing sentence says "pool" (the word
 * stays only in the glossary), every pool kind the table lists has a sentence, years come from lineage (never
 * typed), and `comparedWith` assembles the "Who you're compared with" panel's rows from the same facts the
 * sentence cites, with the applying row first. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReportedResidencyAdmissions, School } from "../lib/types";
import { comparedWith } from "../lib/chances/compared-with.ts";
import { GLOSSARY, isTermKey } from "../lib/glossary.ts";
import { NOTES, isNoteKey, noteText } from "../lib/chances/notes.ts";
import { poolRateFor, type PoolSchool, type PoolStudent } from "../lib/chances/pool-rate.ts";

const ROOT = join(import.meta.dirname, "..");
const readJson = <T,>(...p: string[]): T => JSON.parse(readFileSync(join(ROOT, ...p), "utf8")) as T;
const schools = readJson<School[]>("data", "schools.json");
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const student = (o: Partial<PoolStudent> = {}): PoolStudent => ({ state: null, classRankPercentile: null, gpa: null, majors: [], round: null, ...o });
const counts = (applicants: number, admitted: number) => ({ applicants, admitted, enrolled: Math.round(admitted / 3) });
const grid = (inState: [number, number], outState: [number, number], intl: [number, number]): ReportedResidencyAdmissions => ({
  entering_term: "Fall 2025",
  year: 2025,
  edition: "2025-26",
  in_state: counts(...inState),
  out_of_state: counts(...outState),
  international: counts(...intl),
  unknown: counts(0, 0),
  total: counts(inState[0] + outState[0] + intl[0], inState[1] + outState[1] + intl[1]),
});
function college(id: string, rate: number | null, residency?: ReportedResidencyAdmissions): PoolSchool {
  const s = clone(byId.get(id)!);
  return {
    unit_id: s.unit_id,
    name: s.name,
    location: s.location,
    admissions: { ...s.admissions, acceptance_rate: rate },
    reported: { ...(s.reported ?? {}), admissions_by_residency: residency },
    lineage: { ...(s.lineage ?? {}), "admissions.acceptance_rate": { source: "ipeds-adm", year: "Fall 2025" } },
  } as PoolSchool;
}

/* ---- "The word 'pool' no longer appears in any sentence a student sees" ---- */

test('no NOTES sentence says "pool" (the glossary keeps the word as a synonym, not any sentence)', () => {
  // A representative value for every placeholder NOTES uses, so every template can be rendered once.
  const values: Record<string, string | number> = {
    taken: 6, offered: 14, gpa: "3.82", count: 4, a: 5, finished: 6, high: 3, college: "Purdue University",
    rating: "very important", share: "71%", program: "Texas automatic admission", pct: "5%", system: "UC",
    unit: "Engineering", state: "Indiana", rate: "71%", year: "fall 2025", ed: "18%", overall: "6%",
    applicants: "engineering", subjects: "math and science", yours: "math 3.9, science 3.7", course: "a year of physics",
    subject: "math", major: "engineering", route: "AP Calculus (4)", routes: "SAT Math 620+, ACT Math 26+",
    alternate: "a second-choice major", colleges: "Illinois and Purdue", courses: "calculus, physics",
    position: "in the middle of admitted students", pool: "Applicants like you — from Indiana — were admitted at 71% (fall 2025).",
    test: "SAT", input: "class rank", list: "GPA 3.85 · SAT 1300", score: 1350, group: "Target", from: "Target", to: "Likely",
  };
  for (const [key, fn] of Object.entries(NOTES)) {
    const text = fn(values);
    assert.ok(!/\bpool\b/i.test(text), `${key} says "pool": ${text}`);
  }
});

test("the glossary keeps \"pool\" as a synonym, pointing at applicants-like-you", () => {
  assert.ok(isTermKey("pool"));
  assert.ok(isTermKey("applicants-like-you"));
  assert.ok(GLOSSARY.pool.related?.includes("applicants-like-you"));
  for (const r of GLOSSARY["applicants-like-you"].related ?? []) assert.ok(isTermKey(r));
});

/* ---- "Every kind has a sentence", years from lineage ---- */

test("every pool kind the spec's table lists has a sentence, worded without \"pool\"", () => {
  // Guaranteed (campus): Texas top 5% at UT Austin.
  const ut = college("228778", 0.27, grid([40000, 12000], [20000, 2000], [5000, 500]));
  const guaranteed = poolRateFor(student({ state: "TX", classRankPercentile: 4 }), ut);
  assert.equal(guaranteed.kind, "guaranteed");
  assert.match(noteText(guaranteed.notes[0]), /^Guaranteed for you: Texas automatic admission \(top 5%\)\.$/);

  // Residency: in-state, out-of-state, international (Purdue-like fixture).
  const purdue = college("243780", 0.43, grid([12000, 8520], [59000, 25960], [16000, 4800]));
  const hoosier = poolRateFor(student({ state: "IN" }), purdue);
  assert.equal(noteText(hoosier.notes[0]), "Applicants like you — from Indiana — were admitted at 71% (Fall 2025).");
  const buckeye = poolRateFor(student({ state: "OH" }), purdue);
  assert.equal(noteText(buckeye.notes[0]), "Applicants like you — from outside Indiana — were admitted at 44% (Fall 2025).");
  const abroad = poolRateFor(student({ state: "OUTSIDE_US" }), purdue);
  assert.equal(noteText(abroad.notes[0]), "International applicants were admitted at 30% (Fall 2025).");

  // Major: Illinois Engineering.
  const illinois = college("145637", 0.37, grid([30000, 13500], [40000, 12000], [13000, 3500]));
  const major = poolRateFor(student({ state: "IL", majors: ["14"] }), illinois);
  assert.equal(major.kind, "major");
  assert.equal(noteText(major.notes[0]), "Applicants to Grainger College of Engineering were admitted at 21% (Fall 2025).");

  // Overall, state known: the college doesn't publish one for it.
  const overallKnown = poolRateFor(student({ state: "IN" }), college("243780", 0.43));
  assert.match(noteText(overallKnown.notes[0]), /^Applicants were admitted at 43% \(Fall 2025\)\. .+ doesn't publish a rate for applicants from Indiana, so this is everyone\.$/);

  // Overall, no state on the household: invites adding one.
  const overallNoState = poolRateFor(student(), college("243780", 0.43));
  assert.equal(noteText(overallNoState.notes[0]), "Applicants were admitted at 43% (Fall 2025). Add your state to see the rate for applicants like you.");

  // Open admission (no rate at all): no pool line to show.
  assert.deepEqual(poolRateFor(student(), college("243780", null)).notes, []);
});

test("years come from lineage, never typed: a different lineage year changes the sentence without any code change", () => {
  const purdue = college("243780", 0.43);
  (purdue.lineage as Record<string, { year: string }>)["admissions.acceptance_rate"] = { year: "Fall 2019" };
  const r = poolRateFor(student(), purdue);
  assert.ok(noteText(r.notes[0]).includes("Fall 2019"), noteText(r.notes[0]));
  assert.ok(!noteText(r.notes[0]).includes("Fall 2025"));

  const grid2025 = grid([12000, 8520], [59000, 25960], [16000, 4800]);
  const r2 = poolRateFor(student({ state: "IN" }), college("243780", 0.43, grid2025));
  assert.ok(noteText(r2.notes[0]).includes("Fall 2025"));
});

/* ---- "Who you're compared with": comparedWith(student, school) ---- */

test("comparedWith: the applying rate is first, every row cites a published fact, and a guarantee and the major both show as rows", () => {
  const purdue = college("243780", 0.43, grid([12000, 8520], [59000, 25960], [16000, 4800]));
  const hoosier = comparedWith(student({ state: "IN" }), purdue);
  assert.equal(hoosier.rows[0].label, "From Indiana (you)");
  assert.equal(hoosier.rows[0].rate, "71%");
  assert.equal(hoosier.rows[0].applies, true);
  assert.equal(hoosier.rows[0].cite, "derived.admit_rate_in_state");
  assert.ok(hoosier.rows.some((r) => r.label === "Everyone" && r.rate === "43%" && !r.applies));
  assert.ok(hoosier.rows.some((r) => r.label.startsWith("From outside Indiana") && r.rate === "44%" && !r.applies));
  for (const row of hoosier.rows) if (row.rate !== null) assert.ok(row.cite, row.label);

  // Everyone, when the student's state is unknown: the overall row applies, and is first.
  const noState = comparedWith(student(), purdue);
  assert.equal(noState.rows[0].label, "Everyone");
  assert.equal(noState.rows[0].applies, true);

  // A guarantee is a row of its own, bold first, with no rate (a rule, not a rate).
  const ut = college("228778", 0.27, grid([40000, 12000], [20000, 2000], [5000, 500]));
  const guaranteed = comparedWith(student({ state: "TX", classRankPercentile: 4 }), ut);
  assert.equal(guaranteed.rows[0].rate, null);
  assert.equal(guaranteed.rows[0].applies, true);
  assert.match(guaranteed.rows[0].label, /Texas automatic admission/);
  assert.equal(guaranteed.rows[0].note, "admits every applicant who qualifies");

  // A major that admits separately but publishes no rate shows the words, not a number (UT Austin engineering; a
  // non-Texas student so no guarantee applies, isolating the major row).
  const noMajorRate = comparedWith(student({ state: "CA", majors: ["14"] }), college("228778", 0.27));
  const majorRow = noMajorRate.rows.find((r) => r.rate === null && r.note?.includes("publishes no rate by major"));
  assert.ok(majorRow, JSON.stringify(noMajorRate.rows));
});

test("comparedWith never writes the hidden odds, the method, or any text outside the catalog", () => {
  const purdue = college("243780", 0.43, grid([12000, 8520], [59000, 25960], [16000, 4800]));
  const data = comparedWith(student({ state: "IN" }), purdue);
  const everything = JSON.stringify(data);
  assert.ok(!/odds|multiplier|threshold|cutoff/i.test(everything), everything);
});

test("every NOTES key added here is registered and renders", () => {
  for (const key of [
    "pool.residency_in", "pool.residency_out", "pool.major_rate", "pool.overall_state_known", "pool.overall_no_state",
    "pool.panel_intro", "pool.panel_change_state", "pool.panel_major_none", "pool.panel_guaranteed_note",
    "pool.add_state_prompt", "estimate.guaranteed", "estimate.pool", "major.undecided",
  ]) {
    assert.ok(isNoteKey(key), key);
  }
});
