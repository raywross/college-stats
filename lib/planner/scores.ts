/**
 * The Scores tab's pure logic (specs/planner/redesign/scores.md "Score timing", "Test dates"): which upcoming test
 * dates to show for the student's own test, and whether a date's scores would arrive in time for the rounds a
 * retake could still move. No I/O; tested directly (tests/planner-scores.test.mts). `lib/planner/standing.ts`
 * (`scoreToMoveUp`, `retakeSuggestion`, `RETAKE_REACH`) already covers "when to suggest another test"; this module
 * covers only the dates.
 */
import type { ListRound } from "../list-rules.ts";
import { ROUND_SHORT, roundDates } from "./rounds.ts";
import type { Cycle, CycleEntry, Grade } from "./cycle.ts";
import type { PlanRowView } from "./plan-view.ts";
import type { TestKind } from "./standing.ts";

/** Days from a test date to scores a college can use (scores.md "Score timing"); both tests, in practice. */
export const SCORE_LAG = 14;

/** Grades where the application season has effectively started: a senior sees only dates that can still help. */
const SENIOR_GRADES: ReadonlySet<Grade> = new Set(["senior_fall", "senior_winter", "senior_spring"]);

/** Most dates a senior sees at once (scores.md "Test dates"). */
const SENIOR_MAX = 3;
/** Dates a junior (or earlier) sees: the next few, whether or not they'd help a current deadline. */
const JUNIOR_MAX = 4;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 7" from a yyyy-mm-dd. */
export function dayLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/** Whole days from one yyyy-mm-dd to another (can be negative). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The upcoming dates for the student's own test (scores.md "Test dates"): from `data/application-cycle.json`'s
 * entries for the student's cycle, keyed `sat_YYYY_MM` or `act_YYYY_MM`. A senior (the application season has
 * started) sees at most three dates whose scores could still reach a deadline still open on the list; everyone else
 * sees the next four, whether or not a deadline needs them yet.
 */
export function datesFor(test: TestKind, cycle: Cycle, grade: Grade, today: string, rows: readonly Pick<PlanRowView, "deadline">[]): CycleEntry[] {
  const upcoming = cycle.entries
    .filter((e): e is CycleEntry & { date: string } => e.key.startsWith(`${test}_`) && typeof e.date === "string" && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!SENIOR_GRADES.has(grade)) return upcoming.slice(0, JUNIOR_MAX);
  const last = rows.reduce<string | null>((m, r) => (r.deadline && (!m || r.deadline.iso > m) ? r.deadline.iso : m), null);
  if (!last) return [];
  return upcoming.filter((e) => addDays(e.date, SCORE_LAG) <= last).slice(0, SENIOR_MAX);
}

/** "Register by Oct 23", "Registration closed; late registration may be open", or "Registration not open yet". */
export function registerByText(registerBy: string | null, today: string): string {
  if (!registerBy) return "Registration not open yet";
  return registerBy < today ? "Registration closed; late registration may be open" : `Register by ${dayLabel(registerBy)}`;
}

/** The row shape `inTimeText` needs: a college's name, the round chosen, its deadline, and its other rounds' dates. */
export interface InTimeRow {
  name: string;
  round: ListRound;
  deadline: string | null;
  alternates: { round: ListRound; iso: string }[];
}

/** Builds an `InTimeRow` from a plan row, reading its college's other rounds through `roundDates`. */
export function inTimeRow(row: Pick<PlanRowView, "school" | "round" | "pickable" | "deadline">): InTimeRow {
  const alternates = row.pickable
    .filter((r) => r !== row.round)
    .map((r) => {
      const closing = roundDates(row.school, r).closing;
      return closing ? { round: r, iso: closing.iso } : null;
    })
    .filter((x): x is { round: ListRound; iso: string } => x !== null);
  return { name: row.school?.name ?? "A college", round: row.round, deadline: row.deadline?.iso ?? null, alternates };
}

/**
 * Whether a test date's scores would arrive in time, for the colleges a retake could move (scores.md "Score
 * timing"): the three sentences, in order of preference. Empty string when there's nothing to say (no rows).
 */
export function inTimeText(dateIso: string, rows: readonly InTimeRow[]): string {
  if (rows.length === 0) return "";
  const ready = addDays(dateIso, SCORE_LAG);
  const inTime = rows.filter((r) => r.deadline && r.deadline >= ready);
  const stillLate = rows.filter((r) => !inTime.includes(r));
  const later = stillLate
    .map((r) => {
      const alt = r.alternates.find((a) => a.iso >= ready);
      return alt ? `${r.name} ${ROUND_SHORT[alt.round]} (${dayLabel(alt.iso)})` : null;
    })
    .filter((x): x is string => x !== null);
  if (inTime.length > 0) {
    const names = inTime.map((r) => `${r.name} ${ROUND_SHORT[r.round]}`).join(", ");
    return later.length > 0 ? `Scores in time for ${names}. Too late for the rest; in time for ${later.join(", ")}.` : `Scores in time for ${names}.`;
  }
  if (later.length > 0) return `Too late for the round you picked; in time for ${later.join(", ")}.`;
  return "Scores arrive after these deadlines.";
}
