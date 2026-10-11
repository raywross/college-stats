/**
 * The application cycle (specs/planner/model.md "The cycle year"; timeline.md "The cycle file"). Pure: the cycle a
 * graduating class applies in, the student's grade on a given day, the cycle file's entries, and the `applies`
 * vocabulary those entries use. The file itself is data/application-cycle.json, checked by scripts/check-cycle.mts
 * in `npm run verify`.
 *
 * Naming: a cycle is named by its academic year, "YYYY-YY", the year in which students apply. The class of G applies
 * in the cycle that starts in G - 1 (applications in the fall of G - 1, decisions in the spring of G).
 */
import file from "../../data/application-cycle.json" with { type: "json" };
import type { Assignee, PlanItem, PlanSchool } from "./types.ts";
import type { StudentProfileData } from "../student-profile.ts";

/** The `applies` vocabulary: an entry is a task for a student only when its rule holds. Unknown values fail the check. */
export const APPLIES = ["all", "has_css_college", "has_common_app", "plans_tests", "uses_may1", "has_ed", "committed", "international", "noncustodial", "ap_in_progress", "has_ap_course"] as const;
export type Applies = (typeof APPLIES)[number];

export const ASSIGNEES: readonly Assignee[] = ["student", "guardian", "either"];

export interface CycleEntry {
  /** Unique within the cycle, snake_case; the task key's last part. */
  key: string;
  label: string;
  /** A fixed date (ISO), or… */
  date?: string;
  /** …a window [start, end] (ISO), shown as a bar with no hard due date. Exactly one of date/window. */
  window?: [string, string];
  /** For a test date: the registration deadline (ISO), on or before `date`. */
  register_by?: string;
  applies: Applies;
  assignee: Assignee;
  /** Where the date or the advice comes from (https). */
  source: string;
  detail?: string;
}

export interface Cycle {
  /** "YYYY-YY". */
  cycle: string;
  /** The calendar year the cycle starts in (applications go out that fall). */
  startYear: number;
  entries: CycleEntry[];
}

export interface CycleFile {
  description?: string;
  cycles: { cycle: string; entries: CycleEntry[] }[];
}

const CYCLE_RE = /^(\d{4})-(\d{2})$/;

/** "YYYY-YY" for the cycle starting in `startYear`. */
export function cycleKey(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** The start year of a "YYYY-YY" key, or null when the key isn't one (or its two years aren't consecutive). */
export function cycleStartOf(key: string): number | null {
  const m = CYCLE_RE.exec(key);
  if (!m) return null;
  const start = Number(m[1]);
  return (start + 1) % 100 === Number(m[2]) ? start : null;
}

/** The cycle a class applies in: the class of 2028 applies in the cycle that starts in 2027. */
export function cycleFor(gradYear: number): string {
  return cycleKey(gradYear - 1);
}

/**
 * The cycle under way on `today` (a guardian's own list, or a student without a grad year): a cycle starts on
 * August 1, when the Common App opens, so from August a new cycle is current.
 */
export function currentCycle(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return cycleKey(m >= 8 ? y : y - 1);
}

/**
 * The start year of the cycle a college's logistics block describes: "Fall 2027" (the entering class) → applications
 * in the cycle that starts in 2026. Null when the label has no year.
 */
export function cycleStartFromEntering(label: string | null | undefined): number | null {
  const m = label?.match(/\d{4}/);
  return m ? Number(m[0]) - 1 : null;
}

/** The cycle file's entries for `key`; a cycle the file doesn't have yet is an empty one (no entries), never an error. */
export function loadCycle(key: string, source: CycleFile = file as CycleFile): Cycle {
  const startYear = cycleStartOf(key) ?? Number(key.slice(0, 4));
  const found = source.cycles.find((c) => c.cycle === key);
  return { cycle: key, startYear, entries: found ? found.entries : [] };
}

/** Every cycle the file has, oldest first. */
export function cycleKeys(source: CycleFile = file as CycleFile): string[] {
  return source.cycles.map((c) => c.cycle).sort();
}

/* ------------------------------------------------------------------ */
/* Grade                                                               */
/* ------------------------------------------------------------------ */

/** Where a student is, by the calendar (timeline.md "The plan by grade"). `unknown` without a grad year. */
export type Grade =
  | "earlier"
  | "junior_fall"
  | "junior_spring"
  | "summer_before_senior"
  | "senior_fall"
  | "senior_winter"
  | "senior_spring"
  | "summer_after"
  | "graduated"
  | "unknown";

export const GRADES: readonly Grade[] = [
  "earlier",
  "junior_fall",
  "junior_spring",
  "summer_before_senior",
  "senior_fall",
  "senior_winter",
  "senior_spring",
  "summer_after",
  "graduated",
  "unknown",
];

export const GRADE_LABELS: Record<Grade, string> = {
  earlier: "Sophomore or earlier",
  junior_fall: "Junior, fall and winter",
  junior_spring: "Junior, spring",
  summer_before_senior: "Summer before senior year",
  senior_fall: "Senior, fall",
  senior_winter: "Senior, winter",
  senior_spring: "Senior, spring",
  summer_after: "Summer after senior year",
  graduated: "In college",
  unknown: "Class year not set",
};

/**
 * The grade on `today` (ISO) for the class of `gradYear`. With G the grad year and S = G - 1 (the cycle's start):
 * junior year runs August of S - 1 to May of S (fall and winter through February, spring March to May), the summer
 * before senior year June to August of S, senior fall September to December of S, senior winter January and February
 * of G, senior spring March to May of G, the summer after June to August of G; from September of G, college.
 */
export function gradeOf(gradYear: number | null, today: string): Grade {
  if (gradYear === null || !Number.isFinite(gradYear)) return "unknown";
  const [y, m] = today.split("-").map(Number);
  const months = y * 12 + (m - 1);
  const at = (year: number, month: number) => year * 12 + (month - 1);
  const s = gradYear - 1;
  if (months < at(s - 1, 8)) return "earlier";
  if (months < at(s, 3)) return "junior_fall";
  if (months < at(s, 6)) return "junior_spring";
  if (months < at(s, 9)) return "summer_before_senior";
  if (months < at(gradYear, 1)) return "senior_fall";
  if (months < at(gradYear, 3)) return "senior_winter";
  if (months < at(gradYear, 6)) return "senior_spring";
  if (months < at(gradYear, 9)) return "summer_after";
  return "graduated";
}

/** Junior spring through the summer after: when the plan is "in season" (the hub's caption, reminders). */
export function inSeason(grade: Grade): boolean {
  return grade !== "earlier" && grade !== "graduated";
}

/* ------------------------------------------------------------------ */
/* applies                                                             */
/* ------------------------------------------------------------------ */

/** What an `applies` rule reads: the student's list, its colleges, and their numbers. */
export interface AppliesFacts {
  items: Pick<PlanItem, "unit_id" | "round" | "enrolling" | "application_platform">[];
  schools: Record<string, Pick<PlanSchool, "aid" | "logistics">>;
  profile: StudentProfileData | null;
}

export function isApplies(v: unknown): v is Applies {
  return typeof v === "string" && (APPLIES as readonly string[]).includes(v);
}

/**
 * Whether a cycle entry is a task for this student. Missing facts lean toward showing the step (a family can dismiss
 * it): `has_common_app` holds when any college's platform is Common App or not yet set; `plans_tests` unless the
 * student plans to apply test-optional; `uses_may1` when a college's reply rule is May 1 or it hasn't published one.
 */
export function applies(entry: Pick<CycleEntry, "applies">, facts: AppliesFacts): boolean {
  const schools = facts.items.map((i) => facts.schools[i.unit_id]).filter(Boolean);
  switch (entry.applies) {
    case "all":
      return true;
    case "has_css_college":
      return schools.some((s) => s.aid?.forms?.css_profile === true);
    case "noncustodial":
      return schools.some((s) => s.aid?.forms?.noncustodial_profile === true);
    case "has_common_app":
      return facts.items.some((i) => i.application_platform === "common_app" || i.application_platform === null);
    case "plans_tests":
      return facts.profile?.tests.plansTestOptional !== true;
    case "uses_may1":
      if (facts.items.length === 0) return false;
      if (schools.length < facts.items.length) return true;
      return schools.some((s) => !s.logistics?.reply || s.logistics.reply.kind === "may1_or_weeks");
    case "has_ed":
      return facts.items.some((i) => i.round === "ed" || i.round === "ed2");
    case "committed":
      return facts.items.some((i) => i.enrolling);
    case "international":
      return facts.profile?.basics.stateOfResidence === "OUTSIDE_US";
    // Course plan: AP exam dates are for students with an AP course now (ordering and the May exams) or one behind them (scores).
    case "ap_in_progress":
      return facts.profile?.academics?.courses?.some((c) => c.kind === "ap" && c.status === "in_progress") === true;
    case "has_ap_course":
      return facts.profile?.academics?.courses?.some((c) => c.kind === "ap" && c.status !== "planned") === true;
  }
}

/* ------------------------------------------------------------------ */
/* The file's schema check (scripts/check-cycle.mts)                   */
/* ------------------------------------------------------------------ */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Every problem with a cycle file, as lines ("2027-28 fafsa_opens: applies 'everyone' is not one of …"); empty when
 * it's valid. Checks: cycles named "YYYY-YY" with consecutive years, once each; entries with a unique snake_case key,
 * a label, exactly one of `date` or `window` (real ISO dates, the window in order), `register_by` on or before the
 * date, `applies` from APPLIES, an assignee, an https source, and dates inside the cycle's span (August two years
 * before it starts, for sophomore-year steps such as the AP ordering deadline, through December of the year it ends).
 */
export function validateCycleFile(raw: unknown): string[] {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as CycleFile).cycles)) return ["the file must be an object with a `cycles` array"];
  const seen = new Set<string>();
  for (const [ci, c] of (raw as CycleFile).cycles.entries()) {
    const name = typeof c?.cycle === "string" ? c.cycle : `cycles[${ci}]`;
    const start = typeof c?.cycle === "string" ? cycleStartOf(c.cycle) : null;
    if (start === null) {
      problems.push(`${name}: the cycle must be "YYYY-YY" with consecutive years`);
      continue;
    }
    if (seen.has(c.cycle)) problems.push(`${name}: listed twice`);
    seen.add(c.cycle);
    if (!Array.isArray(c.entries)) {
      problems.push(`${name}: entries must be an array`);
      continue;
    }
    const from = `${start - 2}-08-01`;
    const to = `${start + 1}-12-31`;
    const keys = new Set<string>();
    for (const [ei, e] of c.entries.entries()) {
      const where = `${name} ${typeof e?.key === "string" ? e.key : `entries[${ei}]`}`;
      if (!e || typeof e !== "object") {
        problems.push(`${where}: not an object`);
        continue;
      }
      if (typeof e.key !== "string" || !KEY_RE.test(e.key)) problems.push(`${where}: key must be snake_case`);
      else if (keys.has(e.key)) problems.push(`${where}: key listed twice`);
      else keys.add(e.key);
      if (typeof e.label !== "string" || !e.label.trim()) problems.push(`${where}: label is required`);
      if (!isApplies(e.applies)) problems.push(`${where}: applies '${String(e.applies)}' is not one of ${APPLIES.join(", ")}`);
      if (!ASSIGNEES.includes(e.assignee)) problems.push(`${where}: assignee '${String(e.assignee)}' is not one of ${ASSIGNEES.join(", ")}`);
      if (typeof e.source !== "string" || !/^https:\/\/\S+$/.test(e.source)) problems.push(`${where}: source must be an https URL`);
      if (e.detail !== undefined && (typeof e.detail !== "string" || !e.detail.trim())) problems.push(`${where}: detail, when given, must be text`);
      const hasDate = e.date !== undefined;
      const hasWindow = e.window !== undefined;
      if (hasDate === hasWindow) problems.push(`${where}: exactly one of date or window`);
      const dates: string[] = [];
      if (hasDate) {
        if (!isIsoDate(e.date)) problems.push(`${where}: date must be a real yyyy-mm-dd`);
        else dates.push(e.date);
      }
      if (hasWindow) {
        if (!Array.isArray(e.window) || e.window.length !== 2 || !isIsoDate(e.window[0]) || !isIsoDate(e.window[1])) {
          problems.push(`${where}: window must be [start, end] as yyyy-mm-dd`);
        } else if (e.window[0] > e.window[1]) problems.push(`${where}: window ends before it starts`);
        else dates.push(...e.window);
      }
      if (e.register_by !== undefined) {
        if (!isIsoDate(e.register_by)) problems.push(`${where}: register_by must be a real yyyy-mm-dd`);
        else if (!hasDate || (isIsoDate(e.date) && e.register_by > e.date)) problems.push(`${where}: register_by must come with a date, on or before it`);
        else dates.push(e.register_by);
      }
      for (const d of dates) if (d < from || d > to) problems.push(`${where}: ${d} is outside the cycle (${from} to ${to})`);
      const allowed = new Set(["key", "label", "date", "window", "register_by", "applies", "assignee", "source", "detail"]);
      for (const k of Object.keys(e)) if (!allowed.has(k)) problems.push(`${where}: unknown field '${k}'`);
    }
  }
  return problems;
}
