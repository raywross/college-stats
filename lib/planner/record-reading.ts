/**
 * "How Quad reads your record" (specs/planner/record/reading.md): the record overview's one section reading the
 * estimate back to the student — what it's working from right now, the one input that would help most, and today's
 * list in level counts. Inputs and outputs only, like every estimate surface (reading.md "Rules"): never a weight,
 * threshold, percentage, multiple, or closeness. Pure (no server or browser APIs); `components/record/RecordReading.tsx`
 * renders it and owns every fixed word (the empty-state copy, the "Working from:"/"Not yet:"/"Your list today:"
 * labels, the links); this module only supplies the dynamic lines a result set can vary.
 */
import { STANDING_LEVELS } from "../chances/levels.ts";
import { INPUT_WORDS, noteText } from "../chances/notes.ts";
import type { EstimateResult, EstimateStudent, InputKind, StandingLevel } from "../chances/types.ts";
import { hasNumbers, mostUsefulMissing, yourNumbersFrom, yourNumbersList } from "../chances/what-went-in.ts";
import { planGpaLabel, type StudentProfileData } from "../student-profile.ts";
import { type RecordSection } from "./record.ts";
import type { PlanItem } from "./types.ts";

/** Reverse of INPUT_WORDS ("GPA" -> "gpa"): every value in INPUT_WORDS is unique, so this is lossless. */
const KIND_BY_WORD: ReadonlyMap<string, InputKind> = new Map(Object.entries(INPUT_WORDS).map(([k, w]) => [w, k as InputKind]));

/**
 * Which record section supplies each input kind `mostUsefulMissing` can name (its own INPUT_ORDER: gpa, courses,
 * class_rank, subject_grades, major, state, high_school, activities, test). Class rank and high school are both
 * entered on the Grades step (components/planner/intake/GradesStep.tsx); math and science grades come from the
 * Courses step's course entries (model.ts subjectFromGrades); "activities" (the combined sports/clubs/work/other
 * reading) links Sports, the first of the four activity steps — a judgment call documented in build-plan.md, since
 * no single record section owns the combined kind.
 */
const MISSING_INPUT_SECTION: Partial<Record<InputKind, RecordSection>> = {
  gpa: "grades",
  class_rank: "grades",
  high_school: "grades",
  test: "test",
  courses: "courses",
  subject_grades: "courses",
  major: "major",
  state: "basics",
  activities: "sports",
};

/** The level word, singular and plural ("Likely"/"Likelies"), ascending selectivity ("Your list today" order). */
const LEVEL_WORD: Record<StandingLevel, { one: string; many: string }> = {
  safe: { one: "Safe", many: "Safes" },
  likely: { one: "Likely", many: "Likelies" },
  target: { one: "Target", many: "Targets" },
  reach: { one: "Reach", many: "Reaches" },
  high_reach: { one: "High reach", many: "High reaches" },
};
/** "Your list today" reads ascending selectivity (Safe first), the mirror of STANDING_LEVELS. */
const LEVEL_ORDER: readonly StandingLevel[] = [...STANDING_LEVELS].reverse();

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** The input kinds every listed college's estimate used, once each ("the union the estimates' notes mark as used").
 * Exported too: `RecordReading.tsx`'s info sheet reuses it to build "What went into this estimate"'s own numbers
 * line (`yourNumbersList`) the same way this module's `workingFrom` does. */
export function usedInputKinds(results: readonly Pick<EstimateResult, "used">[]): InputKind[] {
  const used = new Set<InputKind>();
  for (const r of results) for (const k of r.used) used.add(k);
  return [...used];
}

/** How many distinct input kinds the student's listed estimates used (record_reading_shown's `inputs`). */
export function usedInputsCount(estimates: Record<string, Pick<EstimateResult, "used">>): number {
  return usedInputKinds(Object.values(estimates)).length;
}

/** Each level's count among the list's open (not withdrawn) rows, by the estimate's group; rows with no group
 * (unsorted) don't count toward any level. */
function levelCounts(items: readonly Pick<PlanItem, "unit_id" | "withdrawn_on">[], estimates: Record<string, Pick<EstimateResult, "group">>): Record<StandingLevel, number> {
  const out = Object.fromEntries(STANDING_LEVELS.map((l) => [l, 0])) as Record<StandingLevel, number>;
  for (const item of items) {
    if (item.withdrawn_on) continue;
    const group = estimates[item.unit_id]?.group;
    if (group) out[group]++;
  }
  return out;
}

/** "1 Likely · 3 Targets · 4 Reaches · 1 High reach": every nonzero level, ascending selectivity, never a total or a
 * level with nothing in it. Null when nothing's sorted yet (so the caller falls back to its own empty copy). */
function levelCountsLine(counts: Record<StandingLevel, number>): string | null {
  const parts = LEVEL_ORDER.filter((l) => counts[l] > 0).map((l) => {
    const n = counts[l];
    const word = LEVEL_WORD[l];
    return `${n} ${n === 1 ? word.one : word.many}`;
  });
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface ReadingLines {
  /** "GPA 3.85, SAT 1300, 6 advanced courses, and activities." — the component's own "Working from:" label goes in
   * front. Null when nothing the estimate used is nameable (no numbers, or no listed college used anything). */
  workingFrom: string | null;
  /** The one input that would help at the most colleges, and the record step that supplies it; null when nothing
   * would move the list, or there's nothing to compute from. */
  notYet: { text: string; section: RecordSection } | null;
  /** "1 Likely · 3 Targets · 4 Reaches · 1 High reach"; null when nothing on the list has a level yet. */
  listLine: string | null;
  /** A full-section empty state: no grades or test at all ("no_record"), or no list to read ("no_list"); the
   * component owns both states' fixed copy. Null for the normal, populated section. */
  empty: "no_record" | "no_list" | null;
}

/**
 * The record overview's "How Quad reads your record right now" section (reading.md): built from the plan's own
 * estimates (one per listed college, already computed the way `/plan` computes them) and the student's entries.
 * `items`/`estimates` are the plan's `ctx.items`/`ctx.estimates` (or empty, for a student with no list yet); `student`
 * is the estimate's own input shape (`estimateInputFromProfile(profile, "", null).student`, the same the plan and the
 * profile card use); `profile` is read only for `planGpaLabel`'s nicer GPA string.
 */
export function readingLines(input: {
  estimates: Record<string, EstimateResult>;
  items: readonly Pick<PlanItem, "unit_id" | "withdrawn_on">[];
  profile: StudentProfileData | null;
  student: EstimateStudent;
}): ReadingLines {
  const { estimates, items, profile, student } = input;
  if (!hasNumbers(student)) return { workingFrom: null, notYet: null, listLine: null, empty: "no_record" };

  const open = items.filter((i) => !i.withdrawn_on);
  if (open.length === 0) return { workingFrom: null, notYet: null, listLine: null, empty: "no_list" };

  const results = open.map((i) => estimates[i.unit_id]).filter((r): r is EstimateResult => !!r);

  const numbers = yourNumbersFrom(student, planGpaLabel(profile));
  const list = yourNumbersList(numbers, usedInputKinds(results));
  const workingFrom = list.length > 0 ? `${joinWithAnd(list)}.` : null;

  const missing = mostUsefulMissing(results);
  let notYet: ReadingLines["notYet"] = null;
  if (missing) {
    const word = String(missing.values.input ?? "");
    const kind = KIND_BY_WORD.get(word) ?? null;
    const section = kind ? MISSING_INPUT_SECTION[kind] ?? null : null;
    if (section) notYet = { text: noteText(missing), section };
  }

  const listLine = levelCountsLine(levelCounts(open, estimates));

  return { workingFrom, notYet, listLine, empty: null };
}
