/**
 * The family calendar (specs/planner/redesign/calendar.md): a school year as one timeline per child, with lanes for
 * tests, essays & recs, money, and one lane per college with a deadline in range, plus the "Coming up" list below it.
 * Pure (no server or browser APIs): the range and its stepping, the lanes and marks built from a child's rows, tasks,
 * and cycle file, and the Coming-up events. The components (FamilyCalendar, CalendarLane, ComingUp) only draw what
 * this module computes.
 *
 * The layout reference is the design preview's components/plan-preview/CalendarView.tsx; this module generalizes its
 * derivation over real rows (lib/planner/plan-view.ts), real tasks, and the real cycle file, with a round or a plain
 * link citation on every mark so a tooltip or the Coming-up list can always say where a date comes from.
 */
import { ROUND_LABELS, type ListRound } from "../list-rules.ts";
import { applies, type AppliesFacts, type CycleEntry } from "./cycle.ts";
import { ROUND_SHORT } from "./rounds.ts";
import type { PlanView } from "./plan-view.ts";
import { TEST_LABEL } from "./standing.ts";
import type { PlanContext, PlanTask } from "./types.ts";

/** Weeks of work shown before each deadline (calendar.md "Bars"); there's no stored "Working on it" date yet, so
 *  every bar runs the same fixed six weeks back from the deadline (open question 2's placeholder, not the date the
 *  student marks a row "Working on it"). */
export const WORK_WEEKS = 6;
const WORK_DAYS = WORK_WEEKS * 7;

/** Task kinds that are money markers on the calendar (rounds.md "Money", calendar.md "Lanes" 3). */
const MONEY_TASK_KINDS: ReadonlySet<PlanTask["kind"]> = new Set(["aid_forms", "cost_check", "housing_deposit", "deposit"]);
/** Cycle-file keys that are money markers: FAFSA and CSS Profile opening, the national reply date. */
const MONEY_CYCLE_KEYS: ReadonlySet<string> = new Set(["fafsa_opens", "css_profile_opens", "reply_date"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (iso: string): string => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
export const monthLabel = (m: number): string => MONTHS[m];

export function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/* Range and stepping                                                   */
/* ------------------------------------------------------------------ */

export interface YearRange {
  /** The calendar year the school year starts in (applications open August 1 of this year). */
  startYear: number;
  from: string;
  to: string;
}

function rangeOf(startYear: number): YearRange {
  return { startYear, from: `${startYear}-08-01`, to: `${startYear + 1}-07-31` };
}

/** The school year containing `today`: August 1 through July 31. */
export function schoolYearOf(today: string): YearRange {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return rangeOf(m >= 8 ? y : y - 1);
}

/** One step forward (1) or back (-1): the previous or next school year (calendar.md "Range": the arrows). */
export function stepRange(range: YearRange, dir: 1 | -1): YearRange {
  return rangeOf(range.startYear + dir);
}

export function rangeContains(range: YearRange, iso: string): boolean {
  return iso >= range.from && iso <= range.to;
}

/** Where `iso` sits across `range`, 0–100 (clamped to the ends). */
export function xPercent(range: YearRange, iso: string): number {
  const span = daysBetween(range.from, range.to);
  return Math.max(0, Math.min(100, (daysBetween(range.from, iso) / span) * 100));
}

/** The twelve months of `range`, each with the ISO date of its first day (for gridlines and labels). */
export function monthsOf(range: YearRange): { label: string; iso: string }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = (7 + i) % 12;
    const yr = range.startYear + (7 + i >= 12 ? 1 : 0);
    return { label: monthLabel(m), iso: `${yr}-${String(m + 1).padStart(2, "0")}-01` };
  });
}

/* ------------------------------------------------------------------ */
/* Citations                                                            */
/* ------------------------------------------------------------------ */

/**
 * Where a mark's date is sourced: a college's cited field (resolve with `ctx.schools[unitId].cites[field]`, the same
 * pattern TimelineTaskRow and RoundChip use), or a plain link (the cycle file's own `source`, or a generated task's
 * `source_field` when it isn't on a college, which doesn't happen today but is handled the same way either case).
 */
export type CalendarCite = { kind: "field"; unitId: string; field: string } | { kind: "link"; url: string } | null;

function entryCite(e: Pick<CycleEntry, "source">): CalendarCite {
  return e.source ? { kind: "link", url: e.source } : null;
}

function taskCite(ctx: Pick<PlanContext, "items">, t: Pick<PlanTask, "item_id" | "source_field">): CalendarCite {
  if (!t.source_field || !t.item_id) return null;
  const item = ctx.items.find((i) => i.id === t.item_id);
  return item ? { kind: "field", unitId: item.unit_id, field: t.source_field } : null;
}

/* ------------------------------------------------------------------ */
/* Marks, lanes, and events                                            */
/* ------------------------------------------------------------------ */

export type CalendarMark =
  | { kind: "bar"; start: string; end: string; round: ListRound; label: string; tip: string; cite: CalendarCite }
  | { kind: "window"; start: string; end: string; label: string; tip: string; row: number; cite: CalendarCite }
  | { kind: "deadline"; date: string; round: ListRound; tip: string; cite: CalendarCite }
  | { kind: "decision"; from: string; date: string; round: ListRound; tip: string; cite: CalendarCite }
  | { kind: "test"; date: string; tip: string; past: boolean; cite: CalendarCite }
  | { kind: "money"; date: string; tip: string; cite: CalendarCite };

export interface CalendarLane {
  key: string;
  label: string;
  sub?: string;
  marks: CalendarMark[];
  note?: string;
  /** Stacked rows (overlapping windows each get their own; the lane's height follows). */
  rows?: number;
}

export interface CalendarEvent {
  date: string;
  studentId: string;
  shape: "bar" | "test" | "money" | "decision";
  round?: ListRound;
  text: string;
  cite: CalendarCite;
  daysAway: number;
}

/* ------------------------------------------------------------------ */
/* Raw facts, unbounded by any one range                                */
/* ------------------------------------------------------------------ */

interface RawTest {
  date: string;
  registerBy: string | null;
  label: string;
  cite: CalendarCite;
}

interface RawWindow {
  start: string;
  end: string;
  label: string;
  cite: CalendarCite;
}

interface RawMoney {
  date: string;
  tip: string;
  cite: CalendarCite;
}

interface RawCollege {
  itemId: string;
  unitId: string;
  schoolName: string;
  round: ListRound;
  dream: boolean;
  deadline: { iso: string; field: string } | null;
  decision: { iso: string; field: string } | null;
}

function appliesFacts(ctx: PlanContext): AppliesFacts {
  return { items: ctx.items, schools: ctx.schools, profile: ctx.profile };
}

/**
 * The student's own test dates (calendar.md "Lanes" 1): only their test, and, while applying, only dates whose
 * scores could still reach a deadline on the list (there's nothing to reach when none has a deadline yet).
 */
function rawTests(ctx: PlanContext, view: PlanView, applying: boolean): RawTest[] {
  const kind = view.student.test?.kind;
  if (!kind) return [];
  const facts = appliesFacts(ctx);
  const last = view.rows.reduce((m, r) => (r.deadline && r.deadline.iso > m ? r.deadline.iso : m), "");
  return ctx.cycle.entries
    .filter((e) => e.applies === "plans_tests" && !!e.date && e.label === TEST_LABEL[kind] && applies(e, facts))
    .filter((e) => !applying || (last !== "" && e.date! <= last))
    .map((e) => ({ date: e.date!, registerBy: e.register_by ?? null, label: e.label, cite: entryCite(e) }));
}

/** The cycle file's windows for this student (calendar.md "Lanes" 2): every window entry that applies, except the
 *  "committed" ones (after enrolling, a later stage of the plan). */
function rawWindows(ctx: PlanContext): RawWindow[] {
  const facts = appliesFacts(ctx);
  return ctx.cycle.entries
    .filter((e) => e.window && e.applies !== "committed" && applies(e, facts))
    .map((e) => ({ start: e.window![0], end: e.window![1], label: e.label, cite: entryCite(e) }));
}

/** Money markers (calendar.md "Lanes" 3): FAFSA/CSS Profile opening and the reply date from the cycle file, the
 *  college-specific aid, cost-check, and deposit tasks (rounds.md "Money"). */
function rawMoney(ctx: PlanContext): RawMoney[] {
  const facts = appliesFacts(ctx);
  const fromCycle = ctx.cycle.entries
    .filter((e) => e.date && MONEY_CYCLE_KEYS.has(e.key) && applies(e, facts))
    .map((e) => ({ date: e.date!, tip: e.label, cite: entryCite(e) }));
  const fromTasks = ctx.tasks
    .filter((t) => MONEY_TASK_KINDS.has(t.kind) && t.due_on !== null)
    .map((t) => ({ date: t.due_on!, tip: t.title, cite: taskCite(ctx, t) }));
  return [...fromCycle, ...fromTasks];
}

/** Every row with a college still in the dataset, with its round and dates (calendar.md "Lanes" 4–5). */
function rawColleges(view: PlanView): RawCollege[] {
  const out: RawCollege[] = [];
  for (const r of view.rows) {
    if (!r.school) continue;
    out.push({
      itemId: r.item.id,
      unitId: r.item.unit_id,
      schoolName: r.school.name,
      round: r.round,
      dream: r.dream,
      deadline: r.deadline ? { iso: r.deadline.iso, field: r.deadline.field } : null,
      decision: r.decision ? { iso: r.decision.iso, field: r.decision.field } : null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lanes for one displayed range                                       */
/* ------------------------------------------------------------------ */

/**
 * One child's lanes across `range` (calendar.md "Lanes"): each only when it has something in range. `applying` is
 * whether `range` is this student's own application year (their one cycle, lib/planner/cycle.ts).
 */
export function calendarFor(ctx: PlanContext, view: PlanView, range: YearRange): CalendarLane[] {
  const applying = range.startYear === ctx.cycle.startYear;
  const lanes: CalendarLane[] = [];
  const kind = view.student.test?.kind;

  // 1. Tests: only while still testing, or while a retake could still help.
  if (kind && (!applying || view.retake !== null)) {
    const tests = rawTests(ctx, view, applying).filter((t) => rangeContains(range, t.date));
    if (tests.length > 0) {
      lanes.push({
        key: "tests",
        label: `${TEST_LABEL[kind]} dates`,
        sub: applying ? "another test could help" : "pick one or two",
        marks: tests.map((t) => ({
          kind: "test" as const,
          date: t.date,
          past: t.date < ctx.today,
          tip: `${t.label} ${dayLabel(t.date)}${t.registerBy ? ` · register by ${dayLabel(t.registerBy)}` : ""}`,
          cite: t.cite,
        })),
      });
    }
  }

  // 2. Essays & recs: windows packed so no two labels collide (greedy row assignment).
  const windows = rawWindows(ctx).filter((w) => w.end >= range.from && w.start <= range.to);
  if (windows.length > 0) {
    const ends: string[] = [];
    const marks: CalendarMark[] = [...windows]
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((w) => {
        const start = w.start < range.from ? range.from : w.start;
        const end = w.end > range.to ? range.to : w.end;
        let row = ends.findIndex((e) => e < start);
        if (row === -1) row = ends.length;
        ends[row] = end;
        return { kind: "window" as const, start, end, row, label: w.label, tip: `${w.label}: ${dayLabel(w.start)} – ${dayLabel(w.end)}`, cite: w.cite };
      });
    lanes.push({ key: "work", label: "Essays & recs", marks, rows: ends.length });
  }

  // 3. Money: only in the child's application year.
  if (applying) {
    const money = rawMoney(ctx).filter((m) => rangeContains(range, m.date));
    if (money.length > 0) {
      lanes.push({
        key: "money",
        label: "Money",
        sub: ctx.viewer.isGuardian ? "your part" : "with a parent",
        marks: money.map((m) => ({ kind: "money" as const, date: m.date, tip: `${m.tip} · ${dayLabel(m.date)}`, cite: m.cite })),
      });
    }
  }

  // 4. One lane per college with a deadline in range, ordered by deadline.
  const allColleges = rawColleges(view);
  const dated = allColleges.filter((c) => c.deadline && rangeContains(range, c.deadline.iso)).sort((a, b) => a.deadline!.iso.localeCompare(b.deadline!.iso));
  for (const c of dated) {
    const end = c.deadline!.iso;
    const startRaw = addDaysIso(end, -WORK_DAYS);
    const start = startRaw < range.from ? range.from : startRaw;
    const marks: CalendarMark[] = [
      { kind: "bar", start, end, round: c.round, label: ROUND_SHORT[c.round], tip: `${c.schoolName} · ${ROUND_LABELS[c.round]} · due ${dayLabel(end)}`, cite: { kind: "field", unitId: c.unitId, field: c.deadline!.field } },
      { kind: "deadline", date: end, round: c.round, tip: `${c.schoolName} ${ROUND_SHORT[c.round]} due ${dayLabel(end)}`, cite: { kind: "field", unitId: c.unitId, field: c.deadline!.field } },
    ];
    if (c.decision && rangeContains(range, c.decision.iso) && c.decision.iso > end) {
      marks.push({ kind: "decision", from: end, date: c.decision.iso, round: c.round, tip: `${c.schoolName} decision around ${dayLabel(c.decision.iso)}`, cite: { kind: "field", unitId: c.unitId, field: c.decision.field } });
    }
    lanes.push({ key: `college:${c.itemId}`, label: c.schoolName, sub: c.dream ? "Dream" : undefined, marks });
  }

  // 5. Applications (deadlines all next school year) or No date on record (some still missing one), never both.
  if (range.startYear < ctx.cycle.startYear && allColleges.length > 0) {
    lanes.push({
      key: "later",
      label: "Applications",
      marks: [],
      note: `${allColleges.length} college${allColleges.length === 1 ? "" : "s"} on the list; their deadlines start next school year (applications open Aug 1, ${ctx.cycle.startYear})`,
    });
  } else if (range.startYear === ctx.cycle.startYear) {
    const undated = allColleges.filter((c) => !c.deadline);
    if (undated.length > 0) {
      lanes.push({ key: "undated", label: "No date on record", marks: [], note: `${undated.map((c) => c.schoolName).join(", ")}: add the date from the college's site` });
    }
  }

  return lanes;
}

/* ------------------------------------------------------------------ */
/* Coming up                                                           */
/* ------------------------------------------------------------------ */

/**
 * One child's upcoming events (calendar.md "Coming up"), unbounded by any one displayed range: test dates, money
 * dates, and college due/decision dates, from `today` on. Uses the same visibility gates as the lane (tests only
 * while testing or a live retake; money only in the application year), against the school year `today` falls in.
 */
export function eventsFor(ctx: PlanContext, view: PlanView, today: string, studentId: string): CalendarEvent[] {
  const range = schoolYearOf(today);
  const applying = range.startYear === ctx.cycle.startYear;
  const kind = view.student.test?.kind;
  const out: CalendarEvent[] = [];

  if (kind && (!applying || view.retake !== null)) {
    for (const t of rawTests(ctx, view, applying)) {
      if (t.date < today) continue;
      out.push({
        date: t.date,
        studentId,
        shape: "test",
        text: `${t.label} test date${t.registerBy && t.registerBy >= today ? ` (register by ${dayLabel(t.registerBy)})` : ""}`,
        cite: t.cite,
        daysAway: daysBetween(today, t.date),
      });
    }
  }

  if (applying) {
    for (const m of rawMoney(ctx)) {
      if (m.date < today) continue;
      out.push({ date: m.date, studentId, shape: "money", text: m.tip, cite: m.cite, daysAway: daysBetween(today, m.date) });
    }
  }

  for (const c of rawColleges(view)) {
    if (c.deadline && c.deadline.iso >= today) {
      out.push({
        date: c.deadline.iso,
        studentId,
        shape: "bar",
        round: c.round,
        text: `${c.schoolName} ${ROUND_SHORT[c.round]} due`,
        cite: { kind: "field", unitId: c.unitId, field: c.deadline.field },
        daysAway: daysBetween(today, c.deadline.iso),
      });
    }
    if (c.decision && c.decision.iso >= today) {
      out.push({
        date: c.decision.iso,
        studentId,
        shape: "decision",
        round: c.round,
        text: `${c.schoolName} decision expected`,
        cite: { kind: "field", unitId: c.unitId, field: c.decision.field },
        daysAway: daysBetween(today, c.decision.iso),
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.text.localeCompare(b.text));
}

/** The next `max` events across every child (calendar.md "Coming up"): the accessible table view of the chart, the
 *  first thing a phone shows. */
export function comingUp(children: { studentId: string; ctx: PlanContext; view: PlanView }[], today: string, max = 12): CalendarEvent[] {
  return children
    .flatMap((c) => eventsFor(c.ctx, c.view, today, c.studentId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.text.localeCompare(b.text))
    .slice(0, max);
}
