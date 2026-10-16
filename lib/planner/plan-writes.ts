/**
 * The pure halves of the redesigned plan's writes (lib/planner/store-plan.ts, a "use server" module that may export
 * only async functions): argument validation, the patch each action writes, and how the suggested groups and rounds
 * are batched into updates. No I/O, so tests run it directly (tests/planner-redesign-writes.test.mts).
 */
import { isListRound, type ListCategory, type ListRound } from "../list-rules.ts";
import {
  GPA_SCALES,
  gpaMaxFor,
  isTestDateKey,
  PLANNED_DATES_MAX,
  sanitizeProfile,
  type GpaScale,
  type StudentProfileData,
  type TestFocus,
} from "../student-profile.ts";

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/* ------------------------------------------------------------------ */
/* Suggested groups and rounds                                         */
/* ------------------------------------------------------------------ */

/** One row the model wants changed (lib/planner/plan-view.ts autoWrites). */
export interface AutoWrite {
  id: string;
  category?: ListCategory;
  round?: ListRound;
}

export interface AutoWriteBatch {
  /** The source column the batch concerns. */
  sourceColumn: "category_source" | "round_source";
  /**
   * Filter the update on `sourceColumn` still being 'auto', so a fresh pick by the student is never overwritten. True
   * for rounds; false for groups, which are Quad's only (a stored `student` group is converted back to `auto`).
   */
  onlyAuto: boolean;
  patch: { category: ListCategory; category_source: "auto" } | { round: ListRound };
  ids: string[];
}

/**
 * autoWrites grouped into one update per distinct value (rows that move to the same group share one update). A group
 * write also sets `category_source` to `auto`: groups are Quad's only (specs/planner/redesign/intake.md "Groups").
 */
export function autoWriteBatches(writes: AutoWrite[]): AutoWriteBatch[] {
  const categories = new Map<ListCategory, string[]>();
  const rounds = new Map<ListRound, string[]>();
  for (const w of writes) {
    if (w.category !== undefined) categories.set(w.category, [...(categories.get(w.category) ?? []), w.id]);
    if (w.round !== undefined) rounds.set(w.round, [...(rounds.get(w.round) ?? []), w.id]);
  }
  return [
    ...[...categories].map(([category, ids]): AutoWriteBatch => ({ sourceColumn: "category_source", onlyAuto: false, patch: { category, category_source: "auto" }, ids })),
    ...[...rounds].map(([round, ids]): AutoWriteBatch => ({ sourceColumn: "round_source", onlyAuto: true, patch: { round }, ids })),
  ];
}

/* ------------------------------------------------------------------ */
/* Group and round                                                     */
/* ------------------------------------------------------------------ */

/** A sorted group. Groups are Quad's only (intake.md "Groups"); the signed-out plan's local chip still uses this. */
export type PickedGroup = "reach" | "target" | "likely";

/** setPlanRound's patch: a round the student picked, or null for "Use the starting round". Null when refused. */
export function roundPatch(round: unknown): { round: ListRound; round_source: "student" } | { round_source: "auto" } | null {
  if (round === null) return { round_source: "auto" };
  if (isListRound(round)) return { round, round_source: "student" };
  return null;
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/** What the numbers form sends (standing.md "The numbers"). */
export interface PlanNumbers {
  gpa: number | null;
  gpaScale: GpaScale;
  focus: TestFocus | null;
  /** The score on the focus test; null leaves the stored score as it is. Ignored for "none". */
  score: number | null;
  practice: boolean;
}

const SCORE_RANGE = { sat: [400, 1600], act: [1, 36] } as const;

const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Validates the numbers form; null when any value is out of range (the action refuses rather than guessing). */
export function parseNumbers(input: unknown): PlanNumbers | null {
  if (typeof input !== "object" || input === null) return null;
  const v = input as Record<string, unknown>;
  const gpaScale = (v.gpaScale ?? "4.0") as GpaScale;
  if (!GPA_SCALES.some((s) => s.value === gpaScale)) return null;
  let gpa: number | null = null;
  if (v.gpa !== null && v.gpa !== undefined && v.gpa !== "") {
    gpa = finite(v.gpa);
    if (gpa === null || gpa < 0 || gpa > gpaMaxFor(gpaScale)) return null;
  }
  const focus = v.focus ?? null;
  if (focus !== null && focus !== "sat" && focus !== "act" && focus !== "none") return null;
  let score: number | null = null;
  if (focus === "sat" || focus === "act") {
    if (v.score !== null && v.score !== undefined && v.score !== "") {
      const n = finite(v.score);
      const [lo, hi] = SCORE_RANGE[focus];
      if (n === null || n < lo || n > hi) return null;
      score = Math.round(n);
    }
  }
  return { gpa, gpaScale, focus, score, practice: v.practice === true };
}

/** The profile with the numbers form applied: GPA and scale, the focus test and its score, the practice flag. */
export function applyNumbers(profile: StudentProfileData, n: PlanNumbers): StudentProfileData {
  // The target score belongs to one test: a new focus clears it (intake.md "Test").
  const tests = { ...profile.tests, focus: n.focus, practice: n.practice, target: n.focus === profile.tests.focus ? profile.tests.target : null };
  if (n.focus === "sat" && n.score !== null) tests.satTotal = n.score;
  if (n.focus === "act" && n.score !== null) tests.actComposite = n.score;
  return sanitizeProfile({ ...profile, academics: { ...profile.academics, gpa: n.gpa, gpaScale: n.gpaScale }, tests });
}

/* ------------------------------------------------------------------ */
/* Picked test dates                                                   */
/* ------------------------------------------------------------------ */

/** "I'll take it" on a test date, or undoing it. Refuses an unknown key, or a seventh date. */
export function togglePlannedDate(profile: StudentProfileData, entryKey: unknown, on: boolean): { ok: true; profile: StudentProfileData } | { ok: false; message: string } {
  if (!isTestDateKey(entryKey)) return { ok: false, message: "That isn't a test date we know." };
  const now = profile.tests.plannedDates.filter((k) => k !== entryKey);
  if (on) {
    if (now.length >= PLANNED_DATES_MAX) return { ok: false, message: `You can pick up to ${PLANNED_DATES_MAX} test dates.` };
    now.push(entryKey);
  }
  return { ok: true, profile: { ...profile, tests: { ...profile.tests, plannedDates: now } } };
}

/**
 * Confirming (or undoing) a registration (guides/test-prep.md "Upcoming dates"; build-plan.md "Act tracking"):
 * `registeredDates` stays a subset of `plannedDates` (the sanitizer's rule), so turning registration on also plans
 * the date when it wasn't already ("I'll take it" is implied by actually registering). Turning it off only clears
 * the registered flag; the planned date itself is cleared by `togglePlannedDate(key, false)` instead, which already
 * drops it from `registeredDates` too (sanitizeProfile's subset rule). Shared with `writeConfirmedAct`
 * (interest-acts-server.ts), whose `test_register` act writes through this same pure logic.
 */
export function toggleRegisteredDate(profile: StudentProfileData, entryKey: unknown, on: boolean): { ok: true; profile: StudentProfileData } | { ok: false; message: string } {
  if (!isTestDateKey(entryKey)) return { ok: false, message: "That isn't a test date we know." };
  const tests = { ...profile.tests };
  if (on) {
    if (!tests.plannedDates.includes(entryKey)) tests.plannedDates = [...tests.plannedDates, entryKey];
    tests.registeredDates = tests.registeredDates.includes(entryKey) ? tests.registeredDates : [...tests.registeredDates, entryKey];
  } else {
    tests.registeredDates = tests.registeredDates.filter((k) => k !== entryKey);
  }
  return { ok: true, profile: { ...profile, tests } };
}
