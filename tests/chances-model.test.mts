/**
 * Quad's estimate, the method's third version (lib/chances/model.ts; specs/chances/method/standing.md, levels.md):
 * the pinned examples, the within-one-level check against the second version with every new input empty, the caps
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

const { modelEstimate, modelEstimateWithDetail, MODEL_VERSION, RIGOR_CAN_LOWER, rankShareAtOrAbove, STANDING_V2, ODDS_V3, academicMultiplier, shareBelowGpa } = await import("../lib/chances/model.ts");
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

let actId = 0;
function activity(name: string, kind: ActivityEntry["kind"], years: ActivityEntry["years"], o: Partial<ActivityEntry> = {}): ActivityEntry {
  return { id: `a${++actId}`, name, kind, years, roles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false, ...o };
}
/** Focused (depth.md): soccer four years, captain senior year; robotics three years. */
const FOCUSED = [activity("Soccer", "sport", [9, 10, 11, 12], { roles: { 12: "leader" } }), activity("Robotics", "club", [10, 11, 12], { roles: { 12: "officer" } })];
const SAMPLING = [activity("Chess", "club", [9]), activity("Drama", "arts", [10])];

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

test("version: the third version's model version, and the constants the method names", () => {
  assert.equal(MODEL_VERSION, "20261012.1");
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

test("pinned: SAT 1560, GPA 4.0, rigor most at a Harvard-like Elite college (3.5%): Reach, Elite: a reach for everyone", () => {
  const r = run(HARVARD(), student({ test: sat(1560), gpa: 4.0, courses: EIGHT_APS }), { offering: OFFERING(9), linked: true });
  assert.equal(r.group, "reach");
  assert.equal(r.label, "elite");
  assert.equal(keys(r)[0], "estimate.elite");
  assert.equal(r.closeness, null, "the odds don't set an Elite level");
  assert.equal(r.moveUp, null, "nothing moves an Elite college beyond Reach");
});

test("pinned: SAT 1100, GPA 2.6 at the same college: High reach, still Elite", () => {
  const r = run(HARVARD(), student({ test: sat(1100), gpa: 2.6 }));
  assert.equal(r.group, "high_reach");
  assert.equal(r.label, "elite");
});

test("pinned: a Georgia resident, SAT 1500, at Georgia Tech (29% in-state, Highly selective in-state): Target", () => {
  const { result: r, detail } = detailed(GEORGIA_TECH(), student({ state: "GA", test: sat(1500) }));
  assert.equal(r.group, "target");
  assert.equal(r.label, null);
  near(detail.hiddenOdds, 0.41);
  assert.equal(detail.selectivityTier, "highly_selective");
  assert.equal(r.closeness, 2, "41% sits in the third quarter of Target's band");
});

test("pinned: the same student from Florida (10% out-of-state, Elite out of state): Reach, Elite: a reach for everyone", () => {
  const r = run(GEORGIA_TECH(), student({ state: "FL", test: sat(1500) }));
  assert.equal(r.group, "reach");
  assert.equal(r.label, "elite");
  assert.ok(r.facts.includes("selectivity.out_of_state"), "the out-of-state tier is cited");
});

test("pinned: SAT 1500 and GPA 3.7 at a 15% Highly selective college: one weak measure keeps it a Reach", () => {
  const { result: r, detail } = detailed(FIFTEEN(), student({ test: sat(1500), gpa: 3.7 }));
  assert.equal(r.group, "reach");
  near(detail.hiddenOdds, 0.105);
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

test("pinned: SAT 1450 at a 45% college (SAT 1280–1450): Likely (the second version said Target)", () => {
  const r = run(college("100654", { rate: 0.45, sat: [1280, 1450], c7: null, tier: "selective" }), student({ test: sat(1450) }));
  assert.equal(r.group, "likely");
});

test("pinned: ACT 24 at a 40% college (ACT 28–33, test required): Reach", () => {
  const { result: r, detail } = detailed(college("100654", { rate: 0.4, act: [28, 33], c7: null }), student({ test: { kind: "act", score: 24 } }));
  assert.equal(r.group, "reach");
  near(detail.hiddenOdds, 0.1);
});

test("pinned: SAT 1450 at a 78% Accessible college (SAT 1100–1300): Safe (rate ≥ 50%)", () => {
  const { result: r, detail } = detailed(college("100654", { rate: 0.78, sat: [1100, 1300], c7: null, tier: "accessible" }), student({ test: sat(1450) }));
  assert.equal(r.group, "safe");
  near(detail.hiddenOdds, 0.97, 1e-9);
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

test("pinned: GPA 3.90, no courses, no activities at Elon: Likely", () => {
  const r = run(ELON(), student({ gpa: 3.9 }));
  assert.equal(r.group, "likely");
  assert.ok(r.missing.includes("courses"));
  assert.ok(r.missing.includes("activities"), "Elon rates extracurriculars important");
  assert.ok(keys(r).includes("estimate.missing_courses"));
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

for (const row of V2_ROWS) {
  test(`within one level of the second version, new inputs empty: ${row.name}`, () => {
    const { result, detail } = detailed(row.c(), row.s, row.extra);
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
const strong = (rate: number, tier: SelectivityTier | null) => run(college("100654", { rate, sat: [1200, 1350], c7: null, tier }), student({ test: sat(1600) }));

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

test("Elite: Reach with nothing below range, High reach with any measure below, and the odds aren't used", () => {
  const elite = () => college("166027", { rate: 0.6, sat: [1300, 1400], gpa: middleGpa(3.7, 3.9), c7: null, tier: "elite" });
  assert.equal(run(elite(), student({ test: sat(1600), gpa: 4.0 })).group, "reach", "even at 60% admitted: Elite caps at Reach");
  assert.equal(run(elite(), student({ test: sat(1600), gpa: 3.6 })).group, "high_reach", "one measure below");
  assert.equal(run(elite(), student({ test: sat(1290), gpa: 4.0 })).group, "high_reach");
  // An Elite college with no numbers to place: no level ("Add a number").
  assert.equal(run(elite(), student()).group, null);
});

test("floors: a guarantee and open admission are Safe; a likely letter Likely anywhere; a positive pre-read Target at Elite, Likely elsewhere, from d ≥ −0.5", () => {
  const open = run(college("100654", { rate: null, c7: null, tier: "open" }), student({ gpa: 2.0 }));
  assert.deepEqual([open.group, open.label, keys(open)[0]], ["safe", null, "estimate.open_admission"]);
  const elite = ELITE_6();
  const pre = (score: number, c = elite) => run(c, student({ test: sat(score) }), { hooks: hooks({ recruited: "pre_read" }) });
  assert.deepEqual([pre(1300).group, pre(1300).label], ["target", "recruited"], "Elite: Target");
  assert.deepEqual([pre(1230).group, pre(1230).label], ["target", "recruited"], "d = −0.4 still floors");
  assert.equal(pre(1200).label, "elite", "d = −0.7: no floor");
  assert.equal(pre(1200).group, "high_reach");
  const hs = college("100654", { rate: 0.1, sat: [1270, 1370], c7: null, tier: "highly_selective" });
  assert.equal(pre(1300, hs).group, "likely", "Likely beats the Highly selective cap");
  const letter = run(hs, student({ test: sat(1000) }), { hooks: hooks({ recruited: "likely_letter" }) });
  assert.deepEqual([letter.group, letter.label], ["likely", "recruited"], "a likely letter at any distance");
  // A contact multiplies; it isn't a floor and isn't a label.
  const contact = run(hs, student({ test: sat(1300) }), { hooks: hooks({ recruited: "contact" }) });
  assert.equal(contact.label, null);
  assert.ok(keys(contact).includes("hooks.recruited"));
  assert.ok(RANK(contact.group)! >= RANK(run(hs, student({ test: sat(1300) })).group)!);
});

test("the guarantee floor beats every cap, and open admission needs no numbers", () => {
  const r = run(UT_AUSTIN(), student({ state: "TX", classRankPercentile: 3, test: sat(900), gpa: 2.5 }));
  assert.deepEqual([r.group, r.label], ["safe", "guaranteed"]);
  assert.notEqual(run(UT_AUSTIN(), student({ state: "OK", classRankPercentile: 3, test: sat(900), gpa: 2.5 })).label, "guaranteed", "another state's student isn't guaranteed");
  assert.equal(run(college("100654", { rate: null, c7: null }), student()).group, "safe");
});

/* ------------------------------------------------------------------ */
/* Move-up, closeness, ED                                              */
/* ------------------------------------------------------------------ */

test("move-up: the fewest points to the next level, across five; at an Elite college only from High reach to Reach", () => {
  const c = () => plain({ rate: 0.22, sat: [1400, 1510] });
  const r = run(c(), student({ test: sat(1390) }));
  assert.equal(r.group, "reach");
  assert.deepEqual(r.moveUp, { points: 70, to: "target", score: 1460 });
  assert.equal(run(c(), student({ test: sat(1460) })).group, "target");
  assert.equal(run(c(), student({ test: sat(1450) })).group, "reach");
  const elite = () => college("166027", { rate: 0.04, sat: [1500, 1580], gpa: null, c7: null, tier: "elite" });
  const low = run(elite(), student({ test: sat(1450) }));
  assert.equal(low.group, "high_reach");
  assert.deepEqual(low.moveUp, { points: 50, to: "reach", score: 1500 });
  assert.equal(run(elite(), student({ test: sat(1500) })).moveUp, null, "Reach at Elite: nothing beyond");
  // No move-up where the test isn't counted, or from Safe.
  assert.equal(run(ELON(), student({ gpa: 3.5, test: sat(1100) })).moveUp, null);
  assert.equal(strong(0.6, "accessible").moveUp, null);
});

test("closeness: which quarter of its level's band the odds fall in; null when a cap or floor set the level", () => {
  const at = (rate: number) => run(plain({ rate, sat: [1200, 1300] }), student({ test: sat(1250) }));
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
  const target = run(c(), student({ test: sat(1300), round: "ed" }));
  assert.equal(target.group, "target");
  assert.equal(target.ed, "helps");
  assert.ok(texts(target).includes("Early decision would move this toward Likely; it's binding, so check the cost first."));
  const capped = run(c(0.2, "highly_selective"), student({ test: sat(1300), round: "ed" }));
  assert.equal(capped.ed, "same", "the cap holds under ED");
  assert.ok(keys(capped).includes("ed.same"));
  const hr = run(c(), student({ test: sat(1000), round: "ed" }));
  assert.equal(hr.group, "high_reach");
  assert.equal(hr.ed, "not_advised");
  assert.ok(keys(hr).includes("ed.not_advised"));
  // Without a round of ED the verdict is still there for the planner, but no sentence.
  const rd = run(c(), student({ test: sat(1300) }));
  assert.equal(rd.ed, "helps");
  assert.ok(!keys(rd).some((k) => k.startsWith("ed.")));
  // No ED counts on record: no verdict (except the High reach guard).
  assert.equal(run(college("100654", { rate: 0.2, sat: [1200, 1300], c7: null }), student({ test: sat(1300) })).ed, null);
  assert.equal(run(college("100654", { rate: 0.2, sat: [1200, 1300], c7: null }), student({ test: sat(1000) })).ed, "not_advised");
  assert.equal(run(college("100654", { rate: 0.2, sat: [1200, 1300], c7: null }), student()).ed, null, "no level, no verdict");
});

/* ------------------------------------------------------------------ */
/* Depth, work, legacy, interest, first generation                     */
/* ------------------------------------------------------------------ */

const depthCollege = (extracurriculars: string | null, extra: Record<string, string> = {}) =>
  college("100654", { rate: 0.3, sat: [1200, 1400], c7: extracurriculars ? { extracurriculars, ...extra } : Object.keys(extra).length ? extra : null });

test("depth: Focused ×1.3 where the college rates activities important, half at considered, nothing (with a sentence) otherwise", () => {
  const s = student({ test: sat(1300), activities: FOCUSED });
  const odds = (c: ReturnType<typeof depthCollege>, st = s) => detailed(c, st).detail.hiddenOdds!;
  const base = odds(depthCollege("important"), student({ test: sat(1300) }));
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
  const base = detailed(depthCollege("important"), student({ test: sat(1300) })).detail.hiddenOdds!;
  const both = detailed(depthCollege("important"), student({ test: sat(1300), activities: FOCUSED, awards: [{ id: "w1", key: null, name: "National award", tier: 1, year: 11 }] }));
  near(both.detail.hiddenOdds! / base, 1.8, 1e-9);
  assert.ok(both.result.used.includes("awards"));
  const state = detailed(depthCollege("important"), student({ test: sat(1300), activities: SAMPLING, awards: [{ id: "w2", key: null, name: "All-state", tier: 2, year: 11 }] }));
  near(state.detail.hiddenOdds! / base, 1.25, 1e-9);
});

test("depth never lowers a level: Sampling, or no activities, leaves the level where it was", () => {
  for (const acts of [SAMPLING, []]) {
    const s = student({ test: sat(1300), activities: acts });
    assert.equal(run(depthCollege("very_important"), s).group, run(depthCollege("very_important"), student({ test: sat(1300) })).group);
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
  near(both.detail.hiddenOdds! / detailed(c("important"), student({ test: sat(1300) })).detail.hiddenOdds!, 1, 1e-9);
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
  assert.ok(!run(ELON(), student({ gpa: 3.9, classStanding: "no_rank" })).missing.includes("class_rank"), "no rank at the school: not asked again");
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
  const mk = (top: [number, number] | null) => college("198516", { rate: 0.55, gpa: middleGpa(3.3, 3.7), c7: { gpa: "very_important" }, topShare: top });
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
/* The snapshot detail                                                 */
/* ------------------------------------------------------------------ */

test("the snapshot detail: position, pool, crowding, reading, hidden odds, tier, depth, and the level with each input off", () => {
  const purdue = PURDUE();
  const { result, detail } = detailed(purdue, student({ state: "IN", test: sat(1300), gpa: 3.85 }));
  assert.equal(result.group, "likely");
  assert.equal(detail.position, "in");
  assert.equal(detail.baseRateKind, "residency");
  near(detail.baseRate, 0.71, 1e-9);
  near(detail.hiddenOdds, 0.72);
  assert.equal(detail.selectivityTier, "selective");
  assert.equal(detail.without?.residency, "target", "43% overall, Highly selective for all applicants");
  assert.deepEqual(Object.keys(detail.without!).sort(), ["crowding", "depth", "hooks", "interest", "rank", "residency", "rigor"]);
  assert.ok(detail.depth && detail.depth.activitiesCount === 0);
  assert.ok(!("detail" in result) && !("hiddenOdds" in result));
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
const INTERNAL_NAMES = /hidden_?odds|hiddenOdds|\bodds\b|multiplier|selectivity_?index|ODDS_V3|HOOKS_V3|M_acad|M_depth|M_legacy|cutoff/i;

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
  const added = Object.keys(NOTES).filter((k) => /^(estimate\.(level\.|elite|recruited|label\.elite|label\.recruited|not_said|work|first_generation)|hooks\.|ed\.|pool\.who\.)/.test(k));
  assert.ok(added.length >= 20, `${added.length}`);
  for (const k of added) {
    const text = NOTES[k]({ college: "X", rating: "considered", state: "Maryland", scope: "all", law: "HB", level: "Target", unit: "Engineering", test: "SAT", hours: "" });
    assert.doesNotMatch(text, /\d|%/, `${k}: ${text}`);
    assert.doesNotMatch(text, /weight|threshold|cutoff|multipl|odds|percent|index/i, `${k}: ${text}`);
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
  const problems = (src: string) => [...src.matchAll(/properties:\s*\[([^\]]*)\]/g)].flatMap((m) => m[1].split(",").map((p) => p.trim().replace(/"/g, ""))).filter((p) => /odds|closeness|multiplier|index|legacy|recruited|interest|without_/.test(p));
  assert.deepEqual(problems(registry), []);
  assert.deepEqual(problems('x: { properties: ["group", "hidden_odds"] }'), ["hidden_odds"], "the check sees a leak");
});

test("guard: the account export never includes the hidden odds or the ablation columns", () => {
  const exp = read("lib", "account-export.ts");
  const cols = exp.match(/const SNAPSHOT_EXPORT_COLUMNS =\s*"([^"]+)"/)![1].split(",").map((c) => c.trim());
  const leaks = (list: string[]) => list.filter((c) => /hidden_odds|^without_|^position$|^base_rate/.test(c));
  assert.deepEqual(leaks(cols), []);
  assert.deepEqual(leaks([...cols, "hidden_odds"]), ["hidden_odds"], "the check sees a leak");
});
