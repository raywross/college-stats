/**
 * The recommenders guide's pure helpers (lib/planner/recommenders.ts; specs/planner/v3/guides/recommenders.md):
 * ranking and `moveRank`, `setStatus`'s one-way ladder and its dates, `subjectsFrom`'s core-first ordering,
 * `collegesAskLine`'s citations, `thankSeason`, and that `THINK_ABOUT`/`HOW_TO_ASK` pass the catalog's words guard.
 * Also: `pick_recommenders` opens in junior spring, not junior fall, and closes once two are asked (the catalog and
 * season-generator guards U1 already proved; reconfirmed here against this unit's own fixtures). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collegesAskLine,
  HOW_TO_ASK,
  moveRank,
  nextRank,
  orderRecommenders,
  setStatus,
  subjectsFrom,
  thankSeason,
  THINK_ABOUT,
  yearsLabel,
} from "../lib/planner/recommenders.ts";
import { entriesFor, moveApplies, type MoveFacts } from "../lib/planner/generators/season.ts";
import { PLAYBOOK } from "../lib/planner/moves-catalog.ts";
import { emptyProfile, type RecommenderEntry, type StudentProfileData } from "../lib/student-profile.ts";
import type { CourseEntry } from "../lib/chances/types.ts";
import type { PlanItem, PlanSchool } from "../lib/planner/types.ts";
import { numberProblems } from "./helpers/copy-guard.mts";

const entry = (over: Partial<RecommenderEntry> = {}): RecommenderEntry => ({
  id: "r1",
  name: "Ms. Alvarez",
  subject: "AP Chemistry",
  courseId: null,
  years: [11],
  rank: 1,
  status: "thinking",
  askedOn: null,
  agreedOn: null,
  invitedOn: null,
  ...over,
});

/* ------------------------------------------------------------------ */
/* orderRecommenders, nextRank, moveRank                               */
/* ------------------------------------------------------------------ */

test("orderRecommenders sorts by rank; nextRank is one past the highest", () => {
  const a = entry({ id: "a", rank: 2 });
  const b = entry({ id: "b", rank: 1 });
  const c = entry({ id: "c", rank: 3 });
  assert.deepEqual(orderRecommenders([a, b, c]).map((e) => e.id), ["b", "a", "c"]);
  assert.equal(nextRank([]), 1);
  assert.equal(nextRank([a, b, c]), 4);
});

test("moveRank swaps with the neighbor and renumbers 1..n; a move off either end is a no-op", () => {
  const a = entry({ id: "a", rank: 1 });
  const b = entry({ id: "b", rank: 2 });
  const c = entry({ id: "c", rank: 3 });
  const down = moveRank([a, b, c], "a", 1);
  assert.deepEqual(down.map((e) => [e.id, e.rank]), [
    ["b", 1],
    ["a", 2],
    ["c", 3],
  ]);
  const up = moveRank([a, b, c], "a", -1);
  assert.deepEqual(up.map((e) => e.id), ["a", "b", "c"], "already first: unchanged");
  const past = moveRank([a, b, c], "c", 1);
  assert.deepEqual(past.map((e) => e.id), ["a", "b", "c"], "already last: unchanged");
  assert.deepEqual(moveRank([a, b, c], "no-such-id", 1).map((e) => e.id), ["a", "b", "c"]);
});

/* ------------------------------------------------------------------ */
/* setStatus: the one-way ladder and its dates                         */
/* ------------------------------------------------------------------ */

test("setStatus dates the status the first time it's reached, never overwrites an existing date, and never moves backward except the explicit reset", () => {
  const today = "2027-03-10";
  const thinking = entry();
  const asked = setStatus(thinking, "asked", today);
  assert.equal(asked.status, "asked");
  assert.equal(asked.askedOn, today);

  // Re-asking on a later day never changes the date already on file.
  const stillAsked = setStatus(asked, "asked", "2027-04-01");
  assert.equal(stillAsked.askedOn, today);

  const agreed = setStatus(asked, "agreed", "2027-04-02");
  assert.equal(agreed.status, "agreed");
  assert.equal(agreed.agreedOn, "2027-04-02");
  assert.equal(agreed.askedOn, today, "the earlier date is kept");

  // Backward (agreed -> asked) is refused: the entry is returned unchanged.
  assert.deepEqual(setStatus(agreed, "asked", "2027-04-03"), agreed);

  // The explicit reset to "thinking" clears every date, from any status.
  const invited = setStatus(setStatus(agreed, "invited", "2027-09-01"), "thinking", "2027-09-02");
  assert.deepEqual(invited, { ...thinking, status: "thinking", askedOn: null, agreedOn: null, invitedOn: null });
});

test("setStatus can go straight from thinking to agreed, skipping asked (the mockup allows it)", () => {
  const agreed = setStatus(entry(), "agreed", "2027-04-02");
  assert.equal(agreed.status, "agreed");
  assert.equal(agreed.agreedOn, "2027-04-02");
  assert.equal(agreed.askedOn, null);
});

/* ------------------------------------------------------------------ */
/* subjectsFrom                                                        */
/* ------------------------------------------------------------------ */

const course = (over: Partial<CourseEntry>): CourseEntry => ({
  id: `c-${Math.random()}`,
  kind: "regular",
  key: null,
  name: "Robotics",
  subject: "other",
  year: 11,
  status: "taken",
  grades: { s1: null, s2: null, final: null },
  exam: null,
  ...over,
});

test("subjectsFrom: unique display names, core subjects first, named courses before placeholders", () => {
  const courses: CourseEntry[] = [
    course({ subject: "other", name: "Robotics" }),
    course({ subject: "english", key: null, name: "English 11 (H)", kind: "honors" }),
    course({ subject: "science", key: "ap_chemistry", name: null, kind: "ap" }),
    course({ subject: "english", key: null, name: "English 11 (H)", kind: "honors" }), // duplicate name, dropped
    course({ subject: "other", name: null, kind: "ap" }), // unnamed placeholder, skipped
  ];
  const subjects = subjectsFrom(courses);
  assert.deepEqual(subjects.slice(0, 2).sort(), ["AP Chemistry", "English 11 (H)"].sort(), "core subjects (english, science) come first");
  assert.ok(subjects.includes("Robotics"), "non-core subjects still show, after the core ones");
  assert.equal(subjects.indexOf("Robotics") > subjects.indexOf("AP Chemistry"), true);
  assert.equal(new Set(subjects).size, subjects.length, "no duplicate names");
});

test("subjectsFrom: no courses, no subjects", () => {
  assert.deepEqual(subjectsFrom([]), []);
});

/* ------------------------------------------------------------------ */
/* collegesAskLine                                                     */
/* ------------------------------------------------------------------ */

const item = (over: Partial<PlanItem> = {}): Pick<PlanItem, "unit_id" | "recommendations_count" | "withdrawn_on"> => ({
  unit_id: "100",
  recommendations_count: null,
  withdrawn_on: null,
  ...over,
});
const school = (name: string): Pick<PlanSchool, "name"> => ({ name });

test("collegesAskLine: names each college with a count, in list order, cited by unit id", () => {
  const items = [item({ unit_id: "1", recommendations_count: 2 }), item({ unit_id: "2", recommendations_count: 1 })];
  const schools = { "1": school("Wake Forest"), "2": school("Davidson") };
  const line = collegesAskLine(items, schools);
  assert.ok(line);
  assert.equal(line!.text, "Wake Forest asks for 2, Davidson asks for 1");
  assert.deepEqual(line!.cites, ["1", "2"]);
});

test("collegesAskLine: null without any count; skips withdrawn, zero/null counts, and a college with no name on file", () => {
  assert.equal(collegesAskLine([], {}), null);
  const items = [
    item({ unit_id: "1", recommendations_count: null }),
    item({ unit_id: "2", recommendations_count: 0 }),
    item({ unit_id: "3", recommendations_count: 2, withdrawn_on: "2027-01-01" }),
    item({ unit_id: "4", recommendations_count: 1 }), // no school on record
  ];
  assert.equal(collegesAskLine(items, { "1": school("A") }), null, "null-count, zero-count, withdrawn, and nameless rows are all excluded");
});

/* ------------------------------------------------------------------ */
/* thankSeason                                                         */
/* ------------------------------------------------------------------ */

test("thankSeason: November on in senior fall, open through winter and spring; not before", () => {
  assert.equal(thankSeason("senior_fall", "2027-10-15"), false);
  assert.equal(thankSeason("senior_fall", "2027-11-01"), true);
  assert.equal(thankSeason("senior_fall", "2027-12-20"), true);
  assert.equal(thankSeason("senior_winter", "2028-01-10"), true);
  assert.equal(thankSeason("senior_spring", "2028-04-01"), true);
  assert.equal(thankSeason("junior_spring", "2027-11-05"), false);
  assert.equal(thankSeason("unknown", "2027-11-05"), false);
});

/* ------------------------------------------------------------------ */
/* yearsLabel                                                           */
/* ------------------------------------------------------------------ */

test("yearsLabel: one year is a name, several are ordinals joined with an en dash", () => {
  assert.equal(yearsLabel([11]), "junior year");
  assert.equal(yearsLabel([10, 11]), "10th–11th");
  assert.equal(yearsLabel([]), "");
});

/* ------------------------------------------------------------------ */
/* THINK_ABOUT / HOW_TO_ASK: the catalog's words guard                 */
/* ------------------------------------------------------------------ */

test("THINK_ABOUT and HOW_TO_ASK: no estimate number, no 'you should' (the catalog's guard)", () => {
  for (const line of [...THINK_ABOUT, ...HOW_TO_ASK]) {
    assert.deepEqual(numberProblems(line), [], line);
  }
});

test("the guard actually catches a planted bad line (it isn't a no-op)", () => {
  assert.ok(numberProblems("You have a 70% chance; you should ask two teachers").length > 0);
});

/* ------------------------------------------------------------------ */
/* pick_recommenders: junior spring, carries, closes at two asked       */
/* ------------------------------------------------------------------ */

const baseFacts: MoveFacts = {
  items: [],
  schools: {},
  profile: null,
  visits: [],
  estimates: {},
  edCandidates: [],
  shapeGaps: [],
  interest: [],
  counts: null,
};

function profileWith(recommenders: RecommenderEntry[]): StudentProfileData {
  return { ...emptyProfile(), recommenders };
}

test("recommenders_open: true under two asked/agreed/invited, false at two or more", () => {
  assert.equal(moveApplies("recommenders_open", { ...baseFacts, profile: profileWith([]) }), true);
  assert.equal(moveApplies("recommenders_open", { ...baseFacts, profile: profileWith([entry({ status: "asked" })]) }), true);
  const two = [entry({ id: "a", status: "asked" }), entry({ id: "b", status: "agreed" })];
  assert.equal(moveApplies("recommenders_open", { ...baseFacts, profile: profileWith(two) }), false);
  const invited = [entry({ id: "a", status: "invited" }), entry({ id: "b", status: "invited" })];
  assert.equal(moveApplies("recommenders_open", { ...baseFacts, profile: profileWith(invited) }), false);
});

test("pick_recommenders: in junior_spring's entries, carries, not in junior_fall's", () => {
  assert.ok(entriesFor("junior_spring", PLAYBOOK).some((e) => e.key === "pick_recommenders"));
  assert.ok(!entriesFor("junior_fall", PLAYBOOK).some((e) => e.key === "pick_recommenders"));
  const e = PLAYBOOK.find((x) => x.key === "pick_recommenders");
  assert.ok(e);
  assert.equal(e!.season, "junior_spring");
  assert.equal(e!.carries, true);
  assert.equal(e!.applies, "recommenders_open");
});
