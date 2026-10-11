/**
 * How this college reads a record (specs/chances/how-colleges-read.md; lib/chances/reading.ts, reading-major.ts): each
 * line with and without its data, the crowding sentence with rigor rated low, a weighted reporter, a college with the
 * federal factors only, the block hidden below two lines, the Major line only from a quoted statement, the Compare row,
 * and the lineage and client-safety rules around them. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GpaBands, School } from "../lib/types";
import { FIELDS } from "../lib/fields.ts";
import { TOPIC_FIELDS } from "../lib/profile-topics.ts";
import { READING_ROW, cardFields, cardRows } from "../lib/compare-cards.ts";
import { CROWDED_SHARE, RANK_MIN_SUBMITTED, gpaTopShare, isWeightedReporter, readingLines, readingSummary, readingTheRecord, type ReadingLine } from "../lib/chances/reading.ts";
import { curatedMajorSource, majorLine, readingWithMajor, type MajorSource } from "../lib/chances/reading-major.ts";
import { allMajorUnits, type CuratedMajorUnit } from "../lib/chances/major-admission.ts";

/* ---- Fixtures: only the fields the reading reads ---- */

type Profile = NonNullable<NonNullable<School["reported"]>["admission_profile"]>;
interface Fixture {
  id?: string;
  name?: string;
  profile?: Partial<Profile>;
  factors?: Record<string, string> | null;
  policy?: string | null;
  sat?: number | null;
  act?: number | null;
  prep?: { req?: Record<string, number | null> | null; rec?: Record<string, number | null> | null };
}

const bands = (...top: number[]): GpaBands => {
  const rest = (1 - top.reduce((a, b) => a + b, 0)) / (9 - top.length);
  return [...top, ...Array(9 - top.length).fill(rest)] as GpaBands;
};
const gpa = (over: Partial<NonNullable<Profile["gpa"]>> = {}): NonNullable<Profile["gpa"]> => ({
  average: 3.9,
  scale: "not_stated",
  submitted_share: 0.9,
  bands: { all: bands(0.5, 0.38), with_test: null, without_test: null },
  ...over,
});

function college(f: Fixture = {}): School {
  const units = (u: Record<string, number | null> | null | undefined) => (u ? { total: null, english: null, math: null, science: null, lab: null, foreign_language: null, social_studies: null, history: null, electives: null, computer_science: null, arts: null, other_text: null, ...u } : null);
  return {
    unit_id: f.id ?? "999001",
    name: f.name ?? "Test University",
    admissions: {
      test_submission_rate_sat: f.sat ?? null,
      test_submission_rate_act: f.act ?? null,
      test_policy: f.policy ?? null,
      factors: f.factors ?? null,
    },
    reported: {
      ...(f.profile ? { admission_profile: f.profile as Profile } : {}),
      ...(f.prep ? { admissions_hs_prep: { completion: null, college_prep: null, units_required: units(f.prep.req), units_recommended: units(f.prep.rec) } } : {}),
    },
  } as unknown as School;
}

const C7 = { rigor: "very_important", gpa: "very_important", class_rank: "very_important", test_scores: "important" } as const;
const keys = (s: School) => readingLines(s).map((l) => l.key);
const line = (s: School, key: ReadingLine["key"]) => readingLines(s).find((l) => l.key === key);

/* ---- Academic emphasis ---- */

test("emphasis names the highest-rated academic factors together, then the lower ones", () => {
  const s = college({ profile: { factors: C7 } });
  assert.equal(line(s, "emphasis")!.text, "Course rigor, GPA, and class rank are all very important; tests are important.");
  const two = college({ profile: { factors: { rigor: "very_important", gpa: "very_important", test_scores: "important", class_rank: "considered" } } });
  assert.equal(line(two, "emphasis")!.text, "Course rigor and GPA are both very important; tests are important; class rank is considered.");
  assert.equal(line(two, "emphasis")!.short, "Rigor and GPA very important");
  const one = college({ profile: { factors: { gpa: "important" } } });
  assert.equal(line(one, "emphasis")!.text, "GPA is important.");
});

test("emphasis leaves out what the college doesn't consider, and is absent without any rated factor", () => {
  const s = college({ profile: { factors: { rigor: "very_important", gpa: "considered", test_scores: "not_considered", class_rank: "not_considered" } } });
  assert.equal(line(s, "emphasis")!.text, "Course rigor is very important; GPA is considered.");
  assert.equal(line(college({ profile: { factors: { rigor: "not_considered" } } }), "emphasis"), undefined);
  assert.equal(line(college(), "emphasis"), undefined);
});

test("a college with only the federal factors gets the federal sentence", () => {
  const s = college({ factors: { gpa: "required", hs_record: "required", class_rank: "considered", essay: "considered", college_prep: "not_considered" } });
  const l = line(s, "emphasis")!;
  assert.equal(l.text, "GPA and the high school record are required; class rank is considered.");
  assert.deepEqual(l.cites, ["admissions.factors"]);
  // The college's own C7 wins when it has academic rows.
  const both = college({ factors: { gpa: "required" }, profile: { factors: { gpa: "important" } } });
  assert.deepEqual(line(both, "emphasis")!.cites, ["reported.admission_profile.factors.gpa"]);
});

/* ---- GPA crowding ---- */

test("crowding: the share in the top two bands, with the courses clause when rigor is at least important", () => {
  const s = college({ profile: { factors: C7, gpa: gpa() } });
  assert.equal(gpaTopShare(s), 0.88);
  assert.equal(line(s, "crowding")!.text, "88% of first-years had a 3.75 or higher, so a high GPA is common here and rarely sets an applicant apart; the courses behind it carry more of the weight.");
  assert.deepEqual(line(s, "crowding")!.cites, ["derived.gpa_top_share"]);
});

test("crowding with rigor rated low (or unrated) says only that a high GPA is common", () => {
  for (const factors of [{ ...C7, rigor: "considered" }, { ...C7, rigor: "not_considered" }, undefined] as const) {
    const s = college({ profile: { ...(factors ? { factors } : {}), gpa: gpa() } });
    assert.equal(line(s, "crowding")!.text, "88% of first-years had a 3.75 or higher, so a high GPA is common here.");
  }
});

test("crowding adds nothing below the 50% line, and the line sits exactly at it", () => {
  assert.equal(CROWDED_SHARE, 0.5);
  const spread = college({ profile: { factors: C7, gpa: gpa({ bands: { all: bands(0.1, 0.15), with_test: null, without_test: null } }) } });
  assert.equal(line(spread, "crowding")!.text, "25% of first-years had a 3.75 or higher.");
  const edge = college({ profile: { factors: C7, gpa: gpa({ bands: { all: bands(0.3, 0.2), with_test: null, without_test: null } }) } });
  assert.match(line(edge, "crowding")!.text, /^50% of first-years had a 3.75 or higher, so a high GPA is common here/);
});

test("crowding reads 'all', else the students who sent scores, else those who didn't, and says which", () => {
  const withTest = college({ profile: { gpa: gpa({ bands: { all: null, with_test: bands(0.6, 0.2), without_test: bands(0.1, 0.1) } }) } });
  assert.equal(line(withTest, "crowding")!.text, "80% of first-years who sent test scores had a 3.75 or higher, so a high GPA is common here.");
  const without = college({ profile: { gpa: gpa({ bands: { all: null, with_test: null, without_test: bands(0.3, 0.1) } }) } });
  assert.equal(line(without, "crowding")!.text, "40% of first-years who didn't send test scores had a 3.75 or higher.");
  assert.equal(gpaTopShare(college({ profile: { gpa: gpa({ bands: { all: null, with_test: null, without_test: null } }) } })), null);
  assert.equal(line(college({ profile: { gpa: gpa({ bands: { all: null, with_test: null, without_test: null } }) } }), "crowding"), undefined);
  assert.equal(gpaTopShare(college()), null);
});

/* ---- Weighted reporters ---- */

test("a weighted reporter's sentence replaces the crowding sentence", () => {
  const s = college({ profile: { factors: C7, gpa: gpa({ average: 4.17, scale: "weighted", bands: { all: bands(0.9, 0.05), with_test: null, without_test: null } }) } });
  assert.ok(isWeightedReporter(s));
  assert.deepEqual(keys(s).filter((k) => k === "crowding" || k === "weighted"), ["weighted"]);
  assert.equal(line(s, "weighted")!.text, "This college reports weighted GPAs (average 4.17), which pile most students into the top band; the bands can't show how crowded unweighted GPAs are.");
});

test("a weighted reporter is found by an average above 4.0 too, and says less when its bands don't pile up", () => {
  const above = college({ profile: { gpa: gpa({ average: 4.34, scale: "not_stated", bands: { all: bands(0.1, 0.1), with_test: null, without_test: null } }) } });
  assert.ok(isWeightedReporter(above));
  assert.equal(line(above, "weighted")!.text, "This college reports weighted GPAs (average 4.34), so its GPA figures can't show how crowded unweighted GPAs are.");
  assert.equal(isWeightedReporter(college({ profile: { gpa: gpa({ average: 3.95, scale: "unweighted" }) } })), false);
  assert.equal(isWeightedReporter(college()), false);
});

/* ---- Tests ---- */

test("tests: the policy and the shares who sent each test", () => {
  const optional = college({ policy: "considered", sat: 0.24, act: 0.2 });
  assert.equal(line(optional, "tests")!.text, "Scores are optional. 24% of first-years sent an SAT and 20% an ACT. Most first-years were admitted without scores.");
  assert.deepEqual(line(optional, "tests")!.cites, ["admissions.test_policy", "admissions.test_submission_rate_sat", "admissions.test_submission_rate_act"]);
  assert.equal(line(college({ policy: "required", sat: 0.8, act: 0.3 }), "tests")!.text, "Scores are required. 80% of first-years sent an SAT and 30% an ACT.");
  assert.equal(line(college({ policy: "recommended", sat: 0.5 }), "tests")!.text, "Scores are recommended. 50% of first-years sent an SAT.");
  assert.equal(line(college({ act: 0.4 }), "tests")!.text, "40% of first-years sent an ACT.");
});

test("tests: 'most were admitted without scores' needs the two shares to add to under half", () => {
  // 24% + 28% could be 52% of the class (a student may send both), so nothing is claimed.
  assert.equal(line(college({ policy: "considered", sat: 0.24, act: 0.28 }), "tests")!.text, "Scores are optional. 24% of first-years sent an SAT and 28% an ACT.");
  assert.doesNotMatch(line(college({ policy: "considered", sat: 0.49, act: 0.1 }), "tests")!.text, /without scores/);
  assert.doesNotMatch(line(college({ policy: "required", sat: 0.1, act: 0.1 }), "tests")!.text, /without scores/);
  assert.doesNotMatch(line(college({ policy: "considered", sat: 0.1 }), "tests")!.text, /without scores/);
});

test("tests: test-blind says scores aren't read; no data means no line", () => {
  assert.equal(line(college({ policy: "not-considered", sat: 0.01 }), "tests")!.text, "Scores aren't read.");
  assert.equal(line(college({ profile: { factors: { test_scores: "not_considered" } } }), "tests")!.text, "Scores aren't read.");
  assert.equal(line(college(), "tests"), undefined);
});

/* ---- Class rank ---- */

const rank = (submitted: number) => ({ top_tenth: 0.91, top_quarter: 0.99, top_half: 1, bottom_half: 0, bottom_quarter: 0, submitted_share: submitted });

test("class rank: the share in the top tenth among the high schools that rank, only when enough do", () => {
  assert.equal(RANK_MIN_SUBMITTED, 0.15);
  const s = college({ profile: { factors: C7, class_rank: rank(0.2) } });
  assert.equal(line(s, "rank")!.text, "Of the 20% whose high school reported a rank, 91% were in the top tenth.");
  assert.equal(line(college({ profile: { factors: C7, class_rank: rank(0.15) } }), "rank")!.text, "Of the 15% whose high school reported a rank, 91% were in the top tenth.");
  assert.equal(line(college({ profile: { factors: C7, class_rank: rank(0.14) } }), "rank"), undefined);
  const quarter = college({ profile: { factors: C7, class_rank: { ...rank(0.4), top_tenth: null } } });
  assert.match(line(quarter, "rank")!.text, /99% were in the top quarter\.$/);
});

test("class rank: a college that doesn't consider it says so; one without a C7 rating says nothing", () => {
  const none = college({ profile: { factors: { ...C7, class_rank: "not_considered" }, class_rank: rank(0.5) } });
  assert.equal(line(none, "rank")!.text, "Most high schools no longer rank; this college doesn't lean on it.");
  assert.equal(line(college({ profile: { class_rank: rank(0.5) } }), "rank"), undefined, "no C7 rating, no quote");
  assert.equal(line(college({ factors: { class_rank: "not_considered" } }), "rank"), undefined, "the federal yes/no doesn't stand in");
  assert.equal(line(college(), "rank"), undefined);
});

/* ---- Courses expected ---- */

test("courses: the two subjects recommended furthest above what's required", () => {
  const s = college({ prep: { req: { english: 4, math: 3, science: 3 }, rec: { english: 4, math: 4, science: 4 } } });
  const l = line(s, "courses")!;
  assert.equal(l.text, "Recommends 4 years of math and science (3 of each required).");
  assert.equal(l.href, "#hs-prep");
  assert.deepEqual(l.cites, ["reported.admissions_hs_prep.units_recommended", "reported.admissions_hs_prep.units_required"]);
  const uneven = college({ prep: { req: { math: 3, science: 2 }, rec: { math: 4, science: 3 } } });
  assert.equal(line(uneven, "courses")!.text, "Recommends 4 years of math and 3 of science (3 and 2 required).");
  const norequired = college({ prep: { rec: { math: 4, science: 4 } } });
  assert.equal(line(norequired, "courses")!.text, "Recommends 4 years of math and science.");
});

test("courses: with no gap, the four core subjects at the years recommended, else required", () => {
  const same = college({ prep: { req: { english: 4, math: 3, science: 3 }, rec: { english: 4, math: 3, science: 3 } } });
  assert.equal(line(same, "courses")!.text, "Recommends 4 years of English, 3 of math, and 3 of science.");
  const s = college({ prep: { req: { english: 4, math: 3, science: 3, social_studies: 1 }, rec: null } });
  assert.equal(line(s, "courses")!.text, "Requires 4 years of English, 3 of math, 3 of science, and 1 of social studies.");
  assert.equal(line(college({ prep: { req: { math: 3 }, rec: null } }), "courses"), undefined, "one subject isn't a pattern");
  assert.equal(line(college({ prep: { req: null, rec: null } }), "courses"), undefined);
  assert.equal(line(college(), "courses"), undefined);
});

/* ---- Major ---- */

const unit = (over: Partial<CuratedMajorUnit> & Pick<CuratedMajorUnit, "unit_id" | "unit">): CuratedMajorUnit => ({
  name: "Unit",
  cip_families: [],
  direct_admit: null,
  admit_rate: null,
  verified_via: "page",
  review: {
    major_considered: null,
    emphasis: [],
    required_courses: [],
    gate: null,
    quote: "quoted",
    source_url: "https://example.edu/a",
    fetched: "2026-10-11",
    edition: null,
  },
  ...over,
});
const review = (over: Partial<NonNullable<CuratedMajorUnit["review"]>>): CuratedMajorUnit["review"] => ({ ...unit({ unit_id: "1", unit: "school" }).review!, ...over });

test("major: hidden without a quoted statement", () => {
  assert.equal(majorLine(college(), { statement: null, units: [] }), null);
  // A school whose review quotes nothing about the major (required courses only) says nothing.
  const quiet = unit({ unit_id: "999001:engineering", unit: "school", cip_families: ["14"] });
  assert.equal(majorLine(college(), { statement: null, units: [quiet] }), null);
  assert.equal(majorLine(college({ id: "no-such-college" })), null, "the real file has no statement for it");
});

test("major: 'doesn't affect admission' only when the college says so", () => {
  const statement = unit({ unit_id: "999001", unit: "university", review: review({ major_considered: "no" }) });
  const l = majorLine(college(), { statement, units: [] })!;
  assert.equal(l.text, "The major you list doesn't affect admission.");
  assert.deepEqual(l.unitCites, [{ path: "reported.major_admission.review.major_considered", unitId: "999001" }]);
});

test("major: applicants compared within the college, with the extra look at math and science grades", () => {
  const eng = unit({ unit_id: "999001:engineering", unit: "school", name: "College of Engineering", cip_families: ["14"], review: review({ major_considered: "pool_and_emphasis", emphasis: ["math", "science"] }) });
  const arts = unit({ unit_id: "999001:arts", unit: "school", name: "College of Arts", cip_families: ["23"], review: review({ major_considered: "pool" }) });
  const l = majorLine(college(), { statement: null, units: [eng, arts] })!;
  assert.equal(l.text, "Applicants are compared within the college they apply to; engineering applicants get an extra look at math and science grades.");
  assert.deepEqual(l.unitCites?.map((c) => c.unitId), ["999001:engineering", "999001:engineering"]);
  const byMajor = unit({ unit_id: "999001:cs", unit: "major", name: "Computer Science", cip_families: ["11"], review: review({ major_considered: "pool" }) });
  assert.match(majorLine(college(), { statement: null, units: [byMajor] })!.text, /^Applicants are compared within the college or major they apply to\.$/);
  // A unit with a review that doesn't speak to the major adds nothing.
  assert.equal(majorLine(college(), { statement: null, units: [unit({ unit_id: "999001:x", unit: "school", cip_families: ["14"] })] }), null);
});

test("the curated file's Major lines are all quoted statements about the major", () => {
  const byId = new Map(allMajorUnits().map((u) => [u.unit_id, u]));
  for (const u of allMajorUnits()) {
    const colleges = u.unit_id.split(":")[0];
    const l = majorLine({ unit_id: colleges });
    // Every unit the line cites must carry a quoted review (a unit with only a published rate adds nothing to it).
    for (const c of l?.unitCites ?? []) assert.ok(byId.get(c.unitId)?.review?.quote, `${c.unitId}: a Major line needs a quoted review`);
  }
  const src: MajorSource = curatedMajorSource("190415");
  assert.ok(src.units.every((u) => u.unit !== "university"));
});

test("the block carries the Major line between rank and courses", () => {
  const s = college({ profile: { factors: C7, class_rank: rank(0.5) }, prep: { rec: { math: 4, science: 4 } } });
  const statement = unit({ unit_id: "999001", unit: "university", review: review({ major_considered: "no" }) });
  const block = readingTheRecord(s, { major: majorLine(s, { statement, units: [] }) })!;
  assert.deepEqual(block.lines.map((l) => l.key), ["emphasis", "rank", "major", "courses"]);
  assert.deepEqual(readingWithMajor(s)!.lines.map((l) => l.key), ["emphasis", "rank", "courses"], "the curated file has nothing for this college");
});

/* ---- The block ---- */

test("the block is hidden below two lines, and its title and fields come from the lines shown", () => {
  assert.equal(readingTheRecord(college()), null);
  assert.equal(readingTheRecord(college({ policy: "required" })), null, "tests alone");
  assert.equal(readingTheRecord(college({ factors: { gpa: "required" } })), null, "emphasis alone");
  const two = readingTheRecord(college({ factors: { gpa: "required" }, policy: "required" }), { name: "Test" })!;
  assert.equal(two.title, "How Test reads a record");
  assert.deepEqual(two.lines.map((l) => l.key), ["emphasis", "tests"]);
  assert.deepEqual(two.fields, ["admissions.factors", "admissions.test_policy"]);
  const full = readingTheRecord(college({ profile: { factors: C7, gpa: gpa(), class_rank: rank(0.2) }, policy: "considered", sat: 0.2, act: 0.2, prep: { rec: { math: 4, science: 4 } } }))!;
  assert.deepEqual(full.lines.map((l) => l.key), ["emphasis", "crowding", "tests", "rank", "courses"]);
  assert.equal(new Set(full.fields).size, full.fields.length);
  assert.equal(readingTheRecord(college({ factors: { gpa: "required" }, policy: "required" }))!.title, "How Test University reads a record");
});

test("every line's text is its parts joined, and no line prints a hole", () => {
  const s = college({ profile: { factors: C7, gpa: gpa(), class_rank: rank(0.2) }, policy: "considered", sat: 0.2, act: 0.2, prep: { req: { math: 3 }, rec: { math: 4, science: 4 } } });
  for (const l of readingLines(s)) {
    assert.equal(l.text, l.parts.map((p) => p.text).join(""));
    assert.doesNotMatch(l.text, /NaN|undefined|null|\bnull\b/);
    assert.ok(l.cites.length > 0, `${l.key} cites a field`);
  }
});

/* ---- Compare row ---- */

test("the Compare row: the short emphasis and the share, a note for a weighted reporter", () => {
  const vanderbilt = college({ profile: { factors: C7, gpa: gpa() } });
  assert.deepEqual(readingSummary(vanderbilt), { emphasis: "Rigor, GPA, and rank very important", topShare: 0.88, weighted: false });
  assert.equal(READING_ROW.get(vanderbilt), "Rigor, GPA, and rank very important");
  assert.equal(READING_ROW.value!(vanderbilt), "88%");
  const weighted = college({ profile: { factors: C7, gpa: gpa({ average: 4.17, scale: "weighted" }) } });
  assert.equal(READING_ROW.value!(weighted), null);
  assert.equal(READING_ROW.note!(weighted), "weighted GPAs");
  const federal = college({ factors: { gpa: "required" } });
  assert.equal(READING_ROW.get(federal), "GPA required");
  assert.equal(READING_ROW.value!(federal), null);
  assert.equal(READING_ROW.get(college()), null);
  const sharesOnly = college({ profile: { gpa: gpa() } });
  assert.equal(READING_ROW.get(sharesOnly), "Emphasis not reported");
});

test("the Compare card for Getting in shows the row only when a college has it, and cites its fields", () => {
  const has = college({ profile: { factors: C7, gpa: gpa() } });
  const rate = (s: School, r: number) => ({ ...s, admissions: { ...s.admissions, acceptance_rate: r } }) as School;
  assert.ok(cardRows("admissions", [rate(has, 0.05), rate(college(), 0.5)]).includes(READING_ROW));
  assert.ok(!cardRows("admissions", [rate(college(), 0.05), rate(college(), 0.5)]).includes(READING_ROW));
  for (const f of [READING_ROW.field, "reported.admission_profile.factors.rigor", "admissions.factors"] as const) assert.ok(cardFields().includes(f), `${f} is cited on the overview`);
});

/* ---- Lineage ---- */

test("derived.gpa_top_share is registered with its band inputs, and the page's section lists what the block cites", () => {
  const def = FIELDS["derived.gpa_top_share"] as (typeof FIELDS)[keyof typeof FIELDS] & { derived: { formula: string; inputs: string[] } };
  assert.ok(def.derived.formula.length > 0);
  assert.deepEqual(def.derived.inputs, ["reported.admission_profile.gpa.bands.all", "reported.admission_profile.gpa.bands.with_test", "reported.admission_profile.gpa.bands.without_test"]);
  for (const i of def.derived.inputs) assert.ok(i in FIELDS, `${i} is registered`);
  const full = college({
    profile: { factors: C7, gpa: gpa({ average: 4.1, scale: "weighted" }), class_rank: rank(0.2) },
    factors: { gpa: "required" },
    policy: "considered",
    sat: 0.2,
    act: 0.2,
    prep: { rec: { math: 4, science: 4 } },
  });
  const statement = unit({ unit_id: "999001", unit: "university", review: review({ major_considered: "no" }) });
  const sections = new Set<string>(TOPIC_FIELDS.admissions);
  for (const s of [full, college({ profile: { factors: C7, gpa: gpa(), class_rank: { ...rank(0.2), top_tenth: null } } }), college({ factors: { gpa: "required" } })]) {
    for (const l of readingLines(s, majorLine(s, { statement, units: [] }))) {
      for (const c of l.cites) {
        assert.ok(c in FIELDS, `${l.key} cites ${c}, which isn't registered`);
        assert.ok(sections.has(c), `${c} is cited by the block but missing from TOPIC_FIELDS.admissions`);
      }
    }
  }
});

test("every college in the dataset reads without holes, and every cite is a registered field", () => {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "schools.json"), "utf8"));
  const schools: School[] = Array.isArray(raw) ? raw : raw.schools;
  let shown = 0;
  for (const s of schools) {
    const block = readingWithMajor(s);
    if (block) shown++;
    for (const l of readingLines(s)) {
      assert.doesNotMatch(l.text, /NaN|undefined|\bnull\b/, `${s.unit_id} ${l.key}: ${l.text}`);
      for (const c of l.cites) assert.ok(c in FIELDS, `${s.unit_id} ${l.key} cites ${c}`);
    }
    const top = gpaTopShare(s);
    if (top !== null) assert.ok(top >= 0 && top <= 1, `${s.unit_id}: top share ${top}`);
  }
  assert.ok(shown > 0, "some colleges read");
});

/* ---- Client safety and the proprietary rule ---- */

/** Imports of a source file, comments removed. */
const importsOf = (src: string) => [...src.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^\s*import\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);
/** Modules the reading must never reach: the server-only estimate and its constants. */
const SERVER_ONLY = /server-only|\/(model|estimate|rigor-rules|rigor|baseline)(\.ts)?$/;

test("the reading stays client-safe: no server-only or estimate-method imports", () => {
  for (const f of ["reading.ts", "reading-major.ts"]) {
    const src = readFileSync(join(import.meta.dirname, "..", "lib", "chances", f), "utf8");
    assert.deepEqual(importsOf(src).filter((i) => SERVER_ONLY.test(i)), [], `${f} reaches server-only code`);
  }
  // The guard itself catches a bad import (proving the rule can fail).
  assert.deepEqual(importsOf(`import "server-only";\nimport { x } from "./model.ts";\nimport { y } from "./notes.ts";`).filter((i) => SERVER_ONLY.test(i)), ["server-only", "./model.ts"]);
});

test("reading.ts keeps the curated major file out (Compare imports it)", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "lib", "chances", "reading.ts"), "utf8");
  assert.deepEqual(importsOf(src).filter((i) => /major-admission|majors/.test(i)), []);
  assert.deepEqual(importsOf(`import { a } from "./major-admission.ts";`).filter((i) => /major-admission|majors/.test(i)), ["./major-admission.ts"]);
});
