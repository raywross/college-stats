/**
 * The admit rate for the student's own pool (specs/chances/base-rates.md): the most specific published rate that
 * matches the student, with its kind, label, cited field, and year, plus the public lines that go with it.
 *
 * Precedence: a campus **automatic-admission** program the student meets (data/guaranteed-admission.json) > the
 * published rate of the **school or major** their first intended major applies to (data/major-admission.json) > the
 * **residency** rate from the college's CDS grid (`rateForStudent`) > the **overall** rate. Rates are never
 * multiplied or blended: when a major rate is shown, the residency rate is named beside it in words. A program of
 * scope "system" (UC's ELC) guarantees a place in the system, never at this campus, so it is a line here and never
 * the pool's rate. A program applies only on fields the student gave: with the state, rank, or GPA it needs missing,
 * it is a "you may qualify" line, never assumed.
 *
 * Pure and client-safe: everything here is a published fact (a college's rate, a program's rule), with its citation.
 * How the rate moves an estimate is the method's (specs/chances/method/standing.md, server-only).
 */
import type { School } from "../types";
import { edRate, sameDocumentRate } from "../cds/admissions.ts";
import { OUTSIDE_US as GRID_OUTSIDE_US, rateForStudent } from "../cds/residency-display.ts";
import { pctSmart } from "../format.ts";
import { stateName } from "../states.ts";
import { OUTSIDE_US as PROFILE_OUTSIDE_US } from "../student-profile.ts";
import { gpaText, guaranteedCycle, programsFor, type GuaranteedProgram } from "./guaranteed.ts";
import { majorUnitFor, unitAdmitRate, type CuratedMajorUnit } from "./major-admission.ts";
import { noteText } from "./notes.ts";
import type { EstimateNote, EstimateStudent, PoolRate } from "./types.ts";

/** What the pool rate reads from the student. */
export type PoolStudent = Pick<EstimateStudent, "state" | "classRankPercentile" | "gpa" | "majors"> & Partial<Pick<EstimateStudent, "round">>;
/** What it reads from the college. */
export type PoolSchool = Pick<School, "unit_id" | "name" | "location" | "admissions" | "reported" | "lineage">;

/** Field paths the pool's facts cite (lib/fields.ts). */
export const POOL_FIELDS = {
  guaranteedRule: "reference.guaranteed_admission.rule",
  guaranteedScope: "reference.guaranteed_admission.scope",
  majorGuaranteed: "reference.guaranteed_admission.major_guaranteed",
  majorRate: "reported.major_admission.admit_rate",
  inState: "derived.admit_rate_in_state",
  outOfState: "derived.admit_rate_out_of_state",
  international: "derived.admit_rate_international",
  overall: "admissions.acceptance_rate",
  earlyDecision: "derived.ed_admit_rate",
} as const;

/** Whether a program applies to the student: "not_eligible" (another state's program), "not_met" (a stated threshold missed). */
export type ProgramStatus = "applies" | "may_qualify" | "not_met" | "not_eligible";
export type ProgramInput = "state" | "class_rank" | "gpa";

export interface ProgramCheck {
  program: GuaranteedProgram;
  status: ProgramStatus;
  /** For "may_qualify": the student fields the program needs that weren't given. */
  missing: ProgramInput[];
}

/** The pool's rate (the PoolRate contract) with the lines that go with it. */
export interface PoolReading extends PoolRate {
  /** Public lines, in order: the pool's own line first, then the guarantee's limits, residency named beside a major rate, system and "may qualify" lines, the early-decision fact. */
  notes: EstimateNote[];
  /** Every program at this college for the file's cycle, with its status for this student. */
  programs: ProgramCheck[];
  /** Every field path the rate and notes cite, to list beside them. */
  facts: string[];
}

export interface PoolOptions {
  /**
   * The overall rate's year when the college has no lineage record for it (its field's default release, e.g. the
   * dataset's IPEDS admissions vintage). Without either, the overall line is undated.
   */
  overallYear?: string | null;
}

const isOutsideUs = (state: string) => state === PROFILE_OUTSIDE_US || state === GRID_OUTSIDE_US;

/**
 * A program's rule checked against the student's own fields. Residency first (a program for another state's students
 * is "not_eligible"), then the thresholds: rank as "top N%" (the student's `classRankPercentile` at or under N), GPA
 * as an unweighted minimum; `match: "any"` needs one of two thresholds, otherwise each. A missed threshold is
 * "not_met"; a threshold or state not given, with nothing missed, is "may_qualify". The program's curriculum isn't
 * something the profile records, so it never blocks "applies" (the curriculum is shown with the program's source).
 */
export function programStatus(program: GuaranteedProgram, student: Pick<PoolStudent, "state" | "classRankPercentile" | "gpa">): ProgramCheck {
  const r = program.rule;
  const missing: ProgramInput[] = [];
  if (r.resident) {
    if (!student.state) missing.push("state");
    else if (isOutsideUs(student.state) || student.state.toUpperCase() !== program.state) return { program, status: "not_eligible", missing: [] };
  }
  const tests: (boolean | null)[] = [];
  if (r.class_rank_top_pct !== null) {
    const v = student.classRankPercentile;
    if (v === null || v === undefined) missing.push("class_rank");
    tests.push(v === null || v === undefined ? null : v <= r.class_rank_top_pct);
  }
  if (r.gpa_min !== null) {
    const v = student.gpa;
    if (v === null || v === undefined) missing.push("gpa");
    tests.push(v === null || v === undefined ? null : v >= r.gpa_min - 1e-9);
  }
  const any = r.match === "any" && tests.length > 1;
  const met = any ? (tests.includes(true) ? true : tests.every((t) => t === false) ? false : null) : tests.includes(false) ? false : tests.every((t) => t === true) ? true : null;
  if (met === false) return { program, status: "not_met", missing: [] };
  if (met === true && !missing.includes("state")) return { program, status: "applies", missing: [] };
  return { program, status: "may_qualify", missing: met === true ? ["state"] : missing };
}

/** The rule in words for a label: "top 5%", "a 3.0 GPA", "top 25% or a 3.0 GPA". */
export function ruleWords(program: GuaranteedProgram): string {
  const { class_rank_top_pct: rank, gpa_min: gpa, match } = program.rule;
  const rankWords = rank !== null ? `top ${rank}%` : null;
  const gpaWords = gpa !== null ? `a ${gpaText(gpa)} GPA` : null;
  if (rankWords && gpaWords) return `${rankWords} ${match === "any" ? "or" : "with"} ${gpaWords}`;
  return rankWords ?? gpaWords ?? "";
}

/** "Texas automatic admission (top 5%)": the program as the "Guaranteed for you" line names it. */
export function programLabel(program: GuaranteedProgram): string {
  const rule = ruleWords(program);
  return rule ? `${program.name} (${rule})` : program.name;
}

/** The "you may qualify" line for a program, worded by its thresholds. */
function mayQualifyNote(program: GuaranteedProgram): EstimateNote {
  const { class_rank_top_pct: rank, gpa_min: gpa, match } = program.rule;
  const values: Record<string, string> = { program: program.name };
  if (rank !== null) values.pct = `${rank}%`;
  if (gpa !== null) values.gpa = gpaText(gpa);
  const key = rank !== null && gpa !== null ? (match === "any" ? "pool.may_qualify_rank_or_gpa" : "pool.may_qualify_rank_and_gpa") : rank !== null ? "pool.may_qualify" : "pool.may_qualify_gpa";
  return { key, values, cite: POOL_FIELDS.guaranteedRule };
}

/** Easier to meet first: a larger rank share, then a lower GPA. Used to keep one "may qualify" line per program name. */
const leniency = (p: GuaranteedProgram) => (p.rule.class_rank_top_pct ?? 0) * 10 - (p.rule.gpa_min ?? 0);

/** Whether a unit admits separately: a direct-admit unit, or one the college says compares applicants within it. */
export function admitsSeparately(unit: Pick<CuratedMajorUnit, "direct_admit" | "review">): boolean {
  const c = unit.review?.major_considered;
  return unit.direct_admit === true || unit.direct_admit === "some" || c === "pool" || c === "pool_and_emphasis";
}

const label = (key: string) => noteText({ key, values: {} });

/** The residency rate for the student, with its line; null without a state, a grid, or a rate for the student's group. */
function residencyPool(student: PoolStudent, school: PoolSchool): { rate: PoolRate; note: EstimateNote } | null {
  const grid = school.reported?.admissions_by_residency;
  if (!student.state || !grid) return null;
  const { group, rate } = rateForStudent(school, isOutsideUs(student.state) ? GRID_OUTSIDE_US : student.state);
  if (rate === null) return null;
  const year = grid.entering_term;
  const state = stateName(school.location.state);
  const values = { state, rate: pctSmart(rate), year };
  if (group === "in_state") return { rate: { kind: "residency", rate, label: label("pool.kind.residency_in"), field: POOL_FIELDS.inState, edition: year }, note: { key: "pool.residency_in", values, cite: POOL_FIELDS.inState } };
  if (group === "out_of_state") return { rate: { kind: "residency", rate, label: label("pool.kind.residency_out"), field: POOL_FIELDS.outOfState, edition: year }, note: { key: "pool.residency_out", values, cite: POOL_FIELDS.outOfState } };
  return { rate: { kind: "residency", rate, label: label("pool.kind.residency_international"), field: POOL_FIELDS.international, edition: year }, note: { key: "pool.residency_international", values, cite: POOL_FIELDS.international } };
}

/** The overall rate and its line (no line when the college has no rate: open admission or not reported). */
function overallPool(school: PoolSchool, opts: PoolOptions): { rate: PoolRate; note: EstimateNote | null } {
  const rate = school.admissions?.acceptance_rate ?? null;
  const year = school.lineage?.[POOL_FIELDS.overall]?.year ?? opts.overallYear ?? null;
  const pool: PoolRate = { kind: "overall", rate, label: label("pool.kind.overall"), field: POOL_FIELDS.overall, edition: year };
  if (rate === null) return { rate: pool, note: null };
  const note: EstimateNote = year ? { key: "pool.overall", values: { rate: pctSmart(rate), year }, cite: POOL_FIELDS.overall } : { key: "pool.overall_undated", values: { rate: pctSmart(rate) }, cite: POOL_FIELDS.overall };
  return { rate: pool, note };
}

/**
 * The early-decision fact (base-rates.md "Early decision, as a fact"), for a student whose round is ED or ED II at a
 * college whose CDS has its ED counts and the same document's overall rate. Never the pool's rate.
 */
export function earlyDecisionNote(student: Pick<PoolStudent, "round">, school: PoolSchool): EstimateNote | null {
  if (student.round !== "ed" && student.round !== "ed2") return null;
  const ed = edRate(school.reported?.admission_profile?.early_decision);
  const overall = sameDocumentRate(school as School);
  const year = school.lineage?.["reported.admission_profile.early_decision.applicants"]?.year;
  if (ed === null || overall === null || !year) return null;
  return { key: "pool.ed_fact", values: { ed: pctSmart(ed), overall: pctSmart(overall), year }, cite: POOL_FIELDS.earlyDecision };
}

/** The pool's rate for this student at this college, with its lines and citations (see the module comment). */
export function poolRateFor(student: PoolStudent, school: PoolSchool, opts: PoolOptions = {}): PoolReading {
  const programs = programsFor(school.unit_id).map((p) => programStatus(p, student));
  const family = student.majors[0] ?? null;
  const unit = family ? majorUnitFor(school.unit_id, family) : null;
  const unitRate = unit ? unitAdmitRate(unit) : null;
  const residency = residencyPool(student, school);
  const notes: EstimateNote[] = [];
  let pool: PoolRate;

  const guarantee = programs.find((c) => c.status === "applies" && c.program.scope === "campus");
  if (guarantee) {
    const p = guarantee.program;
    pool = { kind: "guaranteed", rate: null, label: label("pool.kind.guaranteed"), field: POOL_FIELDS.guaranteedRule, edition: `Fall ${guaranteedCycle()}`, programId: p.id, scope: "campus" };
    notes.push({ key: "pool.guaranteed", values: { program: programLabel(p) }, cite: POOL_FIELDS.guaranteedRule });
    if (!p.major_guaranteed && unit && admitsSeparately(unit)) notes.push({ key: "pool.major_not_guaranteed", values: { college: school.name, unit: unit.name }, cite: POOL_FIELDS.majorGuaranteed });
  } else if (unit && unitRate) {
    pool = { kind: "major", rate: unitRate.rate, label: label("pool.kind.major"), field: POOL_FIELDS.majorRate, edition: unitRate.year };
    notes.push({ key: "pool.major_rate", values: { unit: unit.name, rate: pctSmart(unitRate.rate), year: unitRate.year }, cite: POOL_FIELDS.majorRate });
    // No published cross of major and residency: the residency rate is named beside it, never multiplied in.
    if (residency) notes.push(residency.note);
  } else if (residency) {
    pool = residency.rate;
    notes.push(residency.note);
  } else {
    const overall = overallPool(school, opts);
    pool = overall.rate;
    if (overall.note) notes.push(overall.note);
  }

  // System guarantees and "you may qualify" lines. With a campus guarantee in hand, other campus programs add nothing.
  const shownMayQualify = new Map<string, GuaranteedProgram>();
  for (const c of programs) {
    if (c.status !== "may_qualify" || (guarantee && c.program.scope === "campus")) continue;
    const prev = shownMayQualify.get(c.program.name);
    if (!prev || leniency(c.program) > leniency(prev)) shownMayQualify.set(c.program.name, c.program);
  }
  for (const c of programs) {
    const p = c.program;
    if (shownMayQualify.get(p.name) === p) notes.push(mayQualifyNote(p));
    if (p.scope === "system" && (c.status === "applies" || c.status === "may_qualify")) {
      notes.push({ key: "pool.system_scope", values: { program: p.name, system: p.system_name ?? p.name }, cite: POOL_FIELDS.guaranteedScope });
    }
  }

  const ed = earlyDecisionNote(student, school);
  if (ed) notes.push(ed);

  // An overall rate the college doesn't report has nothing to cite.
  const own = pool.rate !== null || pool.kind === "guaranteed" ? [pool.field] : [];
  const facts = [...new Set([...own, ...notes.map((n) => n.cite).filter((c): c is string => !!c)])];
  return { ...pool, notes, programs, facts };
}
