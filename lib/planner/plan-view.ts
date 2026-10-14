/**
 * The redesigned plan's view model (specs/planner/redesign/build-plan.md "The view model"): everything the Colleges,
 * Scores, and Calendar tabs show for one student, worked out once from their stored rows, their numbers, and the
 * colleges' records.
 * Every tab reads this; nothing recomputes groups, rounds, notices, or the next deadline on its own.
 *
 * Pure (no server or browser APIs) so the server page, the numbers form's live re-sort in the browser, and the
 * signed-out plan all build the same view: starting rounds (lib/planner/auto-rounds.ts) and round dates
 * (lib/planner/rounds.ts) here, and each college's group, reasons, send advice, and move-up from Quad's estimate,
 * computed on the server (lib/chances/estimate.ts) and passed in as `estimates` (the server loader computes them with
 * estimateMany; the numbers form and the signed-out plan ask POST /api/estimate). Nothing here runs the estimate.
 *
 * Groups are Quad's only (specs/planner/redesign/intake.md "Groups"; owner, 2026-10-11): a row's group is always the
 * model's, whatever `category_source` says, and `autoWrites` rewrites a stored `student` group to the model's (the
 * write also sets the source back to `auto`, plan-writes.ts autoWriteBatches) so stored data converges. Rounds are
 * still suggested until changed (rounds.md): the student's own once `round_source` is `student`; `autoWrites` never
 * rewrites a `student` round, nor the round of an applied or decided college.
 */
import type { ListCategory, ListRound } from "../list-rules.ts";
import { isOffered, roundDates, roundsOffered } from "./rounds.ts";
import { autoRounds, roundProblems, type AutoRound, type AutoRoundsItem } from "./auto-rounds.ts";
import { RETAKE_REACH, TEST_MAX, type StandingStudent, type TestKind } from "./standing.ts";
import { GPA_CITES, positionIn, readScore, type GpaCite, type ScoreRead, type SendAdvice, type StandingSchool } from "../chances/baseline.ts";
import { STANDING_LEVELS } from "../chances/levels.ts";
import { noteText } from "../chances/notes.ts";
import type { EstimateResult, StandingLevel } from "../chances/types.ts";
import { planGpaLabel, planGpaRange, planStudent, type StudentProfileData } from "../student-profile.ts";
import { affordabilityFor, dreamAtHighReach, shapeFor, shapeGaps, unsortedLine } from "./list-shape.ts";
import type { Season } from "./seasons.ts";
import type { PlanItem, PlanSchool } from "./types.ts";

export type SeasonStatus = "not_started" | "working" | "submitted" | "decision";
/** The ED II offer and "ED would help most" notices became the Good ED opportunity pills (ed-opportunities.md). */
export type PlanNotice = "problems" | "balance" | "retake";

/**
 * One college's estimate as the tabs read it: the group, its label, the score's place in the college's middle 50%
 * (public: the student's score against the published range), the send advice, the reasons (the estimate's catalog
 * notes as sentences), and the GPA sentence with the field its ⓘ cites.
 */
export interface RowStanding {
  fit: StandingLevel | null;
  /** The college is a Reach for everyone (label "elite"): its tier is Elite, whatever the numbers. */
  reachForEveryone: boolean;
  label: EstimateResult["label"];
  test: ScoreRead | null;
  gpaNote: { text: string; cite: GpaCite | null } | null;
  send: SendAdvice | null;
  reasons: string[];
}

/** The fewest points on the student's own test that would move a college up a level (levels.md "The planner's advice"; scores.md). */
export interface LevelMoveUp {
  score: number;
  delta: number;
  from: StandingLevel;
  to: StandingLevel;
}

/** A retake worth suggesting across the list (scores.md "When to suggest another test"), across the five levels. */
export interface LevelRetakeSuggestion {
  kind: TestKind;
  /** The increase that makes every listed move (the largest one needed, within RETAKE_REACH). */
  delta: number;
  target: number;
  moves: { id: string; from: StandingLevel; to: StandingLevel; needed: number }[];
}

/** Counts per level for the balance line ("2 High reach · 3 Reach · 2 Target · 1 Likely · 1 Safe"). */
function balanceLevels(levels: (StandingLevel | null)[]): Record<StandingLevel, number> {
  const out = Object.fromEntries(STANDING_LEVELS.map((l) => [l, 0])) as Record<StandingLevel, number>;
  for (const l of levels) if (l) out[l]++;
  return out;
}

/**
 * The retake card from moves already worked out (scores.md "When to suggest another test"): every move within a
 * common retake gain, smallest first, and the largest number needed among them. Null when none. A planner-local,
 * five-level version of lib/chances/baseline.ts retakeFromMoves (which stays three-group for the open baseline).
 */
function levelRetakeFromMoves(test: { kind: TestKind; score: number }, moves: { id: string; up: LevelMoveUp | null }[]): LevelRetakeSuggestion | null {
  const counted = moves
    .filter((m): m is { id: string; up: LevelMoveUp } => m.up !== null && m.up.delta > 0 && m.up.delta <= RETAKE_REACH[test.kind])
    .map(({ id, up }) => ({ id, from: up.from, to: up.to, needed: up.delta }))
    .sort((a, b) => a.needed - b.needed);
  if (counted.length === 0) return null;
  const delta = counted[counted.length - 1].needed;
  return { kind: test.kind, delta, target: Math.min(test.score + delta, TEST_MAX[test.kind]), moves: counted };
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
  /** The group shown: always the model's ("unsorted" when the model has none; the stored group until an estimate arrives). */
  group: ListCategory;
  /** Always true: groups are Quad's only (kept so older readers still compile). */
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
  /** The fewest points on the student's test that move this college up a level (scores.md). */
  moveUp: LevelMoveUp | null;
  /** The row's status chip once the season starts; null before. */
  seasonStatus: SeasonStatus | null;
}

export interface PlanView {
  student: StandingStudent;
  /** Ordered: the Dream, then High reach, Reach, Target, Likely, Safe, unsorted; within a section, closest first, then the list's own order. */
  rows: PlanRowView[];
  balance: Record<StandingLevel, number>;
  /** One sentence under the list when the balance is off (levels.md "Where the levels show"), else null. */
  balanceLine: string | null;
  /** One sentence per round conflict (rounds.md "Problems"). */
  problems: string[];
  retake: LevelRetakeSuggestion | null;
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
  /**
   * Next steps (list-shape.md): the student's season, for the balance notice's shape (lib/planner/list-shape.ts
   * shapeFor). Optional so every existing caller keeps compiling (lib/planner/load.ts, store-plan.ts, the
   * signed-out plan, the numbers form); "unknown" (the default) has no shape, so the notice stays silent exactly as
   * it did before this unit.
   */
  season?: Season;
}

/** list.md "Around the list": at most three notices at once; the rest wait until the earlier ones are handled. */
export const MAX_NOTICES = 3;
export const NOTICE_ORDER: readonly PlanNotice[] = ["problems", "balance", "retake"];
/** list.md "The row": the season starts when the first deadline is within this many days. */
export const SEASON_WINDOW_DAYS = 30;
/** The junior long list's own soft line (list-shape.md open question 1): no move, just a nudge. */
const LONG_LIST_SOFT_LINE = "20 is plenty to visit.";

const GROUP_ORDER: Record<ListCategory, number> = { high_reach: 0, reach: 1, target: 2, likely: 3, safe: 4, unsorted: 5 };

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

/**
 * The balance sentence, when the list is off (list-shape.md "Gap moves"): the first gap `shapeGaps` returns — the
 * same list the shape_gap/shape_cost move reads (lib/planner/list-shape.ts), so the Colleges tab's notice and the
 * Next steps move never disagree (build-plan.md "What's removed (U2) and replaced (U4)"). The junior long list's
 * own soft "20 is plenty" line (open question 1) has no move behind it, so it's handled here only, after every
 * real gap comes up empty. No shape (freshman/sophomore, no graduation year) means no line at all.
 */
export function balanceLineFor(groups: ListCategory[], season: Season, affordability: "ok" | "none" | "unknown", hasDreamAtHighReach = false): string | null {
  if (groups.length === 0) return null;
  const shape = shapeFor(season);
  if (!shape) return null;
  const unsorted = groups.filter((g) => g === "unsorted").length;
  if (unsorted > 0) return unsortedLine(unsorted);
  const counts = balanceLevels(groups.map((g) => (g === "unsorted" ? null : g)));
  const gaps = shapeGaps(counts, unsorted, season, affordability, hasDreamAtHighReach);
  if (gaps.length > 0) return gaps[0].line;
  if ((season === "junior_fall" || season === "junior_winter") && groups.length > shape.total[1]) return LONG_LIST_SOFT_LINE;
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
    reachForEveryone: est.label === "elite",
    label: est.label,
    test: scoreReadFor(student, school, est.send),
    gpaNote: gpa ? { text: noteText(gpa), cite } : null,
    send: est.send,
    reasons: est.notes.map(noteText).filter((t) => t !== ""),
  };
}

/** The row's move-up in the score coach's shape (scores.md), from the estimate's, across the five levels. */
function rowMoveUp(est: EstimateResult | null, student: StandingStudent): LevelMoveUp | null {
  if (!est?.moveUp || !est.group || !student.test) return null;
  return { score: est.moveUp.score, delta: est.moveUp.points, from: est.group, to: est.moveUp.to };
}

/** The plan's whole view (build-plan.md "The view model"). */
export function planView(input: PlanViewInput): PlanView {
  const { items, schools, profile, today } = input;
  const estimates = input.estimates ?? {};
  const season = input.season ?? "unknown";
  // The GPA as a range, so a weighted GPA is placed only as roughly as it allows (gpa.md "The design" 3).
  const student: StandingStudent = { ...planStudent(profile), gpaRange: planGpaRange(profile), gpaLabel: planGpaLabel(profile) };
  const schoolOf = (i: PlanItem): PlanSchool | null => schools[i.unit_id] ?? null;
  const bySchool: Record<string, PlanSchool | undefined> = Object.fromEntries(items.map((i) => [i.id, schools[i.unit_id]]));

  const roundItems: AutoRoundsItem[] = items.map((i) => {
    const locked = isLocked(i);
    const chosen = locked ? i.round : i.round_source === "student" ? i.round : null;
    return { id: i.id, dream: i.dream === true, chosen, locked };
  });
  // rounds.md "The ED guard": the Dream's starting round depends on its level (null when the estimate has nothing to go on).
  const levelById: Record<string, StandingLevel | null> = Object.fromEntries(items.map((i) => [i.id, estimates[i.unit_id]?.group ?? null]));
  const rounds = autoRounds(roundItems, bySchool, levelById);
  const roundById = new Map<string, AutoRound>(rounds.map((r) => [r.id, r]));

  let rows: PlanRowView[] = items.map((item) => {
    const school = schoolOf(item);
    const est = school ? (estimates[item.unit_id] ?? null) : null;
    const standing = est && school ? rowStanding(est, student, school.standing) : null;
    // Groups are Quad's only: a stored `student` group is ignored. Without an estimate yet, a row keeps the group it
    // has (nothing is rewritten until one arrives).
    const groupAuto = true;
    const group: ListCategory = standing ? (standing.fit ?? "unsorted") : school ? item.category : "unsorted";
    const r = roundById.get(item.id)!;
    const locked = isLocked(item);
    // rounds.md "The ED guard" 2: a Dream at High reach never starts in ED/REA; its auto round's `why` already says so.
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

  // levels.md "Within a section": Dream first overall, then the level order, then closest first (closeness 3 =
  // nearest the next level up; null sorts after every closeness), then the student's own order among ties.
  const closenessOf = (r: PlanRowView) => r.estimate?.closeness ?? -1;
  rows.sort(
    (a, b) =>
      Number(b.dream) - Number(a.dream) ||
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      closenessOf(b) - closenessOf(a) ||
      a.item.position - b.item.position,
  );

  // The season (list.md "The row"): the first deadline is within 30 days, or any college is past "considering".
  const firstDeadline = rows.map((r) => r.deadline?.iso).filter((d): d is string => !!d).sort()[0] ?? null;
  const inSeason = (firstDeadline !== null && firstDeadline <= addDays(today, SEASON_WINDOW_DAYS)) || items.some((i) => i.status !== "considering");
  if (inSeason) rows = rows.map((r) => ({ ...r, seasonStatus: STATUS_TO_SEASON[r.item.status] }));

  // Conflicts among the rounds that still bind (rounds.md "Problems").
  const active = rows.filter((r) => isActive(r.item));
  const names = Object.fromEntries(items.map((i) => [i.id, schoolOf(i)?.name ?? "A college"]));
  const activeRounds = rounds.filter((r) => active.some((a) => a.item.id === r.id));
  const problems = [...roundProblems(activeRounds, bySchool, names), ...amberProblems(active)];

  // A retake can still move a college that hasn't decided (scores.md "When to suggest another test").
  const retake = student.test
    ? levelRetakeFromMoves(
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
  // list-shape.md "The shape": the same affordability and gaps the shape_gap/shape_cost move reads, so the
  // Colleges tab's notice never disagrees with it.
  const affordability = affordabilityFor(items, schools, profile, estimates);
  const balanceLine = balanceLineFor(groups, season, affordability, dreamAtHighReach(items, estimates));
  const present: Record<PlanNotice, boolean> = {
    problems: problems.length > 0,
    balance: balanceLine !== null,
    retake: retake !== null,
  };
  const notices = NOTICE_ORDER.filter((n) => present[n]).slice(0, MAX_NOTICES);

  return {
    student,
    rows,
    balance: balanceLevels(groups.map((g) => (g === "unsorted" ? null : g))),
    balanceLine,
    problems,
    retake,
    estimates,
    next,
    inSeason,
    notices,
  };
}

/**
 * What a sync writes (store-plan.ts syncAuto): a row's group when it differs from the model's or is still stored as the
 * student's pick (the write sets `category_source` back to `auto`), and a row's `auto` round when it differs from the
 * starting round. Never a `student` round, never the round of an applied or decided college, never a college that's
 * no longer in the dataset (nothing to judge it by), never a group without an estimate behind it, and never a round
 * the college's record rules out.
 */
export function autoWrites(view: PlanView): { id: string; category?: ListCategory; round?: ListRound }[] {
  const out: { id: string; category?: ListCategory; round?: ListRound }[] = [];
  for (const r of view.rows) {
    if (!r.school) continue;
    const w: { id: string; category?: ListCategory; round?: ListRound } = { id: r.item.id };
    if (r.standing && (r.item.category !== r.group || r.item.category_source === "student")) w.category = r.group;
    if (r.item.round_source === "auto" && r.roundAuto && !isLocked(r.item) && r.item.round !== r.round && isOffered(r.school, r.round) !== false) w.round = r.round;
    if (w.category !== undefined || w.round !== undefined) out.push(w);
  }
  return out;
}
