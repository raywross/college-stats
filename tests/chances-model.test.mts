/**
 * Quad's estimate, the method (lib/chances/model.ts; specs/chances/method/standing.md, rigor-reading.md,
 * major-effects.md): method/standing.md's pinned examples, every position switched on and off (score through C7,
 * GPA through C7, crowding, rigor raising but never lowering, class rank through C10's tiers, the major's subjects,
 * required courses, and gate), a guarantee overriding Stage 1, "Reach for everyone" from the student's own pool, the
 * snapshot detail with each input switched off, and the open baseline's pinned table through the model with every
 * new input empty. The colleges are real records with their figures fixed (the 2026-10-10 numbers the method quotes),
 * so the examples stay pinned as the data moves. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as nodeModule from "node:module";
import type { ReportedResidencyAdmissions, School } from "../lib/types";

// model.ts and rigor.ts start with `import "server-only"`, which only Next.js resolves; stand in an empty module.
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

const { modelEstimate, modelEstimateWithDetail, MODEL_VERSION, RIGOR_CAN_LOWER, rankShareAtOrAbove, STANDING_V2 } = await import("../lib/chances/model.ts");
const { baselineEstimate } = await import("../lib/chances/baseline.ts");
const { noteText, isNoteKey } = await import("../lib/chances/notes.ts");
const { isFieldPath } = await import("../lib/fields.ts");
type ModelInput = import("../lib/chances/model.ts").ModelInput;
type StandingSchool = import("../lib/chances/baseline.ts").StandingSchool;
type EstimateStudent = import("../lib/chances/types.ts").EstimateStudent;
type CourseEntry = import("../lib/chances/types.ts").CourseEntry;
type SchoolOffering = import("../lib/chances/types.ts").SchoolOffering;
type CollegeGpa = import("../lib/planner/gpa-model.ts").CollegeGpa;

const ROOT = join(import.meta.dirname, "..");
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

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

const bands = (top: number, next: number): [number, number, number, number, number, number, number, number, number] => {
  const rest = Math.max(0, 1 - top - next);
  return [top, next, rest * 0.5, rest * 0.3, rest * 0.2, 0, 0, 0, 0];
};
const exactMiddle = (p25: number, p75: number) => ({ p25: [p25, p25] as [number, number], p75: [p75, p75] as [number, number], shown: [p25, p75] as [number, number], kind: "bands" as const });
const reportedGpa = (avg: number): CollegeGpa => ({ kind: "reported", range: [avg, avg], point: avg, weighted: null, n: null });

interface CollegeOpts {
  rate: number | null;
  sat?: [number, number] | null;
  policy?: School["admissions"]["test_policy"];
  gpa?: CollegeGpa | null;
  /** C7 ratings; `null` removes C7 entirely. */
  c7?: Record<string, string> | null;
  federal?: Record<string, string> | null;
  classRank?: { top_tenth: number | null; top_quarter: number | null; top_half: number | null; submitted_share: number } | null;
  topShare?: [number, number] | null;
  residency?: ReportedResidencyAdmissions | null;
  satMath?: [number, number] | null;
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
  s.reported = { ...(s.reported ?? {}), admission_profile: profile, admissions_by_residency: o.residency ?? undefined } as School["reported"];
  s.lineage = { ...(s.lineage ?? {}), "admissions.acceptance_rate": { source: "ipeds-adm", year: "Fall 2025" } } as School["lineage"];
  const standing: StandingSchool = { admitRate: o.rate, sat: o.sat ?? null, act: null, gpaAverage: null, gpa: o.gpa ?? null, testPolicy: o.policy ?? "required" };
  return { school: s, standing };
}

const OFFERING = (apCount: number): SchoolOffering => ({ apCount, apKeys: null, ib: null, dual: null, source: "profile", field: "detail.ap_courses" });
let courseId = 0;
function ap(key: string, subject: CourseEntry["subject"], final: CourseEntry["grades"]["final"] = "A"): CourseEntry {
  return { id: `c${++courseId}`, kind: "ap", key, name: null, subject, year: 11, status: "taken", grades: { s1: null, s2: null, final }, exam: null };
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

function run(c: { school: School; standing: StandingSchool }, s: EstimateStudent, extra: Partial<ModelInput> = {}) {
  return modelEstimate({ student: s, school: c.school, standing: c.standing, offering: null, ...extra });
}
const keys = (r: { notes: { key: string }[] }) => r.notes.map((n) => n.key);
const texts = (r: { notes: { key: string; values: Record<string, string | number> }[] }) => r.notes.map((n) => noteText(n));

/* The pinned colleges (method/standing.md "Pinned examples"). */
const C7_ALL = { gpa: "very_important", rigor: "very_important", class_rank: "considered", test_scores: "important" };
const PURDUE = () =>
  college("243780", {
    rate: 0.43,
    sat: [1220, 1470],
    gpa: { ...reportedGpa(3.81), kind: "bands", middle: exactMiddle(3.6, 4.0) },
    c7: C7_ALL,
    residency: grid([10000, 7100], [10000, 4400]),
  });
const GEORGIA_TECH = () =>
  college("139755", {
    rate: 0.09,
    sat: [1370, 1530],
    gpa: { kind: "estimated", range: [3.8, 4.0], point: 3.9, weighted: 4.17, n: 114 },
    c7: C7_ALL,
    classRank: { top_tenth: 0.89, top_quarter: 0.98, top_half: 0.99, submitted_share: 0.4 },
    residency: grid([10000, 2900], [10000, 1000]),
  });
const ELON = (rate = 0.63) =>
  college("198516", {
    rate,
    sat: [1170, 1350],
    policy: "considered",
    gpa: { ...reportedGpa(3.88), kind: "bands", middle: exactMiddle(3.62, 4.0) },
    c7: { gpa: "very_important", rigor: "very_important", class_rank: "considered", test_scores: "not_considered" },
    classRank: { top_tenth: 0.2, top_quarter: 0.48, top_half: 0.81, submitted_share: 0.35 },
    topShare: [0.59, 0.11],
  });
const UT_AUSTIN = () => college("228778", { rate: 0.27, sat: [1230, 1500], policy: "considered", gpa: null, c7: null, federal: { gpa: "considered", hs_record: "required" } });

/* ------------------------------------------------------------------ */
/* method/standing.md's pinned examples                                */
/* ------------------------------------------------------------------ */

test("pinned: Indiana resident, SAT 1300, GPA 3.85 at Purdue (71% in-state) is Likely", () => {
  const r = run(PURDUE(), student({ state: "IN", test: sat(1300), gpa: 3.85 }));
  assert.equal(r.group, "likely");
  assert.equal(r.label, null);
  assert.ok(r.used.includes("state") && r.used.includes("test") && r.used.includes("gpa"));
  const t = texts(r);
  assert.equal(t[0], "Your academics: in the middle of admitted students.");
  assert.equal(t[1], "Your pool: applicants from Indiana were admitted at 71% (Fall 2025).");
  assert.ok(t.includes("Your SAT 1300 is inside the middle 50% of enrolled students."));
});

test("pinned: an Ohio resident with the same numbers at Purdue (44% out-of-state) is a Target", () => {
  const r = run(PURDUE(), student({ state: "OH", test: sat(1300), gpa: 3.85 }));
  assert.equal(r.group, "target");
  assert.equal(texts(r)[1], "Your pool: applicants from outside Indiana were admitted at 44% (Fall 2025).");
});

test("pinned: a Georgia resident, SAT 1500, GPA 3.95 at Georgia Tech (29% in-state) is a Target, not a Reach for everyone", () => {
  const r = run(GEORGIA_TECH(), student({ state: "GA", test: sat(1500), gpa: 3.95 }));
  assert.equal(r.group, "target");
  assert.equal(r.label, null);
});

test("pinned: the same student from Florida (10% out-of-state) is a Reach for everyone", () => {
  const r = run(GEORGIA_TECH(), student({ state: "FL", test: sat(1500), gpa: 3.95 }));
  assert.equal(r.group, "reach");
  assert.equal(r.label, "reach-for-everyone");
  assert.equal(keys(r)[0], "estimate.reach_for_everyone");
  assert.equal(r.moveUp, null, "a score can't move a Reach for everyone");
});

test("pinned: GPA 3.90 with 8 of 9 APs (most) at Elon, not sending a score: Likely (rigor fills the crowded GPA slot)", () => {
  const r = run(ELON(), student({ gpa: 3.9, courses: EIGHT_APS }), { offering: OFFERING(9), linked: true });
  assert.equal(r.group, "likely");
  assert.ok(keys(r).includes("estimate.gpa_meets_bar"));
  assert.ok(keys(r).includes("rigor.most"));
  assert.ok(r.used.includes("courses"));
  assert.ok(texts(r).some((t) => t.startsWith("Your GPA (3.90) meets the bar here; 70% of first-years had a 3.75 or higher")));
});

test("pinned: GPA 3.90, no courses entered, at Elon: Target, and the courses are the missing input", () => {
  const r = run(ELON(), student({ gpa: 3.9 }));
  assert.equal(r.group, "target");
  assert.ok(r.missing.includes("courses"));
  assert.ok(keys(r).includes("estimate.missing_courses"));
});

test("pinned: GPA 3.90 and top 10% of class at Elon (20% of ranked first-years in the top tenth): Likely", () => {
  const r = run(ELON(), student({ gpa: 3.9, classRankPercentile: 10 }));
  assert.equal(r.group, "likely");
  assert.ok(r.used.includes("class_rank"));
  assert.ok(texts(r).includes("Of the first-years whose high school reported a rank, 20% were in the top tenth."));
});

test("pinned: a Texas resident in the top 4%, SAT 1350, at UT Austin: Likely, Guaranteed for you, and the major isn't", () => {
  const r = run(UT_AUSTIN(), student({ state: "TX", classRankPercentile: 4, test: sat(1350), majors: ["14"] }));
  assert.equal(r.group, "likely");
  assert.equal(r.label, "guaranteed");
  assert.equal(keys(r)[0], "estimate.guaranteed");
  assert.match(texts(r)[0], /^Guaranteed for you: Texas automatic admission \(top 5%\)\.$/);
  assert.ok(keys(r).includes("pool.major_not_guaranteed"));
  assert.ok(r.used.includes("state") && r.used.includes("class_rank"));
});

test("pinned: GPA 3.90 with 2 of 14 APs (some) at a crowded college admitting 45%: still a Target (rigor below is shown, not used)", () => {
  assert.equal(RIGOR_CAN_LOWER, false);
  const r = run(ELON(0.45), student({ gpa: 3.9, courses: TWO_APS }), { offering: OFFERING(14), linked: true });
  assert.equal(r.group, "target");
  assert.ok(keys(r).includes("rigor.some"), "the reading is shown");
  const none = run(ELON(0.45), student({ gpa: 3.9 }));
  assert.equal(none.group, r.group, "the same as with no courses");
});

/* ------------------------------------------------------------------ */
/* Each position on and off                                            */
/* ------------------------------------------------------------------ */

test("score: unused at a test-optional college whose C7 says tests aren't considered; used where they are", () => {
  const off = run(ELON(), student({ test: sat(1500) }));
  assert.equal(off.send, "not-used");
  assert.ok(keys(off).includes("estimate.not_used"));
  assert.equal(off.moveUp, null);
  assert.ok(!off.used.includes("test"));
  const on = run(college("198516", { rate: 0.63, sat: [1170, 1350], policy: "considered", c7: { test_scores: "considered" } }), student({ test: sat(1500) }));
  assert.equal(on.send, "send");
  assert.ok(on.used.includes("test"));
  assert.equal(on.group, "likely");
});

test("GPA: unused where C7 says it isn't considered, used where it is or where nothing is said", () => {
  const base = { rate: 0.45, gpa: reportedGpa(3.5) };
  const off = run(college("198516", { ...base, c7: { gpa: "not_considered" } }), student({ gpa: 3.9 }));
  assert.equal(off.group, null);
  assert.ok(texts(off).some((t) => /^Not used here: GPA/.test(t)));
  const on = run(college("198516", { ...base, c7: { gpa: "considered" } }), student({ gpa: 3.9 }));
  assert.equal(on.group, "target");
  const federalOff = run(college("198516", { ...base, c7: null, federal: { gpa: "not_considered" } }), student({ gpa: 3.9 }));
  assert.equal(federalOff.group, null, "the federal answer decides without C7");
  const silent = run(college("198516", { ...base, c7: null }), student({ gpa: 3.9 }));
  assert.equal(silent.group, "target", "nothing said: the baseline's reading");
});

test("crowding: above the GPA middle only meets the bar at a crowded college; below still counts as below", () => {
  const gpa = { ...reportedGpa(3.5), kind: "bands" as const, middle: exactMiddle(3.3, 3.7) };
  const mk = (top: [number, number] | null) => college("198516", { rate: 0.55, gpa, c7: { gpa: "very_important" }, topShare: top });
  assert.equal(run(mk(null), student({ gpa: 3.95 })).group, "likely", "above everywhere at 55%");
  assert.equal(run(mk([0.2, 0.2]), student({ gpa: 3.95 })).group, "likely", "40% at 3.75+: not crowded");
  const crowded = run(mk([0.4, 0.2]), student({ gpa: 3.95 }));
  assert.equal(crowded.group, "target", "60% at 3.75+: meets the bar, in");
  assert.ok(crowded.facts.includes("derived.gpa_top_share"));
  assert.equal(run(mk([0.4, 0.2]), student({ gpa: 3.1 })).group, "reach", "a low GPA is still low");
  assert.equal(STANDING_V2.crowdedShare, 0.5);
});

test("rigor: raises a crowded slot only where the college weighs rigor, never at an uncrowded college", () => {
  const mk = (rigor: string, top: [number, number] | null) =>
    college("198516", { rate: 0.55, gpa: { ...reportedGpa(3.8), kind: "bands", middle: exactMiddle(3.6, 4.0) }, c7: { gpa: "very_important", rigor }, topShare: top });
  const most = { offering: OFFERING(9), linked: true };
  assert.equal(run(mk("very_important", [0.5, 0.2]), student({ gpa: 3.9, courses: EIGHT_APS }), most).group, "likely");
  assert.equal(run(mk("considered", [0.5, 0.2]), student({ gpa: 3.9, courses: EIGHT_APS }), most).group, "target", "rigor only considered: not used");
  assert.equal(run(mk("very_important", null), student({ gpa: 3.9, courses: EIGHT_APS }), most).group, "target", "not crowded: GPA in decides");
  const noSchool = run(mk("very_important", [0.5, 0.2]), student({ gpa: 3.9, courses: EIGHT_APS }));
  assert.equal(noSchool.group, "target", "can't place without the school's offering");
  assert.ok(noSchool.missing.includes("high_school"));
});

test("class rank: counts only where C7 weighs it and enough first-years reported one; the tiers place it", () => {
  const mk = (o: Partial<CollegeOpts>) => college("198516", { rate: 0.63, gpa: { ...reportedGpa(3.88), kind: "bands", middle: exactMiddle(3.62, 4.0) }, c7: { gpa: "very_important", class_rank: "considered" }, classRank: { top_tenth: 0.2, top_quarter: 0.48, top_half: 0.81, submitted_share: 0.35 }, ...o });
  assert.equal(run(mk({}), student({ gpa: 3.9, classRankPercentile: 10 })).group, "likely");
  const notWeighed = run(mk({ c7: { gpa: "very_important", class_rank: "not_considered" } }), student({ gpa: 3.9, classRankPercentile: 10 }));
  assert.equal(notWeighed.group, "target");
  assert.ok(texts(notWeighed).some((t) => /^Not used here: class rank/.test(t)));
  assert.equal(run(mk({ classRank: { top_tenth: 0.2, top_quarter: 0.48, top_half: 0.81, submitted_share: 0.1 } }), student({ gpa: 3.9, classRankPercentile: 10 })).group, "target", "too few ranked");
  // Georgia Tech's tiers: 89% of ranked first-years in the top tenth, so the top 10% is below.
  assert.ok(Math.abs(rankShareAtOrAbove(10, { top_tenth: 0.89, top_quarter: 0.98, top_half: 0.99 })! - 0.89) < 1e-9);
  assert.ok(Math.abs(rankShareAtOrAbove(5, { top_tenth: 0.2, top_quarter: null, top_half: null })! - 0.1) < 1e-9, "even spread inside a tier");
  assert.equal(rankShareAtOrAbove(10, { top_tenth: null, top_quarter: null, top_half: null }), null);
  const gt = run(mk({ classRank: { top_tenth: 0.89, top_quarter: 0.98, top_half: 0.99, submitted_share: 0.4 }, rate: 0.75 }), student({ gpa: 3.9, classRankPercentile: 10 }));
  assert.equal(gt.group, "target", "rank below at a 75% college: one weak measure is a Target");
  assert.ok(keys(gt).includes("estimate.rank_below"));
});

test("major subjects: math and science grades join the votes where the unit reads them, and can lower the group", () => {
  // Berkeley's College of Engineering reads math and science grades (pool_and_emphasis).
  const mk = () => college("110635", { rate: 0.45, gpa: reportedGpa(3.8), policy: "not-considered", c7: null, satMath: [700, 790] });
  const strong = [ap("ap_calculus_bc", "math", "A"), ap("ap_physics_c_mechanics", "science", "A")];
  const weak = [ap("ap_calculus_bc", "math", "B-"), ap("ap_physics_c_mechanics", "science", "B-")];
  const on = run(mk(), student({ gpa: 3.8, majors: ["14"], courses: strong }));
  assert.equal(on.group, "target");
  assert.ok(on.used.includes("subject_grades") && on.used.includes("major"));
  assert.ok(keys(on).includes("major.emphasis"));
  const lower = run(mk(), student({ gpa: 3.8, majors: ["14"], courses: weak }));
  assert.equal(lower.group, "reach", "grades well under the overall GPA lower the group");
  const noMajor = run(mk(), student({ gpa: 3.8, courses: weak }));
  assert.equal(noMajor.group, "target", "no intended major: standing as it was");
  const noGrades = run(mk(), student({ gpa: 3.8, majors: ["14"] }));
  assert.equal(noGrades.group, "target");
  assert.ok(noGrades.missing.includes("subject_grades"));
  const lowSection = run(mk(), student({ gpa: 3.8, majors: ["14"], courses: strong, satMath: 650 }));
  assert.equal(lowSection.group, "reach", "a math section under the college's 25th percentile is below");
  assert.ok(lowSection.used.includes("sections"));
});

test("major subjects: a required course missing from the list is below; an empty list asks for courses instead", () => {
  const mk = () => college("190415", { rate: 0.45, gpa: reportedGpa(3.8), c7: null });
  const noChem = run(mk(), student({ gpa: 3.8, majors: ["14"], courses: [ap("ap_calculus_bc", "math"), ap("ap_physics_c_mechanics", "science")] }));
  assert.equal(noChem.group, "reach");
  assert.ok(texts(noChem).includes("Cornell Duffield College of Engineering expects chemistry; it isn't on your list."));
  const all = run(mk(), student({ gpa: 3.8, majors: ["14"], courses: [ap("ap_calculus_bc", "math"), ap("ap_physics_c_mechanics", "science"), ap("ap_chemistry", "science")] }));
  assert.equal(all.group, "target");
  const empty = run(mk(), student({ gpa: 3.8, majors: ["14"] }));
  assert.equal(empty.group, "target");
  assert.ok(empty.missing.includes("courses"));
});

test("major gate: met or not yet is a line, never a vote", () => {
  const mk = () => college("228778", { rate: 0.45, sat: [1230, 1500], policy: "considered", gpa: reportedGpa(3.8), c7: null });
  const notYet = run(mk(), student({ gpa: 3.8, majors: ["14"] }));
  const met = run(mk(), student({ gpa: 3.8, majors: ["14"], satMath: 650 }));
  assert.ok(keys(notYet).includes("major.gate_not_yet"));
  assert.ok(keys(met).includes("major.gate_met"));
  assert.equal(notYet.group, met.group);
});

/* ------------------------------------------------------------------ */
/* Stage 2                                                             */
/* ------------------------------------------------------------------ */

test("a guarantee overrides Stage 1, even below every range", () => {
  const r = run(UT_AUSTIN(), student({ state: "TX", classRankPercentile: 3, test: sat(900), gpa: 2.5 }));
  assert.equal(r.group, "likely");
  assert.equal(r.label, "guaranteed");
  const out = run(UT_AUSTIN(), student({ state: "OK", classRankPercentile: 3, test: sat(900), gpa: 2.5 }));
  assert.notEqual(out.label, "guaranteed", "another state's student isn't guaranteed");
});

test("Reach for everyone follows the student's own pool; open admission is Likely", () => {
  assert.equal(run(GEORGIA_TECH(), student({ test: sat(1500), gpa: 3.95 })).label, "reach-for-everyone", "9% overall, no state");
  const open = run(college("198516", { rate: null, c7: null }), student({ gpa: 3.0 }));
  assert.equal(open.group, "likely");
  assert.equal(keys(open)[0], "estimate.open_admission");
});

/* ------------------------------------------------------------------ */
/* The snapshot detail                                                 */
/* ------------------------------------------------------------------ */

test("the snapshot detail: Stage 1's position, the pool, crowding, the reading, and the group with each input switched off", () => {
  const purdue = PURDUE();
  const { result, detail } = modelEstimateWithDetail({ student: student({ state: "IN", test: sat(1300), gpa: 3.85 }), school: purdue.school, standing: purdue.standing, offering: null });
  assert.equal(result.group, "likely");
  assert.equal(detail.position, "in");
  assert.equal(detail.baseRateKind, "residency");
  assert.ok(Math.abs(detail.baseRate! - 0.71) < 1e-9);
  assert.equal(detail.without?.residency, "target", "43% overall");
  const elon = ELON();
  const most = modelEstimateWithDetail({ student: student({ gpa: 3.9, courses: EIGHT_APS, classRankPercentile: 10 }), school: elon.school, standing: elon.standing, offering: OFFERING(9), linked: true });
  assert.equal(most.detail.crowded, true);
  assert.equal(most.detail.rigorReading, "most");
  assert.equal(most.detail.without?.rigor, "likely", "rank still above");
  assert.equal(most.detail.without?.rank, "likely", "rigor still above");
  assert.equal(most.detail.without?.crowding, "likely", "uncrowded: GPA in, rank above");
  assert.ok(!("detail" in most.result));
});

test("every note is a catalog key with a sentence, and every fact is a registered field", () => {
  const cases = [
    run(PURDUE(), student({ state: "IN", test: sat(1300), gpa: 3.85, classRankPercentile: 12 })),
    run(ELON(), student({ gpa: 3.9, courses: EIGHT_APS, classRankPercentile: 10, test: sat(1250) }), { offering: OFFERING(9) }),
    run(UT_AUSTIN(), student({ state: "TX", classRankPercentile: 4, test: sat(1350), majors: ["14"], round: "ed" })),
    run(GEORGIA_TECH(), student({ state: "FL", test: sat(1500), gpa: 3.95, majors: ["undecided"] })),
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
/* The open baseline's table, through the model with no new inputs     */
/* ------------------------------------------------------------------ */

/** A college with no C7, no C10, no bands, no residency grid, no curated entries: nothing the method adds can read. */
function plain(o: { rate: number | null; sat?: [number, number] | null; act?: [number, number] | null; gpaAverage?: number | null; policy?: StandingSchool["testPolicy"] }) {
  const s = {
    unit_id: "100000",
    name: "Example College",
    location: { state: "OH", city: "Example" },
    admissions: { acceptance_rate: o.rate, test_policy: o.policy === undefined ? "considered" : o.policy, sat_math_25_75: null },
    reported: {},
    lineage: { "admissions.acceptance_rate": { source: "ipeds-adm", year: "Fall 2024" } },
  } as unknown as School;
  const standing: StandingSchool = { admitRate: o.rate, sat: o.sat ?? null, act: o.act ?? null, gpaAverage: o.gpaAverage ?? null, testPolicy: o.policy === undefined ? "considered" : o.policy };
  return { school: s, standing };
}

const TABLE: { name: string; s: EstimateStudent; c: ReturnType<typeof plain>; group: string | null }[] = [
  { name: "SAT 1450, admit 6%, SAT 1500–1560", s: student({ test: sat(1450) }), c: plain({ rate: 0.06, sat: [1500, 1560] }), group: "reach" },
  { name: "SAT 1450, admit 45%, SAT 1280–1450", s: student({ test: sat(1450) }), c: plain({ rate: 0.45, sat: [1280, 1450] }), group: "target" },
  { name: "SAT 1450, admit 78%, SAT 1100–1300", s: student({ test: sat(1450) }), c: plain({ rate: 0.78, sat: [1100, 1300] }), group: "likely" },
  { name: "ACT 24, admit 40%, ACT 28–33, required", s: student({ test: { kind: "act", score: 24 } }), c: plain({ rate: 0.4, act: [28, 33], policy: "required" }), group: "reach" },
  { name: "no test, GPA 3.9, admit 35%, average 3.7", s: student({ gpa: 3.9 }), c: plain({ rate: 0.35, gpaAverage: 3.7 }), group: "target" },
  { name: "SAT 1390, GPA 3.82, admit 63%, SAT 1170–1350, average 3.88", s: student({ test: sat(1390), gpa: 3.82 }), c: plain({ rate: 0.63, sat: [1170, 1350], gpaAverage: 3.88 }), group: "likely" },
  { name: "SAT 1200, GPA 3.8, test-optional 45%, SAT 1280–1450, average 3.75", s: student({ test: sat(1200), gpa: 3.8 }), c: plain({ rate: 0.45, sat: [1280, 1450], gpaAverage: 3.75 }), group: "target" },
  { name: "open admission", s: student({ test: sat(1000) }), c: plain({ rate: null }), group: "likely" },
  { name: "no numbers", s: student(), c: plain({ rate: 0.45, sat: [1280, 1450] }), group: null },
  { name: "test-blind", s: student({ test: sat(1590) }), c: plain({ rate: 0.45, sat: [1280, 1450], policy: "not-considered" }), group: null },
  { name: "an ACT through the concordance", s: student({ test: { kind: "act", score: 31 } }), c: plain({ rate: 0.45, sat: [1300, 1450] }), group: "target" },
  { name: "a move up within reach", s: student({ test: sat(1390) }), c: plain({ rate: 0.22, sat: [1400, 1510] }), group: "reach" },
  { name: "a weighted GPA as a range", s: student({ gpa: 3.5, gpaScale: "5.0", gpaRange: [3.4, 4.0] }), c: plain({ rate: 0.45, gpaAverage: 3.7 }), group: null },
];

for (const row of TABLE) {
  test(`baseline equivalence with no new inputs: ${row.name}`, () => {
    const model = run(row.c, row.s);
    const base = baselineEstimate(row.s, row.c.standing, row.c.school.unit_id);
    assert.equal(base.group, row.group, "the baseline's pinned group");
    assert.equal(model.group, base.group);
    assert.equal(model.label, base.label);
    assert.equal(model.send, base.send);
    assert.deepEqual(model.moveUp, base.moveUp);
    for (const n of base.notes) assert.ok(model.notes.some((m) => m.key === n.key && JSON.stringify(m.values) === JSON.stringify(n.values)), `the model keeps the baseline's ${n.key}`);
    for (const k of base.used) assert.ok(model.used.includes(k), k);
  });
}
