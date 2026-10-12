/**
 * Quad's estimate, the method's third version (lib/chances/model.ts; specs/chances/method/standing.md, levels.md):
 * the pinned examples, the within-one-level check against the second version on complete records, Revision 1's rules
 * (the test as a consistency check, Reach at Ultra selective only on consistent excellence, completeness), the caps
 * from the selectivity tier and the floors from the college's own statements, the move-up across five levels, the ED
 * verdict, `closeness`, the depth and list-row inputs gated by C7, the readings carried over from the second version
 * (score, GPA, crowding, rigor, rank, the major's subjects), the snapshot detail, and guards that the hidden odds, the
 * multipliers, and the cutoffs never reach a result, a sentence, an API response, a client bundle, telemetry, or an
 * export. The colleges are real records with their figures fixed (the method's numbers), so the examples stay pinned
 * as the data moves. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as nodeModule from "node:module";
import type { ReportedResidencyAdmissions, School } from "../lib/types";

// model.ts, hooks.ts, and rigor.ts start with `import "server-only"`, which only Next.js resolves; stand in an empty module.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    return next(specifier, context);
  },
});

const { modelEstimate, modelEstimateWithDetail, stageOneReadings, MODEL_VERSION, RIGOR_CAN_LOWER, rankShareAtOrAbove, STANDING_V2, ODDS_V3, academicMultiplier, shareBelowGpa } = await import("../lib/chances/model.ts");
const { baselineEstimate } = await import("../lib/chances/baseline.ts");
const { noteText, isNoteKey, NOTES } = await import("../lib/chances/notes.ts");
const { isFieldPath } = await import("../lib/fields.ts");
const { publicResult, RESULT_FIELDS } = await import("../lib/chances/estimate-request.ts");
const { compareShortLine } = await import("../lib/chances/what-went-in.ts");
const { STANDING_LEVELS } = await import("../lib/chances/levels.ts");
type ModelInput = import("../lib/chances/model.ts").ModelInput;
type StandingSchool = import("../lib/chances/baseline.ts").StandingSchool;
type EstimateStudent = import("../lib/chances/types.ts").EstimateStudent;
type EstimateResult = import("../lib/chances/types.ts").EstimateResult;
type CourseEntry = import("../lib/chances/types.ts").CourseEntry;
type ActivityEntry = import("../lib/chances/types.ts").ActivityEntry;
type CollegeHooks = import("../lib/chances/types.ts").CollegeHooks;
type SchoolOffering = import("../lib/chances/types.ts").SchoolOffering;
type StandingLevel = import("../lib/chances/types.ts").StandingLevel;
type SelectivityTier = import("../lib/chances/types.ts").SelectivityTier;
type CollegeGpa = import("../lib/planner/gpa-model.ts").CollegeGpa;

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const schools = JSON.parse(read("data", "schools.json")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const RANK = (l: StandingLevel | null) => (l === null ? null : STANDING_LEVELS.indexOf(l));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function student(o: Partial<EstimateStudent> = {}): EstimateStudent {
  const gpa = o.gpa ?? null;
  return {
    gpa,
    gpaScale: "4.0",
    gpaRange: gpa !== null ? [gpa, gpa] : null,
    test: null,
    satMath: null,
    actMath: null,
    classRankPercentile: null,
    courses: [],
    state: null,
    majors: [],
    round: null,
    highSchoolId: null,
    ...o,
  };
}
const sat = (score: number) => ({ kind: "sat" as const, score });

const counts = (applicants: number, admitted: number) => ({ applicants, admitted, enrolled: Math.round(admitted / 3) });
function grid(inState: [number, number], outState: [number, number]): ReportedResidencyAdmissions {
  return {
    entering_term: "Fall 2025",
    year: 2025,
    edition: "2025-26",
    in_state: counts(...inState),
    out_of_state: counts(...outState),
    international: counts(1000, 200),
    unknown: counts(0, 0),
    total: counts(inState[0] + outState[0] + 1000, inState[1] + outState[1] + 200),
  } as ReportedResidencyAdmissions;
}

/** C11 bands with `top` at 4.0 and `next` at 3.75–3.99; the rest spread down. */
const bands = (top: number, next: number): [number, number, number, number, number, number, number, number, number] => {
  const rest = Math.max(0, 1 - top - next);
  return [top, next, rest * 0.5, rest * 0.3, rest * 0.2, 0, 0, 0, 0];
};
const exactMiddle = (p25: number, p75: number) => ({ p25: [p25, p25] as [number, number], p75: [p75, p75] as [number, number], shown: [p25, p75] as [number, number], kind: "bands" as const });
const reportedGpa = (avg: number): CollegeGpa => ({ kind: "reported", range: [avg, avg], point: avg, weighted: null, n: null });
const middleGpa = (p25: number, p75: number): CollegeGpa => ({ ...reportedGpa((p25 + p75) / 2), kind: "bands", middle: exactMiddle(p25, p75) });

interface CollegeOpts {
  rate: number | null;
  sat?: [number, number] | null;
  act?: [number, number] | null;
  policy?: School["admissions"]["test_policy"];
  gpa?: CollegeGpa | null;
  /** C7 ratings; `null` removes C7 entirely. */
  c7?: Record<string, string> | null;
  federal?: Record<string, string> | null;
  classRank?: { top_tenth: number | null; top_quarter: number | null; top_half: number | null; submitted_share: number } | null;
  topShare?: [number, number] | null;
  residency?: ReportedResidencyAdmissions | null;
  satMath?: [number, number] | null;
  /** The selectivity tier (one tier, or per pool); absent: not rated. */
  tier?: SelectivityTier | { tier: SelectivityTier | null; in_state?: SelectivityTier; out_of_state?: SelectivityTier } | null;
  /** C21 early-decision counts; absent: none on record. */
  ed?: { applicants: number; admitted: number } | null;
}

/** A real college's identity with every figure the model reads fixed. */
function college(id: string, o: CollegeOpts): { school: School; standing: StandingSchool } {
  const s = clone(byId.get(id)!);
  s.admissions = { ...s.admissions, acceptance_rate: o.rate, test_policy: o.policy ?? "required", factors: (o.federal ?? null) as School["admissions"]["factors"], sat_math_25_75: o.satMath ?? null } as School["admissions"];
  const profile = clone(s.reported?.admission_profile ?? {}) as NonNullable<NonNullable<School["reported"]>["admission_profile"]>;
  if (o.c7 === null || o.c7 === undefined) delete profile.factors;
  else profile.factors = o.c7 as typeof profile.factors;
  if (o.classRank) profile.class_rank = { ...o.classRank, bottom_half: null, bottom_quarter: null };
  else delete profile.class_rank;
  if (o.topShare) profile.gpa = { average: null, scale: "not_stated", submitted_share: null, bands: { all: bands(...o.topShare), with_test: null, without_test: null } };
  else delete profile.gpa;
  if (o.ed) profile.early_decision = { offered: true, applicants: o.ed.applicants, admitted: o.ed.admitted };
  else delete profile.early_decision;
  s.reported = { ...(s.reported ?? {}), admission_profile: profile, admissions_by_residency: o.residency ?? undefined } as School["reported"];
  s.lineage = { ...(s.lineage ?? {}), "admissions.acceptance_rate": { source: "ipeds-adm", year: "Fall 2025" } } as School["lineage"];
  if (o.tier === undefined || o.tier === null) delete s.selectivity;
  else s.selectivity = typeof o.tier === "string" ? { tier: o.tier, year: "Fall 2025" } : { ...o.tier, year: "Fall 2025" };
  const standing: StandingSchool = { admitRate: o.rate, sat: o.sat ?? null, act: o.act ?? null, gpaAverage: null, gpa: o.gpa ?? null, testPolicy: o.policy ?? "required" };
  return { school: s, standing };
}

const OFFERING = (apCount: number): SchoolOffering => ({ apCount, apKeys: null, ib: null, dual: null, source: "profile", field: "detail.ap_courses" });
let courseId = 0;
function ap(key: string, subject: CourseEntry["subject"], final: CourseEntry["grades"]["final"] = "A", year: CourseEntry["year"] = 11, kind: CourseEntry["kind"] = "ap"): CourseEntry {
  return { id: `c${++courseId}`, kind, key: kind === "ap" ? key : null, name: kind === "ap" ? null : key, subject, year, status: "taken", grades: { s1: null, s2: null, final }, exam: null };
}
const EIGHT_APS = [
  ap("ap_english_language", "english"),
  ap("ap_calculus_ab", "math"),
  ap("ap_biology", "science"),
  ap("ap_us_history", "history"),
  ap("ap_english_literature", "english"),
  ap("ap_calculus_bc", "math"),
  ap("ap_chemistry", "science"),
  ap("ap_us_government", "history"),
];
const TWO_APS = [ap("ap_english_language", "english"), ap("ap_us_history", "history")];
/**
 * Revision 2: nine APs over three years, an advanced course every year from 10th grade on, science rising to a deep
 * track (10th biology, 11th chemistry, 12th physics).
 */
const THREADED_APS = [
  ap("ap_world_history_modern", "history", "A", 10),
  ap("ap_biology", "science", "A", 10),
  ap("ap_english_language", "english", "A", 11),
  ap("ap_calculus_ab", "math", "A", 11),
  ap("ap_chemistry", "science", "A", 11),
  ap("ap_us_history", "history", "A", 11),
  ap("ap_english_literature", "english", "A", 12),
  ap("ap_calculus_bc", "math", "A", 12),
  ap("ap_physics_c_mechanics", "science", "A", 12),
];

let actId = 0;
function activity(name: string, kind: ActivityEntry["kind"], years: ActivityEntry["years"], o: Partial<ActivityEntry> = {}): ActivityEntry {
  return { id: `a${++actId}`, name, kind, years, roles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false, ...o };
}
/** Focused (depth.md): soccer four years, captain senior year; robotics three years. */
const FOCUSED = [activity("Soccer", "sport", [9, 10, 11, 12], { roles: { 12: "leader" } }), activity("Robotics", "club", [10, 11, 12], { roles: { 12: "officer" } })];
const SAMPLING = [activity("Chess", "club", [9]), activity("Drama", "arts", [10])];
/** Building (depth.md): one activity carried three years. */
const BUILDING = [activity("Band", "arts", [10, 11, 12])];
/** Focused, with a theme: soccer four years (captain), and Science Olympiad three years in the science family. */
const THEMED = [activity("Soccer", "sport", [9, 10, 11, 12], { roles: { 12: "leader" }, family: "athletics" }), activity("Science Olympiad", "club", [10, 11, 12], { roles: { 12: "officer" }, family: "science" })];
/**
 * A GPA for a college with no GPA figures: it counts as entered (completeness) but can't be placed, so a mechanism
 * test reads the test alone with nothing missing.
 */
const UNPLACED_GPA = 3.9;

function run(c: { school: School; standing: StandingSchool }, s: EstimateStudent, extra: Partial<ModelInput> = {}) {
  return modelEstimate({ student: s, school: c.school, standing: c.standing, offering: null, ...extra });
}
function detailed(c: { school: School; standing: StandingSchool }, s: EstimateStudent, extra: Partial<ModelInput> = {}) {
  return modelEstimateWithDetail({ student: s, school: c.school, standing: c.standing, offering: null, ...extra });
}
const keys = (r: { notes: { key: string }[] }) => r.notes.map((n) => n.key);
const texts = (r: { notes: { key: string; values: Record<string, string | number> }[] }) => r.notes.map((n) => noteText(n));
const hooks = (o: Partial<CollegeHooks>): CollegeHooks => ({ legacy: false, recruited: "none", interest: false, ...o });
const near = (a: number | null | undefined, b: number, eps = 0.01) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

/* The pinned colleges (method/standing.md "Pinned examples"). */
const C7_ALL = { gpa: "very_important", rigor: "very_important", class_rank: "considered", test_scores: "important" };
const HARVARD = () =>
  college("166027", { rate: 0.035, sat: [1500, 1580], gpa: middleGpa(3.9, 4.0), c7: { gpa: "very_important", rigor: "very_important", test_scores: "very_important" }, topShare: [0.48, 0.3], tier: "elite" });
const PURDUE = () =>
  college("243780", {
    rate: 0.43,
    sat: [1220, 1470],
    gpa: middleGpa(3.6, 4.0),
    c7: C7_ALL,
    residency: grid([10000, 7100], [10000, 4400]),
    tier: { tier: "highly_selective", in_state: "selective", out_of_state: "highly_selective" },
  });
const GEORGIA_TECH = () =>
  college("139755", {
    rate: 0.13,
    sat: [1370, 1530],
    gpa: { kind: "estimated", range: [3.8, 4.0], point: 3.9, weighted: 4.17, n: 114 },
    c7: C7_ALL,
    classRank: { top_tenth: 0.89, top_quarter: 0.98, top_half: 0.99, submitted_share: 0.4 },
    residency: grid([10000, 2900], [10000, 1000]),
    tier: { tier: "highly_selective", in_state: "highly_selective", out_of_state: "elite" },
  });
const FIFTEEN = () => college("168148", { rate: 0.15, sat: [1400, 1520], gpa: middleGpa(3.76, 3.96), c7: null, tier: "highly_selective" });
const ELON = (rate = 0.63) =>
  college("198516", {
    rate,
    sat: [1170, 1350],
    policy: "considered",
    gpa: middleGpa(3.62, 4.0),
    c7: { gpa: "very_important", rigor: "very_important", class_rank: "considered", test_scores: "not_considered", extracurriculars: "important" },
    classRank: { top_tenth: 0.2, top_quarter: 0.48, top_half: 0.81, submitted_share: 0.35 },
    topShare: [0.59, 0.11],
    tier: "selective",
  });
const UT_AUSTIN = () => college("228778", { rate: 0.27, sat: [1230, 1500], policy: "considered", gpa: null, c7: null, federal: { gpa: "considered", hs_record: "required" }, tier: "highly_selective" });
/** A 12% college rating alumni relation `considered`, in Massachusetts (no ban) or Maryland (a ban at every college). */
const LEGACY_MA = () => college("168148", { rate: 0.12, sat: [1360, 1460], gpa: null, c7: { alumni_relation: "considered", test_scores: "important" }, tier: "highly_selective" });
const LEGACY_MD = () => college("162928", { rate: 0.12, sat: [1360, 1460], gpa: null, c7: { alumni_relation: "considered", test_scores: "important" }, tier: "highly_selective" });
const ELITE_6 = () => college("162928", { rate: 0.06, sat: [1270, 1370], gpa: null, c7: null, tier: "elite" });

/* ------------------------------------------------------------------ */
/* method/standing.md's pinned examples                                */
/* ------------------------------------------------------------------ */

test("version: the third version's model version (Revision 1), and the constants the method names", () => {
  assert.equal(MODEL_VERSION, "20261012.5");
  assert.deepEqual([ODDS_V3.testPull, ODDS_V3.testDown, ODDS_V3.testUp, ODDS_V3.gapPrior], [0.25, 0.3, 0.2, -0.5]);
  assert.deepEqual(ODDS_V3.expectWeights, { gpa: 3, courses: 2, class_rank: 1, test: 1, activities: 1 });
  assert.deepEqual(ODDS_V3.acad.map(([d]) => d), [-1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]);
  assert.deepEqual(ODDS_V3.acad.map(([, m]) => m), [0.08, 0.15, 0.4, 0.75, 1.1, 1.6, 2.2, 2.5]);
  near(academicMultiplier(-3), 0.08, 1e-9);
  near(academicMultiplier(3), 2.5, 1e-9);
  near(academicMultiplier(0.81), 1.41);
  near(academicMultiplier(1.75), 2.35);
  assert.deepEqual(ODDS_V3.cutoffs, { reach: 0.05, target: 0.25, likely: 0.55, safe: 0.8 });
  // GPA from bands: a 4.0 where 48% had a 4.0 sits above 76% of first-years (the method's example).
  near(shareBelowGpa(bands(0.48, 0.3), 4.0), 0.76, 1e-9);
});

test("pinned: SAT 1560, GPA 4.0, rigor most at a Harvard-like Ultra selective college (3.5%), no class standing or activities: High reach, and the gaps are named", () => {
  const r = run(HARVARD(), student({ test: sat(1560), gpa: 4.0, courses: EIGHT_APS }), { offering: OFFERING(9), linked: true });
  // Revision 1: Reach at Ultra selective needs every signal; class standing and activities aren't entered.
  assert.equal(r.group, "high_reach");
  assert.equal(r.label, "elite");
  assert.equal(keys(r)[0], "estimate.elite");
  assert.equal(r.closeness, null, "the odds don't set an Elite level");
  assert.ok(r.missing.includes("class_rank") && r.missing.includes("activities"));
  assert.ok(texts(r).includes("Not in this estimate yet: your class standing and activities. Adding what you have gives a fuller picture and could change where this college stands for you."));
  assert.ok(keys(r).includes("estimate.missing_input"), "one prompt at an Ultra selective college too, now that inputs can move it");
  // With them (top 5%, Focused with a theme, an advanced course every year): Reach, and nothing moves it beyond. Top
  // 10% isn't enough (owner, 2026-10-12).
  const withStanding = (pct: number, pick: "top5" | "top10") => run(HARVARD(), student({ test: sat(1560), gpa: 4.0, courses: THREADED_APS, classRankPercentile: pct, classStanding: pick, activities: THEMED }), { offering: OFFERING(9), linked: true });
  assert.equal(withStanding(10, "top10").group, "high_reach");
  const full = withStanding(5, "top5");
  assert.equal(full.group, "reach");
  // Revision 2 moved this row: the same top-5%, Focused record with all eight APs in one year and no theme is a High
  // reach now (no depth across courses and activities, no advanced course before 11th grade).
  const r1Full = run(HARVARD(), student({ test: sat(1560), gpa: 4.0, courses: EIGHT_APS, classRankPercentile: 5, classStanding: "top5", activities: FOCUSED }), { offering: OFFERING(9), linked: true });
  assert.equal(r1Full.group, "high_reach");
  assert.equal(full.moveUp, null, "nothing moves an Elite college beyond Reach");
  assert.ok(!keys(full).includes("estimate.incomplete"));
});

test("pinned: SAT 1100, GPA 2.6 at the same college: High reach, still Elite", () => {
  const r = run(HARVARD(), student({ test: sat(1100), gpa: 2.6 }));
  assert.equal(r.group, "high_reach");
  assert.equal(r.label, "elite");
});

test("pinned: a Georgia resident with only an SAT 1500 at Georgia Tech (29% in-state, Highly selective in-state): Reach", () => {
  const { result: r, detail } = detailed(GEORGIA_TECH(), student({ state: "GA", test: sat(1500) }));
  // Revision 1: a score alone is mostly gap (GPA, courses, class standing missing): Target → Reach.
  assert.equal(r.group, "reach");
  assert.equal(r.label, null);
  near(detail.hiddenOdds, 0.154);
  assert.equal(detail.selectivityTier, "highly_selective");
  assert.equal(r.closeness, 2, "15% sits in the third quarter of Reach's band");
  assert.ok(["gpa", "courses", "class_rank"].every((k) => r.missing.includes(k as never)));
  assert.ok(keys(r).includes("estimate.missing_input") && texts(r).includes("Adding your GPA could change this estimate."));
});

test("pinned: the same student from Florida (10% out-of-state, Ultra selective out of state): High reach, Elite: a reach for everyone", () => {
  const r = run(GEORGIA_TECH(), student({ state: "FL", test: sat(1500) }));
  assert.equal(r.group, "high_reach", "Revision 1: the record doesn't show every signal");
  assert.equal(r.label, "elite");
  assert.ok(r.facts.includes("selectivity.out_of_state"), "the out-of-state tier is cited");
});

test("pinned: SAT 1500 and GPA 3.7 at a 15% Highly selective college: one weak measure keeps it a Reach", () => {
  const { result: r, detail } = detailed(FIFTEEN(), student({ test: sat(1500), gpa: 3.7 }));
  assert.equal(r.group, "reach");
  // The GPA (−0.3) is the core; the test (0.83) pulls it up by at most testUp.
  near(detail.hiddenOdds, 0.102);
  assert.equal(detail.position, "below");
});

test("pinned: SAT 1100, GPA 2.6 at the 15% college: High reach", () => {
  const { result: r, detail } = detailed(FIFTEEN(), student({ test: sat(1100), gpa: 2.6 }));
  assert.equal(r.group, "high_reach");
  near(detail.hiddenOdds, 0.012, 0.001);
});

test("pinned: Indiana, SAT 1300, GPA 3.85 at Purdue (71% in-state): Likely", () => {
  const r = run(PURDUE(), student({ state: "IN", test: sat(1300), gpa: 3.85 }));
  assert.equal(r.group, "likely");
  assert.equal(r.label, null);
  assert.ok(r.used.includes("state") && r.used.includes("test") && r.used.includes("gpa"));
  const t = texts(r);
  assert.equal(t[0], "Your academics: in the middle of admitted students.");
  assert.equal(t[1], "Applicants like you — from Indiana — were admitted at 71% (Fall 2025).");
});

test("pinned: the same numbers from Ohio (44% out-of-state): Target", () => {
  const r = run(PURDUE(), student({ state: "OH", test: sat(1300), gpa: 3.85 }));
  assert.equal(r.group, "target");
  assert.equal(texts(r)[1], "Applicants like you — from outside Indiana — were admitted at 44% (Fall 2025).");
});

test("pinned: only an SAT 1450 at a 45% college (SAT 1280–1450): Target (no GPA; with one it can be Likely)", () => {
  const c = () => college("100654", { rate: 0.45, sat: [1280, 1450], c7: null, tier: "selective" });
  const r = run(c(), student({ test: sat(1450) }));
  assert.equal(r.group, "target", "Revision 1: the GPA the college weighs is missing");
  assert.equal(run(c(), student({ test: sat(1450), gpa: UNPLACED_GPA })).group, "likely", "the same score with a GPA entered");
});

test("pinned: ACT 24 at a 40% college (ACT 28–33, test required): Reach", () => {
  const { result: r, detail } = detailed(college("100654", { rate: 0.4, act: [28, 33], c7: null }), student({ test: { kind: "act", score: 24 } }));
  assert.equal(r.group, "reach");
  // A score below the range and nothing else: the gaps don't lift it (a gap never raises a record below the prior).
  near(detail.hiddenOdds, 0.1);
});

test("pinned: only an SAT 1450 at a 78% Accessible college (SAT 1100–1300): Likely (Safe with a GPA entered)", () => {
  const c = () => college("100654", { rate: 0.78, sat: [1100, 1300], c7: null, tier: "accessible" });
  const { result: r, detail } = detailed(c(), student({ test: sat(1450) }));
  assert.equal(r.group, "likely", "Revision 1: a score alone is mostly gap");
  near(detail.hiddenOdds, 0.619);
  assert.equal(run(c(), student({ test: sat(1450), gpa: UNPLACED_GPA })).group, "safe");
});

test("pinned: no test, GPA 3.9 at a 35% college averaging 3.7: Likely", () => {
  const r = run(college("100654", { rate: 0.35, gpa: reportedGpa(3.7), c7: null, policy: "considered" }), student({ gpa: 3.9 }));
  assert.equal(r.group, "likely");
});

test("pinned: SAT 1200, GPA 3.8 at a test-optional 45% college (SAT 1280–1450, average 3.75), score withheld: Target", () => {
  const r = run(college("100654", { rate: 0.45, sat: [1280, 1450], gpa: reportedGpa(3.75), c7: null, policy: "considered" }), student({ test: sat(1200), gpa: 3.8 }));
  assert.equal(r.group, "target");
  assert.equal(r.send, "consider-not-sending");
});

test("pinned: GPA 3.90, 8 of 9 APs, Focused activities at Elon (63%, Selective): Safe", () => {
  const { result: r, detail } = detailed(ELON(), student({ gpa: 3.9, courses: EIGHT_APS, activities: FOCUSED }), { offering: OFFERING(9), linked: true });
  assert.equal(r.group, "safe");
  near(detail.hiddenOdds, 0.97, 1e-9);
  assert.ok(keys(r).includes("estimate.gpa_meets_bar") && keys(r).includes("rigor.most") && keys(r).includes("depth.activities.focused"));
  assert.ok(r.used.includes("courses") && r.used.includes("activities"));
});

test("pinned: GPA 3.90, no courses, no activities at Elon: Target (was Likely)", () => {
  const r = run(ELON(), student({ gpa: 3.9 }));
  assert.equal(r.group, "target", "Revision 1: courses, class standing, and activities missing");
  assert.ok(r.missing.includes("courses"));
  assert.ok(r.missing.includes("class_rank"), "Elon rates class rank considered");
  assert.ok(r.missing.includes("activities"), "Elon rates extracurriculars important");
  assert.ok(keys(r).includes("estimate.missing_courses"));
  assert.ok(texts(r).includes("Not in this estimate yet: your courses, class standing, and activities. Adding what you have gives a fuller picture and could change where this college stands for you."));
});

test("pinned: a Texas resident in the top 4%, SAT 1350, at UT Austin: Safe, Guaranteed for you, and the major isn't", () => {
  const r = run(UT_AUSTIN(), student({ state: "TX", classRankPercentile: 4, test: sat(1350), majors: ["14"] }));
  assert.equal(r.group, "safe");
  assert.equal(r.label, "guaranteed");
  assert.equal(keys(r)[0], "estimate.guaranteed");
  assert.ok(keys(r).includes("pool.major_not_guaranteed"));
  assert.deepEqual(r.pool, { kind: "guaranteed", rate: null, whoKey: "pool.who.guaranteed", whoValues: {} });
});

test("pinned: GPA 3.90 with 2 of 14 APs (some) at a crowded college admitting 45%: Target (rigor below shown, not used)", () => {
  assert.equal(RIGOR_CAN_LOWER, false);
  const r = run(ELON(0.45), student({ gpa: 3.9, courses: TWO_APS }), { offering: OFFERING(14), linked: true });
  assert.equal(r.group, "target");
  assert.ok(keys(r).includes("rigor.some"));
  assert.equal(run(ELON(0.45), student({ gpa: 3.9 })).group, r.group, "the same as with no courses");
});

test("pinned: SAT 1450, GPA 3.9, legacy at a 12% college rating alumni relation considered, in Massachusetts: Target", () => {
  const s = student({ test: sat(1450), gpa: 3.9 });
  const { result: r, detail } = detailed(LEGACY_MA(), s, { hooks: hooks({ legacy: true }) });
  assert.equal(r.group, "target");
  near(detail.hiddenOdds, 0.27);
  assert.ok(r.used.includes("legacy"));
  assert.equal(texts(r).find((t) => t.startsWith("Legacy helps")), "Legacy helps here: Tufts University rates alumni relation considered.");
  assert.equal(detail.without?.hooks, "reach", "without the toggle it's a Reach");
  assert.equal(run(LEGACY_MA(), s).group, "reach");
});

test("pinned: the same at a Maryland college: Reach, and the sentence says Maryland bars legacy preference", () => {
  const r = run(LEGACY_MD(), student({ test: sat(1450), gpa: 3.9 }), { hooks: hooks({ legacy: true }) });
  assert.equal(r.group, "reach");
  assert.ok(!r.used.includes("legacy"));
  assert.match(texts(r).find((t) => t.includes("bars legacy"))!, /^Maryland bars legacy preference at all colleges \(.+\), so this isn't used\.$/);
});

test("pinned: SAT 1300, GPA 3.6, recruited with a likely letter at a 6% Elite college: Likely, Recruited", () => {
  const r = run(ELITE_6(), student({ test: sat(1300), gpa: 3.6 }), { hooks: hooks({ recruited: "likely_letter" }) });
  assert.equal(r.group, "likely");
  assert.equal(r.label, "recruited");
  assert.equal(keys(r)[0], "estimate.recruited");
  assert.ok(keys(r).includes("hooks.recruited"));
  assert.equal(r.closeness, null, "a floor set it");
});

/* ------------------------------------------------------------------ */
/* Within one level of the second version, with every new input empty */
/* ------------------------------------------------------------------ */

/** A college with no C7, no C10, no bands, no residency grid, no curated entries, no tier: nothing the method adds can read. */
function plain(o: { rate: number | null; sat?: [number, number] | null; act?: [number, number] | null; gpaAverage?: number | null; policy?: StandingSchool["testPolicy"] }) {
  const s = {
    unit_id: "100000",
    name: "Example College",
    type: "private-nonprofit",
    location: { state: "OH", city: "Example" },
    admissions: { acceptance_rate: o.rate, test_policy: o.policy === undefined ? "considered" : o.policy, sat_math_25_75: null },
    reported: {},
    lineage: { "admissions.acceptance_rate": { source: "ipeds-adm", year: "Fall 2024" } },
  } as unknown as School;
  const standing: StandingSchool = { admitRate: o.rate, sat: o.sat ?? null, act: o.act ?? null, gpaAverage: o.gpaAverage ?? null, testPolicy: o.policy === undefined ? "considered" : o.policy };
  return { school: s, standing };
}

type V2 = "reach" | "target" | "likely" | null;
const V2_ROWS: { name: string; s: EstimateStudent; c: () => { school: School; standing: StandingSchool }; v2: V2; extra?: Partial<ModelInput> }[] = [
  // The second version's open-baseline table (it equaled the baseline with no new inputs).
  { name: "SAT 1450, admit 6%, SAT 1500–1560", s: student({ test: sat(1450) }), c: () => plain({ rate: 0.06, sat: [1500, 1560] }), v2: "reach" },
  { name: "SAT 1450, admit 45%, SAT 1280–1450", s: student({ test: sat(1450) }), c: () => plain({ rate: 0.45, sat: [1280, 1450] }), v2: "target" },
  { name: "SAT 1450, admit 78%, SAT 1100–1300", s: student({ test: sat(1450) }), c: () => plain({ rate: 0.78, sat: [1100, 1300] }), v2: "likely" },
  { name: "ACT 24, admit 40%, ACT 28–33, required", s: student({ test: { kind: "act", score: 24 } }), c: () => plain({ rate: 0.4, act: [28, 33], policy: "required" }), v2: "reach" },
  { name: "no test, GPA 3.9, admit 35%, average 3.7", s: student({ gpa: 3.9 }), c: () => plain({ rate: 0.35, gpaAverage: 3.7 }), v2: "target" },
  { name: "SAT 1390, GPA 3.82, admit 63%, SAT 1170–1350, average 3.88", s: student({ test: sat(1390), gpa: 3.82 }), c: () => plain({ rate: 0.63, sat: [1170, 1350], gpaAverage: 3.88 }), v2: "likely" },
  { name: "SAT 1200, GPA 3.8, test-optional 45%, SAT 1280–1450, average 3.75", s: student({ test: sat(1200), gpa: 3.8 }), c: () => plain({ rate: 0.45, sat: [1280, 1450], gpaAverage: 3.75 }), v2: "target" },
  { name: "open admission", s: student({ test: sat(1000) }), c: () => plain({ rate: null }), v2: "likely" },
  { name: "no numbers", s: student(), c: () => plain({ rate: 0.45, sat: [1280, 1450] }), v2: null },
  { name: "test-blind", s: student({ test: sat(1590) }), c: () => plain({ rate: 0.45, sat: [1280, 1450], policy: "not-considered" }), v2: null },
  { name: "an ACT through the concordance", s: student({ test: { kind: "act", score: 31 } }), c: () => plain({ rate: 0.45, sat: [1300, 1450] }), v2: "target" },
  { name: "a move up within reach", s: student({ test: sat(1390) }), c: () => plain({ rate: 0.22, sat: [1400, 1510] }), v2: "reach" },
  { name: "a weighted GPA as a range", s: student({ gpa: 3.5, gpaScale: "5.0", gpaRange: [3.4, 4.0] }), c: () => plain({ rate: 0.45, gpaAverage: 3.7 }), v2: null },
  // The second version's pinned examples (tests at MODEL_VERSION 20261011.1).
  { name: "Purdue, Indiana", s: student({ state: "IN", test: sat(1300), gpa: 3.85 }), c: PURDUE, v2: "likely" },
  { name: "Purdue, Ohio", s: student({ state: "OH", test: sat(1300), gpa: 3.85 }), c: PURDUE, v2: "target" },
  { name: "Georgia Tech, Georgia", s: student({ state: "GA", test: sat(1500), gpa: 3.95 }), c: GEORGIA_TECH, v2: "target" },
  { name: "Georgia Tech, Florida", s: student({ state: "FL", test: sat(1500), gpa: 3.95 }), c: GEORGIA_TECH, v2: "reach" },
  { name: "Elon, 8 of 9 APs", s: student({ gpa: 3.9, courses: EIGHT_APS }), c: ELON, v2: "likely", extra: { offering: OFFERING(9), linked: true } },
  { name: "Elon, no courses", s: student({ gpa: 3.9 }), c: ELON, v2: "target" },
  { name: "Elon, top 10%", s: student({ gpa: 3.9, classRankPercentile: 10 }), c: ELON, v2: "likely" },
  { name: "UT Austin, top 4%", s: student({ state: "TX", classRankPercentile: 4, test: sat(1350), majors: ["14"] }), c: UT_AUSTIN, v2: "likely" },
  { name: "Elon 45%, 2 of 14 APs", s: student({ gpa: 3.9, courses: TWO_APS }), c: () => ELON(0.45), v2: "target", extra: { offering: OFFERING(14), linked: true } },
];

const V2_RANK: Record<NonNullable<V2>, number> = { reach: 1, target: 2, likely: 3 };

/**
 * The row's student with every input a college can expect entered, in ways the second version didn't read: a GPA
 * where none was given (only at colleges with no GPA figures, so it's entered but not placed), courses (without the
 * school's offering they can't be placed, so rigor stays unread unless the row links the school), "my school doesn't
 * rank" where no rank was given (top quarter since Revision 3), and a Building activities record. Revision 1 lowers levels for gaps by design, so
 * the yardstick check runs on complete records (the second version had no gaps to read).
 */
function completed(s: EstimateStudent): EstimateStudent {
  return {
    ...s,
    gpa: s.gpa ?? UNPLACED_GPA,
    gpaRange: s.gpaRange ?? [s.gpa ?? UNPLACED_GPA, s.gpa ?? UNPLACED_GPA],
    courses: s.courses.length > 0 ? s.courses : TWO_APS,
    // Revision 3, rule 5: "My school doesn't rank" is unanswered now, so the complete record picks a standing.
    classStanding: s.classRankPercentile !== null ? (s.classStanding ?? null) : "top25",
    classRankPercentile: s.classRankPercentile ?? 25,
    activities: BUILDING,
  };
}

for (const row of V2_ROWS) {
  test(`within one level of the second version, on a complete record: ${row.name}`, () => {
    const s = completed(row.s);
    const { result, detail } = detailed(row.c(), s, row.extra);
    const ev = modelEstimateWithDetail({ student: s, school: row.c().school, standing: row.c().standing, offering: null, ...row.extra });
    // Nothing the college weighs is missing (an Ultra selective college's own rule also reads the school's offering).
    if (ev.result.label !== "elite") assert.ok(!ev.result.notes.some((n) => n.key === "estimate.incomplete"), "nothing the college weighs is missing");
    if (row.v2 === null) {
      assert.equal(result.group, null, "nothing to place then, nothing now");
      return;
    }
    assert.ok(result.group, "a level where the second version had a group");
    const now = RANK(result.group)!;
    const step = now - V2_RANK[row.v2];
    assert.ok(Math.abs(step) <= 1, `${row.v2} → ${result.group}`);
    if (detail.position === "above") assert.ok(step >= 0, `a student above range doesn't move down (${row.v2} → ${result.group})`);
    if (detail.position === "below") assert.ok(step <= 0, `a student below range doesn't move up (${row.v2} → ${result.group})`);
  });
}

test("the baseline's groups map onto the levels unchanged, so development without the model still runs", () => {
  for (const row of V2_ROWS.slice(0, 13)) {
    const c = row.c();
    const base = baselineEstimate(row.s, c.standing, c.school.unit_id);
    assert.equal(base.group, row.v2, row.name);
    // Completing the record doesn't change what the second version (the open baseline at these colleges) says.
    assert.equal(baselineEstimate(completed(row.s), c.standing, c.school.unit_id).group, row.v2, `${row.name}, completed`);
  }
});

test("guard: the within-one-level check refuses a two-step jump and a wrong-way move", () => {
  const within = (v2: NonNullable<V2>, now: StandingLevel, position: string) => {
    const step = RANK(now)! - V2_RANK[v2];
    return Math.abs(step) <= 1 && !(position === "above" && step < 0) && !(position === "below" && step > 0);
  };
  assert.equal(within("target", "likely", "in"), true);
  assert.equal(within("reach", "likely", "in"), false, "two steps");
  assert.equal(within("target", "reach", "above"), false, "above range, moved down");
  assert.equal(within("target", "likely", "below"), false, "below range, moved up");
});

/* ------------------------------------------------------------------ */
/* Caps and floors                                                     */
/* ------------------------------------------------------------------ */

/** A strong student at a college with this tier and rate: SAT at the top of the range. */
const strong = (rate: number, tier: SelectivityTier | null) => run(college("100654", { rate, sat: [1200, 1350], c7: null, tier }), student({ gpa: UNPLACED_GPA, test: sat(1600) }));

test("caps: Highly selective stops at Target; Very selective at Likely; Selective at Likely below 50% and Safe from 50%; Accessible and Open allow Safe", () => {
  assert.equal(strong(0.45, "highly_selective").group, "target");
  assert.equal(strong(0.45, "highly_selective").closeness, null, "a cap set it");
  assert.equal(strong(0.6, "very_selective").group, "likely", "never Safe, even with most applicants admitted");
  assert.equal(strong(0.45, "selective").group, "likely");
  assert.equal(strong(0.6, "selective").group, "safe");
  assert.equal(strong(0.6, "accessible").group, "safe");
  assert.equal(strong(0.6, "open").group, "safe");
  assert.equal(strong(0.6, null).group, "safe", "a college that isn't rated: by the odds");
});

test("Safe needs at least half of the student's pool admitted, whatever the tier", () => {
  // 45% × 2.5 = 97% odds, but under half admitted: Likely.
  assert.equal(strong(0.45, "accessible").group, "likely");
  assert.equal(strong(0.45, null).group, "likely");
});

/** A record consistent with excellence at ULTRA (below): GPA above, 8 of 9 APs, top 5%, Focused, SAT above. */
const EXCELLENT = (o: Partial<EstimateStudent> = {}) => student({ gpa: 4.0, test: sat(1450), courses: THREADED_APS, classRankPercentile: 5, classStanding: "top5", activities: THEMED, ...o });
const ULTRA = (policy: School["admissions"]["test_policy"] = "required") => college("166027", { rate: 0.6, sat: [1300, 1400], gpa: middleGpa(3.7, 3.9), c7: null, tier: "elite", policy });
const LINKED = { offering: OFFERING(9), linked: true };

test("rule 2: at an Ultra selective college, Reach only when every signal is consistent; each missing or short signal alone gives High reach", () => {
  const at = (s: EstimateStudent, policy?: School["admissions"]["test_policy"], extra: Partial<ModelInput> = LINKED) => run(ULTRA(policy), s, extra);
  const all = at(EXCELLENT());
  assert.equal(all.group, "reach", "every signal: Reach, even at 60% admitted (the tier caps it)");
  assert.equal(all.label, "elite");
  const cases: [string, EstimateStudent, Partial<ModelInput>?][] = [
    ["GPA missing", EXCELLENT({ gpa: null, gpaRange: null })],
    ["GPA below the range", EXCELLENT({ gpa: 3.6, gpaRange: [3.6, 3.6] })],
    ["no courses", EXCELLENT({ courses: [] })],
    ["courses the reading can't place (no school offering)", EXCELLENT(), {}],
    ["rigor some", EXCELLENT({ courses: TWO_APS }), { offering: OFFERING(14), linked: true }],
    ["no class standing", EXCELLENT({ classRankPercentile: null, classStanding: null })],
    ["top 10% (the bar is top 5%)", EXCELLENT({ classRankPercentile: 10, classStanding: "top10" })],
    ["a rank of top 8% typed in", EXCELLENT({ classRankPercentile: 8, classStanding: null })],
    ["top 25%", EXCELLENT({ classRankPercentile: 25, classStanding: "top25" })],
    ["test below the range", EXCELLENT({ test: sat(1290) })],
    ["no test where one is required", EXCELLENT({ test: null })],
    ["no activities", EXCELLENT({ activities: [] })],
    ["activities Sampling", EXCELLENT({ activities: SAMPLING })],
    // Revision 2: depth needs a theme; Sampling with a tier-2 award no longer passes (Focused or Building only).
    ["Focused, no theme (no activity shares a course family)", EXCELLENT({ activities: FOCUSED })],
    ["a tier-2 award beside Sampling", EXCELLENT({ activities: SAMPLING, awards: [{ id: "w3", key: null, name: "All-state", tier: 2, year: 11 }] })],
  ];
  for (const [name, s, extra] of cases) assert.equal(at(s, "required", extra ?? LINKED).group, "high_reach", name);
  // Revision 3, rule 5: "my school doesn't rank" reads as unanswered (the pick is the student's perceived standing).
  const noRankPick = at(EXCELLENT({ classRankPercentile: null, classStanding: "no_rank" }));
  assert.equal(noRankPick.group, "high_reach", "no_rank is unanswered");
  assert.ok(noRankPick.missing.includes("class_rank"));
  // What passes: a Building record with a theme, no test at a test-optional college.
  assert.equal(at(EXCELLENT({ classRankPercentile: 1, classStanding: "top1" })).group, "reach", "top 1% passes");
  assert.equal(at(EXCELLENT({ classRankPercentile: 5, classStanding: null })).group, "reach", "a typed rank in the top 5% passes");
  assert.equal(at(EXCELLENT({ activities: [THEMED[1]] })).group, "reach", "Building with a theme passes");
  assert.equal(at(EXCELLENT({ test: null }), "considered").group, "reach", "no test at a test-optional college isn't missing");
  // The missing ones are named; the short ones are not called missing.
  const noRank = at(EXCELLENT({ classRankPercentile: null, classStanding: null }));
  assert.ok(noRank.missing.includes("class_rank"));
  assert.ok(texts(noRank).some((t) => t.startsWith("Not in this estimate yet: your class standing.")));
  assert.ok(!at(EXCELLENT({ activities: SAMPLING })).missing.includes("activities"));
  // A recruited floor still beats it; an Ultra selective college with no numbers to place has no level.
  assert.equal(at(EXCELLENT({ activities: [] }), "required", { ...LINKED, hooks: hooks({ recruited: "likely_letter" }) }).group, "likely");
  assert.equal(run(ULTRA(), student()).group, null);
});

/** THREADED_APS without the courses of one year, or with every grade changed. */
const withoutYear = (y: number) => THREADED_APS.filter((c) => c.year !== y);
const graded = (final: CourseEntry["grades"]["final"]) => THREADED_APS.map((c) => ({ ...c, grades: { ...c.grades, final } }));
/** Every core subject at the top level in 11th and 12th grade (rigor reads "most" from this alone). */
const ALL_CORE = { 11: { english: true, math: true, science: true, history: true, language: true }, 12: { english: true, math: true, science: true, history: true, language: true } };

test("Revision 2, Ultra selective: depth with a theme, an advanced course every year, and strong advanced grades; each alone gives High reach", () => {
  const at = (s: EstimateStudent, extra: Partial<ModelInput> = LINKED) => run(ULTRA(), s, extra);
  assert.equal(at(EXCELLENT()).group, "reach");
  // Depth: Focused or Building AND at least one theme. An activity without a family never makes one.
  assert.equal(at(EXCELLENT({ activities: FOCUSED })).group, "high_reach", "no theme");
  assert.equal(at(EXCELLENT({ activities: [THEMED[0], { ...THEMED[1], family: null }] })).group, "high_reach", "the club without a family");
  assert.equal(at(EXCELLENT({ activities: [THEMED[0], { ...THEMED[1], family: "athletics" }] })).group, "high_reach", "a family with no course track");
  // Consistency: a year with no advanced course between the first and now.
  assert.equal(at(EXCELLENT({ courses: withoutYear(11) })).group, "high_reach", "a skipped 11th grade");
  assert.equal(at(EXCELLENT({ courses: withoutYear(10) })).group, "reach", "starting in 11th grade is consistent");
  // Fewer than three in all (rigor still reads "most" from the core answers, the theme from the science track).
  const two = [ap("ap_biology", "science", "A", 10), ap("ap_chemistry", "science", "A", 11)];
  const lateTwo = [ap("ap_biology", "science", "A", 11), ap("ap_chemistry", "science", "A", 12)];
  assert.equal(at(EXCELLENT({ courses: lateTwo }), { ...LINKED, coreAtTopLevel: ALL_CORE, grade: 12 }).group, "high_reach", "two advanced courses, senior year");
  assert.equal(at(EXCELLENT({ courses: [...lateTwo, ap("ap_us_history", "history", "A", 12)] }), { ...LINKED, coreAtTopLevel: ALL_CORE, grade: 12 }).group, "reach", "three");
  // Revision 3, rule 4: before junior year ends, senior year is assumed to continue at junior year's count (one more
  // here: three); once it's over (a senior), only what's entered counts.
  assert.equal(at(EXCELLENT({ courses: two }), { ...LINKED, coreAtTopLevel: ALL_CORE, grade: 11 }).group, "reach", "two advanced courses, a junior");
  assert.equal(at(EXCELLENT({ courses: two, gradYear: 2028 }), { ...LINKED, coreAtTopLevel: ALL_CORE, grade: 11, asOf: "2027-07-01" }).group, "high_reach", "junior year over by the graduation year");
  // Grades: the advanced courses' unweighted average at least 3.7 (A- passes, B+ doesn't; rigor still reads "most").
  assert.equal(at(EXCELLENT({ courses: graded("A-") })).group, "reach", "A- average");
  assert.equal(at(EXCELLENT({ courses: graded("B+") })).group, "high_reach", "B+ average");
  // Missing pieces are named: this year's courses (the student's grade says 12th) and grades not yet entered.
  const noSenior = at(EXCELLENT({ courses: withoutYear(12) }), { ...LINKED, grade: 12 });
  assert.equal(noSenior.group, "high_reach");
  assert.ok(texts(noSenior).includes("Not in this estimate yet: your advanced courses this year. Adding what you have gives a fuller picture and could change where this college stands for you."), texts(noSenior).join(" | "));
  const ungraded = at(EXCELLENT({ courses: graded(null) }));
  assert.equal(ungraded.group, "high_reach");
  assert.ok(texts(ungraded).some((x) => x.startsWith("Not in this estimate yet: your advanced-course grades.")), texts(ungraded).join(" | "));
  // A theme missing is said as a suggestion.
  assert.ok(keys(at(EXCELLENT({ activities: FOCUSED }))).includes("depth.theme.add_family"));
  // The rule is Ultra selective only: elsewhere a gap year or a B+ average changes nothing by itself.
  const hs = WEIGHS_ALL("highly_selective", 0.2);
  assert.equal(run(hs, EXCELLENT({ courses: withoutYear(11) }), LINKED).group, run(hs, EXCELLENT(), LINKED).group);
});

test("guard: the rule-2 check fails if the old rule (nothing below range) comes back", () => {
  // Under the old rule a record with every measure in range but no activities or class standing was a Reach.
  const old = (s: EstimateStudent) => {
    const r = detailed(ULTRA(), s, LINKED);
    return r.detail.position !== "below" && s.test !== null && s.test.score >= 1300 ? "reach" : "high_reach";
  };
  const gaps = EXCELLENT({ activities: [], classRankPercentile: null, classStanding: null });
  assert.equal(old(gaps), "reach");
  assert.notEqual(run(ULTRA(), gaps, LINKED).group, old(gaps), "the new rule disagrees with the old one here");
});

test("floors: a guarantee and open admission are Safe; a likely letter Likely anywhere; a positive pre-read Target at Elite, Likely elsewhere, from d ≥ −0.5", () => {
  const open = run(college("100654", { rate: null, c7: null, tier: "open" }), student({ gpa: 2.0 }));
  assert.deepEqual([open.group, open.label, keys(open)[0]], ["safe", null, "estimate.open_admission"]);
  const elite = ELITE_6();
  const pre = (score: number, c = elite) => run(c, student({ gpa: UNPLACED_GPA, test: sat(score) }), { hooks: hooks({ recruited: "pre_read" }) });
  assert.deepEqual([pre(1300).group, pre(1300).label], ["target", "recruited"], "Elite: Target");
  assert.deepEqual([pre(1230).group, pre(1230).label], ["target", "recruited"], "d = −0.4 still floors");
  assert.equal(pre(1200).label, "elite", "d = −0.7: no floor");
  assert.equal(pre(1200).group, "high_reach");
  const hs = college("100654", { rate: 0.1, sat: [1270, 1370], c7: null, tier: "highly_selective" });
  assert.equal(pre(1300, hs).group, "likely", "Likely beats the Highly selective cap");
  const letter = run(hs, student({ gpa: UNPLACED_GPA, test: sat(1000) }), { hooks: hooks({ recruited: "likely_letter" }) });
  assert.deepEqual([letter.group, letter.label], ["likely", "recruited"], "a likely letter at any distance");
  // A contact multiplies; it isn't a floor and isn't a label.
  const contact = run(hs, student({ gpa: UNPLACED_GPA, test: sat(1300) }), { hooks: hooks({ recruited: "contact" }) });
  assert.equal(contact.label, null);
  assert.ok(keys(contact).includes("hooks.recruited"));
  assert.ok(RANK(contact.group)! >= RANK(run(hs, student({ gpa: UNPLACED_GPA, test: sat(1300) })).group)!);
});

test("the guarantee floor beats every cap, and open admission needs no numbers", () => {
  const r = run(UT_AUSTIN(), student({ state: "TX", classRankPercentile: 3, test: sat(900), gpa: 2.5 }));
  assert.deepEqual([r.group, r.label], ["safe", "guaranteed"]);
  assert.notEqual(run(UT_AUSTIN(), student({ state: "OK", classRankPercentile: 3, test: sat(900), gpa: 2.5 })).label, "guaranteed", "another state's student isn't guaranteed");
  assert.equal(run(college("100654", { rate: null, c7: null }), student()).group, "safe");
});

/* ------------------------------------------------------------------ */
/* Revision 1: consistency and completeness (owner, 2026-10-12)        */
/* ------------------------------------------------------------------ */

/** A college that weighs everything (C7), with a C10 rank profile, at a given tier and rate. */
const WEIGHS_ALL = (tier: SelectivityTier | null, rate: number) =>
  college("100654", {
    rate,
    sat: [1300, 1450],
    gpa: middleGpa(3.5, 3.9),
    c7: { gpa: "very_important", rigor: "very_important", class_rank: "considered", test_scores: "important", extracurriculars: "considered" },
    classRank: { top_tenth: 0.4, top_quarter: 0.75, top_half: 0.95, submitted_share: 0.4 },
    tier,
  });
const readings = (c: { school: School; standing: StandingSchool }, s: EstimateStudent, extra: Partial<ModelInput> = {}) =>
  stageOneReadings({ student: s, school: c.school, standing: c.standing, offering: null, ...extra });
const TIERS: (SelectivityTier | null)[] = ["elite", "highly_selective", "very_selective", "selective", "accessible", "open", null];

test("rule 1: a top student with a weaker test is never placed below a middling student with a top test, at any tier", () => {
  // A: GPA 4.0 (well above), top 5%, 8 of 9 APs, Focused; SAT 1250, below the range.
  const a = student({ gpa: 4.0, classRankPercentile: 5, classStanding: "top5", courses: EIGHT_APS, activities: FOCUSED, test: sat(1250) });
  // B: GPA 3.6 (just in range), top 25%, the same courses and activities; SAT 1600, at the top.
  const b = student({ gpa: 3.6, classRankPercentile: 25, classStanding: "top25", courses: EIGHT_APS, activities: FOCUSED, test: sat(1600) });
  for (const tier of TIERS) {
    for (const rate of [0.04, 0.15, 0.3, 0.6, 0.85]) {
      const c = WEIGHS_ALL(tier, rate);
      const [ra, rb] = [readings(c, a, LINKED), readings(c, b, LINKED)];
      assert.ok(ra.d! > rb.d!, `${tier} ${rate}: d ${ra.d} vs ${rb.d}`);
      assert.ok(RANK(run(c, a, LINKED).group)! >= RANK(run(c, b, LINKED).group)!, `${tier} ${rate}: level`);
    }
  }
  // The test still counts, a little: the same top student with a great score reads higher than with a weak one.
  const c = WEIGHS_ALL(null, 0.3);
  const great = readings(c, { ...a, test: sat(1500) }, LINKED);
  const weak = readings(c, a, LINKED);
  assert.ok(great.d! > weak.d!);
  // Bounded both ways: never more than testUp above or testDown below the record without the test.
  const core = readings(WEIGHS_ALL(null, 0.3), { ...a, test: null }, LINKED).d!;
  near(weak.d! - core, -ODDS_V3.testDown, 1e-9);
  assert.ok(readings(c, { ...a, test: sat(1600) }, LINKED).d! - core <= ODDS_V3.testUp + 1e-9);
  // Guard: with the test as one more measure under the weakest-first combine (the version before Revision 1), B's
  // distance would beat A's here; the rule is what keeps A ahead.
  const oldCombine = (ds: number[]) => ODDS_V3.weakest * Math.min(...ds) + (1 - ODDS_V3.weakest) * (ds.reduce((x, y) => x + y, 0) / ds.length);
  const gpaA = (4.0 - 3.5) / 0.4;
  const rankA = (0.75 - 0.2) / 0.5;
  const gpaB = (3.6 - 3.5) / 0.4;
  const rankB = (0.75 - 0.75) / 0.5;
  assert.ok(oldCombine([gpaA, rankA, (1250 - 1300) / 150]) < oldCombine([gpaB, rankB, Math.min(ODDS_V3.dMax, (1600 - 1300) / 150)]), "the old reading put B ahead");
});

test("rule 3: a score alone reads below a GPA alone, which reads below the full record, for the same strong student", () => {
  const c = () => college("100654", {
    rate: 0.3,
    sat: [1200, 1400],
    gpa: middleGpa(3.4, 3.9),
    c7: { gpa: "very_important", rigor: "very_important", class_rank: "considered", test_scores: "important", extracurriculars: "important" },
  });
  const testOnly = detailed(c(), student({ test: sat(1500) }));
  const gpaOnly = detailed(c(), student({ gpa: 4.0 }));
  const full = detailed(c(), student({ gpa: 4.0, test: sat(1500), courses: EIGHT_APS, classRankPercentile: 5, classStanding: "top5", activities: FOCUSED }), LINKED);
  assert.ok(testOnly.detail.hiddenOdds! < gpaOnly.detail.hiddenOdds! && gpaOnly.detail.hiddenOdds! < full.detail.hiddenOdds!);
  assert.deepEqual([testOnly.result.group, gpaOnly.result.group, full.result.group], ["reach", "target", "likely"]);
  // The score alone measures well above the range (d = 1.5) but is mostly gap.
  const r = readings(c(), student({ test: sat(1500) }));
  near(r.d, 1.5, 1e-9);
  near(r.completeness, 1 / 8, 1e-9);
  near(r.dEff, (1 / 8) * 1.5 + (7 / 8) * ODDS_V3.gapPrior, 1e-9);
  // Guard: with completeness switched off (every record complete) the score alone would read as Likely.
  assert.ok(0.3 * academicMultiplier(r.d!) >= ODDS_V3.cutoffs.likely, "without the gaps it would have been Likely");
});

test("rule 3: completeness is 1 when the college expects nothing the student lacks; a missing test at a test-optional college costs nothing", () => {
  // Expects nothing: C7 says GPA and tests aren't considered, nothing else rated.
  const nothing = college("100654", { rate: 0.3, sat: [1200, 1400], policy: "considered", c7: { gpa: "not_considered", test_scores: "not_considered" } });
  near(readings(nothing, student()).completeness, 1, 1e-9);
  near(readings(nothing, student({ gpa: 3.2 })).completeness, 1, 1e-9);
  // Test-optional: no test is no gap; a test the student has is expected (and present).
  const optional = () => college("100654", { rate: 0.3, sat: [1200, 1400], gpa: middleGpa(3.4, 3.9), policy: "considered", c7: { gpa: "very_important", test_scores: "considered" } });
  near(readings(optional(), student({ gpa: 3.8 })).completeness, 1, 1e-9);
  assert.ok(!keys(run(optional(), student({ gpa: 3.8 }))).includes("estimate.incomplete"));
  near(readings(optional(), student({ gpa: 3.8, test: sat(1300) })).completeness, 1, 1e-9);
  // Required: no test is a gap.
  const required = college("100654", { rate: 0.3, sat: [1200, 1400], gpa: middleGpa(3.4, 3.9), policy: "required", c7: { gpa: "very_important", test_scores: "important" } });
  near(readings(required, student({ gpa: 3.8 })).completeness, 3 / 4, 1e-9);
  assert.ok(texts(run(required, student({ gpa: 3.8 }))).includes("Not in this estimate yet: your test score. Adding what you have gives a fuller picture and could change where this college stands for you."));
  // A class-standing pick is an answer; Sampling activities are entered. Revision 3, rule 5: "My school doesn't rank"
  // reads as unanswered (class rank's weight of 1 out of Elon's 7 is missing).
  const elon = ELON();
  near(readings(elon, student({ gpa: 3.9, courses: TWO_APS, classStanding: "top25", classRankPercentile: 25, activities: SAMPLING })).completeness, 1, 1e-9);
  near(readings(elon, student({ gpa: 3.9, courses: TWO_APS, classStanding: "no_rank", activities: SAMPLING })).completeness, 6 / 7, 1e-9);
  // Guard: a gap lowers the distance and never raises it (a record below the prior isn't helped by gaps).
  const low = readings(required, student({ gpa: 2.8 }));
  assert.ok(low.d! < ODDS_V3.gapPrior && low.dEff === low.d);
  const high = readings(required, student({ gpa: 3.95 }));
  assert.ok(high.dEff! < high.d!);
});

test("an incomplete record is never placed above the same record completed (with courses, activities, and class standing)", () => {
  const colleges = [PURDUE, GEORGIA_TECH, ELON, () => ELON(0.45), FIFTEEN, HARVARD, () => WEIGHS_ALL("selective", 0.6), () => WEIGHS_ALL(null, 0.3), () => WEIGHS_ALL("elite", 0.05), LEGACY_MA];
  const bases = [
    student({ state: "IN", gpa: 3.95, test: sat(1500) }),
    student({ state: "GA", gpa: 3.6, test: sat(1300) }),
    student({ state: "OH", gpa: 3.0, test: sat(1100) }),
    student({ gpa: 3.9 }),
    student({ test: sat(1450) }),
  ];
  const finishes: Partial<EstimateStudent>[] = [
    { courses: EIGHT_APS, activities: FOCUSED, classRankPercentile: 1, classStanding: "top1" },
    { courses: TWO_APS, activities: SAMPLING, classStanding: "no_rank" },
    { courses: EIGHT_APS, activities: BUILDING, classStanding: "no_rank" },
  ];
  let checked = 0;
  for (const mk of colleges) {
    for (const base of bases) {
      for (const finish of finishes) {
        const complete = { ...base, ...finish };
        // Every subset of the three finishing inputs left out.
        for (const drop of [["courses"], ["activities"], ["rank"], ["courses", "activities"], ["courses", "rank"], ["activities", "rank"], ["courses", "activities", "rank"]]) {
          const partial: EstimateStudent = { ...complete };
          if (drop.includes("courses")) partial.courses = [];
          if (drop.includes("activities")) partial.activities = [];
          if (drop.includes("rank")) Object.assign(partial, { classRankPercentile: null, classStanding: null });
          const [p, f] = [detailed(mk(), partial, LINKED), detailed(mk(), complete, LINKED)];
          assert.ok(RANK(p.result.group) === null || RANK(p.result.group)! <= RANK(f.result.group)!, `${mk().school.name} ${JSON.stringify(drop)}: ${p.result.group} above ${f.result.group}`);
          if (p.detail.hiddenOdds !== null && f.detail.hiddenOdds !== null) assert.ok(p.detail.hiddenOdds! <= f.detail.hiddenOdds! + 1e-12, `${mk().school.name} ${JSON.stringify(drop)}: odds`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000, `${checked}`);
});

test("the incomplete sentence names the missing kinds in words, and nothing about how much they count", () => {
  const r = run(WEIGHS_ALL(null, 0.3), student({ test: sat(1400) }));
  const n = r.notes.find((x) => x.key === "estimate.incomplete")!;
  assert.equal(n.values.inputs, "GPA, courses, class standing, and activities");
  assert.equal(noteText(n), "Not in this estimate yet: your GPA, courses, class standing, and activities. Adding what you have gives a fuller picture and could change where this college stands for you.");
  for (const k of ["gpa", "courses", "class_rank", "activities"]) assert.ok(r.missing.includes(k as never), k);
  assert.ok(texts(r).includes("Adding your GPA could change this estimate."), "the one prompt asks for the heaviest gap first");
  assert.ok(Object.values(n.values).every((v) => typeof v === "string" && !/\d/.test(v)));
  // Two kinds: "a and b"; complete: no sentence; a guarantee or open admission: none either.
  const two = run(WEIGHS_ALL(null, 0.3), student({ gpa: 3.8, test: sat(1400), courses: EIGHT_APS }), LINKED);
  assert.equal(two.notes.find((x) => x.key === "estimate.incomplete")!.values.inputs, "class standing and activities");
  assert.ok(!keys(run(WEIGHS_ALL(null, 0.3), student({ gpa: 3.8, test: sat(1400), courses: EIGHT_APS, classStanding: "top25", classRankPercentile: 25, activities: SAMPLING }), LINKED)).includes("estimate.incomplete"));
  assert.ok(!keys(run(UT_AUSTIN(), student({ state: "TX", classRankPercentile: 4 }))).includes("estimate.incomplete"));
  assert.ok(!keys(run(college("100654", { rate: null, c7: null }), student({ gpa: 3 }))).includes("estimate.incomplete"));
});

/* ------------------------------------------------------------------ */
/* Move-up, closeness, ED                                              */
/* ------------------------------------------------------------------ */

test("move-up: the fewest points to the next level, across five; at an Elite college only from High reach to Reach", () => {
  const c = () => plain({ rate: 0.22, sat: [1400, 1510] });
  const r = run(c(), student({ gpa: UNPLACED_GPA, test: sat(1390) }));
  assert.equal(r.group, "reach");
  assert.deepEqual(r.moveUp, { points: 70, to: "target", score: 1460 });
  assert.equal(run(c(), student({ gpa: UNPLACED_GPA, test: sat(1460) })).group, "target");
  assert.equal(run(c(), student({ gpa: UNPLACED_GPA, test: sat(1450) })).group, "reach");
  const elite = () => college("166027", { rate: 0.04, sat: [1500, 1580], gpa: middleGpa(3.7, 3.9), c7: null, tier: "elite" });
  const low = run(elite(), EXCELLENT({ test: sat(1450) }), LINKED);
  assert.equal(low.group, "high_reach");
  assert.deepEqual(low.moveUp, { points: 50, to: "reach", score: 1500 }, "every other signal is there: the test is the one short");
  assert.equal(run(elite(), EXCELLENT({ test: sat(1500) }), LINKED).moveUp, null, "Reach at Elite: nothing beyond");
  assert.equal(run(elite(), EXCELLENT({ test: sat(1450), activities: [] }), LINKED).moveUp, null, "no score reaches Reach while activities are missing");
  // No move-up where the test isn't counted, or from Safe.
  assert.equal(run(ELON(), student({ gpa: 3.5, test: sat(1100) })).moveUp, null);
  assert.equal(strong(0.6, "accessible").moveUp, null);
});

test("closeness: which quarter of its level's band the odds fall in; null when a cap or floor set the level", () => {
  const at = (rate: number) => run(plain({ rate, sat: [1200, 1300] }), student({ gpa: UNPLACED_GPA, test: sat(1250) }));
  // d = 0.5 → ×1.1.
  assert.deepEqual([at(0.06).group, at(0.06).closeness], ["reach", 0], "6.6% is low in Reach");
  assert.deepEqual([at(0.2).group, at(0.2).closeness], ["reach", 3], "22% is nearest Target");
  assert.deepEqual([at(0.3).group, at(0.3).closeness], ["target", 1]);
  assert.equal(strong(0.45, "highly_selective").closeness, null);
  for (const r of [at(0.06), at(0.3), at(0.6)]) assert.ok([0, 1, 2, 3].includes(r.closeness as number));
});

test("ED: helps where the college's early-decision rate lifts the level; same where it doesn't; not advised at a High reach", () => {
  // ED admits 60% against 20% overall: M_ed = 1 + ½ × (3 − 1) = 2, the most it can be.
  const c = (rate = 0.2, tier: SelectivityTier | null = null) => college("100654", { rate, sat: [1200, 1300], c7: null, tier, ed: { applicants: 1000, admitted: 600 } });
  const target = run(c(), student({ gpa: UNPLACED_GPA, test: sat(1300), round: "ed" }));
  assert.equal(target.group, "target");
  assert.equal(target.ed, "helps");
  assert.ok(texts(target).includes("Early decision would move this toward Likely; it's binding, so check the cost first."));
  const capped = run(c(0.2, "highly_selective"), student({ gpa: UNPLACED_GPA, test: sat(1300), round: "ed" }));
  assert.equal(capped.ed, "same", "the cap holds under ED");
  assert.ok(keys(capped).includes("ed.same"));
  const hr = run(c(), student({ gpa: UNPLACED_GPA, test: sat(1000), round: "ed" }));
  assert.equal(hr.group, "high_reach");
  assert.equal(hr.ed, "not_advised");
  assert.ok(keys(hr).includes("ed.not_advised"));
  // Without a round of ED the verdict is still there for the planner, but no sentence.
  const rd = run(c(), student({ gpa: UNPLACED_GPA, test: sat(1300) }));
  assert.equal(rd.ed, "helps");
  assert.ok(!keys(rd).some((k) => k.startsWith("ed.")));
  // No ED counts on record: no verdict (except the High reach guard).
  assert.equal(run(college("100654", { rate: 0.2, sat: [1200, 1300], c7: null }), student({ gpa: UNPLACED_GPA, test: sat(1300) })).ed, null);
  assert.equal(run(college("100654", { rate: 0.2, sat: [1200, 1300], c7: null }), student({ gpa: UNPLACED_GPA, test: sat(1000) })).ed, "not_advised");
  assert.equal(run(college("100654", { rate: 0.2, sat: [1200, 1300], c7: null }), student()).ed, null, "no level, no verdict");
});

/* ------------------------------------------------------------------ */
/* Depth, work, legacy, interest, first generation                     */
/* ------------------------------------------------------------------ */

const depthCollege = (extracurriculars: string | null, extra: Record<string, string> = {}) =>
  college("100654", { rate: 0.3, sat: [1200, 1400], c7: extracurriculars ? { extracurriculars, ...extra } : Object.keys(extra).length ? extra : null });

test("depth: Focused ×1.3 where the college rates activities important, half at considered, nothing (with a sentence) otherwise", () => {
  // Against a Sampling record (entered, ×1), so the activities aren't a gap on either side.
  const s = student({ gpa: UNPLACED_GPA, test: sat(1300), activities: FOCUSED });
  const odds = (c: ReturnType<typeof depthCollege>, st = s) => detailed(c, st).detail.hiddenOdds!;
  const base = odds(depthCollege("important"), student({ gpa: UNPLACED_GPA, test: sat(1300), activities: SAMPLING }));
  near(odds(depthCollege("important")) / base, 1.3, 1e-9);
  near(odds(depthCollege("very_important")) / base, 1.3, 1e-9);
  near(odds(depthCollege("considered")) / base, 1.15, 1e-9);
  near(odds(depthCollege("not_considered")) / base, 1, 1e-9);
  const none = run(depthCollege(null), s);
  assert.ok(texts(none).includes("Example University doesn't say it weighs activities; they're shown here for you, not for the estimate.".replace("Example University", none.notes.find((n) => n.key === "depth.activities.not_weighed")!.values.college as string)));
  assert.ok(!none.used.includes("activities"));
  // Talent counts the same as extracurriculars.
  near(odds(depthCollege(null, { talent: "important" })) / base, 1.3, 1e-9);
});

test("depth: recognition counts as the larger of the two, never the product; awards give recognition", () => {
  const base = detailed(depthCollege("important"), student({ gpa: UNPLACED_GPA, test: sat(1300), activities: SAMPLING })).detail.hiddenOdds!;
  const both = detailed(depthCollege("important"), student({ gpa: UNPLACED_GPA, test: sat(1300), activities: FOCUSED, awards: [{ id: "w1", key: null, name: "National award", tier: 1, year: 11 }] }));
  near(both.detail.hiddenOdds! / base, 1.8, 1e-9);
  assert.ok(both.result.used.includes("awards"));
  const state = detailed(depthCollege("important"), student({ gpa: UNPLACED_GPA, test: sat(1300), activities: SAMPLING, awards: [{ id: "w2", key: null, name: "All-state", tier: 2, year: 11 }] }));
  near(state.detail.hiddenOdds! / base, 1.25, 1e-9);
});

test("depth never lowers a level: entering a Sampling record leaves the level at least where it was", () => {
  for (const rating of ["very_important", "considered", "not_considered"]) {
    const none = run(depthCollege(rating), student({ gpa: UNPLACED_GPA, test: sat(1300) }));
    const sampling = run(depthCollege(rating), student({ gpa: UNPLACED_GPA, test: sat(1300), activities: SAMPLING }));
    assert.ok(RANK(sampling.group)! >= RANK(none.group)!, rating);
  }
});

test("depth: the major's deep course track fills the major-subjects slot as above, never lowering the distance", () => {
  // Cornell Engineering states required courses (calculus, physics, chemistry).
  const cornell = () => college("190415", { rate: 0.3, sat: [1450, 1550], c7: null, tier: "selective" });
  const deep = [
    ap("Algebra I", "math", "A", 9, "honors"),
    ap("Geometry", "math", "A", 10, "honors"),
    ap("ap_calculus_ab", "math", "A", 11),
    ap("ap_calculus_bc", "math", "A", 12),
    ap("Biology", "science", "A", 9, "honors"),
    ap("Chemistry", "science", "A", 10, "honors"),
    ap("ap_physics_1", "science", "A", 11),
    ap("ap_chemistry", "science", "A", 12),
  ];
  const s = student({ test: sat(1500), majors: ["14"], courses: deep });
  const { result, detail } = detailed(cornell(), s);
  assert.ok(result.notes.some((n) => n.key === "depth.courses.deep_major"), "the track sentence for the major's families");
  assert.ok(result.used.includes("courses"));
  assert.equal(detail.depth?.majorDeep, true);
  assert.ok(RANK(result.group)! >= RANK(detail.without!.depth!)!, "with the track at least as high as without");
  // Guard: no name in the depth snapshot.
  assert.doesNotMatch(JSON.stringify(detail.depth), /Algebra|Calculus|Soccer|Robotics/);
});

test("work: 10+ hours ×1.1, 20+ ×1.2 where the college weighs work experience; not when the job already counts as a top activity", () => {
  const job = (hours: number) => [activity("Grocery store", "work", [11, 12], { hoursPerWeek: hours })];
  const c = (ec: string | null) => college("100654", { rate: 0.3, sat: [1200, 1400], c7: ec ? { work_experience: "considered", extracurriculars: ec } : { work_experience: "considered" } });
  const base = detailed(c(null), student({ test: sat(1300) })).detail.hiddenOdds!;
  const twenty = detailed(c(null), student({ test: sat(1300), activities: job(22) }));
  near(twenty.detail.hiddenOdds! / base, 1.2, 1e-9);
  assert.ok(twenty.result.used.includes("work"));
  assert.ok(texts(twenty.result).includes("Working 22 hours a week through the school year counts at colleges that weigh work experience, and it explains a shorter activity list."));
  near(detailed(c(null), student({ test: sat(1300), activities: job(12) })).detail.hiddenOdds! / base, 1.1, 1e-9);
  near(detailed(c(null), student({ test: sat(1300), activities: job(6) })).detail.hiddenOdds! / base, 1, 1e-9);
  // Depth open and the job is a top-two activity: depth reads it, work doesn't count it twice.
  const both = detailed(c("important"), student({ test: sat(1300), activities: job(22) }));
  near(both.detail.hiddenOdds! / detailed(c("important"), student({ test: sat(1300), activities: job(6) })).detail.hiddenOdds!, 1, 1e-9);
  // Not weighed: "not used here".
  const notWeighed = run(college("100654", { rate: 0.3, sat: [1200, 1400], c7: { work_experience: "not_considered" } }), student({ test: sat(1300), activities: job(22) }));
  assert.ok(texts(notWeighed).some((t) => /^Not used here: work hours/.test(t)));
});

test("legacy: 2.5 at important, 1.5 at considered, 1 (with a sentence) where not considered or not rated", () => {
  const c = (rating: string | null) => college("168148", { rate: 0.12, sat: [1360, 1460], gpa: null, c7: rating ? { alumni_relation: rating } : null, tier: "highly_selective" });
  const s = student({ test: sat(1450) });
  const ratio = (rating: string | null) => detailed(c(rating), s, { hooks: hooks({ legacy: true }) }).detail.hiddenOdds! / detailed(c(rating), s).detail.hiddenOdds!;
  near(ratio("very_important"), 2.5, 1e-9);
  near(ratio("important"), 2.5, 1e-9);
  near(ratio("considered"), 1.5, 1e-9);
  near(ratio("not_considered"), 1, 1e-9);
  near(ratio(null), 1, 1e-9);
  assert.ok(keys(run(c(null), s, { hooks: hooks({ legacy: true }) })).includes("hooks.legacy_not_weighed"));
  // The cap holds: legacy can't lift a Highly selective college past Target.
  assert.equal(run(c("very_important"), student({ test: sat(1600) }), { hooks: hooks({ legacy: true }) }).group, "target");
});

test("legacy in a state that bars it is ignored, and the ban is cited by state and law", () => {
  const r = detailed(LEGACY_MD(), student({ test: sat(1450) }), { hooks: hooks({ legacy: true }) });
  near(r.detail.hiddenOdds! / detailed(LEGACY_MD(), student({ test: sat(1450) })).detail.hiddenOdds!, 1, 1e-9);
  const ban = r.result.notes.find((n) => n.key === "hooks.legacy_banned")!;
  assert.equal(ban.values.state, "Maryland");
  assert.equal(ban.values.scope, "all");
  assert.ok(String(ban.values.law).length > 0);
});

test("interest: 1.15 where the college rates it important, 1.05 at considered, nothing (said) where not", () => {
  const c = (rating: string | null) => college("100654", { rate: 0.3, sat: [1200, 1400], c7: rating ? { interest: rating } : null });
  const s = student({ test: sat(1300) });
  const ratio = (rating: string | null) => detailed(c(rating), s, { hooks: hooks({ interest: true }) }).detail.hiddenOdds! / detailed(c(rating), s).detail.hiddenOdds!;
  near(ratio("important"), 1.15, 1e-9);
  near(ratio("considered"), 1.05, 1e-9);
  near(ratio("not_considered"), 1, 1e-9);
  const shown = run(c("important"), s, { hooks: hooks({ interest: true }) });
  assert.ok(shown.used.includes("interest"));
  assert.ok(keys(shown).includes("hooks.interest"));
  assert.ok(texts(run(c(null), s, { hooks: hooks({ interest: true }) })).some((t) => /^Not used here: shown interest .*doesn't say it weighs it\)\.$/.test(t)));
});

test("first generation is noted where the college rates it, never estimated", () => {
  const c = () => college("100654", { rate: 0.3, sat: [1200, 1400], c7: { first_generation: "considered" } });
  const yes = detailed(c(), student({ test: sat(1300), firstGeneration: true }));
  const no = detailed(c(), student({ test: sat(1300), firstGeneration: false }));
  assert.equal(yes.detail.hiddenOdds, no.detail.hiddenOdds);
  assert.ok(texts(yes.result).some((t) => t.endsWith("rates first-generation status considered; it's noted, not estimated.")));
  assert.ok(!keys(no.result).includes("estimate.first_generation"));
});

test("class standing: the pick enters as class rank where the college weighs rank", () => {
  const r = run(ELON(), student({ gpa: 3.9, classRankPercentile: 10, classStanding: "top10" }));
  assert.ok(r.used.includes("class_rank") && r.used.includes("class_standing"));
  // Revision 3, rule 5: the pick is the student's perceived standing; "My school doesn't rank" reads as unanswered.
  assert.ok(run(ELON(), student({ gpa: 3.9, classStanding: "no_rank" })).missing.includes("class_rank"), "no_rank is unanswered");
});

/* ------------------------------------------------------------------ */
/* Readings carried over from the second version                       */
/* ------------------------------------------------------------------ */

test("score: unused at a test-optional college whose C7 says tests aren't considered; used where they are", () => {
  const off = run(ELON(), student({ test: sat(1500) }));
  assert.equal(off.send, "not-used");
  assert.ok(keys(off).includes("estimate.not_used"));
  assert.equal(off.moveUp, null);
  const on = run(college("198516", { rate: 0.63, sat: [1170, 1350], policy: "considered", c7: { test_scores: "considered" } }), student({ test: sat(1500) }));
  assert.equal(on.send, "send");
  assert.ok(on.used.includes("test"));
});

test("GPA: unused where C7 says it isn't considered, used where it is or where nothing is said", () => {
  const base = { rate: 0.45, gpa: reportedGpa(3.5) };
  const off = run(college("198516", { ...base, c7: { gpa: "not_considered" } }), student({ gpa: 3.9 }));
  assert.equal(off.group, null);
  assert.ok(texts(off).some((t) => /^Not used here: GPA/.test(t)));
  assert.equal(run(college("198516", { ...base, c7: { gpa: "considered" } }), student({ gpa: 3.9 })).group, "likely");
  assert.equal(run(college("198516", { ...base, c7: null, federal: { gpa: "not_considered" } }), student({ gpa: 3.9 })).group, null);
});

test("crowding: at or above the 25th only meets the bar at a crowded college; below keeps its measured distance", () => {
  const mk = (top: [number, number] | null) => college("198516", { rate: 0.55, gpa: middleGpa(3.3, 3.7), c7: { gpa: "very_important" }, topShare: top, policy: "considered" });
  assert.equal(run(mk([0.2, 0.2]), student({ gpa: 3.95 })).group, "safe", "40% at 3.75+: not crowded, measured from the bands");
  const crowded = detailed(mk([0.4, 0.2]), student({ gpa: 3.95 }));
  assert.equal(crowded.result.group, "likely", "60% at 3.75+: meets the bar");
  assert.equal(crowded.detail.crowded, true);
  assert.ok(crowded.result.facts.includes("derived.gpa_top_share"));
  assert.equal(detailed(mk([0.4, 0.2]), student({ gpa: 3.1 })).detail.position, "below", "a low GPA is still low");
  assert.equal(STANDING_V2.crowdedShare, 0.5);
});

test("rigor: raises a crowded slot only where the college weighs rigor", () => {
  const mk = (rigor: string, top: [number, number] | null) => college("198516", { rate: 0.4, gpa: middleGpa(3.6, 4.0), c7: { gpa: "very_important", rigor }, topShare: top });
  const most = { offering: OFFERING(9), linked: true };
  const s = student({ gpa: 3.9, courses: EIGHT_APS });
  const raised = detailed(mk("very_important", [0.5, 0.2]), s, most);
  assert.equal(raised.result.group, "likely");
  assert.equal(raised.detail.without?.rigor, "target");
  assert.equal(run(mk("considered", [0.5, 0.2]), s, most).group, "target", "rigor only considered: not used");
  const noSchool = run(mk("very_important", [0.5, 0.2]), s);
  assert.equal(noSchool.group, "target", "can't place without the school's offering");
  assert.ok(noSchool.missing.includes("high_school"));
});

test("class rank: counts only where C7 weighs it and enough first-years reported one; the tiers place it", () => {
  const mk = (o: Partial<CollegeOpts>) => college("198516", { rate: 0.4, gpa: middleGpa(3.62, 4.0), c7: { gpa: "very_important", class_rank: "considered" }, classRank: { top_tenth: 0.2, top_quarter: 0.48, top_half: 0.81, submitted_share: 0.35 }, ...o });
  const withRank = detailed(mk({}), student({ gpa: 3.8, classRankPercentile: 10 }));
  const without = detailed(mk({}), student({ gpa: 3.8 }));
  assert.ok(withRank.detail.hiddenOdds! > without.detail.hiddenOdds!, "top 10% where 20% of ranked first-years were: above");
  assert.ok(withRank.result.used.includes("class_rank"));
  const notWeighed = run(mk({ c7: { gpa: "very_important", class_rank: "not_considered" } }), student({ gpa: 3.8, classRankPercentile: 10 }));
  assert.ok(texts(notWeighed).some((t) => /^Not used here: class rank/.test(t)));
  assert.ok(Math.abs(rankShareAtOrAbove(10, { top_tenth: 0.89, top_quarter: 0.98, top_half: 0.99 })! - 0.89) < 1e-9);
  assert.equal(rankShareAtOrAbove(10, { top_tenth: null, top_quarter: null, top_half: null }), null);
  const gt = run(mk({ classRank: { top_tenth: 0.89, top_quarter: 0.98, top_half: 0.99, submitted_share: 0.4 } }), student({ gpa: 3.8, classRankPercentile: 10 }));
  assert.ok(keys(gt).includes("estimate.rank_below"));
});

test("major subjects: a required course missing is below; grades well under the overall GPA lower the level", () => {
  const cornell = () => college("190415", { rate: 0.45, gpa: reportedGpa(3.8), c7: null });
  const noChem = run(cornell(), student({ gpa: 3.8, majors: ["14"], courses: [ap("ap_calculus_bc", "math"), ap("ap_physics_c_mechanics", "science")] }));
  const all = run(cornell(), student({ gpa: 3.8, majors: ["14"], courses: [ap("ap_calculus_bc", "math"), ap("ap_physics_c_mechanics", "science"), ap("ap_chemistry", "science")] }));
  assert.ok(RANK(noChem.group)! < RANK(all.group)!);
  assert.ok(texts(noChem).includes("Cornell Duffield College of Engineering expects chemistry; it isn't on your list."));
  const empty = run(cornell(), student({ gpa: 3.8, majors: ["14"] }));
  assert.ok(empty.missing.includes("courses"));
  const berkeley = () => college("110635", { rate: 0.45, gpa: reportedGpa(3.8), policy: "not-considered", c7: null, satMath: [700, 790] });
  const strongGrades = [ap("ap_calculus_bc", "math", "A"), ap("ap_physics_c_mechanics", "science", "A")];
  const weak = [ap("ap_calculus_bc", "math", "B-"), ap("ap_physics_c_mechanics", "science", "B-")];
  const on = run(berkeley(), student({ gpa: 3.8, majors: ["14"], courses: strongGrades }));
  const lower = run(berkeley(), student({ gpa: 3.8, majors: ["14"], courses: weak }));
  assert.ok(RANK(lower.group)! < RANK(on.group)!);
  assert.ok(on.used.includes("subject_grades"));
});

/* ------------------------------------------------------------------ */
/* Revision 2: rank and rigor nudges, themes (2026-10-12)              */
/* ------------------------------------------------------------------ */

/** A college weighing GPA (C7) and tests, with no GPA figures (a GPA counts as entered but can't be placed). */
const NUDGE_ON = () => college("100654", { rate: 0.2, sat: [1300, 1400], c7: { gpa: "very_important", test_scores: "important" } });
/** The same college saying GPA isn't considered and rating neither rank nor rigor: no nudge applies. */
const NUDGE_OFF = () => college("100654", { rate: 0.2, sat: [1300, 1400], c7: { gpa: "not_considered", test_scores: "important" } });
const oddsOf = (c: { school: School; standing: StandingSchool }, s: EstimateStudent, extra: Partial<ModelInput> = {}) => detailed(c, s, extra).detail.hiddenOdds!;
const NUDGE_BASE = (o: Partial<EstimateStudent> = {}) => student({ gpa: UNPLACED_GPA, test: sat(1350), ...o });

test("Revision 2, rank nudges: top 5% ×1.05, top 1% ×1.08, salutatorian ×1.10, valedictorian ×1.15, the highest only", () => {
  assert.deepEqual(ODDS_V3.rankNudge, { top5: 1.05, top1: 1.08, salutatorian: 1.1, valedictorian: 1.15 });
  const base = oddsOf(NUDGE_ON(), NUDGE_BASE());
  const ratio = (o: Partial<EstimateStudent>) => oddsOf(NUDGE_ON(), NUDGE_BASE(o)) / base;
  near(ratio({ classRankPercentile: 10, classStanding: "top10" }), 1, 1e-9);
  near(ratio({ classRankPercentile: 5, classStanding: "top5" }), 1.05, 1e-9);
  near(ratio({ classRankPercentile: 5, classStanding: null }), 1.05, 1e-9);
  near(ratio({ classRankPercentile: 1, classStanding: "top1" }), 1.08, 1e-9);
  near(ratio({ rankExpectation: "salutatorian" }), 1.1, 1e-9);
  near(ratio({ rankExpectation: "valedictorian" }), 1.15, 1e-9);
  // Never stacked: valedictorian with top 1% is the valedictorian nudge alone; salutatorian beats top 5%.
  near(ratio({ rankExpectation: "valedictorian", classRankPercentile: 1, classStanding: "top1" }), 1.15, 1e-9);
  near(ratio({ rankExpectation: "salutatorian", classRankPercentile: 5, classStanding: "top5" }), 1.1, 1e-9);
  // "My school doesn't rank" is no standing nudge.
  near(ratio({ classStanding: "no_rank" }), 1, 1e-9);
  // The expectation's sentence says it's an expectation.
  const r = run(NUDGE_ON(), NUDGE_BASE({ rankExpectation: "valedictorian" }));
  assert.ok(texts(r).includes(`Class standing: expects to be valedictorian, an expectation until it's official. ${NUDGE_ON().school.name} weighs grades and class standing, so it counts here.`), texts(r).join(" | "));
  assert.ok(r.used.includes("class_standing"));
  const top5 = run(NUDGE_ON(), NUDGE_BASE({ classRankPercentile: 5, classStanding: "top5" }));
  assert.ok(texts(top5).some((x) => x.startsWith("Your class standing (top 5%) counts here")));
});

test("Revision 2, rank nudges: off where the college weighs neither class rank nor GPA; on where it weighs rank alone", () => {
  const base = oddsOf(NUDGE_OFF(), NUDGE_BASE());
  near(oddsOf(NUDGE_OFF(), NUDGE_BASE({ rankExpectation: "valedictorian", classRankPercentile: 1, classStanding: "top1" })) / base, 1, 1e-9);
  const r = run(NUDGE_OFF(), NUDGE_BASE({ rankExpectation: "valedictorian" }));
  assert.ok(!r.used.includes("class_standing"));
  assert.ok(keys(r).includes("estimate.not_used") && texts(r).some((x) => x.startsWith("Not used here: class standing")));
  // Rank alone (C7 class rank considered, GPA not): on. Both records answer the rank question, so completeness matches.
  const rankOnly = () => college("100654", { rate: 0.2, sat: [1300, 1400], c7: { gpa: "not_considered", class_rank: "considered", test_scores: "important" } });
  near(oddsOf(rankOnly(), NUDGE_BASE({ classRankPercentile: 5, classStanding: "top5" })) / oddsOf(rankOnly(), NUDGE_BASE({ classRankPercentile: 10, classStanding: "top10" })), 1.05, 1e-9);
});

test("Revision 2, weighted over unweighted: ×1.04 from a 0.3 lead, ×1.08 from 0.6; 100-point scales by 3 and 6 points; nothing without a lead", () => {
  assert.deepEqual(ODDS_V3.weightedGap, [[0.6, 1.08], [0.3, 1.04]]);
  assert.deepEqual(ODDS_V3.weightedGap100, [[6, 1.08], [3, 1.04]]);
  const base = oddsOf(NUDGE_ON(), NUDGE_BASE());
  const ratio = (o: Partial<EstimateStudent>, c = NUDGE_ON) => oddsOf(c(), NUDGE_BASE(o)) / oddsOf(c(), NUDGE_BASE({ ...o, weightedGpa: null }));
  near(ratio({ weightedGpa: 4.1 }), 1, 1e-9);
  near(ratio({ weightedGpa: 4.2 }), 1.04, 1e-9);
  near(ratio({ weightedGpa: 4.4 }), 1.04, 1e-9);
  near(ratio({ weightedGpa: 4.5 }), 1.08, 1e-9);
  near(ratio({ weightedGpa: 3.8 }), 1, 1e-9);
  near(oddsOf(NUDGE_ON(), NUDGE_BASE()) / base, 1, 1e-9);
  // A 5-point scale: 4.5/5.0 reads as 3.6 unweighted on 4.0; the lead is read on the student's own scale.
  near(ratio({ gpa: 3.6, gpaScale: "5.0", gpaRange: [3.6, 3.6], weightedGpa: 4.9 }), 1.04, 1e-9);
  near(ratio({ gpa: 3.6, gpaScale: "5.0", gpaRange: [3.6, 3.6], weightedGpa: 5.2 }), 1.08, 1e-9);
  // A 100-point scale: 3.7 is the 93–96 band, read at its top (96).
  near(ratio({ gpa: 3.7, gpaScale: "100", gpaRange: [3.7, 3.7], weightedGpa: 98 }), 1, 1e-9);
  near(ratio({ gpa: 3.7, gpaScale: "100", gpaRange: [3.7, 3.7], weightedGpa: 99 }), 1.04, 1e-9);
  near(ratio({ gpa: 3.7, gpaScale: "100", gpaRange: [3.7, 3.7], weightedGpa: 102 }), 1.08, 1e-9);
  // Nothing where the GPA entered on the 4.0 scale is itself weighted (a range), or a weighted figure off the scale.
  near(ratio({ gpa: 4.0, gpaRange: [3.4, 4.0], weightedGpa: 4.9 }), 1, 1e-9);
  near(ratio({ weightedGpa: 95 }), 1, 1e-9);
  // Off where the college weighs neither rigor nor GPA.
  near(ratio({ weightedGpa: 4.5 }, NUDGE_OFF), 1, 1e-9);
  // On where it weighs rigor alone (C7 rigor important), and said in a sentence without the multiplier.
  const rigorOnly = () => college("100654", { rate: 0.2, sat: [1300, 1400], c7: { gpa: "not_considered", rigor: "important", test_scores: "important" } });
  near(oddsOf(rigorOnly(), NUDGE_BASE({ weightedGpa: 4.5, courses: TWO_APS })) / oddsOf(rigorOnly(), NUDGE_BASE({ courses: TWO_APS })), 1.08, 1e-9);
  const r = run(NUDGE_ON(), NUDGE_BASE({ weightedGpa: 4.5 }));
  assert.ok(texts(r).some((x) => x.startsWith("Your weighted GPA (4.5) sits well above your unweighted one")));
});

/** A college rating extracurriculars important (the theme's gate), GPA and tests, no GPA figures. */
const THEME_COLLEGE = (extracurriculars = "important") => college("100654", { rate: 0.2, sat: [1300, 1400], c7: { gpa: "very_important", test_scores: "important", extracurriculars } });
/** Science deep (10th–12th, rising, senior year), math steady (11th, 12th). */
const TRACKS = [
  ap("ap_biology", "science", "A", 10),
  ap("ap_chemistry", "science", "A", 11),
  ap("ap_physics_c_mechanics", "science", "A", 12),
  ap("ap_calculus_ab", "math", "A", 11),
  ap("ap_calculus_bc", "math", "A", 12),
];
const SCI_OLY = activity("Science Olympiad", "club", [10, 11, 12], { family: "science" });
const MATH_CLUB = activity("Math team", "club", [11, 12], { family: "math" });
/** Revision 3: a humanities activity, and courses that read Steady in the humanities group too (English 11th, 12th). */
const DEBATE = activity("Debate", "club", [11, 12], { family: "english" });
const TRACKS_WIDE = [...TRACKS, ap("ap_english_language", "english", "A", 11), ap("ap_english_literature", "english", "A", 12)];

test("Revision 3, themes by broad group: one ×1.10, two or more ×1.18, multiplying with depth; none without a matching group", () => {
  assert.deepEqual(ODDS_V3.theme, { one: 1.1, two: 1.18 });
  const at = (acts: ActivityEntry[], c = THEME_COLLEGE, courses = TRACKS_WIDE) => oddsOf(c(), NUDGE_BASE({ courses, activities: acts }));
  const noFamily = (a: ActivityEntry) => ({ ...a, family: null });
  // Both records read Building (×1.1 depth at "important"), so the ratio is the theme alone.
  const none = at([noFamily(SCI_OLY), noFamily(MATH_CLUB)]);
  near(at([SCI_OLY, noFamily(MATH_CLUB)]) / none, 1.1, 1e-9);
  // Science and math are one group (STEM) now: one theme, where Revision 2 counted two.
  near(at([SCI_OLY, MATH_CLUB]) / none, 1.1, 1e-9);
  // STEM and the humanities: two.
  near(at([SCI_OLY, DEBATE]) / at([noFamily(SCI_OLY), noFamily(DEBATE)]), 1.18, 1e-9);
  // Business belongs to both STEM and the social sciences, so one business club lines up with each (owner: "Business
  // has ties in with math, statistics, computer science").
  const deca = activity("DECA", "club", [10, 11, 12], { catalogKey: "deca" });
  const plainClub = { ...deca, catalogKey: null };
  near(at([deca]) / at([plainClub]), 1.18, 1e-9);
  near(at([deca], THEME_COLLEGE, TRACKS) / at([plainClub], THEME_COLLEGE, TRACKS), 1.1, 1e-9);
  // A catalog pick without its own family reads the catalog's (Science Olympiad is a science club).
  near(at([{ ...noFamily(SCI_OLY), catalogKey: "science_olympiad" }, noFamily(MATH_CLUB)]) / none, 1.1, 1e-9);
  // An activity of one year doesn't join a theme; a group whose courses don't read Deep or Steady doesn't either;
  // athletics sit outside every group.
  near(at([noFamily(SCI_OLY), { ...MATH_CLUB, years: [12] }]) / none, 1, 1e-9);
  near(at([noFamily(SCI_OLY), { ...MATH_CLUB, family: "arts" }]) / none, 1, 1e-9);
  near(at([noFamily(SCI_OLY), { ...MATH_CLUB, family: "athletics" }]) / none, 1, 1e-9);
  // Multiplies with M_depth: a Focused record (×1.3) with one theme against the same record with no family.
  const captain = activity("Soccer", "sport", [9, 10, 11, 12], { roles: { 12: "leader" }, family: "athletics" });
  near(at([captain, SCI_OLY]) / at([captain, noFamily(SCI_OLY)]), 1.1, 1e-9);
  near(at([captain, noFamily(SCI_OLY)]) / at([noFamily(SCI_OLY)]), 1.3 / 1.1, 1e-9);
  // Applied where the college rates activities at least considered; not where it doesn't.
  near(at([SCI_OLY, DEBATE], () => THEME_COLLEGE("considered")) / at([noFamily(SCI_OLY), noFamily(DEBATE)], () => THEME_COLLEGE("considered")), 1.18, 1e-9);
  near(at([SCI_OLY, DEBATE], () => THEME_COLLEGE("not_considered")) / at([noFamily(SCI_OLY), noFamily(DEBATE)], () => THEME_COLLEGE("not_considered")), 1, 1e-9);
});

test("Revision 3, themes: a group's courses read together (one year of science and one of math make a Steady STEM group)", () => {
  const at = (courses: CourseEntry[]) => oddsOf(THEME_COLLEGE(), NUDGE_BASE({ courses, activities: [SCI_OLY] })) / oddsOf(THEME_COLLEGE(), NUDGE_BASE({ courses, activities: [{ ...SCI_OLY, family: null }] }));
  // Each family alone reads Light (one year), but STEM taken together has two years: a theme.
  near(at([ap("ap_biology", "science", "A", 10), ap("ap_calculus_ab", "math", "A", 11)]), 1.1, 1e-9);
  near(at([ap("ap_biology", "science", "A", 10)]), 1, 1e-9);
  // AP Psychology is in both groups (data/reference/depth-groups.json): with one year of science it makes STEM Steady.
  near(at([ap("ap_biology", "science", "A", 10), ap("ap_psychology", "history", "A", 11)]), 1.1, 1e-9);
  near(at([ap("ap_biology", "science", "A", 10), ap("ap_us_history", "history", "A", 11)]), 1, 1e-9);
});

test("Revision 3, themes: the sentence names the group in words, and a suggestion where courses or an activity have no partner", () => {
  const notesFor = (acts: ActivityEntry[], courses = TRACKS_WIDE) => run(THEME_COLLEGE(), NUDGE_BASE({ courses, activities: acts }));
  const two = notesFor([SCI_OLY, DEBATE]);
  assert.ok(texts(two).includes("Your courses and activities line up in STEM and the humanities and social sciences: depth in one area, in and out of class."), texts(two).join(" | "));
  const one = notesFor([SCI_OLY]);
  assert.ok(texts(one).includes("Your courses and activities line up in STEM: depth in one area, in and out of class."));
  assert.ok(!keys(one).includes("depth.theme.track_only"), "with a theme, no club is asked for in every other area");
  const sport = notesFor([activity("Soccer", "sport", [9, 10, 11, 12], { family: "athletics" })], TRACKS);
  assert.ok(texts(sport).includes("Your courses in STEM run through high school; a club, team, or program in STEM would tie them to what you do outside class."), "a group with no activity, the deep one first");
  const art = notesFor([SCI_OLY, activity("Art club", "arts", [10, 11], { family: "arts" })]);
  assert.ok(texts(art).includes("You keep up the arts outside class; an honors or advanced course in the arts each year would tie it to your schedule."), "an activity with no courses behind it");
  const unnamed = notesFor([{ ...SCI_OLY, family: null }]);
  assert.ok(keys(unnamed).includes("depth.theme.add_family"));
  assert.ok(!keys(unnamed).includes("depth.theme"));
  // Never an activity's name in a theme sentence.
  for (const n of [...two.notes, ...one.notes].filter((x) => x.key.startsWith("depth.theme"))) assert.doesNotMatch(noteText(n), /Olympiad|Math team|Debate/);
});

test("pinned, Revision 2: a valedictorian expectation lifts a 22% Reach to Target at a college weighing GPA; top 5% doesn't", () => {
  const level = (o: Partial<EstimateStudent>) => detailed(NUDGE_ON(), NUDGE_BASE(o));
  const base = level({});
  assert.equal(base.result.group, "reach");
  near(base.detail.hiddenOdds, 0.22, 1e-9);
  const top5 = level({ classRankPercentile: 5, classStanding: "top5" });
  assert.equal(top5.result.group, "reach");
  near(top5.detail.hiddenOdds, 0.231, 1e-9);
  const val = level({ rankExpectation: "valedictorian" });
  assert.equal(val.result.group, "target");
  near(val.detail.hiddenOdds, 0.253, 1e-9);
  const both = level({ rankExpectation: "valedictorian", weightedGpa: 4.5 });
  near(both.detail.hiddenOdds, 0.22 * 1.15 * 1.08, 1e-9);
});

test("pinned, Revision 3: at Elon admitting 25%, a complete record moves from Target to Likely when its courses and activities line up", () => {
  const at = (acts: ActivityEntry[], o: Partial<EstimateStudent> = {}) =>
    detailed(ELON(0.25), student({ gpa: 3.9, courses: THREADED_APS, classStanding: "top10", classRankPercentile: 10, activities: acts, ...o }), { offering: OFFERING(14), linked: true });
  const none = at([{ ...SCI_OLY, family: null }, { ...MATH_CLUB, family: null }]);
  assert.equal(none.result.group, "target");
  near(none.detail.hiddenOdds, 0.483, 0.001);
  // Science Olympiad with science courses: one theme (STEM).
  const one = at([SCI_OLY, { ...MATH_CLUB, family: null }]);
  assert.equal(one.result.group, "target");
  near(one.detail.hiddenOdds, 0.531, 0.001);
  // Revision 2 read math team beside it as a second theme (Likely, 61.7%); science and math are one group now.
  const stem = at([SCI_OLY, MATH_CLUB]);
  assert.equal(stem.result.group, "target");
  near(stem.detail.hiddenOdds, 0.531, 0.001);
  // STEM and the humanities (debate beside the English and history courses): two themes, Likely.
  const two = at([SCI_OLY, DEBATE]);
  assert.equal(two.result.group, "likely");
  near(two.detail.hiddenOdds, 0.570, 0.001);
  assert.equal(two.detail.without?.depth, "target", "without depth it's the Target again");
  // Revision 2's row ("doesn't rank") now reads class standing as unanswered: completeness 6/7.
  const noRank = at([SCI_OLY, MATH_CLUB], { classStanding: "no_rank", classRankPercentile: null });
  assert.equal(noRank.result.group, "target");
  near(noRank.detail.hiddenOdds, 0.484, 0.001);
});

test("Revision 2: activities of every kind count toward completeness (sports, clubs, work, other)", () => {
  const c = () => college("100654", { rate: 0.3, sat: [1200, 1400], gpa: middleGpa(3.4, 3.9), c7: { gpa: "very_important", test_scores: "important", extracurriculars: "important" } });
  const none = readings(c(), student({ gpa: 3.8, test: sat(1300) })).completeness;
  for (const kind of ["sport", "club", "work", "other", "family", "service", "arts", "research"] as const) {
    near(readings(c(), student({ gpa: 3.8, test: sat(1300), activities: [activity("X", kind, [11])] })).completeness, 1, 1e-9);
  }
  assert.ok(none < 1);
});

test("owner 2026-10-12: 'None' on every activity step reads as answered for completeness, with no depth credit", async () => {
  const { activitiesReading } = await import("../lib/chances/depth.ts");
  const c = () => college("100654", { rate: 0.3, sat: [1200, 1400], gpa: middleGpa(3.4, 3.9), c7: { gpa: "very_important", test_scores: "important", extracurriculars: "important" } });
  const base = { gpa: 3.8, test: sat(1300) };
  const gap = readings(c(), student(base));
  const answered = readings(c(), student({ ...base, activitiesAnswered: true }));
  assert.ok(gap.completeness < 1, "unanswered steps are a gap");
  near(answered.completeness, 1, 1e-9);
  // No depth credit: the reading runs on the (empty) list, and the flag never reaches it.
  assert.equal(activitiesReading([], []).reading, null);
  // Guard: only a literal true counts; anything else is still a gap.
  near(readings(c(), student({ ...base, activitiesAnswered: false })).completeness, gap.completeness, 1e-9);
});

/* ------------------------------------------------------------------ */
/* The snapshot detail                                                 */
/* ------------------------------------------------------------------ */

test("the snapshot detail: position, pool, crowding, reading, hidden odds, tier, depth, and the level with each input off", () => {
  const purdue = PURDUE();
  const { result, detail } = detailed(purdue, student({ state: "IN", test: sat(1300), gpa: 3.85 }));
  assert.equal(result.group, "likely");
  assert.equal(detail.position, "in");
  assert.equal(detail.baseRateKind, "residency");
  near(detail.baseRate, 0.71, 1e-9);
  near(detail.hiddenOdds, 0.582, 0.001);
  assert.equal(detail.selectivityTier, "selective");
  assert.equal(detail.without?.residency, "target", "43% overall, Highly selective for all applicants");
  assert.deepEqual(Object.keys(detail.without!).sort(), ["crowding", "depth", "hooks", "interest", "rank", "residency", "rigor"]);
  assert.ok(detail.depth && detail.depth.activitiesCount === 0);
  assert.ok(!("detail" in result) && !("hiddenOdds" in result));
  // Revision 2: completeness rides in the detail (courses and class standing missing at Purdue: 4 of 7), never the result.
  near(detail.completeness, 4 / 7, 1e-9);
  assert.ok(!("completeness" in result));
});

test("every note is a catalog key with a sentence, and every fact is a registered field", () => {
  const cases = [
    run(PURDUE(), student({ state: "IN", test: sat(1300), gpa: 3.85, classRankPercentile: 12 })),
    run(ELON(), student({ gpa: 3.9, courses: EIGHT_APS, classRankPercentile: 10, test: sat(1250), activities: FOCUSED }), { offering: OFFERING(9) }),
    run(UT_AUSTIN(), student({ state: "TX", classRankPercentile: 4, test: sat(1350), majors: ["14"], round: "ed" })),
    run(GEORGIA_TECH(), student({ state: "FL", test: sat(1500), gpa: 3.95, majors: ["undecided"] })),
    run(LEGACY_MD(), student({ test: sat(1450), firstGeneration: true }), { hooks: hooks({ legacy: true, interest: true, recruited: "pre_read" }) }),
  ];
  for (const r of cases) {
    assert.equal(r.modelVersion, MODEL_VERSION);
    for (const n of r.notes) {
      assert.ok(isNoteKey(n.key), n.key);
      assert.notEqual(noteText(n), "", n.key);
      assert.ok(/^[a-z0-9_.]+$/.test(n.key), `${n.key} fits the snapshot's key pattern`);
    }
    for (const f of r.facts) assert.ok(isFieldPath(f), f);
  }
});

/* ------------------------------------------------------------------ */
/* The structured pool and Compare's sub-line                          */
/* ------------------------------------------------------------------ */

test("pool: the published rate's kind, rate, and who-phrase; Compare's line reads it, never a sentence", () => {
  const inState = run(PURDUE(), student({ state: "IN", test: sat(1300), gpa: 3.85 }));
  assert.deepEqual(inState.pool, { kind: "residency", rate: 0.71, whoKey: "pool.who.residency_in", whoValues: { state: "Indiana" } });
  assert.equal(compareShortLine(inState), "from Indiana: 71%");
  const out = run(PURDUE(), student({ state: "OH", test: sat(1300), gpa: 3.85 }));
  assert.equal(compareShortLine(out), "from outside Indiana: 44%");
  const overall = run(FIFTEEN(), student({ test: sat(1500) }));
  assert.equal(compareShortLine(overall), "everyone: 15%");
  assert.equal(compareShortLine(run(UT_AUSTIN(), student({ state: "TX", classRankPercentile: 4 }))), "guaranteed");
  assert.equal(run(college("100654", { rate: null, c7: null }), student({ gpa: 3 })).pool, null, "open admission: no rate");
  // The line comes from the structured field: a result whose pool sentence is gone still shows the rate.
  const noSentence: EstimateResult = { ...inState, notes: [] };
  assert.equal(compareShortLine(noSentence), "from Indiana: 71%");
  assert.equal(compareShortLine({ ...inState, pool: null }), null);
});

/* ------------------------------------------------------------------ */
/* Guards: no hidden odds, multiplier, index, or cutoff anywhere public */
/* ------------------------------------------------------------------ */

/** The names the method's internals go by; a public surface carrying any of them leaks the method. */
/* ------------------------------------------------------------------ */
/* Revision 3: the estimate reads the record the way the owner does    */
/* ------------------------------------------------------------------ */

/** A course taken (or in progress) with an exam score and no letter grade. */
function apExam(key: string, subject: CourseEntry["subject"], year: CourseEntry["year"], exam: CourseEntry["exam"], status: CourseEntry["status"] = "taken"): CourseEntry {
  return { ...ap(key, subject, null, year), exam: status === "taken" ? exam : null, status };
}
/** THREADED_APS with no letter grades and this exam score on each. */
const examsOnly = (exam: CourseEntry["exam"]) => THREADED_APS.map((c) => ({ ...c, grades: { s1: null, s2: null, final: null }, exam }));

test("Revision 3, rule 1: an AP exam score is the course's grade for advanced-course grades (5 → 4.0, 4 → 3.7, 3 → 3.0), the better of it and the letter", () => {
  const at = (courses: CourseEntry[]) => run(ULTRA(), EXCELLENT({ courses }), LINKED);
  assert.deepEqual(ODDS_V3.examPoints.ap, { 5: 4, 4: 3.7, 3: 3, 2: 2, 1: 1 });
  assert.deepEqual(ODDS_V3.examPoints.ib, { 7: 4, 6: 3.7, 5: 3.3, 4: 3, 3: 2, 2: 1, 1: 1 });
  assert.equal(at(examsOnly(5)).group, "reach", "fives and no letter grades");
  assert.equal(at(examsOnly(4)).group, "reach", "fours: 3.7");
  assert.equal(at(examsOnly(3)).group, "high_reach", "threes: 3.0");
  assert.ok(!texts(at(examsOnly(4))).some((t) => t.includes("advanced-course grades")), "an exam score is a grade, not a gap");
  // The better reading: a B+ (3.3) with a 5 reads 4.0; an A with a 2 reads 4.0.
  assert.equal(at(graded("B+").map((c) => ({ ...c, exam: 5 as const }))).group, "reach");
  assert.equal(at(graded("A").map((c) => ({ ...c, exam: 2 as const }))).group, "reach");
  // No letter grade and no exam score: still a gap, named.
  const none = at(examsOnly(null));
  assert.equal(none.group, "high_reach");
  assert.ok(texts(none).some((t) => t.startsWith("Not in this estimate yet: your advanced-course grades.")));
});

test("Revision 3, rule 1: courses in progress and planned have no grade yet and never count against the student", () => {
  const at = (courses: CourseEntry[], extra: Partial<ModelInput> = {}) => run(ULTRA(), EXCELLENT({ courses }), { ...LINKED, grade: 11, ...extra });
  const inProgress = (c: CourseEntry, final: CourseEntry["grades"]["s1"] = null): CourseEntry => ({ ...c, status: "in_progress", exam: null, grades: { s1: final, s2: null, final: null } });
  const done = THREADED_APS.filter((c) => c.year === 10);
  const now = THREADED_APS.filter((c) => c.year === 11);
  // Nothing completed yet, nothing graded (a junior's first advanced courses; the core answers carry the STEM theme):
  // passes, where Revision 2 failed it.
  const firstYear = [...now, ...done.map((c) => ({ ...c, year: 11 as const }))].map((c) => inProgress(c));
  assert.equal(at(firstYear, { coreAtTopLevel: ALL_CORE }).group, "reach");
  // Completed A's with a C semester grade in progress: the in-progress grade doesn't lower it.
  assert.equal(at([...done, ...now.map((c) => inProgress(c, "C"))]).group, "reach");
  // Completed B's with A semester grades in progress: they lift it (3.0 alone; with the A's, 3.7).
  const bDone = done.map((c) => ({ ...c, grades: { s1: null, s2: null, final: "B" as const } }));
  assert.equal(at([...bDone, ...now.map((c) => inProgress(c))]).group, "high_reach", "B's alone");
  const lifted = [...bDone, ...now.map((c) => inProgress(c, "A")), ap("ap_us_government", "history", null, 11, "ap")].map((c) => (c.status === "taken" && c.grades.final === null ? { ...c, status: "in_progress" as const, grades: { s1: "A" as const, s2: null, final: null } } : c));
  assert.equal(at(lifted).group, "reach", "A's in progress lift completed B's");
});

/** A junior like the owner's example (method/standing.md "Revision 3"): exam scores and no letter grades, a target score, business club, no state. */
const VANDY = () =>
  college("221999", {
    rate: 0.054,
    act: [34, 35],
    policy: "considered",
    gpa: middleGpa(3.81, 4.0),
    c7: { gpa: "very_important", rigor: "very_important", class_rank: "considered", test_scores: "considered", extracurriculars: "important" },
    classRank: { top_tenth: 0.91, top_quarter: 0.98, top_half: 1, submitted_share: 0.25 },
    topShare: [0.6, 0.28],
    tier: "elite",
  });
const JUNIOR = (o: Partial<EstimateStudent> = {}) =>
  student({
    gpa: 4.0,
    weightedGpa: 4.3,
    test: { kind: "act", score: 29 },
    testTarget: { kind: "act", score: 34 },
    gradYear: 2028,
    classStanding: "top5",
    classRankPercentile: 5,
    courses: [
      apExam("ap_computer_science_principles", "cs", 10, 4),
      apExam("ap_european_history", "history", 10, 5),
      apExam("ap_psychology", "history", 10, 5),
      apExam("ap_us_history", "history", 11, null, "in_progress"),
      apExam("ap_statistics", "math", 11, null, "in_progress"),
      apExam("ap_english_language", "english", 11, null, "in_progress"),
      apExam("ap_biology", "science", 11, null, "in_progress"),
    ],
    activities: [
      activity("Tennis", "sport", [9, 10, 11, 12], { roles: { 12: "leader" }, family: "athletics" }),
      activity("Flag football", "sport", [9, 10, 11, 12], { family: "athletics" }),
      activity("DECA", "club", [9, 10, 11, 12], { roles: { 11: "officer", 12: "leader" }, catalogKey: "deca", family: "business" }),
      activity("Out of the box", "work", [10, 11, 12], { hoursPerWeek: 5 }),
    ],
    ...o,
  });
const JUNIOR_CTX: Partial<ModelInput> = { offering: OFFERING(28), linked: true, grade: 11, asOf: "2026-10-12", schoolState: "NY" };

test("Revision 3, pinned: the owner's junior at a Vanderbilt-like Ultra selective college is a Reach; without exam scores as grades, the broad groups, or a standing, High reach", () => {
  const r = run(VANDY(), JUNIOR(), JUNIOR_CTX);
  assert.deepEqual([r.group, r.label], ["reach", "elite"], texts(r).join(" | "));
  assert.ok(texts(r).includes("Reading your target ACT of 34 until junior year ends; after that, your actual score."));
  assert.ok(texts(r).includes("Using your high school's state, New York; add yours if different."));
  assert.ok(texts(r).includes("Your courses and activities line up in STEM and the humanities and social sciences: depth in one area, in and out of class."), texts(r).join(" | "));
  assert.ok(!r.missing.includes("state"));
  // Each rule taken away gives High reach again.
  const without: [string, EstimateStudent, Partial<ModelInput>?][] = [
    ["rule 1: exam scores not read (no grade at all)", JUNIOR({ courses: JUNIOR().courses.map((c) => ({ ...c, exam: null })) })],
    ["rule 2: DECA with no group", JUNIOR({ activities: JUNIOR().activities!.map((a) => (a.name === "DECA" ? { ...a, family: "athletics" as const, catalogKey: null } : a)) })],
    ["rule 5: \"doesn't rank\"", JUNIOR({ classStanding: "no_rank", classRankPercentile: null })],
  ];
  for (const [name, s, extra] of without) assert.equal(run(VANDY(), s, extra ?? JUNIOR_CTX).group, "high_reach", name);
  // Vanderbilt is test-optional, so the ACT 29 below its range reads as withheld and the target changes only the
  // sentences there; where the college requires a test, the target is what keeps the record consistent.
  const required = () => {
    const c = VANDY();
    c.school.admissions = { ...c.school.admissions, test_policy: "required" } as School["admissions"];
    return { school: c.school, standing: { ...c.standing, testPolicy: "required" as const } };
  };
  assert.equal(run(required(), JUNIOR(), JUNIOR_CTX).group, "reach");
  assert.equal(run(required(), JUNIOR(), { ...JUNIOR_CTX, asOf: "2027-07-01" }).group, "high_reach", "junior year over: the actual ACT 29");
  assert.equal(run(required(), JUNIOR({ testTarget: null }), JUNIOR_CTX).group, "high_reach", "no target");
  assert.equal(run(VANDY(), JUNIOR(), { ...JUNIOR_CTX, asOf: "2027-07-01" }).group, "reach", "test-optional: the withheld score isn't read");
});

test("Revision 3, rule 3: the target counts until June 30 of the year before graduation, only when higher, and the move-up counts from the actual score", () => {
  const c = () => plain({ rate: 0.3, act: [30, 33] });
  const at = (o: Partial<EstimateStudent>, asOf: string) => run(c(), student({ gpa: UNPLACED_GPA, test: { kind: "act", score: 27 }, testTarget: { kind: "act", score: 31 }, gradYear: 2028, ...o }), { asOf });
  const before = at({}, "2027-06-30");
  assert.ok(keys(before).includes("estimate.test_target"));
  assert.ok(texts(before).some((t) => t.startsWith("Your ACT 31 is")), texts(before).join(" | "));
  const after = at({}, "2027-07-01");
  assert.ok(!keys(after).includes("estimate.test_target"));
  assert.ok(texts(after).some((t) => t.startsWith("Your ACT 27 is")));
  // Only a higher target; a target with no score yet counts; a target on the other test doesn't.
  assert.ok(!keys(at({ testTarget: { kind: "act", score: 26 } }, "2026-10-12")).includes("estimate.test_target"));
  assert.ok(keys(at({ test: null }, "2026-10-12")).includes("estimate.test_target"));
  assert.ok(!keys(at({ testTarget: { kind: "sat", score: 1500 } }, "2026-10-12")).includes("estimate.test_target"));
  // Without a graduation year, the grade decides; with neither, the actual score.
  assert.ok(keys(run(c(), student({ gpa: UNPLACED_GPA, test: { kind: "act", score: 27 }, testTarget: { kind: "act", score: 31 } }), { grade: 11 })).includes("estimate.test_target"));
  assert.ok(!keys(run(c(), student({ gpa: UNPLACED_GPA, test: { kind: "act", score: 27 }, testTarget: { kind: "act", score: 31 } }))).includes("estimate.test_target"));
  // The move-up's points count from the score the student has.
  const up = before.moveUp;
  assert.ok(up && up.points === up.score - 27, JSON.stringify(up));
});

test("Revision 3, rule 7: the high school's state stands in for a missing state of residence, and the snapshot records it", () => {
  const c = GEORGIA_TECH;
  const own = detailed(c(), student({ state: "FL", test: sat(1500) }), { schoolState: "GA" });
  assert.ok(!keys(own.result).includes("estimate.state_from_school"), "the student's own state wins");
  assert.equal(own.detail.stateUsed, "FL");
  const fromSchool = detailed(c(), student({ test: sat(1500) }), { schoolState: "GA" });
  assert.ok(texts(fromSchool.result).includes("Using your high school's state, Georgia; add yours if different."));
  assert.equal(fromSchool.result.pool?.whoKey, "pool.who.residency_in");
  assert.equal(fromSchool.detail.stateUsed, "GA");
  assert.equal(fromSchool.result.group, run(c(), student({ state: "GA", test: sat(1500) })).group);
  const none = detailed(c(), student({ test: sat(1500) }));
  assert.ok(none.result.missing.includes("state"));
  assert.equal(none.detail.stateUsed, null);
});

/** ULTRA in the top band of Ultra selective (rule 8): SAT 1300–1400, so a 1400 is at the 75th percentile. */
const TOP = () => {
  const c = ULTRA();
  c.school.selectivity = { ...c.school.selectivity!, band: "top" };
  return c;
};

test("Revision 3, rule 8: at the top band, Reach also takes one standout (the test at the 75th percentile, a state or national honor, or the top of the class)", () => {
  const at = (s: EstimateStudent, extra: Partial<ModelInput> = LINKED) => run(TOP(), s, extra);
  // EXCELLENT has an SAT 1450, above the 75th percentile: Reach.
  assert.equal(at(EXCELLENT()).group, "reach");
  assert.equal(at(EXCELLENT({ test: sat(1400) })).group, "reach", "at the 75th percentile");
  // A score inside the range and no other standout: High reach, and the sentence names what would lift it.
  const inside = at(EXCELLENT({ test: sat(1350) }));
  assert.deepEqual([inside.group, inside.label], ["high_reach", "elite"]);
  assert.ok(texts(inside).includes("At the very top colleges, Reach also takes one standout: a test score at the top of their range, a state or national honor, or the top of your class."));
  assert.ok(!keys(at(EXCELLENT())).includes("estimate.top_band"));
  // The same record below the band (ULTRA without it) is a Reach: the band is what decides.
  assert.equal(run(ULTRA(), EXCELLENT({ test: sat(1350) }), LINKED).group, "reach");
  // Each standout alone lifts it.
  const standouts: [string, Partial<EstimateStudent>][] = [
    ["a state honor (tier 2) from an award", { awards: [{ id: "w", key: null, name: "All-state", tier: 2, year: 11 }] }],
    ["a national honor (tier 1) on an activity", { activities: THEMED.map((a, i) => (i === 1 ? { ...a, recognition: 1 as const } : a)) }],
    ["valedictorian expected", { rankExpectation: "valedictorian" }],
    ["salutatorian expected", { rankExpectation: "salutatorian" }],
    ["top 1%", { classStanding: "top1", classRankPercentile: 1 }],
  ];
  for (const [name, o] of standouts) assert.equal(at(EXCELLENT({ test: sat(1350), ...o })).group, "reach", name);
  // Not standouts: a school-level honor (tier 3), top 5%.
  assert.equal(at(EXCELLENT({ test: sat(1350), awards: [{ id: "w", key: null, name: "Honor roll", tier: 3, year: 11 }] })).group, "high_reach");
  // A junior's target counts as the test (rule 3), until junior year ends.
  const junior = EXCELLENT({ test: sat(1350), testTarget: { kind: "sat", score: 1420 }, gradYear: 2028 });
  assert.equal(at(junior, { ...LINKED, asOf: "2026-10-12" }).group, "reach");
  assert.equal(at(junior, { ...LINKED, asOf: "2027-07-01" }).group, "high_reach");
  // A recruited floor still beats it.
  assert.equal(at(EXCELLENT({ test: sat(1350) }), { ...LINKED, hooks: hooks({ recruited: "likely_letter" }) }).group, "likely");
});

const INTERNAL_NAMES = /hidden_?odds|hiddenOdds|\bodds\b|multiplier|selectivity_?index|ODDS_V3|HOOKS_V3|M_acad|M_depth|M_legacy|M_theme|M_rank|cutoff|completeness|gap_?prior|test_?pull|test_?down|test_?up|expect_?weights|\bd_?eff\b|d_core|stageOneReadings|rank_?nudge|weighted_?gap|weightedMax|ultra_?advanced|theme_?count|\bmTheme\b|\bmRank\b|\bmWeighted\b|exam_?points|first_?advanced_?year|junior_?year_?ends|owner_?reading|top_?band_?score/i;

/** Results across the pinned cases, each with its hidden odds. */
function sweep() {
  const out: { result: EstimateResult; odds: number | null }[] = [];
  const add = (c: { school: School; standing: StandingSchool }, s: EstimateStudent, extra: Partial<ModelInput> = {}) => {
    const { result, detail } = detailed(c, s, extra);
    out.push({ result, odds: detail.hiddenOdds ?? null });
  };
  add(PURDUE(), student({ state: "IN", test: sat(1300), gpa: 3.85 }));
  add(GEORGIA_TECH(), student({ state: "GA", test: sat(1500) }));
  add(FIFTEEN(), student({ test: sat(1500), gpa: 3.7 }));
  add(ELON(), student({ gpa: 3.9, courses: EIGHT_APS, activities: FOCUSED }), { offering: OFFERING(9), linked: true });
  add(LEGACY_MA(), student({ test: sat(1450), gpa: 3.9, round: "ed" }), { hooks: hooks({ legacy: true, interest: true, recruited: "contact" }) });
  add(HARVARD(), student({ test: sat(1560), gpa: 4.0 }));
  add(GEORGIA_TECH(), student({ state: "GA", test: sat(1500) }));
  add(ELON(), student({ gpa: 3.9 }));
  // Revision 2's nudges and a theme.
  add(NUDGE_ON(), student({ gpa: UNPLACED_GPA, test: sat(1350), classRankPercentile: 1, classStanding: "top1", rankExpectation: "valedictorian", weightedGpa: 4.5 }));
  add(THEME_COLLEGE(), student({ gpa: UNPLACED_GPA, test: sat(1350), courses: TRACKS, activities: [SCI_OLY, MATH_CLUB] }));
  add(ULTRA(), EXCELLENT({ courses: withoutYear(12) }), { ...LINKED, grade: 12 });
  // Revision 3: the target, the high school's state, exam scores as grades, the top band.
  add(VANDY(), JUNIOR(), JUNIOR_CTX);
  add(TOP(), EXCELLENT({ test: sat(1350) }), LINKED);
  return out;
}

test("guard: a result carries exactly the contract's fields, and none holds the hidden odds", () => {
  for (const { result, odds } of sweep()) {
    assert.deepEqual(Object.keys(result), [...RESULT_FIELDS], "exactly the contract");
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, INTERNAL_NAMES);
    if (odds === null) continue;
    // The odds as a number or a percentage appear nowhere (the pool's own published rate aside).
    const rate = result.pool?.rate ?? null;
    for (const form of [odds.toFixed(3), odds.toFixed(4), `${(odds * 100).toFixed(1)}%`]) {
      if (rate !== null && Math.abs(rate - odds) < 0.005) continue;
      assert.ok(!json.includes(form), `${form} in ${result.unitId}`);
    }
    for (const n of result.notes) for (const v of Object.values(n.values)) if (typeof v === "number") assert.ok(Math.abs(v - odds) > 1e-6, `${n.key} carries the odds`);
    assert.ok(result.closeness === null || [0, 1, 2, 3].includes(result.closeness));
  }
  // The check fails when a result does carry them.
  const leaky = { ...sweep()[0].result, hiddenOdds: 0.72 };
  assert.match(JSON.stringify(leaky), INTERNAL_NAMES);
  // And Revision 1's readings (completeness, the gap prior, the test pull) the same way.
  for (const extra of [{ completeness: 0.45 }, { gapPrior: -0.5 }, { testPull: 0.25 }, { dEff: 0.3 }]) assert.match(JSON.stringify({ ...sweep()[0].result, ...extra }), INTERNAL_NAMES);
  // And Revision 2's constants and readings.
  for (const extra of [{ rankNudge: { valedictorian: 1.15 } }, { weightedGap: 0.6 }, { M_theme: 1.18 }, { mRank: 1.08 }, { mWeighted: 1.04 }, { ultraAdvancedGpa: 3.7 }, { weightedMaxPoints: 6 }, { examPoints: { 5: 4 } }, { firstAdvancedYear: 10 }, { juniorYearEnds: "06-30" }, { TOP_BAND_SCORE: 90 }]) {
    assert.match(JSON.stringify({ ...sweep()[0].result, ...extra }), INTERNAL_NAMES, JSON.stringify(extra));
  }
});

test("guard: no Revision 2 constant reaches a result as a number", () => {
  const constants = [
    ...Object.values(ODDS_V3.rankNudge),
    ...ODDS_V3.weightedGap.map(([, m]) => m),
    ...ODDS_V3.weightedGap100.map(([, m]) => m),
    ODDS_V3.theme.one,
    ODDS_V3.theme.two,
  ];
  const numbersIn = (r: EstimateResult) => r.notes.flatMap((n) => Object.values(n.values)).filter((v): v is number => typeof v === "number");
  for (const { result } of sweep()) for (const v of numbersIn(result)) assert.ok(!constants.some((c) => Math.abs(c - v) < 1e-9), `${v} in ${result.unitId}`);
  // The check sees one.
  const leaky = { ...sweep()[0].result, notes: [{ key: "estimate.work", values: { hours: ODDS_V3.rankNudge.top5 } }] };
  assert.ok(numbersIn(leaky).some((v) => constants.includes(v)));
});

test("guard: the API response strips anything beyond the contract, including odds and multipliers", () => {
  const r = sweep()[0].result;
  const leaky = { ...r, hiddenOdds: 0.72, multipliers: { legacy: 1.5 }, pool: { ...r.pool!, rate: 0.71, odds: 0.72 } } as unknown as EstimateResult;
  const clean = publicResult(leaky);
  assert.doesNotMatch(JSON.stringify(clean), INTERNAL_NAMES);
  assert.deepEqual(Object.keys(clean), [...RESULT_FIELDS]);
  assert.deepEqual(Object.keys(clean.pool!), ["kind", "rate", "whoKey", "whoValues"]);
  assert.equal(publicResult({ ...r, pool: { ...r.pool!, whoKey: "estimate.pool" } }).pool, null, "only who-phrases");
  assert.equal(publicResult({ ...r, pool: { ...r.pool!, rate: 7 } }).pool, null, "a rate is a share");
});

test("guard: the new sentences name no number, weight, cutoff, or odds", () => {
  const added = Object.keys(NOTES).filter((k) => /^(estimate\.(level\.|elite|recruited|label\.elite|label\.recruited|not_said|work|first_generation|incomplete|rank_expectation|rank_top|weighted_above|state_from_school|top_band)|hooks\.|ed\.|pool\.who\.|depth\.theme)/.test(k));
  assert.ok(added.length >= 27, `${added.length}`);
  for (const k of added) {
    const text = NOTES[k]({ inputs: "courses and activities", college: "X", rating: "considered", state: "Maryland", scope: "all", law: "HB", level: "Target", unit: "Engineering", test: "SAT", hours: "", title: "valedictorian", rank: "top", weighted: "", subjects: "art", subject: "art" });
    assert.doesNotMatch(text, /\d|%/, `${k}: ${text}`);
    assert.doesNotMatch(text, /(?<!un)weight(?!ed GPA)|threshold|cutoff|multipl|odds|percent|index/i, `${k}: ${text}`);
  }
});

/** Files reachable from a root by relative and `@/` imports, stopping at "use server" modules. */
function reach(roots: string[]): Set<string> {
  const out = new Set<string>();
  const resolveImport = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? relative(ROOT, join(ROOT, from, "..", spec)) : null;
    if (base === null) return null;
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(join(ROOT, cand)) && statSync(join(ROOT, cand)).isFile()) return cand;
    return null;
  };
  const visit = (file: string) => {
    if (out.has(file)) return;
    out.add(file);
    const text = read(file);
    if (/^\s*["']use server["']/.test(text)) return;
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveImport(file, m[1] ?? m[2]);
      if (target) visit(target);
    }
  };
  for (const r of roots) visit(r);
  return out;
}

const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => (statSync(join(ROOT, dir, f)).isDirectory() ? walk(join(dir, f)) : /\.(ts|tsx)$/.test(f) ? [join(dir, f)] : []));
const METHOD_FILES = ["lib/chances/model.ts", "lib/chances/hooks.ts"];

test("guard: the method and the hooks are server-only, and no client component reaches them", () => {
  for (const f of METHOD_FILES) assert.match(read(f), /^import "server-only";/, f);
  const clients = [...walk("components"), ...walk("app")].filter((f) => /^\s*["']use client["']/.test(read(f)));
  assert.ok(clients.length > 20);
  const reached = reach(clients);
  for (const f of METHOD_FILES) assert.ok(!reached.has(f), `a client file reaches ${f}`);
  // The check sees a client that does.
  const bad = reach(["lib/chances/estimate.ts"]);
  assert.ok(bad.has("lib/chances/model.ts") && bad.has("lib/chances/hooks.ts"));
});

test("guard: telemetry never carries the odds, closeness, the tier's index, or the list row's toggles", () => {
  const analytics = read("lib", "analytics.ts");
  const registry = analytics.slice(analytics.indexOf("export const EVENTS"));
  const problems = (src: string) => [...src.matchAll(/properties:\s*\[([^\]]*)\]/g)].flatMap((m) => m[1].split(",").map((p) => p.trim().replace(/"/g, ""))).filter((p) => /odds|closeness|multiplier|index|legacy|recruited|interest|without_|completeness/.test(p));
  assert.deepEqual(problems(registry), []);
  assert.deepEqual(problems('x: { properties: ["group", "hidden_odds"] }'), ["hidden_odds"], "the check sees a leak");
  assert.deepEqual(problems('x: { properties: ["group", "completeness"] }'), ["completeness"], "and a completeness leak");
});

test("guard: the account export never includes the hidden odds or the ablation columns; completeness is the student's own", () => {
  const exp = read("lib", "account-export.ts");
  const cols = exp.match(/const SNAPSHOT_EXPORT_COLUMNS =\s*"([^"]+)"/)![1].split(",").map((c) => c.trim());
  const leaks = (list: string[]) => list.filter((c) => /hidden_odds|^without_|^position$|^base_rate|multiplier|nudge|theme/.test(c));
  assert.deepEqual(leaks(cols), []);
  assert.deepEqual(leaks([...cols, "hidden_odds"]), ["hidden_odds"], "the check sees a leak");
  assert.deepEqual(leaks([...cols, "rank_nudge"]), ["rank_nudge"], "and a nudge column");
  // Revision 2 (the lead's brief for U14): the binned completeness is exported with the student's own snapshots.
  assert.ok(cols.includes("completeness"));
});
