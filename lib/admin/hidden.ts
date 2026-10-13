import "server-only";
/**
 * The values the site computes but never shows, assembled for the admin console (specs/product/admin.md "Colleges and
 * hidden values", "A student's standing"): a college's selectivity breakdown, the GPA the standing model reads for it,
 * the registry's hidden derived fields, and, per list college, the estimate's private detail for one student. Pure:
 * every function takes what it reads (the dataset's schools, the fitted GPA models, the estimate's output), so the
 * tests pin each panel; the loaders that call it are lib/admin/college.ts and lib/admin/standing.ts.
 *
 * Server-only, and only ever rendered by server components behind requireAdmin(): it reads the method
 * (lib/selectivity.ts, the estimate's SnapshotDetail), which no client bundle, API route, or public page may carry
 * (specs/chances/README.md "Quad's estimate is proprietary"; tests/admin-hidden.test.mts walks the client graph).
 * Everything it returns is display-ready text and numbers for the console's own server components.
 */
import type { School } from "../types.ts";
import { FIELDS, HIDDEN_FIELDS, type FieldDef, type FieldPath } from "../fields.ts";
import {
  ELITE_INDEX,
  EVIDENCE_ADMITS,
  HYSTERESIS,
  SCORE_CENTER,
  SCORE_SPREAD,
  TIER_CUTOFFS,
  TOP_BAND_SCORE,
  WEIGHTS,
  filledReadings,
  inconsistent,
  poolRate,
  rawInputs,
  scales,
  selectivityScore,
  selectivityScoreExact,
  selectivityTier,
  topBand,
  type RawInputs,
  type Scales,
  type ScoreInput,
} from "../selectivity.ts";
import { satTotal } from "../score-bands.ts";
import { SELECTIVITY_TIERS, SELECTIVITY_TIER_LABELS, STANDING_LEVEL_LABELS } from "../chances/levels.ts";
import type { EstimateResult, EstimateStudent, InputKind, SelectivityPool, SelectivityTier, StandingLevel } from "../chances/types.ts";
import { ABLATION_INPUTS, type AblationInput, type AppliedEstimate, type SnapshotDetail } from "../chances/snapshot.ts";
import type { StandingSchool } from "../chances/baseline.ts";
import { INPUT_WORDS, noteText } from "../chances/notes.ts";
import { collegeGpa, gpaPredictors, satMidpoint, satQuartiles, type GpaCurve, type GpaModel } from "../planner/gpa-model.ts";
import { pct, pctSmart } from "../format.ts";

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const num = (v: number, digits = 2) => v.toFixed(digits);
const signed = (v: number, digits = 2) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(digits)}`;
const gpaText = (v: number) => v.toFixed(2);
const rangeText = ([a, b]: readonly [number, number], f: (v: number) => string = gpaText) => (a === b ? f(a) : `${f(a)}–${f(b)}`);
const levelText = (level: StandingLevel | null | undefined) => (level ? STANDING_LEVEL_LABELS[level] : "No level");
const tierText = (tier: SelectivityTier | null | undefined) => (tier ? SELECTIVITY_TIER_LABELS[tier] : "Not rated");

/* ------------------------------------------------------------------ */
/* Selectivity                                                         */
/* ------------------------------------------------------------------ */

/** The five inputs in the method's order, with the words and the field each one cites. Kept equal to WEIGHTS' keys. */
export const SELECTIVITY_INPUTS: readonly { input: ScoreInput; label: string; field: FieldPath }[] = [
  { input: "admit_rate", label: "Admit rate", field: "admissions.acceptance_rate" },
  { input: "class_strength", label: "SAT, 75th percentile", field: "derived.sat_total" },
  { input: "yield", label: "Yield", field: "derived.yield" },
  { input: "retention", label: "Retention", field: "outcomes.retention_rate" },
  { input: "graduation", label: "Graduation rate", field: "outcomes.graduation_rate" },
];

const POOL_LABELS: Record<SelectivityPool, string> = { all: "All applicants", in_state: "In-state applicants", out_of_state: "Out-of-state applicants" };
const RATE_FIELD: Record<SelectivityPool, FieldPath> = {
  all: "admissions.acceptance_rate",
  in_state: "derived.admit_rate_in_state",
  out_of_state: "derived.admit_rate_out_of_state",
};

/** What every college's breakdown is read against: the scales over every rated college, and each input's reporters. */
export interface SelectivityContext {
  scales: Scales;
  /** Per input, the reporters' values on a "higher = harder" ordering, sorted ascending (for percentiles). */
  reporters: Record<ScoreInput, number[]>;
}

/** An input's value on a "higher = harder" ordering (monotone with the method's own scale), or null when not reported. */
function harder(input: ScoreInput, raw: RawInputs, rate: number | null): number | null {
  switch (input) {
    case "admit_rate":
      return rate === null ? null : -rate;
    case "class_strength":
      return raw.sat75;
    // The method reads a zero share as unreported (lib/selectivity.ts ON_SCALE); so does the percentile.
    case "yield":
      return raw.yield ? raw.yield : null;
    case "retention":
      return raw.retention ? raw.retention : null;
    case "graduation":
      return raw.graduation ? raw.graduation : null;
  }
}

const contextMemo = new WeakMap<readonly School[], SelectivityContext>();

/** The scales and reporters over these colleges (every rated, consistent one, as the build reads them). Memoized per array. */
export function selectivityContext(schools: readonly School[]): SelectivityContext {
  const hit = contextMemo.get(schools);
  if (hit) return hit;
  const raws = schools.map(rawInputs);
  const rated = raws.filter((r) => r.admitRate !== null && !inconsistent(r));
  const reporters = {} as Record<ScoreInput, number[]>;
  for (const { input } of SELECTIVITY_INPUTS) {
    reporters[input] = rated
      .map((r) => harder(input, r, r.admitRate))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
  }
  const ctx = { scales: scales(raws), reporters };
  contextMemo.set(schools, ctx);
  return ctx;
}

/** Percent of reporting colleges this value is harder than (ties count half), 0–100; null when not reported. */
export function percentileAmong(sorted: readonly number[], value: number | null): number | null {
  if (value === null || sorted.length === 0) return null;
  let below = 0;
  let same = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) same++;
  }
  return Math.round(((below + same / 2) / sorted.length) * 1000) / 10;
}

export interface SelectivityInputRow {
  input: ScoreInput;
  label: string;
  /** The field the raw value cites (the ACT field when the SAT is the ACT through the concordance). */
  field: FieldPath;
  raw: number | null;
  display: string;
  /** Reported by the college; otherwise filled (yield, retention, graduation from the middle; the SAT from the fit). */
  present: boolean;
  filled: "reported" | "middle" | "fit";
  /** The standardized reading the score uses (standard deviations from the reporters' mean, higher = harder). */
  reading: number;
  percentile: number | null;
  weight: number;
  /** weight ÷ the weights' total. */
  share: number;
  /** share × reading: the rows add up to the weighted mean. */
  contribution: number;
}

export interface SelectivityPoolView {
  pool: SelectivityPool;
  label: string;
  rows: SelectivityInputRow[];
  /** Σ contributions: the weighted mean of the readings. */
  weightedMean: number;
  /** The small-class pull: admitted ÷ (admitted + EVIDENCE_ADMITS). */
  evidence: { admitted: number | null; factor: number };
  /** SCORE_CENTER + SCORE_SPREAD × weightedMean × factor, before the 0–100 hold. */
  unclamped: number;
  exact: number;
  score: number;
  plainTier: SelectivityTier;
  publishedTier: SelectivityTier | null;
  hysteresis: {
    /** The stored tier differs from what the plain cutoffs give: the band kept it. */
    held: boolean;
    /** The stored tier is what the rule gives from this score with the band (false means the build is stale). */
    consistent: boolean;
    /** The score at which the tier moves up (null at the top) and at or below which it moves down (null at the bottom). */
    upAt: number | null;
    downAt: number | null;
    sentence: string;
  };
}

export interface SelectivityPanel {
  status: "rated" | "no_admit_rate" | "inconsistent";
  pools: SelectivityPoolView[];
  topBand: { inBand: boolean; stored: boolean; sentence: string } | null;
  /** The method's constants, shown once (the one place the weights are visible). */
  constants: {
    weights: { input: ScoreInput; label: string; weight: number }[];
    center: number;
    spread: number;
    evidenceAdmits: number;
    hysteresis: number;
    topBandScore: number;
    cutoffs: { tier: SelectivityTier; label: string; at: number | null }[];
  };
  /** The trend adjustment the spec's first version had, and why there is none now. */
  trend: string;
}

/** The score a tier starts at (null for Open, which has no floor). */
export function tierFloor(tier: SelectivityTier): number | null {
  if (tier === "elite") return ELITE_INDEX;
  if (tier === "open") return null;
  return TIER_CUTOFFS[tier];
}

function hysteresisFor(score: number, plain: SelectivityTier, published: SelectivityTier | null): SelectivityPoolView["hysteresis"] {
  const at = published ?? plain;
  const rank = SELECTIVITY_TIERS.indexOf(at);
  const above = rank > 0 ? tierFloor(SELECTIVITY_TIERS[rank - 1]) : null;
  const own = tierFloor(at);
  const upAt = above === null ? null : Math.round((above + HYSTERESIS) * 100) / 100;
  const downAt = own === null ? null : Math.round((own - HYSTERESIS) * 100) / 100;
  const consistent = published === null || selectivityTier(score, published) === published;
  const held = published !== null && published !== plain;
  const band = [upAt !== null ? `moves up at ${num(upAt)} or more` : null, downAt !== null ? `down at ${num(downAt)} or less` : null].filter(Boolean).join(", ");
  let sentence: string;
  if (published === null) sentence = `No tier is stored for this pool; the plain cutoffs give ${tierText(plain)}.`;
  else if (!consistent) sentence = `The stored tier (${tierText(published)}) isn't what the rule gives from score ${num(score)}: the build is stale (npm run build-selectivity).`;
  else if (held)
    sentence = `Hysteresis held ${tierText(published)}: score ${num(score)} reads ${tierText(plain)} on the plain cutoffs, but hasn't crossed by ${HYSTERESIS} points (${band}).`;
  else sentence = `The plain cutoffs give ${tierText(published)}, and it stays there until the score crosses by ${HYSTERESIS} points (${band || "no other tier"}).`;
  return { held, consistent, upAt, downAt, sentence };
}

function rawDisplay(input: ScoreInput, raw: RawInputs, rate: number | null, actOnly: boolean): string {
  switch (input) {
    case "admit_rate":
      return rate === null ? "Not reported" : pctSmart(rate);
    case "class_strength":
      return raw.sat75 === null ? "Not reported" : `${Math.round(raw.sat75)}${actOnly ? " (from the ACT 75th)" : ""}`;
    case "yield":
      return raw.yield ? pct(raw.yield) : "Not reported";
    case "retention":
      return raw.retention ? pct(raw.retention) : "Not reported";
    case "graduation":
      return raw.graduation ? pct(raw.graduation) : "Not reported";
  }
}

function poolView(school: School, raw: RawInputs, ctx: SelectivityContext, pool: SelectivityPool): SelectivityPoolView | null {
  const z = filledReadings(raw, ctx.scales, pool);
  const exact = selectivityScoreExact(raw, ctx.scales, pool);
  const score = selectivityScore(raw, ctx.scales, pool);
  if (!z || exact === null || score === null) return null;
  const rate = poolRate(raw, pool);
  const total = SELECTIVITY_INPUTS.reduce((s, r) => s + WEIGHTS[r.input], 0);
  const actOnly = !satTotal(school) && raw.sat75 !== null;
  const rows = SELECTIVITY_INPUTS.map(({ input, label, field }): SelectivityInputRow => {
    const value = harder(input, raw, rate);
    const present = value !== null;
    const share = WEIGHTS[input] / total;
    return {
      input,
      label,
      field: input === "admit_rate" ? RATE_FIELD[pool] : input === "class_strength" && actOnly ? "admissions.act_composite_25_75" : field,
      raw: input === "admit_rate" ? rate : input === "class_strength" ? raw.sat75 : input === "yield" ? raw.yield : input === "retention" ? raw.retention : raw.graduation,
      display: rawDisplay(input, raw, rate, actOnly),
      present,
      filled: present ? "reported" : input === "class_strength" ? "fit" : "middle",
      reading: z[input],
      percentile: percentileAmong(ctx.reporters[input], value),
      weight: WEIGHTS[input],
      share,
      contribution: share * z[input],
    };
  });
  const weightedMean = rows.reduce((s, r) => s + r.contribution, 0);
  const admitted = raw.admitted;
  const factor = (admitted ?? 0) / ((admitted ?? 0) + EVIDENCE_ADMITS);
  const plainTier = selectivityTier(score)!;
  const sel = school.selectivity;
  const publishedTier = (pool === "all" ? sel?.tier : sel?.[pool]) ?? null;
  return {
    pool,
    label: POOL_LABELS[pool],
    rows,
    weightedMean,
    evidence: { admitted, factor },
    unclamped: SCORE_CENTER + SCORE_SPREAD * weightedMean * factor,
    exact,
    score,
    plainTier,
    publishedTier,
    hysteresis: hysteresisFor(score, plainTier, publishedTier),
  };
}

/**
 * One college's selectivity, input by input: each raw value, its percentile among reporting colleges, its standardized
 * reading, its weight and contribution; the score per pool; and why the stored tier is what it is (the plain cutoffs,
 * or hysteresis holding the previous tier). Recomputed from the dataset (the index file is read only by the build and
 * its check), so it matches the build whenever `npm run check:selectivity` passes.
 */
export function selectivityPanel(school: School, ctx: SelectivityContext): SelectivityPanel {
  const raw = rawInputs(school);
  const constants: SelectivityPanel["constants"] = {
    weights: SELECTIVITY_INPUTS.map(({ input, label }) => ({ input, label, weight: WEIGHTS[input] })),
    center: SCORE_CENTER,
    spread: SCORE_SPREAD,
    evidenceAdmits: EVIDENCE_ADMITS,
    hysteresis: HYSTERESIS,
    topBandScore: TOP_BAND_SCORE,
    cutoffs: SELECTIVITY_TIERS.map((tier) => ({ tier, label: SELECTIVITY_TIER_LABELS[tier], at: tierFloor(tier) })),
  };
  const trend = "No trend adjustment: the second version dropped trend points (they lowered agreement with the public rankings).";
  if (inconsistent(raw)) return { status: "inconsistent", pools: [], topBand: null, constants, trend };
  const pools = (["all", "in_state", "out_of_state"] as const)
    .filter((p) => p === "all" || (raw.inStateRate !== null && raw.outOfStateRate !== null))
    .map((p) => poolView(school, raw, ctx, p))
    .filter((v): v is SelectivityPoolView => v !== null);
  if (pools.length === 0) return { status: "no_admit_rate", pools: [], topBand: null, constants, trend };
  const all = pools[0];
  const stored = school.selectivity?.band === "top";
  const tier = school.selectivity?.tier ?? null;
  const inBand = topBand(all.score, tier, stored ? "top" : null) === "top";
  const top =
    tier === "elite"
      ? {
          inBand,
          stored,
          sentence:
            (inBand ? `In the top band of Ultra selective` : `Not in the top band of Ultra selective`) +
            ` (enters at ${TOP_BAND_SCORE} or more; once in, leaves at ${TOP_BAND_SCORE - HYSTERESIS} or less)` +
            (inBand === stored ? "." : `; the stored band says otherwise: the build is stale.`),
        }
      : null;
  return { status: "rated", pools, topBand: top, constants, trend };
}

/* ------------------------------------------------------------------ */
/* GPA                                                                 */
/* ------------------------------------------------------------------ */

export type GpaSourceKind = "reported" | "bands" | "estimated" | "bounded" | "none";

const GPA_KIND_LABELS: Record<GpaSourceKind, string> = {
  reported: "Reported average (CDS C12)",
  bands: "Mean of the GPA bands (CDS C11)",
  estimated: "Estimated by the model",
  bounded: "Estimated, bounded by the weighted average",
  none: "None: the standing model can't read a GPA here",
};

export interface ModelFit {
  n: number;
  meanError: number;
  p90Error: number;
}

const fitOf = (m: GpaModel): ModelFit => ({ n: m.n, meanError: m.meanError, p90Error: m.p90Error });

export interface GpaPanel {
  kind: GpaSourceKind;
  kindLabel: string;
  point: string | null;
  range: string | null;
  weighted: string | null;
  /** The field the plan's sentence cites for this GPA (null for none). */
  field: FieldPath | null;
  /** For an estimate: the average model's fit and the predictors it read. */
  model: ModelFit | null;
  inputs: { label: string; value: string }[];
  /** The middle 50% (p25 and p75), exact from the bands or estimated by the curve models. */
  middle: { kind: "bands" | "estimated"; p25: string; p75: string; shown: string } | null;
  curve: { p25: ModelFit; p75: ModelFit } | null;
}

/** What the standing model uses for this college's GPA (specs/planner/redesign/gpa.md), with the fit behind an estimate. */
export function gpaPanel(school: School, model: GpaModel | null, curve: GpaCurve | null): GpaPanel {
  const gpa = collegeGpa(school, model, curve);
  const kind: GpaSourceKind = gpa.kind === "estimated" && gpa.weighted !== null ? "bounded" : gpa.kind;
  const middle = gpa.middle ?? null;
  const field: FieldPath | null =
    middle?.kind === "bands"
      ? "derived.gpa_middle_half"
      : middle?.kind === "estimated"
        ? "derived.gpa_estimate"
        : gpa.kind === "reported"
          ? "reported.admission_profile.gpa.average"
          : gpa.kind === "bands"
            ? "derived.gpa_band_mean"
            : gpa.kind === "estimated"
              ? "derived.gpa_estimate"
              : null;
  const inputs: { label: string; value: string }[] = [];
  const x = gpaPredictors(school);
  const estimating = gpa.kind === "estimated" || middle?.kind === "estimated";
  if (estimating && x) {
    const sat = satMidpoint(school);
    const q = satQuartiles(school);
    if (sat !== null) inputs.push({ label: "SAT midpoint", value: String(Math.round(sat)) });
    if (q && middle?.kind === "estimated") inputs.push({ label: "SAT 25th / 75th", value: `${Math.round(q[0])} / ${Math.round(q[1])}` });
    inputs.push({ label: "Admit rate", value: pctSmart(x.rate) }, { label: "Graduation rate", value: pct(x.grad) }, { label: "SAT and ACT senders' shares, added", value: pct(x.submit) });
  }
  return {
    kind,
    kindLabel: GPA_KIND_LABELS[kind],
    point: gpa.point === null ? null : gpaText(gpa.point),
    range: gpa.range ? rangeText(gpa.range) : null,
    weighted: gpa.weighted === null ? null : gpaText(gpa.weighted),
    field,
    model: gpa.kind === "estimated" && model ? fitOf(model) : null,
    inputs,
    middle: middle ? { kind: middle.kind, p25: rangeText(middle.p25), p75: rangeText(middle.p75), shown: rangeText(middle.shown) } : null,
    curve: middle?.kind === "estimated" && curve ? { p25: fitOf(curve.p25), p75: fitOf(curve.p75) } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Hidden derived fields                                               */
/* ------------------------------------------------------------------ */

const poolScore = (panel: SelectivityPanel, pool: SelectivityPool): string | null => {
  const v = panel.pools.find((p) => p.pool === pool);
  return v ? num(v.score) : null;
};

/** Each hidden field's value for one college, as text (null = none for this college). One entry per HIDDEN_FIELDS path. */
export const HIDDEN_VALUES: Readonly<Record<string, (school: School, ctx: { selectivity: SelectivityPanel }) => string | null>> = {
  "selectivity.band": (s) => (s.selectivity?.tier === "elite" ? (s.selectivity.band === "top" ? "Top band" : "Not in the top band") : null),
  "derived.selectivity_score": (_s, c) => poolScore(c.selectivity, "all"),
  "derived.selectivity_score_in_state": (_s, c) => poolScore(c.selectivity, "in_state"),
  "derived.selectivity_score_out_of_state": (_s, c) => poolScore(c.selectivity, "out_of_state"),
};

/** Hidden fields with no entry in HIDDEN_VALUES (must be empty; the test fails otherwise). */
export function hiddenFieldsWithoutValue(fields: readonly string[] = HIDDEN_FIELDS): string[] {
  return fields.filter((p) => !(p in HIDDEN_VALUES));
}

export interface HiddenFieldRow {
  path: FieldPath;
  label: string;
  value: string | null;
  formula: string | null;
}

/** The "Derived, not shown" panel: every hidden registry field with this college's value (lineage comes from citeField). */
export function hiddenFieldRows(school: School, ctx: { selectivity: SelectivityPanel }): HiddenFieldRow[] {
  return HIDDEN_FIELDS.map((path) => {
    const def = FIELDS[path] as FieldDef;
    return { path, label: def.label, value: HIDDEN_VALUES[path]?.(school, ctx) ?? null, formula: def.derived?.formula ?? null };
  });
}

/* ------------------------------------------------------------------ */
/* High school pooled course counts                                    */
/* ------------------------------------------------------------------ */

/**
 * The fewest distinct students before school_course_list() returns a course (supabase/migrations/
 * 20261011120000_school_course_counts.sql, `c.students >= 3`, the threshold's one home). Mirrored here only to draw the
 * line on the admin high-school page; tests/admin-hidden.test.mts reads the migration and fails if they differ.
 */
export const COURSE_LIST_MIN_STUDENTS = 3;

export interface CourseCountRow {
  key: string;
  name: string;
  students: number;
  /** At or over the line: school_course_list() returns it, so the course plan can suggest it. */
  listed: boolean;
}

/** Every pooled count, most students first, each marked against the three-student line. */
export function courseCountRows(rows: readonly { course_key: string; students: number }[], nameOf: (key: string) => string | null): CourseCountRow[] {
  return rows
    .map((r) => ({ key: r.course_key, name: nameOf(r.course_key) ?? r.course_key, students: r.students, listed: r.students >= COURSE_LIST_MIN_STUDENTS }))
    .sort((a, b) => b.students - a.students || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* A student's standing at one college                                 */
/* ------------------------------------------------------------------ */

const ABLATION_WORDS: Record<AblationInput, string> = {
  residency: "Without the residency (pool) rate",
  crowding: "Without GPA crowding",
  rigor: "Without the rigor reading",
  rank: "Without class rank",
  depth: "Without depth (courses and activities)",
  hooks: "Without hooks (legacy, recruiting)",
  interest: "Without shown interest",
};

const POSITION_WORDS = { below: "Below the college's range", in: "In the college's range", above: "Above the college's range" } as const;

export interface StandingPanelView {
  unitId: string;
  /** The model's level, or the baseline's when the model failed (then `fellBack`). */
  level: string;
  label: string | null;
  /** The hidden odds as a percentage with one decimal; null without a level's measures. */
  hiddenOdds: string | null;
  closeness: string | null;
  used: string[];
  missing: string[];
  /** The student's value beside the college's, input by input. */
  sideBySide: { input: string; student: string; college: string }[];
  /** The note catalog sentences that fired, in order. */
  notes: string[];
  /** The level with each input switched off; `changed` when it differs from the level. */
  ablations: { input: string; level: string; changed: boolean }[];
  /** The rest of the method's detail, as label and value. */
  detail: { label: string; value: string }[];
  modelVersion: string;
  /** The open baseline's answer for the same student and college, for comparison. */
  baseline: string | null;
  /** The model threw and the baseline was served (no detail). */
  fellBack: boolean;
}

function studentGpa(s: EstimateStudent): string {
  if (s.gpa === null && !s.gpaRange) return "Not entered";
  const point = s.gpa !== null ? `${gpaText(s.gpa)} unweighted` : null;
  const range = s.gpaRange && (s.gpa === null || s.gpaRange[0] !== s.gpaRange[1]) ? `range ${rangeText(s.gpaRange)}` : null;
  return [point, range].filter(Boolean).join(", ");
}

function collegeGpaText(college: StandingSchool | null): string {
  const g = college?.gpa;
  if (!g) return college?.gpaAverage != null ? `${gpaText(college.gpaAverage)} average` : "None";
  if (g.middle) return `Middle 50% ${rangeText(g.middle.shown)} (${g.middle.kind === "bands" ? "from the bands" : "estimated"})`;
  if (g.point !== null) return `${gpaText(g.point)} (${g.kind}${g.range && g.range[0] !== g.range[1] ? `, ${rangeText(g.range)}` : ""})`;
  return "None";
}

function testText(s: EstimateStudent, college: StandingSchool | null): { student: string; college: string } {
  const t = s.test;
  const student = t ? `${t.kind.toUpperCase()} ${t.score}${s.practice ? " (practice)" : ""}` : "Not entered";
  const ranges = [college?.sat ? `SAT ${college.sat[0]}–${college.sat[1]}` : null, college?.act ? `ACT ${college.act[0]}–${college.act[1]}` : null].filter(Boolean);
  const policy = college?.testPolicy ? ` · policy: ${college.testPolicy.replace(/-/g, " ")}` : "";
  return { student, college: `${ranges.length ? ranges.join(", ") : "No range"}${policy}` };
}

function depthText(d: SnapshotDetail["depth"]): string | null {
  if (!d) return null;
  const parts = [
    d.activitiesReading ? `activities ${d.activitiesReading.replace(/_/g, " ")} (${d.activitiesCount})` : `${d.activitiesCount} activities`,
    d.majorDeep ? "deep in the major" : null,
    d.trajectory ? "rising trajectory" : null,
    d.recognition ? `recognition tier ${d.recognition}` : null,
    d.workHours ? `${d.workHours} work hours` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

const words = (kinds: readonly InputKind[]) => kinds.map((k) => INPUT_WORDS[k] ?? k);

/**
 * The standing panel for one list college: the estimate's level and label, its private detail (hidden odds, Stage 1
 * position, the pool's rate, crowding, rigor, the tier that capped it, completeness, the state used, depth), the
 * inputs used with the student's values beside the college's, the catalog notes that fired, the ablations, the model
 * version, and the baseline's answer. `applied` is estimateWithDetail()'s output; `baseline` is baselineEstimate()'s.
 */
export function standingPanel(input: { applied: AppliedEstimate; baseline: EstimateResult | null; student: EstimateStudent; college: StandingSchool | null }): StandingPanelView {
  const { result } = input.applied;
  const detail = input.applied.detail ?? null;
  const s = input.student;
  const test = testText(s, input.college);
  const advanced = (s.courses ?? []).filter((c) => c.kind === "ap" || c.kind === "ib_hl" || c.kind === "ib_sl").length;
  const sideBySide = [
    { input: "GPA", student: studentGpa(s), college: collegeGpaText(input.college) },
    { input: "Test", ...test },
    { input: "Class rank", student: s.classRankPercentile !== null ? `Top ${s.classRankPercentile}%` : s.classStanding ? s.classStanding.replace(/_/g, " ") : "Not entered", college: "—" },
    { input: "Rigor", student: `${advanced} AP/IB course${advanced === 1 ? "" : "s"} taken or planned`, college: detail?.rigorReading ? `Reading: ${detail.rigorReading.replace(/_/g, " ")}` : "No reading" },
    {
      input: "State",
      student: s.state ?? (detail?.stateUsed ? `${detail.stateUsed} (from the high school)` : "Not entered"),
      college: detail?.baseRateKind ? `${detail.baseRateKind} rate${detail.baseRate != null ? ` ${pctSmart(detail.baseRate)}` : ""}` : input.college?.admitRate != null ? `overall rate ${pctSmart(input.college.admitRate)}` : "No rate",
    },
    { input: "Major", student: s.majors?.length ? s.majors.join(", ") : "Not entered", college: "—" },
  ];
  const level = result.group;
  const ablations = detail?.without
    ? ABLATION_INPUTS.filter((k) => k in detail.without!).map((k) => {
        const without = detail.without![k] ?? null;
        return { input: ABLATION_WORDS[k], level: levelText(without), changed: without !== level };
      })
    : [];
  const rows: { label: string; value: string }[] = [];
  if (detail) {
    if (detail.position) rows.push({ label: "Stage 1 position", value: POSITION_WORDS[detail.position] });
    if (detail.crowded !== undefined && detail.crowded !== null) rows.push({ label: "GPA crowding", value: detail.crowded ? "Crowded" : "Not crowded" });
    if (detail.selectivityTier !== undefined) rows.push({ label: "Tier that capped the level", value: tierText(detail.selectivityTier) });
    if (detail.completeness != null) rows.push({ label: "Completeness", value: pct(detail.completeness) });
    if (detail.stateUsed) rows.push({ label: "State used", value: detail.stateUsed });
    const depth = depthText(detail.depth);
    if (depth) rows.push({ label: "Depth", value: depth });
  }
  return {
    unitId: result.unitId,
    level: levelText(level),
    label: result.label ? noteText({ key: `estimate.label.${result.label}`, values: {} }) || result.label : null,
    hiddenOdds: detail?.hiddenOdds != null ? `${(detail.hiddenOdds * 100).toFixed(1)}%` : null,
    closeness: result.closeness === null ? null : `${result.closeness + 1} of 4 (4 = nearest the next level up)`,
    used: words(result.used),
    missing: words(result.missing),
    sideBySide,
    notes: result.notes.map((n) => noteText(n)).filter((t) => t !== ""),
    ablations,
    detail: rows,
    modelVersion: result.modelVersion,
    baseline: input.baseline ? levelText(input.baseline.group) : null,
    fellBack: detail === null,
  };
}

/** For the panel's summary line: "Target · hidden odds 41.0%". */
export function standingSummary(v: StandingPanelView): string {
  return [v.label ? `${v.level} (${v.label})` : v.level, v.hiddenOdds ? `hidden odds ${v.hiddenOdds}` : null, v.fellBack ? "baseline served" : null].filter(Boolean).join(" · ");
}

/** Signed standardized reading for the table ("+1.32"). */
export const readingText = (v: number) => signed(v);
