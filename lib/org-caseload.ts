/**
 * The counselor portal's caseload, pure (specs/product/counselor-portal.md "The caseload", "A student", "Asking a
 * student for something", "Export"). Kept apart from lib/org-rules.ts so the join page's client code, which needs only
 * the code format, doesn't carry the planner's modules.
 *
 * The caseload (U3, "The caseload", "Export"): `caseloadRows()` computes every row from what the counselor's own
 * session read, with the planner's pure functions (profileProgress, countLine/shapeGaps, stageOf, summaryLine,
 * stuckSignals, nextTask), so the office reads the same facts in the same words a parent does; `caseloadCounts()` is
 * the line above the rows, and `caseloadCsv()` the export. Levels come from the list items' stored category, never an
 * estimate; nothing about money (the ED-estimate signal is left out: the counselor never sees a family's estimates).
 */
import { PROFILE_SECTIONS, SECTION_MOVE_TITLE, profileProgress, sectionDone, type ProfileSection } from "./planner/profile-progress.ts";
import { countLine, shapeFor, shapeGaps, type ShapeGapKind } from "./planner/list-shape.ts";
import { stuckSignals, summaryLine, type StuckSignal } from "./planner/summary.ts";
import { addDays, stageOf } from "./planner/stage.ts";
import { dayLabel, isOpen, nextTask, taskDate } from "./planner/tasks.ts";
import { gradeOf, seasonOf } from "./planner/seasons.ts";
import { NO_MONEY, ROUND_SHORT } from "./planner/rounds.ts";
import type { Grade } from "./planner/cycle.ts";
import type { PlanTask } from "./planner/types.ts";
import { CATEGORY_LABELS, OUTCOME_LABELS, ROUND_LABELS, STATUS_LABELS, type ListCategory, type ListOutcome, type ListRound, type ListStatus } from "./list-rules.ts";
import { effectiveGradYear, profileForViewer, sanitizeProfile, type StudentProfileData } from "./student-profile.ts";
import type { StandingLevel } from "./chances/types.ts";
import { ADVISOR_STATUS_LABEL, type AdvisorStatus } from "./entitlements.ts";
import type { OpenOrgAsk, OrgAsk, OrgAskKind, OrgRosterRow } from "./org-rules.ts";

/* ------------------------------------------------------------------ */
/* The record's sections and asks                                      */
/* ------------------------------------------------------------------ */

/** A record section's short name, as the record's rail shows it (lib/planner/record.ts RECORD_STEPS), plus the school. */
export const RECORD_SECTION_LABEL: Record<ProfileSection, string> = {
  high_school: "High school",
  grades: "Grades",
  test: "Test score",
  courses: "AP courses",
  sports: "Sports",
  clubs: "Clubs",
  work: "Work",
  connections: "Connections",
  other: "Awards and more",
  major: "Major",
  basics: "Basics",
  where: "Where you'd go",
  story: "Story",
  recommenders: "Recommenders",
};

export function isRecordSection(v: unknown): v is ProfileSection {
  return typeof v === "string" && (PROFILE_SECTIONS as readonly string[]).includes(v);
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * What the family reads at the top of Next steps ("Ms. Rivera asked you to add a test score or target"): who asked
 * (their name, else the organization's), then the section's own move title, "add your first colleges", or the
 * counselor's line in quotes. Never a number or a grade: the ask names the section, nothing else.
 */
export function askSentence(ask: Pick<OpenOrgAsk, "kind" | "section" | "note" | "asked_by_name" | "org_name">): string {
  const who = ask.asked_by_name?.trim() || ask.org_name;
  if (ask.kind === "record_section" && isRecordSection(ask.section)) return `${who} asked you to ${lowerFirst(SECTION_MOVE_TITLE[ask.section])}.`;
  if (ask.kind === "list") return `${who} asked you to add your first colleges.`;
  return `${who} asked: “${ask.note ?? ""}”`;
}

/** The ask as the office lists it: the section's name, "First colleges", or the custom line. */
export function askLabel(ask: Pick<OrgAsk, "kind" | "section" | "note">): string {
  if (ask.kind === "record_section") return isRecordSection(ask.section) ? RECORD_SECTION_LABEL[ask.section] : "A record section";
  if (ask.kind === "list") return "First colleges";
  return ask.note ?? "";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The calendar day (yyyy-mm-dd) of a timestamp in the office's zone (America/New_York, as shortDate uses). */
export function isoDay(at: string, timeZone = "America/New_York"): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** "Tue" within the last six days, "Today", else "Oct 12" (the ask's "Asked Tue · Done Thu"). */
export function shortDay(at: string, today: string, long = false): string {
  const day = isoDay(at);
  const ago = daysBetween(day, today);
  if (ago === 0) return "today";
  if (ago > 0 && ago < 7) return (long ? LONG_WEEKDAYS : WEEKDAYS)[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return dayLabel(day, today);
}

/** "Asked Tue · Done Thu", "Asked Oct 2 · Seen", "Asked today". */
export function askStatusLine(ask: Pick<OrgAsk, "created" | "done_at" | "seen_at">, today: string): string {
  const asked = `Asked ${shortDay(ask.created, today)}`;
  if (ask.done_at) return `${asked} · Done ${shortDay(ask.done_at, today)}`;
  return ask.seen_at ? `${asked} · Seen` : asked;
}

/** The open ask for a record section or the list, if any (the button then says "Asked Tuesday"). */
export function openAskFor(asks: readonly Pick<OrgAsk, "kind" | "section" | "done_at" | "created">[], kind: OrgAskKind, section: string | null = null) {
  return asks.find((a) => a.kind === kind && (a.section ?? null) === section && a.done_at === null) ?? null;
}

/** How many asks this organization sent the student in the last seven days (the SQL's limit is ORG_ASKS_PER_WEEK). */
export function asksThisWeek(asks: readonly Pick<OrgAsk, "created">[], now: Date = new Date()): number {
  const since = now.getTime() - 7 * 86_400_000;
  return asks.filter((a) => Date.parse(a.created) > since).length;
}

/**
 * Whether an open ask is already done by the facts (the notice checks when it renders, specs "Asking a student"): a
 * record-section ask once the section is filled, a list ask once the list has a college. A custom ask never is: it
 * has its own Done.
 */
export function askSatisfied(ask: Pick<OpenOrgAsk, "kind" | "section">, facts: { profile: StudentProfileData | null; listCount: number }): boolean {
  if (ask.kind === "record_section") return isRecordSection(ask.section) && facts.profile !== null && sectionDone(facts.profile, ask.section);
  if (ask.kind === "list") return facts.listCount > 0;
  return false;
}

/* ------------------------------------------------------------------ */
/* The caseload                                                        */
/* ------------------------------------------------------------------ */

/** A list item as the caseload reads it (the student's default list). */
export interface CaseloadItem {
  id: string;
  unit_id: string;
  category: ListCategory;
  status: ListStatus;
  outcome: ListOutcome | null;
  round: ListRound | null;
  position: number;
  enrolling: boolean;
  visited_on: string | null;
  dream: boolean;
  added_at: string | null;
  committed_on: string | null;
  withdrawn_on: string | null;
  deadline_date: string | null;
  deadline_text: string | null;
}

export type CaseloadTask = Pick<
  PlanTask,
  "id" | "item_id" | "kind" | "title" | "due_on" | "window_start" | "window_end" | "done_at" | "dismissed" | "snoozed_until" | "orphaned" | "source" | "created_at" | "position"
>;

export interface CaseloadVisit {
  item_id: string;
  on_date: string;
  created_at: string;
  updated_at: string | null;
}

/** One student on the caseload with everything the counselor's session read about them. */
export interface CaseloadStudent {
  studentId: string;
  name: string | null;
  gradYear: number | null;
  canEdit: boolean;
  hasAccount: boolean;
  profile: StudentProfileData | null;
  items: CaseloadItem[];
  tasks: CaseloadTask[];
  visits: CaseloadVisit[];
  /** The student's essays (drafts), newest first: only when each was last changed. */
  essays: { id: string; updated: string }[];
}

export interface CaseloadInput {
  students: CaseloadStudent[];
  /** College names by unit id (from the dataset). */
  schools: Record<string, { name: string }>;
  status: Record<string, AdvisorStatus>;
  today: string;
}

/** Short words for a signal on a row (the full sentence is the chip's title and the student page's line). */
export const SIGNAL_CHIP: Record<StuckSignal["id"], string> = {
  overdue_task: "Overdue step",
  no_activity: "Quiet 2 weeks",
  no_likely: "No Likely",
  ed_no_estimate: "ED, no estimate",
  waitlist_no_commit: "Wait list, no deposit",
  overdue_decision: "Decision overdue",
};

export interface CaseloadRow {
  studentId: string;
  name: string;
  gradYear: number | null;
  /** "Class of 2027", or null without a year. */
  classOf: string | null;
  grade: Grade;
  canEdit: boolean;
  hasAccount: boolean;
  advisorStatus: AdvisorStatus;
  advisorLabel: string;
  record: { done: number; total: number; line: string; missing: ProfileSection[]; missingLabels: string[] };
  list: {
    count: number;
    /** "7 colleges · no Likely yet", "No colleges yet". */
    line: string;
    /** The levels in words ("3 Reaches, 2 Targets, and no Likely yet"), for the hover. */
    detail: string | null;
    counts: Record<StandingLevel, number>;
    unsorted: number;
    gaps: ShapeGapKind[];
  };
  /** "3 of 8 in" once the student is applying, else null. */
  applications: string | null;
  /** The next dated open step: "Michigan, Nov 1 (ED I)". */
  nextDeadline: { label: string; date: string; overdue: boolean } | null;
  /** Open dated steps due in the next seven days (the counts line's "deadlines this week"). */
  dueThisWeek: number;
  lastActivity: { at: string | null; label: string };
  /** The parent's stuck signals (parents.md), never the ED-estimate one (money). */
  signals: StuckSignal[];
  /** The parent's summary line ("Applying · 3 of 8 in · next: Michigan, Nov 1 (ED I)"). */
  summary: string;
  /** Any signal, or an empty record: the "needs something" filter. */
  needsSomething: boolean;
}

const EMPTY_COUNTS = (): Record<StandingLevel, number> => ({ high_reach: 0, reach: 0, target: 0, likely: 0, safe: 0 });

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", "4 months ago". */
export function agoLabel(at: string, today: string): string {
  const days = Math.max(0, daysBetween(isoDay(at), today));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 60) return `${plural(Math.floor(days / 7), "week")} ago`;
  if (days < 365) return `${plural(Math.floor(days / 30), "month")} ago`;
  return "Over a year ago";
}

/** The newest change the student (or anyone) made in the plan: a step done or added, a college added, a visit, an essay. */
export function lastActivityAt(s: Pick<CaseloadStudent, "items" | "tasks" | "visits" | "essays">): string | null {
  const stamps: string[] = [];
  for (const t of s.tasks) {
    if (t.done_at) stamps.push(t.done_at);
    if (t.source === "own" && t.created_at) stamps.push(t.created_at);
  }
  for (const i of s.items) if (i.added_at) stamps.push(i.added_at);
  for (const v of s.visits) stamps.push(v.updated_at ?? v.created_at);
  for (const e of s.essays) stamps.push(e.updated);
  return stamps.sort().at(-1) ?? null;
}

/** The phrase after the count on the list line, from the first shape gap (list-shape.md "Gap moves"). */
function gapPhrase(gap: ShapeGapKind, counts: Record<StandingLevel, number>, total: number, min: number): string | null {
  switch (gap) {
    case "likely_min":
      return counts.likely === 0 && counts.safe === 0 ? "no Likely yet" : "few Likely or Safe";
    case "target_min":
      return "few Targets";
    case "reach_min":
      return "few Reaches";
    case "over_max":
      return "many High reaches";
    case "total_off":
      return total < min ? "short list" : "long list";
    case "affordable":
      return null;
  }
}

function listFacts(items: readonly CaseloadItem[], gradYear: number | null, today: string): CaseloadRow["list"] {
  const live = items.filter((i) => !i.withdrawn_on);
  const counts = EMPTY_COUNTS();
  let unsorted = 0;
  for (const i of live) {
    if (i.category === "unsorted") unsorted++;
    else counts[i.category]++;
  }
  const count = live.length;
  if (count === 0) return { count, line: "No colleges yet", detail: null, counts, unsorted, gaps: [] };
  const season = seasonOf(gradYear, today);
  // Affordability is "ok" here on purpose: the cost check reads the family's limit, which a counselor never sees.
  const gaps = shapeGaps(counts, unsorted, season, "ok").map((g) => g.kind);
  const head = plural(count, "college");
  const shape = shapeFor(season);
  const phrase = unsorted > 0 ? `${unsorted} unsorted` : gaps.length > 0 ? gapPhrase(gaps[0], counts, count, shape?.total[0] ?? 0) : null;
  const detail = countLine(counts).replace(/^Your list has /, "").replace(/\.$/, "");
  return { count, line: phrase ? `${head} · ${phrase}` : head, detail: detail.charAt(0).toUpperCase() + detail.slice(1), counts, unsorted, gaps };
}

function classOf(gradYear: number | null): string | null {
  return gradYear !== null ? `Class of ${gradYear}` : null;
}

/** One caseload row (exported for the student page, which shows one student's row facts). */
export function caseloadRow(s: CaseloadStudent, input: Pick<CaseloadInput, "schools" | "status" | "today">): CaseloadRow {
  const { today, schools } = input;
  const season = seasonOf(s.gradYear, today);
  const grade = gradeOf(s.gradYear, today);
  const progress = profileProgress(s.profile, { season });
  const missing = PROFILE_SECTIONS.filter((sec) => s.profile === null || !sectionDone(s.profile, sec));
  const tasks = s.tasks as unknown as PlanTask[];
  const { current, stages } = stageOf({ items: s.items, tasks: s.tasks, today });
  const applications = s.items.length > 0 && stages[5].state !== "not_yet" ? stages[5].count : null;

  const next = nextTask(tasks, today);
  let nextDeadline: CaseloadRow["nextDeadline"] = null;
  if (next) {
    const date = taskDate(next)!;
    const item = next.item_id ? s.items.find((i) => i.id === next.item_id) : null;
    const name = item ? (schools[item.unit_id]?.name ?? "A college") : next.title;
    const round = item?.round ? ` (${ROUND_SHORT[item.round]})` : "";
    nextDeadline = { label: `${name}, ${dayLabel(date, today)}${round}`, date, overdue: date < today };
  }
  const weekEnd = addDays(today, 7);
  const dueThisWeek = s.tasks.filter((t) => {
    const d = taskDate(t);
    return isOpen(t, today) && d !== null && d >= today && d <= weekEnd;
  }).length;

  const at = lastActivityAt(s);
  const lastActivity = { at, label: at ? agoLabel(at, today) : s.items.length === 0 ? "Never opened" : "No activity yet" };

  const signals = stuckSignals({
    items: s.items,
    tasks: s.tasks,
    visits: s.visits.map((v) => ({ created_at: v.created_at, updated_at: v.updated_at ?? v.created_at })),
    schools: Object.fromEntries(s.items.map((i) => [i.unit_id, { name: schools[i.unit_id]?.name ?? "A college", links: null }])),
    money: NO_MONEY,
    cycle: { startYear: (s.gradYear ?? Number(today.slice(0, 4)) + 1) - 1 },
    grade,
    today,
  }).filter((sig) => sig.id !== "ed_no_estimate");

  const summary = summaryLine({
    current,
    stages,
    tasks: s.tasks,
    items: s.items,
    schools,
    visits: s.visits,
    today,
  });
  const status = input.status[s.studentId] ?? "preview";
  return {
    studentId: s.studentId,
    name: s.name?.trim() || "Student",
    gradYear: s.gradYear,
    classOf: classOf(s.gradYear),
    grade,
    canEdit: s.canEdit,
    hasAccount: s.hasAccount,
    advisorStatus: status,
    advisorLabel: ADVISOR_STATUS_LABEL[status],
    record: {
      done: progress.done,
      total: progress.total,
      line: `${progress.done} of ${progress.total}`,
      missing,
      missingLabels: missing.map((m) => RECORD_SECTION_LABEL[m]),
    },
    list: listFacts(s.items, s.gradYear, today),
    applications,
    nextDeadline,
    dueThisWeek,
    lastActivity,
    signals,
    summary,
    needsSomething: signals.length > 0 || progress.done === 0,
  };
}

/** Soonest open deadline first (students with none after), then by name: the caseload's one order. */
export function compareCaseloadRows(a: Pick<CaseloadRow, "nextDeadline" | "name">, b: Pick<CaseloadRow, "nextDeadline" | "name">): number {
  const da = a.nextDeadline?.date ?? null;
  const db = b.nextDeadline?.date ?? null;
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? -1 : 1;
  }
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

/** Every row of the caseload, in the caseload's order. No estimate runs here and no student is compared with another. */
export function caseloadRows(input: CaseloadInput): CaseloadRow[] {
  return input.students.map((s) => caseloadRow(s, input)).sort(compareCaseloadRows);
}

const SENIOR_GRADES: ReadonlySet<Grade> = new Set(["summer_before_senior", "senior_fall", "senior_winter", "senior_spring"]);
const JUNIOR_GRADES: ReadonlySet<Grade> = new Set(["junior_fall", "junior_spring"]);

export interface CaseloadCounts {
  students: number;
  seniors: number;
  juniors: number;
  /** Students in a season with a list shape whose list has colleges but no Likely. */
  noLikely: number;
  /** Open dated steps due in the next seven days, across the caseload. */
  deadlinesThisWeek: number;
  invited: number;
  /** "24 students · 8 seniors · 6 juniors · 3 with no Likely · 5 deadlines this week" (zero parts left out). */
  line: string;
}

/** The counts that matter for the office, above the rows (specs "The caseload"). */
export function caseloadCounts(rows: readonly CaseloadRow[], invited = 0): CaseloadCounts {
  const seniors = rows.filter((r) => SENIOR_GRADES.has(r.grade)).length;
  const juniors = rows.filter((r) => JUNIOR_GRADES.has(r.grade)).length;
  const noLikely = rows.filter((r) => r.list.count > 0 && r.list.counts.likely === 0 && (SENIOR_GRADES.has(r.grade) || r.grade === "junior_spring")).length;
  const deadlinesThisWeek = rows.reduce((n, r) => n + r.dueThisWeek, 0);
  const parts = [plural(rows.length, "student")];
  if (seniors) parts.push(plural(seniors, "senior"));
  if (juniors) parts.push(plural(juniors, "junior"));
  if (noLikely) parts.push(`${noLikely} with no Likely`);
  if (deadlinesThisWeek) parts.push(`${plural(deadlinesThisWeek, "deadline")} this week`);
  if (invited) parts.push(`${invited} invited`);
  return { students: rows.length, seniors, juniors, noLikely, deadlinesThisWeek, invited, line: parts.join(" · ") };
}

/** The org_caseload_viewed bucket for a caseload's size. */
export function caseloadSizeBucket(n: number): "1-5" | "6-25" | "26-100" | "100+" {
  if (n <= 5) return "1-5";
  if (n <= 25) return "6-25";
  if (n <= 100) return "26-100";
  return "100+";
}

/** The caseload filters: a class year (null = every class), "needs something", and a name search. */
export function filterCaseload(rows: readonly CaseloadRow[], f: { classOf: number | null; needs: boolean; q: string }): CaseloadRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => (f.classOf === null || r.gradYear === f.classOf) && (!f.needs || r.needsSomething) && (q === "" || r.name.toLowerCase().includes(q)));
}

/** An invited student below the rows, by name, with Copy link · Send again · Cancel (the household roster's way). */
export interface InvitedStudent {
  invitationId: string;
  name: string;
  email: string | null;
  status: "invited" | "expired";
  /** "Invited · link works until Dec 1", "Expired Nov 2". */
  line: string;
  /** The absolute `/join/<token>` link while pending; null once expired. */
  link: string | null;
}

/** The roster's invitation rows, for the caseload. `origin` makes the link absolute (no trailing slash). */
export function invitedStudents(roster: readonly OrgRosterRow[], origin: string, today: string): InvitedStudent[] {
  return roster
    .filter((r): r is OrgRosterRow & { status: "invited" | "expired"; invitation_id: string } => (r.status === "invited" || r.status === "expired") && r.invitation_id !== null)
    .map((r) => {
      const until = r.expires_at ? dayLabel(isoDay(r.expires_at), today) : null;
      return {
        invitationId: r.invitation_id,
        name: r.display_name?.trim() || r.email || "A student",
        email: r.email,
        status: r.status,
        line: r.status === "expired" ? `Expired${until ? ` ${until}` : ""}` : `Invited${until ? ` · link works until ${until}` : ""}`,
        link: r.status === "invited" && r.token ? `${origin.replace(/\/+$/, "")}/join/${encodeURIComponent(r.token)}` : null,
      };
    });
}

/** The next three open steps on the student's plan, dated first (the student page's Advisor panel). */
export function nextMoves(s: Pick<CaseloadStudent, "items" | "tasks">, schools: Record<string, { name: string }>, today: string, max = 3): { id: string; title: string; when: string | null; overdue: boolean }[] {
  return s.tasks
    .filter((t) => isOpen(t, today))
    .sort((a, b) => {
      const da = taskDate(a);
      const db = taskDate(b);
      if (da !== db) {
        if (da === null) return 1;
        if (db === null) return -1;
        return da < db ? -1 : 1;
      }
      return a.position - b.position || a.title.localeCompare(b.title);
    })
    .slice(0, max)
    .map((t) => {
      const item = t.item_id ? s.items.find((i) => i.id === t.item_id) : null;
      const college = item ? schools[item.unit_id]?.name : null;
      const date = taskDate(t);
      return { id: t.id, title: college ? `${college}: ${t.title}` : t.title, when: date ? dayLabel(date, today) : null, overdue: date !== null && date < today };
    });
}

/* ------------------------------------------------------------------ */
/* The reads, assembled                                                */
/* ------------------------------------------------------------------ */

const ITEM_COLUMNS = "id, unit_id, category, status, outcome, round, position, enrolling, visited_on, dream, added_at, committed_on, withdrawn_on, deadline_date, deadline_text";
const TASK_COLUMNS = "id, item_id, kind, title, due_on, window_start, window_end, done_at, dismissed, snoozed_until, orphaned, source, created_at, position";
const VISIT_COLUMNS = "item_id, on_date, created_at, updated_at";

/**
 * The default lists with what hangs off them, in one read (lib/orgs.ts caseloadStudents). The embeds name their
 * foreign keys, as lib/planner/hub.ts does: plan_tasks points at both lists and list_items.
 */
export const CASELOAD_LIST_SELECT = `id, student_id, list_items!list_items_list_id_fkey(${ITEM_COLUMNS}, plan_visits!plan_visits_item_id_fkey(${VISIT_COLUMNS})), plan_tasks!plan_tasks_list_id_fkey(${TASK_COLUMNS})`;
export const CASELOAD_ESSAY_COLUMNS = "id, student_id, updated";

export interface CaseloadProfileRow {
  student_id: string;
  data: unknown;
}
export interface CaseloadListRow {
  id: string;
  student_id: string | null;
  list_items: (CaseloadItem & { plan_visits?: CaseloadVisit[] | null })[] | null;
  plan_tasks: CaseloadTask[] | null;
}
export interface CaseloadEssayRow {
  id: string;
  student_id: string;
  updated: string;
}

/**
 * The roster's live students joined with what the counselor's session read: the profile sanitized and redacted as
 * for any viewer who isn't the student (the story's text never leaves the student), the default list's items,
 * steps, and visits, the essays' last changes. A student with no rows reads as empty, not missing.
 */
export function assembleCaseloadStudents(
  roster: readonly Pick<OrgRosterRow, "status" | "student_id" | "display_name" | "grad_year" | "can_edit" | "has_account">[],
  reads: { profiles: readonly CaseloadProfileRow[]; lists: readonly CaseloadListRow[]; essays: readonly CaseloadEssayRow[] },
): CaseloadStudent[] {
  const profiles = new Map(reads.profiles.map((p) => [p.student_id, p.data]));
  const lists = new Map<string, CaseloadListRow>();
  for (const l of reads.lists) if (l.student_id && !lists.has(l.student_id)) lists.set(l.student_id, l);
  const essays = new Map<string, { id: string; updated: string }[]>();
  for (const e of reads.essays) {
    const mine = essays.get(e.student_id) ?? [];
    mine.push({ id: e.id, updated: e.updated });
    essays.set(e.student_id, mine);
  }
  return roster
    .filter((r) => r.status === "active" && r.student_id)
    .map((r) => {
      const id = r.student_id!;
      const raw = profiles.get(id);
      const profile = raw === undefined ? null : profileForViewer(sanitizeProfile(raw), "counselor");
      const list = lists.get(id) ?? null;
      const rawItems = list?.list_items ?? [];
      const items: CaseloadItem[] = rawItems.map((i) => {
        const item = { ...i };
        delete item.plan_visits;
        return item;
      });
      const visits = rawItems.flatMap((i) => i.plan_visits ?? []);
      return {
        studentId: id,
        name: r.display_name,
        gradYear: profile ? effectiveGradYear(profile.basics, r.grad_year ?? null) : (r.grad_year ?? null),
        canEdit: r.can_edit ?? false,
        hasAccount: r.has_account ?? false,
        profile,
        items,
        tasks: list?.plan_tasks ?? [],
        visits,
        essays: (essays.get(id) ?? []).sort((a, b) => b.updated.localeCompare(a.updated)),
      };
    });
}

/* ------------------------------------------------------------------ */
/* The export                                                          */
/* ------------------------------------------------------------------ */

/**
 * The caseload's CSV columns (specs "Export"): the list CSV's words where they overlap (lib/list-rules.ts toCsv:
 * Category's labels as Level, Round, Status, Outcome, Deadline as the list stores it). Never a GPA or a score.
 */
export const CASELOAD_CSV_COLUMNS = ["Student", "Class of", "Record sections filled", "College", "Level", "Status", "Round", "Deadline", "Outcome"] as const;

/** A cell, quoted when it must be, and never read as a formula by a spreadsheet (a leading =, +, -, @ is escaped). */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One row per college per student; a student with an empty list is one row with the college columns blank. */
export function caseloadCsv(students: readonly CaseloadStudent[], schools: Record<string, { name: string }>, today: string): string {
  const lines = [CASELOAD_CSV_COLUMNS.join(",")];
  const sorted = [...students].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "en", { sensitivity: "base" }));
  for (const s of sorted) {
    const progress = profileProgress(s.profile, { season: seasonOf(s.gradYear, today) });
    const head = [s.name?.trim() || "Student", s.gradYear !== null ? String(s.gradYear) : "", `${progress.done} of ${progress.total}`];
    const items = [...s.items].sort((a, b) => a.position - b.position);
    if (items.length === 0) {
      lines.push([...head, "", "", "", "", "", ""].map(csvCell).join(","));
      continue;
    }
    for (const i of items) {
      lines.push(
        [
          ...head,
          schools[i.unit_id]?.name ?? i.unit_id,
          CATEGORY_LABELS[i.category] ?? "",
          STATUS_LABELS[i.status] ?? "",
          i.round ? ROUND_LABELS[i.round] : "",
          i.deadline_date ?? i.deadline_text ?? "",
          i.outcome ? OUTCOME_LABELS[i.outcome] : "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return lines.join("\n");
}

/** "Quad caseload 2026-11-01.csv". */
export function caseloadCsvFilename(siteName: string, today: string): string {
  return `${siteName} caseload ${today}.csv`;
}

/* ------------------------------------------------------------------ */
/* Adding students                                                     */
/* ------------------------------------------------------------------ */

export const ORG_INVITE_BATCH_MAX = 50;

/** The word the owner types to delete the organization (as the account's delete form asks for "delete"). */
export const ORG_DELETE_CONFIRMATION = "delete";

/** One result of an invitation batch: the link to copy, whether it was emailed, or why that line failed. */
export interface StudentInviteResult {
  name: string;
  email: string;
  link: string | null;
  emailed: boolean;
  expires: string | null;
  error: string | null;
}

export interface StudentInviteLine {
  firstName: string;
  lastName: string | null;
  email: string;
  gradYear: number | null;
}

const EMAIL_LIKE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * Pasted lines ("Jordan Lee, jordan@example.com, 2027", tabs or commas, any order of name and year): one student
 * per line, the email required, the year optional (2000 to 2040). Lines it can't read come back with the reason.
 */
export function parseStudentLines(text: string): { rows: StudentInviteLine[]; errors: { line: number; text: string; message: string }[] } {
  const rows: StudentInviteLine[] = [];
  const errors: { line: number; text: string; message: string }[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[\t,;]+/).map((p) => p.trim()).filter(Boolean);
    const email = parts.find((p) => EMAIL_LIKE.test(p.replace(/^<|>$/g, "")))?.replace(/^<|>$/g, "") ?? null;
    if (!email) {
      errors.push({ line: idx + 1, text: line, message: "No email address on this line." });
      return;
    }
    const yearPart = parts.find((p) => /^(20[0-4]\d)$/.test(p));
    const gradYear = yearPart ? Number(yearPart) : null;
    const nameParts = parts.filter((p) => p !== yearPart && p.replace(/^<|>$/g, "") !== email).join(" ").split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] ?? email.split("@")[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
    rows.push({ firstName, lastName, email: email.toLowerCase(), gradYear });
  });
  return { rows, errors };
}
