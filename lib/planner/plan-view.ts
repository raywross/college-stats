/**
 * The redesigned plan's view model (specs/planner/redesign/build-plan.md "The view model"): everything the Colleges,
 * Scores, and Calendar tabs show for one student, worked out once from their stored rows, their numbers, and the
 * colleges' records. Generalizes the design preview's derive (components/plan-preview/derive.ts) over real rows.
 * Every tab reads this; nothing recomputes groups, rounds, notices, or the next deadline on its own.
 *
 * Pure (no server or browser APIs) so the server page, the numbers form's live re-sort in the browser, and the
 * signed-out plan all build the same view: starting rounds (lib/planner/auto-rounds.ts) and round dates
 * (lib/planner/rounds.ts) here, and each college's group, reasons, send advice, and move-up from Quad's estimate,
 * computed on the server (lib/chances/estimate.ts) and passed in as `estimates` (the server loader computes them with
 * estimateMany; the numbers form and the signed-out plan ask POST /api/estimate). Nothing here runs the estimate.
 *
 * Suggested until changed (standing.md, rounds.md): a row's group and round follow the model while their source is
 * `auto` and are the student's own once `student`. `autoWrites` lists what the model would store for the `auto`
 * rows; it never includes a `student` row, and never rewrites the round of an applied or decided college.
 */
import type { ListCategory, ListRound } from "../list-rules.ts";
import { isOffered, roundDates, roundsOffered } from "./rounds.ts";
import { autoRounds, edTwoSuggestion, roundProblems, type AutoRound, type AutoRoundsItem } from "./auto-rounds.ts";
import { balance, retakeFromMoves, type Fit, type MoveUp, type RetakeSuggestion, type StandingStudent } from "./standing.ts";
import { GPA_CITES, positionIn, readScore, type GpaCite, type ScoreRead, type SendAdvice, type StandingSchool } from "../chances/baseline.ts";
import { noteText } from "../chances/notes.ts";
import type { EstimateResult } from "../chances/types.ts";
import { planGpaLabel, planGpaRange, planStudent, type StudentProfileData } from "../student-profile.ts";
import type { PlanItem, PlanSchool } from "./types.ts";

export type SeasonStatus = "not_started" | "working" | "submitted" | "decision";
export type PlanNotice = "problems" | "edTwo" | "balance" | "retake";

/**
 * One college's estimate as the tabs read it: the group, its label, the score's place in the college's middle 50%
 * (public: the student's score against the published range), the send advice, the reasons (the estimate's catalog
 * notes as sentences), and the GPA sentence with the field its ⓘ cites.
 */
export interface RowStanding {
  fit: Fit | null;
  /** The college is a Reach whatever the numbers. */
  reachForEveryone: boolean;
  label: EstimateResult["label"];
  test: ScoreRead | null;
  gpaNote: { text: string; cite: GpaCite | null } | null;
  send: SendAdvice | null;
  reasons: string[];
}

export interface PlanRowView {
  item: PlanItem;
  /** Null when the college is no longer in the dataset. */
  school: PlanSchool | null;
  dream: boolean;
  /** Null when the college has no estimate (not in the dataset, or not answered yet). */
  standing: RowStanding | null;
  /** The estimate behind `standing`, for the drawer's "What went into this estimate" (null when there is none). */
  estimate?: EstimateResult | null;
  /** The group shown: the student's pick, else the model's suggestion ("unsorted" when the model has none). */
  group: ListCategory;
  /** True while the group is the suggestion (✦). */
  groupAuto: boolean;
  /** The round shown: the student's pick, the stored round of an applied or decided college, else the starting round. */
  round: ListRound;
  /** True while the round is the starting round (✦). */
  roundAuto: boolean;
  /** One plain line for the drawer. */
  roundWhy: string;
  /** Rounds the chip's menu offers: everything the college's record doesn't rule out (else just regular). */
  pickable: ListRound[];
  /** The round's closing date in the student's cycle, with the field to cite and its edition. */
  deadline: { iso: string; field: string; edition: string | null; lastCycle: boolean } | null;
  /** The round's expected decision date. */
  decision: { iso: string; field: string } | null;
  /** The fewest points on the student's test that move this college up a group (scores.md). */
  moveUp: MoveUp | null;
  /** The row's status chip once the season starts; null before. */
  seasonStatus: SeasonStatus | null;
}

export interface PlanView {
  student: StandingStudent;
  /** Ordered: the Dream, then Reach, Target, Likely, unsorted; then the list's own order. */
  rows: PlanRowView[];
  balance: Record<Fit, number>;
  /** One sentence under the list when the balance is off (list.md "Balance line"), else null. */
  balanceLine: string | null;
  /** One sentence per round conflict (rounds.md "Problems"). */
  problems: string[];
  /** The one optional ED II line (rounds.md "ED II"). */
  edTwo: { itemId: string; name: string; due: string | null } | null;
  retake: RetakeSuggestion | null;
  /** The estimates the view was built from, by unit id (the numbers form seeds its live preview with them). */
  estimates: Record<string, EstimateResult>;
  /** The next deadline still to meet, or once deadlines are done the next decision to hear. */
  next: PlanRowView | null;
  /** The application season has started: a deadline within SEASON_WINDOW_DAYS, or a college past "considering". */
  inSeason: boolean;
  /** The notices to show, at most MAX_NOTICES, in list.md's order. */
  notices: PlanNotice[];
}

export interface PlanViewInput {
  items: PlanItem[];
  /** By unit id. */
  schools: Record<string, PlanSchool>;
  profile: StudentProfileData | null;
  /**
   * Quad's estimate for each college, by unit id (lib/chances/estimate.ts on the server, or POST /api/estimate).
   * A college without one shows its stored group and is never rewritten by `autoWrites`.
   */
  estimates: Record<string, EstimateResult>;
  /** yyyy-mm-dd. */
  today: string;
}

/** list.md "Around the list": at most three notices at once; the rest wait until the earlier ones are handled. */
export const MAX_NOTICES = 3;
export const NOTICE_ORDER: readonly PlanNotice[] = ["problems", "edTwo", "balance", "retake"];
/** list.md "The row": the season starts when the first deadline is within this many days. */
export const SEASON_WINDOW_DAYS = 30;
/** Counselors' common range for a list (README.md "Research"). */
export const LIST_SIZE = { min: 6, max: 12 } as const;
export const MIN_LIKELY = 2;

export const BALANCE_LINES = {
  likely: "Counselors suggest at least two Likely colleges you'd be happy to attend.",
  size: "Most students apply to 6 to 12 colleges.",
  reach: "A Target or two would balance the Reaches.",
} as const;

const GROUP_ORDER: Record<ListCategory, number> = { reach: 0, target: 1, likely: 2, unsorted: 3 };

const STATUS_TO_SEASON: Record<PlanItem["status"], SeasonStatus> = {
  considering: "not_started",
  applying: "working",
  applied: "submitted",
  decided: "decision",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** An applied or decided college keeps whatever round it has (rounds.md "Starting rounds" 4). */
const isLocked = (i: PlanItem) => i.status === "applied" || i.status === "decided";
/** A round that still binds or restricts: not a decided college other than an admit, not a withdrawn one. */
const isActive = (i: PlanItem) => !(i.status === "decided" && i.outcome !== "admitted") && !i.withdrawn_on;

/** The balance sentence, when the list is off: too few Likely, then the list's size, then too many Reaches. */
export function balanceLineFor(groups: ListCategory[]): string | null {
  if (groups.length === 0) return null;
  const counts = balance(groups.map((g) => (g === "unsorted" ? null : g)));
  const sorted = counts.reach + counts.target + counts.likely;
  if (sorted > 0 && counts.likely < MIN_LIKELY) return BALANCE_LINES.likely;
  if (groups.length < LIST_SIZE.min || groups.length > LIST_SIZE.max) return BALANCE_LINES.size;
  if (sorted > 0 && counts.reach > sorted / 2) return BALANCE_LINES.reach;
  return null;
}

/** The two amber conflicts the built conflicts() also caught, as one plain sentence each (rounds.md "Problems"). */
function amberProblems(rows: { item: PlanItem; school: PlanSchool | null; round: ListRound }[]): string[] {
  const out: string[] = [];
  const name = (r: { school: PlanSchool | null }) => r.school?.name ?? "A college";
  const by = (round: ListRound) => rows.filter((r) => r.round === round);
  for (const rea of by("rea")) {
    for (const ea of by("ea")) {
      if (ea.school?.type === "public") continue;
      out.push(`Restrictive early action at ${name(rea)} usually rules out early action at another private college like ${name(ea)}. Check ${name(rea)}'s rules.`);
    }
  }
  for (const ed of by("ed")) {
    const decides = roundDates(ed.school, "ed").notification;
    for (const ed2 of by("ed2")) {
      const due = roundDates(ed2.school, "ed2").closing;
      if (decides && due && due.iso < decides.iso) {
        out.push(`ED II at ${name(ed2)} is due ${dayLabel(due.iso)}, before ${name(ed)} decides (${dayLabel(decides.iso)}), so you'd commit before you hear back.`);
      }
    }
  }
  return out;
}

/** The score's read against the college's published middle 50%, as the Scores tab draws it; null where scores aren't used. */
function scoreReadFor(student: StandingStudent, school: StandingSchool, send: SendAdvice | null): ScoreRead | null {
  if (!student.test || send === "not-used" || send === "required-missing") return null;
  const read = readScore(student.test, school);
  if (!read) return null;
  return { position: positionIn(read.score, read.range), used: send === "send", kind: read.kind, range: read.range, concorded: read.concorded };
}

const isGpaNote = (key: string) => key.startsWith("estimate.gpa.");

/** The row's standing from its estimate (the reasons are the catalog's sentences, in the estimate's order). */
export function rowStanding(est: EstimateResult, student: StandingStudent, school: StandingSchool): RowStanding {
  const gpa = est.notes.find((n) => isGpaNote(n.key));
  const cite = gpa?.cite && (GPA_CITES as readonly string[]).includes(gpa.cite) ? (gpa.cite as GpaCite) : null;
  return {
    fit: est.group,
    reachForEveryone: est.label === "reach-for-everyone",
    label: est.label,
    test: scoreReadFor(student, school, est.send),
    gpaNote: gpa ? { text: noteText(gpa), cite } : null,
    send: est.send,
    reasons: est.notes.map(noteText).filter((t) => t !== ""),
  };
}

/** The row's move-up in the score coach's shape (scores.md), from the estimate's. */
function rowMoveUp(est: EstimateResult | null, student: StandingStudent): MoveUp | null {
  if (!est?.moveUp || !est.group || !student.test) return null;
  return { score: est.moveUp.score, delta: est.moveUp.points, from: est.group, to: est.moveUp.to };
}

/** The plan's whole view (build-plan.md "The view model"). */
export function planView(input: PlanViewInput): PlanView {
  const { items, schools, profile, today } = input;
  const estimates = input.estimates ?? {};
  // The GPA as a range, so a weighted GPA is placed only as roughly as it allows (gpa.md "The design" 3).
  const student: StandingStudent = { ...planStudent(profile), gpaRange: planGpaRange(profile), gpaLabel: planGpaLabel(profile) };
  const schoolOf = (i: PlanItem): PlanSchool | null => schools[i.unit_id] ?? null;
  const bySchool: Record<string, PlanSchool | undefined> = Object.fromEntries(items.map((i) => [i.id, schools[i.unit_id]]));

  const roundItems: AutoRoundsItem[] = items.map((i) => {
    const locked = isLocked(i);
    const chosen = locked ? i.round : i.round_source === "student" ? i.round : null;
    return { id: i.id, dream: i.dream === true, chosen, locked };
  });
  const rounds = autoRounds(roundItems, bySchool);
  const roundById = new Map<string, AutoRound>(rounds.map((r) => [r.id, r]));

  let rows: PlanRowView[] = items.map((item) => {
    const school = schoolOf(item);
    const est = school ? (estimates[item.unit_id] ?? null) : null;
    const standing = est && school ? rowStanding(est, student, school.standing) : null;
    const groupAuto = item.category_source !== "student";
    // Without an estimate yet, an auto row keeps the group it has (nothing is rewritten until one arrives).
    const group: ListCategory = groupAuto ? (standing ? (standing.fit ?? "unsorted") : school ? item.category : "unsorted") : item.category;
    const r = roundById.get(item.id)!;
    const locked = isLocked(item);
    const why = locked && item.round_source !== "student" ? "Your application is in, so the round stays as it is." : r.why;
    const dates = roundDates(school, r.round);
    const offered = roundsOffered(school);
    return {
      item,
      school,
      dream: item.dream === true,
      standing,
      estimate: school ? est : null,
      group,
      groupAuto,
      round: r.round,
      roundAuto: r.auto,
      roundWhy: why,
      pickable: offered.pickable.length > 0 ? offered.pickable : ["rd"],
      deadline: dates.closing ? { iso: dates.closing.iso, field: dates.closing.field, edition: dates.edition, lastCycle: dates.lastCycle } : null,
      decision: dates.notification ? { iso: dates.notification.iso, field: dates.notification.field } : null,
      moveUp: rowMoveUp(est, student),
      seasonStatus: null,
    };
  });

  rows.sort((a, b) => Number(b.dream) - Number(a.dream) || GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.item.position - b.item.position);

  // The season (list.md "The row"): the first deadline is within 30 days, or any college is past "considering".
  const firstDeadline = rows.map((r) => r.deadline?.iso).filter((d): d is string => !!d).sort()[0] ?? null;
  const inSeason = (firstDeadline !== null && firstDeadline <= addDays(today, SEASON_WINDOW_DAYS)) || items.some((i) => i.status !== "considering");
  if (inSeason) rows = rows.map((r) => ({ ...r, seasonStatus: STATUS_TO_SEASON[r.item.status] }));

  // Conflicts among the rounds that still bind (rounds.md "Problems").
  const active = rows.filter((r) => isActive(r.item));
  const names = Object.fromEntries(items.map((i) => [i.id, schoolOf(i)?.name ?? "A college"]));
  const activeRounds = rounds.filter((r) => active.some((a) => a.item.id === r.id));
  const problems = [...roundProblems(activeRounds, bySchool, names), ...amberProblems(active)];

  const edTwoId = edTwoSuggestion(roundItems, rounds, bySchool);
  const edTwoRow = edTwoId ? rows.find((r) => r.item.id === edTwoId) ?? null : null;
  const edTwo = edTwoRow
    ? { itemId: edTwoRow.item.id, name: edTwoRow.school?.name ?? "A college", due: roundDates(edTwoRow.school, "ed2").closing?.iso ?? null }
    : null;

  // A retake can still move a college that hasn't decided (scores.md "When to suggest another test").
  const retake = student.test
    ? retakeFromMoves(
        student.test,
        rows.filter((r) => r.school && r.item.status !== "decided" && !r.item.withdrawn_on).map((r) => ({ id: r.item.id, up: r.moveUp })),
      )
    : null;

  // Next up: the nearest deadline still to meet; once those are done, the nearest decision still to hear.
  const open = rows.filter((r) => !isLocked(r.item) && !r.item.withdrawn_on && r.deadline && r.deadline.iso >= today);
  const waiting = rows.filter((r) => r.item.status === "applied" && r.decision && r.decision.iso >= today);
  const next =
    [...open].sort((a, b) => a.deadline!.iso.localeCompare(b.deadline!.iso))[0] ??
    [...waiting].sort((a, b) => a.decision!.iso.localeCompare(b.decision!.iso))[0] ??
    null;

  const groups = rows.map((r) => r.group);
  const balanceLine = balanceLineFor(groups);
  const present: Record<PlanNotice, boolean> = { problems: problems.length > 0, edTwo: edTwo !== null, balance: balanceLine !== null, retake: retake !== null };
  const notices = NOTICE_ORDER.filter((n) => present[n]).slice(0, MAX_NOTICES);

  return {
    student,
    rows,
    balance: balance(groups.map((g) => (g === "unsorted" ? null : g))),
    balanceLine,
    problems,
    edTwo,
    retake,
    estimates,
    next,
    inSeason,
    notices,
  };
}

/**
 * Rows whose stored auto category or round differs from the model: what a sync writes (store-plan.ts syncAuto). Never
 * a row with `student` source for that value, never the round of an applied or decided college, never a college
 * that's no longer in the dataset (nothing to judge it by), never a group without an estimate behind it, and never a
 * round the college's record rules out.
 */
export function autoWrites(view: PlanView): { id: string; category?: ListCategory; round?: ListRound }[] {
  const out: { id: string; category?: ListCategory; round?: ListRound }[] = [];
  for (const r of view.rows) {
    if (!r.school) continue;
    const w: { id: string; category?: ListCategory; round?: ListRound } = { id: r.item.id };
    if (r.item.category_source === "auto" && r.groupAuto && r.standing && r.item.category !== r.group) w.category = r.group;
    if (r.item.round_source === "auto" && r.roundAuto && !isLocked(r.item) && r.item.round !== r.round && isOffered(r.school, r.round) !== false) w.round = r.round;
    if (w.category !== undefined || w.round !== undefined) out.push(w);
  }
  return out;
}
