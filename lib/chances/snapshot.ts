/**
 * Application snapshots (specs/chances/calibration.md "Collecting outcomes" 1): the student's estimate inputs as of
 * the day a college is marked applied, binned, with the estimate and whether the student changed the group. Pure:
 * builds the row `record_application_snapshot()` stores (supabase/migrations/20261011100000_application_snapshots.sql);
 * lib/chances/snapshot-write.ts loads what it needs and writes it.
 *
 * What a snapshot never holds: a name, the high school's id or name, a course's typed name, a note's filled-in text,
 * or any other free text. The high school appears only as a band of how many AP courses it offers.
 *
 *   const input = estimateInputFromProfile(profile, "243744", "ea");
 *   const row = buildSnapshot({ input, estimate: { result }, offering, admitRate: 0.21, studentGroup: null });
 */
import type { CourseEntry, EstimateInput, EstimateResult, EstimateStudent, PoolRateKind, RigorReading, SchoolOffering } from "./types.ts";
import { advancedGpa, courseMark, isAdvancedKind, markPoints, planGpaRange, planTest, unweightedGpa4, type StudentProfileData } from "../student-profile.ts";

export type Group = "reach" | "target" | "likely";
export const GROUPS: readonly Group[] = ["reach", "target", "likely"];
const ROUNDS = ["ed", "ed2", "ea", "rea", "rd", "rolling"] as const;
const INPUT_KINDS = ["gpa", "test", "sections", "class_rank", "courses", "subject_grades", "state", "major", "round", "high_school"] as const;

/** The inputs the season measurements switch off one at a time (method/outcomes.md "Each new input separately"). */
export const ABLATION_INPUTS = ["residency", "crowding", "rigor", "rank"] as const;
export type AblationInput = (typeof ABLATION_INPUTS)[number];

/** Method details recorded beside the group for the season measurements (never shown, never exported). */
export interface SnapshotDetail {
  /** The Stage 1 academic position (method/standing.md). */
  position?: "below" | "in" | "above" | null;
  baseRateKind?: PoolRateKind | null;
  /** The pool's admit rate the estimate used, 0–1. */
  baseRate?: number | null;
  crowded?: boolean | null;
  rigorReading?: RigorReading | null;
  /** The group with each input switched off. */
  without?: Partial<Record<AblationInput, Group | null>>;
}

/** What the estimate hands a snapshot: the result the student saw, and optionally the method's details. */
export interface AppliedEstimate {
  result: EstimateResult;
  detail?: SnapshotDetail | null;
}

/** The row's columns as record_application_snapshot() reads them (identity, dates, season, and consent are the database's). */
export interface SnapshotRow {
  round: (typeof ROUNDS)[number] | null;
  gpa: number | null;
  gpa_low: number | null;
  gpa_high: number | null;
  gpa_scale: "4.0" | "5.0" | "100" | null;
  test_kind: "sat" | "act" | null;
  test_score: number | null;
  sat_math: number | null;
  act_math: number | null;
  class_rank_pct: number | null;
  state: string | null;
  majors: string[];
  practice: boolean;
  advanced_courses: number;
  advanced_planned: number;
  honors_courses: number;
  advanced_gpa: number | null;
  math_gpa: number | null;
  science_gpa: number | null;
  hs_ap_band: ApBand | null;
  hs_ib: boolean | null;
  hs_dual: boolean | null;
  admit_rate: number | null;
  estimate_group: Group | null;
  estimate_label: EstimateResult["label"];
  inputs_used: string[];
  note_keys: string[];
  model_version: string | null;
  position: "below" | "in" | "above" | null;
  base_rate_kind: PoolRateKind | null;
  base_rate: number | null;
  crowded: boolean | null;
  rigor_reading: RigorReading | null;
  without_residency: Group | null;
  without_crowding: Group | null;
  without_rigor: Group | null;
  without_rank: Group | null;
  student_group: Group | null;
  group_changed: boolean;
}

/** Every key a snapshot row may carry; tests hold buildSnapshot to exactly these. */
export const SNAPSHOT_COLUMNS = [
  "round", "gpa", "gpa_low", "gpa_high", "gpa_scale", "test_kind", "test_score", "sat_math", "act_math", "class_rank_pct",
  "state", "majors", "practice", "advanced_courses", "advanced_planned", "honors_courses", "advanced_gpa", "math_gpa",
  "science_gpa", "hs_ap_band", "hs_ib", "hs_dual", "admit_rate", "estimate_group", "estimate_label", "inputs_used",
  "note_keys", "model_version", "position", "base_rate_kind", "base_rate", "crowded", "rigor_reading",
  "without_residency", "without_crowding", "without_rigor", "without_rank", "student_group", "group_changed",
] as const satisfies readonly (keyof SnapshotRow)[];

/* ------------------------------------------------------------------ */
/* Bins                                                                */
/* ------------------------------------------------------------------ */

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Rounds to the nearest multiple of `step`, clamped to [min, max], without float noise (3.85, not 3.8500000000000001). */
export function binTo(v: number | null | undefined, step: number, min: number, max: number): number | null {
  if (!finite(v)) return null;
  // toFixed(9) first: 3.85 / 0.1 is 38.49999999999999 in floating point, which would round down.
  const binned = Math.round(Number((v / step).toFixed(9))) * step;
  const decimals = step.toString().split(".")[1]?.length ?? 0;
  return Number(Math.min(max, Math.max(min, binned)).toFixed(decimals));
}

/** GPA (unweighted, 4.0 scale) to the nearest 0.05. */
export const binGpa = (g: number | null | undefined) => binTo(g, 0.05, 0, 4);
/** A grade average to the nearest 0.1. */
export const binGrade = (g: number | null | undefined) => binTo(g, 0.1, 0, 4);
/** A rate (0–1) to the nearest hundredth. */
export const binRate = (r: number | null | undefined) => binTo(r, 0.01, 0, 1);

export function binTest(test: EstimateStudent["test"]): { test_kind: "sat" | "act" | null; test_score: number | null } {
  if (!test || !finite(test.score)) return { test_kind: null, test_score: null };
  if (test.kind === "sat") return { test_kind: "sat", test_score: binTo(test.score, 10, 400, 1600) };
  if (test.kind === "act") return { test_kind: "act", test_score: binTo(test.score, 1, 1, 36) };
  return { test_kind: null, test_score: null };
}

export type ApBand = "none" | "1-5" | "6-10" | "11-15" | "16+";
/** How many AP courses the high school offers, as a band (the school itself is never stored). */
export function apBand(apCount: number | null | undefined): ApBand | null {
  if (!finite(apCount) || apCount < 0) return null;
  if (apCount === 0) return "none";
  if (apCount <= 5) return "1-5";
  if (apCount <= 10) return "6-10";
  if (apCount <= 15) return "11-15";
  return "16+";
}

/* ------------------------------------------------------------------ */
/* Seasons                                                             */
/* ------------------------------------------------------------------ */

/** The fall a student applying on this ISO date would enter: July or later counts toward next year (SQL application_season()). */
export function snapshotSeason(appliedOn: string): number {
  const [y, m] = appliedOn.split("-").map(Number);
  return m >= 7 ? y + 1 : y;
}

/** The latest season whose outcomes are all in: a season finishes September 1 of its year (SQL last_finished_season()). */
export function lastFinishedSeason(today: string): number {
  const [y, m] = today.split("-").map(Number);
  return m >= 9 ? y : y - 1;
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

const isGroup = (v: unknown): v is Group => v === "reach" || v === "target" || v === "likely";

/** The estimate's input for one college from the student's saved profile (the same numbers the plan reads). */
export function estimateInputFromProfile(profile: StudentProfileData | null, unitId: string, round: string | null): EstimateInput {
  const a = profile?.academics;
  const t = profile?.tests;
  const b = profile?.basics;
  return {
    unitId,
    student: {
      gpa: a ? unweightedGpa4(a.gpa, a.gpaScale) : null,
      gpaScale: a?.gpaScale ?? "4.0",
      gpaRange: profile ? planGpaRange(profile) : null,
      test: profile ? planTest(profile) : null,
      satMath: t?.satMath ?? null,
      actMath: t?.actMath ?? null,
      classRankPercentile: a?.classRankPercentile ?? null,
      courses: a?.courses ?? [],
      state: b?.stateOfResidence ?? null,
      majors: profile?.plans.intendedMajors ?? [],
      round,
      highSchoolId: b?.highSchoolId ?? null,
      practice: t?.practice ?? false,
    },
  };
}

function subjectAverage(courses: readonly CourseEntry[], subject: CourseEntry["subject"]): number | null {
  const points = courses
    .filter((c) => c.subject === subject)
    .map((c) => markPoints(courseMark(c)))
    .filter((p): p is number => p !== null);
  return points.length ? points.reduce((x, y) => x + y, 0) / points.length : null;
}

const STATE = /^[A-Z]{2}$/;
const NOTE_KEY = /^[a-z0-9_.]+$/;
const MODEL_VERSION = /^[A-Za-z0-9._:-]{1,40}$/;

export interface SnapshotParts {
  input: EstimateInput;
  /** The estimate the student saw; null when none was available (the snapshot still records the inputs). */
  estimate: AppliedEstimate | null;
  /** The student's high school's offering (lib/chances/offering.ts); null when unknown. */
  offering: SchoolOffering | null;
  /** The college's overall admit rate, 0–1. */
  admitRate: number | null;
  /** The group the student picked on their list (category_source 'student'); null when they kept the suggestion. */
  studentGroup: string | null;
}

/** The binned row. Unknown or malformed values become null (or 0 for counts), never an error. */
export function buildSnapshot({ input, estimate, offering, admitRate, studentGroup }: SnapshotParts): SnapshotRow {
  const s = input.student;
  const courses = Array.isArray(s.courses) ? s.courses : [];
  const advanced = courses.filter((c) => isAdvancedKind(c.kind));
  const range = s.gpaRange && finite(s.gpaRange[0]) && finite(s.gpaRange[1]) ? s.gpaRange : null;
  const result = estimate?.result ?? null;
  const detail = estimate?.detail ?? null;
  const group = isGroup(result?.group) ? result.group : null;
  const picked = isGroup(studentGroup) ? studentGroup : null;
  const without = (k: AblationInput) => (isGroup(detail?.without?.[k]) ? detail.without[k] : null);
  const count = (n: number) => Math.min(40, n);
  const advancedCount = count(advanced.length);
  return {
    round: (ROUNDS as readonly string[]).includes(s.round ?? "") ? (s.round as SnapshotRow["round"]) : null,
    gpa: binGpa(s.gpa),
    gpa_low: range ? binGpa(range[0]) : null,
    gpa_high: range ? binGpa(range[1]) : null,
    gpa_scale: s.gpaScale === "4.0" || s.gpaScale === "5.0" || s.gpaScale === "100" ? s.gpaScale : null,
    ...binTest(s.test),
    sat_math: binTo(s.satMath, 10, 200, 800),
    act_math: binTo(s.actMath, 1, 1, 36),
    class_rank_pct: binTo(s.classRankPercentile, 1, 0, 100),
    state: s.state && (STATE.test(s.state) || s.state === "OUTSIDE_US") ? s.state : null,
    majors: (s.majors ?? []).filter((m) => /^[0-9]{2}$/.test(m)).slice(0, 3),
    practice: s.practice === true,
    advanced_courses: advancedCount,
    advanced_planned: Math.min(advancedCount, advanced.filter((c) => c.status === "planned").length),
    honors_courses: count(courses.filter((c) => c.kind === "honors").length),
    advanced_gpa: binGrade(advancedGpa(courses)),
    math_gpa: binGrade(subjectAverage(courses, "math")),
    science_gpa: binGrade(subjectAverage(courses, "science")),
    hs_ap_band: apBand(offering?.apCount),
    hs_ib: offering?.ib ?? null,
    hs_dual: offering?.dual ?? null,
    admit_rate: binRate(admitRate),
    estimate_group: group,
    estimate_label: result?.label === "reach-for-everyone" || result?.label === "guaranteed" ? result.label : null,
    inputs_used: [...new Set((result?.used ?? []).filter((k) => (INPUT_KINDS as readonly string[]).includes(k)))],
    note_keys: [...new Set((result?.notes ?? []).map((n) => n.key).filter((k) => NOTE_KEY.test(k)))].slice(0, 40),
    model_version: result && MODEL_VERSION.test(result.modelVersion) ? result.modelVersion : null,
    position: detail?.position === "below" || detail?.position === "in" || detail?.position === "above" ? detail.position : null,
    base_rate_kind: detail?.baseRateKind && ["guaranteed", "major", "residency", "overall"].includes(detail.baseRateKind) ? detail.baseRateKind : null,
    base_rate: binRate(detail?.baseRate),
    crowded: typeof detail?.crowded === "boolean" ? detail.crowded : null,
    rigor_reading: detail?.rigorReading && ["most", "much", "some", "few_offered", "cant_place"].includes(detail.rigorReading) ? detail.rigorReading : null,
    without_residency: without("residency"),
    without_crowding: without("crowding"),
    without_rigor: without("rigor"),
    without_rank: without("rank"),
    student_group: picked,
    group_changed: picked !== null && picked !== group,
  };
}
