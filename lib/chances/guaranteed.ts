/**
 * Published automatic-admission programs (specs/chances/base-rates.md "Automatic admission"): Texas's top-10% rule,
 * UT Austin's smaller cut, UC's Eligibility in the Local Context (system scope), and other state programs, each
 * hand-curated in data/guaranteed-admission.json from the college's, system's, or state agency's own page with its
 * words quoted. Checked by scripts/check-guaranteed-admission.mts in `npm run verify`; cited as
 * `reference.guaranteed_admission.*` (lib/fields.ts), which lib/lineage.ts resolves to the program's source.
 * Pure: safe in server and client code and in tests. Whether a program applies to a student is pool-rate.ts's.
 */
import file from "../../data/guaranteed-admission.json" with { type: "json" };

export interface GuaranteedRule {
  /** Applies to students in the top N% of their class (5 = top 5%); null when the rule isn't by rank. */
  class_rank_top_pct: number | null;
  /** A minimum unweighted GPA, when the program states one; else null. */
  gpa_min: number | null;
  /** State residents (or graduates of the state's high schools) only. */
  resident: boolean;
  /** A curriculum the program requires, in its own words; null when none. */
  curriculum: string | null;
  /**
   * How a rank threshold and a GPA threshold combine when the program states both: "all" (the default) needs each,
   * "any" needs one ("top 25% of the class, OR a 3.0 GPA"). Ignored with a single threshold.
   */
  match?: "all" | "any";
}

export interface GuaranteedProgram {
  id: string;
  name: string;
  /** IPEDS ids of the colleges the program admits to (every campus of a system for scope "system"). */
  unit_ids: string[];
  /** USPS code of the state whose students it covers. */
  state: string;
  rule: GuaranteedRule;
  /** "campus": admission to that college; "system": a place somewhere in the system, never a chosen campus. */
  scope: "campus" | "system";
  /** For scope "system": the system's name as a sentence names it ("University of California"). */
  system_name?: string;
  /** Whether admission includes the student's major; false for every program so far (UT Austin and Texas A&M say so). */
  major_guaranteed: boolean;
  /** The entering falls the rule is published for. */
  fall: number[];
  source: { publisher: string; url: string; retrieved: string; quote: string; verified_via: "page" | "search" };
}

export interface GuaranteedFile {
  description?: string;
  /** The entering fall the current application season applies for. */
  cycle: number;
  checked: string;
  programs: GuaranteedProgram[];
}

const data = file as GuaranteedFile;

/** Every curated program. */
export function guaranteedPrograms(): readonly GuaranteedProgram[] {
  return data.programs;
}

/** The file's cycle: the entering fall the current season applies for. */
export function guaranteedCycle(): number {
  return data.cycle;
}

/** The programs that admit to a college (campus or system scope), for the file's cycle. */
export function programsFor(unitId: string): GuaranteedProgram[] {
  return data.programs.filter((p) => p.unit_ids.includes(unitId) && p.fall.includes(data.cycle));
}

/** One program by id, or null. */
export function programById(id: string): GuaranteedProgram | null {
  return data.programs.find((p) => p.id === id) ?? null;
}

/**
 * The entering fall a season applies for on a date: from August on, next year's fall (October 2026 → 2027); before
 * August, this year's (the season's decisions are out by then).
 */
export function currentCycle(today: Date): number {
  return today.getUTCMonth() >= 7 ? today.getUTCFullYear() + 1 : today.getUTCFullYear();
}

/* ------------------------------------------------------------------ */
/* Validation (scripts/check-guaranteed-admission.mts, `npm run verify`) */
/* ------------------------------------------------------------------ */

export function isIsoDate(v: unknown): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function isHttpsUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** A GPA as a page prints it: 3 → "3.0", 2.25 → "2.25". */
export function gpaText(gpa: number): string {
  return Number.isInteger(gpa) ? gpa.toFixed(1) : String(gpa);
}

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATE_RE = /^[A-Z]{2}$/;

/**
 * Problems with the programs file, one line each (empty means sound): the cycle is the current or next entering fall
 * on `today`; every program has a unique id, a name, known `unit_ids`, a state, a rule with a rank or GPA threshold,
 * a scope, a `major_guaranteed` flag, entering falls that include the file's cycle (a program whose falls are past
 * fails), and a source with an https URL, a retrieval date, a quote, and how it was verified. `knownUnitIds` is the
 * dataset's college ids (omit to skip that check).
 */
export function validateGuaranteed(input: GuaranteedFile, today: Date, knownUnitIds?: Set<string>): string[] {
  if (!input || !Array.isArray(input.programs)) return ['guaranteed-admission: "programs" must be an array'];
  const errors: string[] = [];
  const now = currentCycle(today);
  if (!Number.isInteger(input.cycle) || (input.cycle !== now && input.cycle !== now + 1)) {
    errors.push(`guaranteed-admission: cycle ${JSON.stringify(input.cycle)} must be the current or next entering fall (${now} or ${now + 1}); re-verify the programs`);
  }
  if (!isIsoDate(input.checked)) errors.push("guaranteed-admission: checked must be a real ISO date");
  const seen = new Set<string>();
  input.programs.forEach((p, i) => {
    if (!p || typeof p !== "object") {
      errors.push(`guaranteed-admission[${i}]: not an object`);
      return;
    }
    const where = `guaranteed-admission[${i}] ${typeof p.id === "string" ? p.id : "(no id)"}`;
    if (typeof p.id !== "string" || !ID_RE.test(p.id)) errors.push(`${where}: id must be lowercase words joined by hyphens`);
    else if (seen.has(p.id)) errors.push(`${where}: duplicate id`);
    else seen.add(p.id);
    if (typeof p.name !== "string" || !p.name.trim()) errors.push(`${where}: name is required`);
    if (!Array.isArray(p.unit_ids) || p.unit_ids.length === 0) errors.push(`${where}: unit_ids must list at least one college`);
    else
      for (const u of p.unit_ids) {
        if (typeof u !== "string" || !/^\d+$/.test(u)) errors.push(`${where}: unit_id ${JSON.stringify(u)} must be a numeric string`);
        else if (knownUnitIds && !knownUnitIds.has(u)) errors.push(`${where}: unit_id ${u} isn't a college in the dataset`);
      }
    if (typeof p.state !== "string" || !STATE_RE.test(p.state)) errors.push(`${where}: state must be a USPS code`);
    const r = p.rule;
    if (!r || typeof r !== "object") errors.push(`${where}: rule is required`);
    else {
      const rank = r.class_rank_top_pct;
      const gpa = r.gpa_min;
      if (rank !== null && !(typeof rank === "number" && rank > 0 && rank <= 100)) errors.push(`${where}: class_rank_top_pct must be a number from 1 to 100, or null`);
      if (gpa !== null && !(typeof gpa === "number" && gpa > 0 && gpa <= 4)) errors.push(`${where}: gpa_min must be an unweighted GPA up to 4.0, or null`);
      if (rank === null && gpa === null) errors.push(`${where}: rule needs a class rank or GPA threshold`);
      if (r.match !== undefined && r.match !== "all" && r.match !== "any") errors.push(`${where}: rule.match must be "all" or "any"`);
      if (r.match === "any" && (rank === null || gpa === null)) errors.push(`${where}: rule.match "any" needs both a rank and a GPA threshold`);
      if (typeof r.resident !== "boolean") errors.push(`${where}: rule.resident must be true or false`);
      if (r.curriculum !== null && (typeof r.curriculum !== "string" || !r.curriculum.trim())) errors.push(`${where}: rule.curriculum must be words or null`);
    }
    if (p.scope !== "campus" && p.scope !== "system") errors.push(`${where}: scope must be "campus" or "system"`);
    if (p.scope === "system" && (typeof p.system_name !== "string" || !p.system_name.trim())) errors.push(`${where}: a system-scope program names its system (system_name)`);
    if (typeof p.major_guaranteed !== "boolean") errors.push(`${where}: major_guaranteed must be true or false`);
    if (!Array.isArray(p.fall) || p.fall.length === 0 || p.fall.some((y) => !Number.isInteger(y))) errors.push(`${where}: fall must list entering years`);
    else if (Number.isInteger(input.cycle) && !p.fall.includes(input.cycle)) errors.push(`${where}: published for fall ${p.fall.join(", ")}, not the file's cycle (${input.cycle}); re-verify or remove it`);
    const s = p.source;
    if (!s || typeof s !== "object") errors.push(`${where}: source is required`);
    else {
      if (!isHttpsUrl(s.url)) errors.push(`${where}: source.url must be an https page`);
      if (!isIsoDate(s.retrieved)) errors.push(`${where}: source.retrieved must be a real ISO date`);
      if (typeof s.quote !== "string" || s.quote.trim().length < 20) errors.push(`${where}: source.quote must quote the program's own words`);
      if (typeof s.publisher !== "string" || !s.publisher.trim()) errors.push(`${where}: source.publisher is required`);
      if (s.verified_via !== "page" && s.verified_via !== "search") errors.push(`${where}: source.verified_via must be "page" or "search"`);
      // The threshold must appear in the quote, as the review queue requires for any number.
      if (r && typeof r.class_rank_top_pct === "number" && typeof s.quote === "string" && !s.quote.includes(`${r.class_rank_top_pct}`)) {
        errors.push(`${where}: the rank threshold (${r.class_rank_top_pct}) doesn't appear in the quote`);
      }
      if (r && typeof r.gpa_min === "number" && typeof s.quote === "string" && !s.quote.includes(gpaText(r.gpa_min))) {
        errors.push(`${where}: the GPA threshold (${gpaText(r.gpa_min)}) doesn't appear in the quote`);
      }
    }
  });
  return errors;
}
