/**
 * What the estimate's panels show, worked out from an `EstimateResult` (specs/chances/estimate.md "What families see"):
 * the "What went into this estimate" panel, the two stage lines and label on the profile card and the planner's drawer,
 * the rate kind under an estimate on Compare, and the numbers card's "most useful missing input" line. Pure and
 * client-safe, and it only sorts and joins what the result already carries: every sentence comes from the catalog
 * (lib/chances/notes.ts), every figure is the student's own entry or a cited college fact. Nothing here knows how the
 * inputs are combined, so nothing here can reveal it.
 */
import { FIELDS, type FieldPath } from "../fields.ts";
import { majorFamilyName } from "../majors.ts";
import { stateName } from "../states.ts";
import { courseRigorCountOf, OUTSIDE_US } from "../student-profile.ts";
import { INPUT_WORDS, noteText } from "./notes.ts";
import type { EstimateNote, EstimateResult, EstimateStudent, InputKind } from "./types.ts";

/* ------------------------------------------------------------------ */
/* The college's facts                                                 */
/* ------------------------------------------------------------------ */

/**
 * Every field path an estimate can cite (its `facts` and its notes' `cite`). A college page is static, so the server
 * resolves these citations up front and the client picks the ones an answer names; the planner resolves the ones its
 * estimates name (lib/planner/plan-estimates.ts). `tests/chances-estimate-ui.test.mts` runs estimates across many
 * colleges and students and fails if one cites a path that isn't listed here.
 */
export const ESTIMATE_FACT_PATHS = [
  // The pool's fields (lib/chances/pool-rate.ts POOL_FIELDS) and the major's (major-review.ts MAJOR_FIELDS), written out
  // here so a client bundle needn't load the curated files behind them; the tests keep the two in step.
  "derived.admit_rate_in_state",
  "derived.admit_rate_out_of_state",
  "derived.admit_rate_international",
  "admissions.acceptance_rate",
  "derived.ed_admit_rate",
  "reported.major_admission.admit_rate",
  "reported.major_admission.review.major_considered",
  "reported.major_admission.review.emphasis",
  "reported.major_admission.review.required_courses",
  "reported.major_admission.review.gate",
  "admissions.act_composite_25_75",
  "admissions.test_policy",
  "admissions.factors",
  "derived.sat_total",
  "derived.gpa_band_mean",
  "derived.gpa_middle_half",
  "derived.gpa_estimate",
  "derived.gpa_top_share",
  "reported.admission_profile.gpa.average",
  "reported.admission_profile.factors.gpa",
  "reported.admission_profile.factors.rigor",
  "reported.admission_profile.factors.class_rank",
  "reported.admission_profile.factors.test_scores",
  "reported.admission_profile.class_rank.submitted_share",
  "reported.admission_profile.class_rank.top_tenth",
  "reported.admission_profile.class_rank.top_quarter",
  "reported.admission_profile.early_decision.applicants",
  "reference.guaranteed_admission.rule",
  "reference.guaranteed_admission.scope",
  "reference.guaranteed_admission.major_guaranteed",
] as const satisfies readonly FieldPath[];

const FACT_PATHS: ReadonlySet<string> = new Set(ESTIMATE_FACT_PATHS);
export const isEstimateFactPath = (path: string): boolean => FACT_PATHS.has(path);

/** The paths a result cites: its facts and its notes' cites, each once. */
export function citedPaths(result: Pick<EstimateResult, "facts" | "notes">): string[] {
  return [...new Set([...result.facts, ...result.notes.map((n) => n.cite).filter((c): c is string => !!c)])];
}

/* ------------------------------------------------------------------ */
/* The student's side                                                  */
/* ------------------------------------------------------------------ */

/** What the student entered, as words to show them back ("GPA 3.85"); built from their own entries only. */
export interface YourNumbers {
  gpa: string | null;
  /** "SAT 1300". */
  test: string | null;
  /** "top 10%". */
  classRank: string | null;
  advancedCourses: number;
  /** A state's name, or null. */
  state: string | null;
  /** Names of the intended major families, most-interested first. */
  majors: string[];
}

/** The student's entries as `YourNumbers`. `gpaLabel` is the GPA as entered (planGpaLabel); without it the stored GPA is shown. */
export function yourNumbersFrom(student: EstimateStudent, gpaLabel?: string | null): YourNumbers {
  const range = student.gpaRange;
  const gpa = gpaLabel ?? (student.gpa === null ? null : range && range[0] !== range[1] ? `about ${range[0].toFixed(1)}–${range[1].toFixed(1)} unweighted` : student.gpa.toFixed(2));
  return {
    gpa,
    test: student.test ? `${student.test.kind === "sat" ? "SAT" : "ACT"} ${student.test.score}` : null,
    classRank: student.classRankPercentile === null ? null : `top ${student.classRankPercentile}%`,
    advancedCourses: courseRigorCountOf(student.courses),
    state: student.state && student.state !== OUTSIDE_US ? stateName(student.state) : null,
    majors: student.majors.map((m) => majorFamilyName(m)).filter((m): m is string => !!m),
  };
}

/** Whether the student has entered a GPA or a test: the profile card's condition for showing an estimate. */
export function hasNumbers(student: Pick<EstimateStudent, "gpa" | "test" | "gpaRange">): boolean {
  return student.gpa !== null || student.test !== null || student.gpaRange !== null;
}

/** "Your numbers: GPA 3.85 · SAT 1300 · 6 advanced courses · Indiana resident": only the inputs the estimate used. */
export function yourNumbersList(n: YourNumbers, used: readonly InputKind[]): string[] {
  const has = (k: InputKind) => used.includes(k);
  const out: string[] = [];
  if (has("gpa") && n.gpa) out.push(`GPA ${n.gpa}`);
  if (has("test") && n.test) out.push(n.test);
  if (has("class_rank") && n.classRank) out.push(`class rank ${n.classRank}`);
  if (has("courses") && n.advancedCourses > 0) out.push(`${n.advancedCourses} advanced ${n.advancedCourses === 1 ? "course" : "courses"}`);
  if (has("state") && n.state) out.push(`${n.state} resident`);
  if (has("major") && n.majors.length > 0) out.push(`intended major ${n.majors[0].toLowerCase()}`);
  if (has("subject_grades")) out.push("math and science grades");
  if (has("sections")) out.push("section scores");
  return out;
}

/* ------------------------------------------------------------------ */
/* Sorting a result's notes                                            */
/* ------------------------------------------------------------------ */

const LABEL_KEYS = new Set(["estimate.guaranteed", "estimate.reach_for_everyone", "estimate.open_admission"]);
const STAGE_KEYS = new Set(["estimate.academics", "estimate.pool"]);
const PROMPT_KEYS = new Set(["estimate.missing_courses", "estimate.missing_input"]);
const NOT_USED_KEY = "estimate.not_used";

export interface PanelParts {
  /** "Reach for everyone: …" or "Guaranteed for you: …", or null. */
  label: EstimateNote | null;
  /** "Your academics: …" and "Your pool: …". */
  stages: EstimateNote[];
  /** The college's facts and what the estimate read in the student's record, in the estimate's order. */
  reasons: EstimateNote[];
  /** "Not used here: class rank (X doesn't weigh it)". */
  notUsed: EstimateNote[];
  /** "Adding your courses could change this estimate", or null. */
  prompt: EstimateNote | null;
}

export function panelParts(result: Pick<EstimateResult, "notes">): PanelParts {
  const parts: PanelParts = { label: null, stages: [], reasons: [], notUsed: [], prompt: null };
  for (const n of result.notes) {
    if (LABEL_KEYS.has(n.key)) parts.label ??= n;
    else if (STAGE_KEYS.has(n.key)) parts.stages.push(n);
    else if (n.key === NOT_USED_KEY) parts.notUsed.push(n);
    else if (PROMPT_KEYS.has(n.key)) parts.prompt ??= n;
    else parts.reasons.push(n);
  }
  return parts;
}

/** "Test policy" → "test policy"; an acronym ("SAT", "ACT") keeps its capitals. */
const lowerFirst = (s: string): string => (s.length > 1 && s[1] === s[1].toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** The cited facts no note's sentence already carries, as labels ("Share of first-years with a 3.75 or higher GPA"). */
export function uncoveredFacts(result: Pick<EstimateResult, "facts" | "notes">): { path: string; label: string }[] {
  const covered = new Set(result.notes.map((n) => n.cite).filter((c): c is string => !!c));
  return result.facts
    .filter((f) => !covered.has(f) && f in FIELDS)
    .map((f) => ({ path: f, label: lowerFirst(FIELDS[f as FieldPath].label) }));
}

/** The note's sentence, or "" for a key the catalog doesn't have. */
export const sentence = (n: EstimateNote): string => noteText(n);

/* ------------------------------------------------------------------ */
/* Compare: the rate kind under an estimate                            */
/* ------------------------------------------------------------------ */

const RATE_KIND_BY_FIELD: Record<string, string> = {
  "derived.admit_rate_in_state": "pool.kind.residency_in",
  "derived.admit_rate_out_of_state": "pool.kind.residency_out",
  "derived.admit_rate_international": "pool.kind.residency_international",
  "reported.major_admission.admit_rate": "pool.kind.major",
  "admissions.acceptance_rate": "pool.kind.overall",
};

/**
 * Which rate the estimate used, in words ("in-state rate", "guaranteed"), from the pool line's cited field; null when
 * the estimate has no pool line (no rate, or an open-admission college).
 */
export function rateKindText(result: Pick<EstimateResult, "label" | "notes">): string | null {
  if (result.label === "guaranteed") return noteText({ key: "pool.kind.guaranteed", values: {} });
  const pool = result.notes.find((n) => n.key === "estimate.pool");
  const key = pool?.cite ? RATE_KIND_BY_FIELD[pool.cite] : undefined;
  return key ? noteText({ key, values: {} }) : null;
}

/* ------------------------------------------------------------------ */
/* The numbers card: the most useful missing input                     */
/* ------------------------------------------------------------------ */

/** The order a tie between inputs breaks in: the one that helps at the most colleges first, then this order. */
const INPUT_ORDER: readonly InputKind[] = ["courses", "class_rank", "subject_grades", "major", "state", "high_school"];

/** The input a result's prompt note names, or null when it has none. */
export function promptedInput(result: Pick<EstimateResult, "notes">): InputKind | null {
  const prompt = panelParts(result).prompt;
  if (!prompt) return null;
  if (prompt.key === "estimate.missing_courses") return "courses";
  const word = String(prompt.values.input ?? "");
  return (Object.keys(INPUT_WORDS) as InputKind[]).find((k) => INPUT_WORDS[k] === word || (k === "major" && word === "intended major")) ?? null;
}

/**
 * "Adding your class rank would sort 2 more colleges": the one input that would help at the most colleges on the list,
 * or null when none would change a group. An estimate asks for an input only where it could still change that
 * college's group (a guarantee or a Reach for everyone asks for nothing), so counting the inputs the estimates ask for
 * counts the colleges the input would move. Only an input the result also lists as missing counts.
 */
export function mostUsefulMissing(results: readonly Pick<EstimateResult, "notes" | "missing">[]): EstimateNote | null {
  const counts = new Map<InputKind, number>();
  for (const r of results) {
    const input = promptedInput(r);
    if (input && r.missing.includes(input)) counts.set(input, (counts.get(input) ?? 0) + 1);
  }
  let best: InputKind | null = null;
  for (const k of INPUT_ORDER) {
    const n = counts.get(k) ?? 0;
    if (n > 0 && (best === null || n > (counts.get(best) ?? 0))) best = k;
  }
  if (!best) return null;
  return { key: "estimate.most_useful_input", values: { input: INPUT_WORDS[best], count: counts.get(best) ?? 0 } };
}
