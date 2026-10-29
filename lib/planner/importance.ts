/**
 * Importance ranking (specs/planner/record/ranking.md; build-plan.md review note 9, "R1b Importance ranking"):
 * every open move that passes the season gate (`eligibleNow`, lib/planner/moves.ts) gets a score from 0 to 100,
 * `importance = clamp(base + timing − carried, 0, 100)`. `nowMoves` sorts the eligible set by it (desc) and drops
 * a move whose importance is 0. Importance is never shown or stored: it decides order only.
 *
 * `baseImportance` resolves a task in this order: a few season-varying rules (story, pick/ask recommenders, a course
 * choice inside its window, reach-your-score against the list's deadlines) checked first since they can't live as a
 * flat table entry; then the table (`MOVE_IMPORTANCE`), by the task's kind, then its playbook key (the suffix after
 * `:playbook:`), then its cycle key (`:cycle:`), then a shape-gap variant (`:shape_gap:`), then — for the record's
 * own `profile` playbook entry — the first missing section (`firstMissingSection`, lib/planner/profile-progress.ts).
 * A key not resolved any of those ways gets `DEFAULT_IMPORTANCE`.
 *
 * Pure; safe in client components (no I/O; `daysBetween`/`datesFor` come from the already-client-safe test-guide.ts).
 */
import { firstMissingSection, type ProfileSection } from "./profile-progress.ts";
import type { Cycle } from "./cycle.ts";
import { datesFor, daysBetween, type ListDeadline, type TestKind } from "./test-guide.ts";
import { taskDate } from "./tasks.ts";
import { seasonOfDate, seasonRank, type Season } from "./seasons.ts";
import type { PlanTask } from "./types.ts";
import type { StudentProfileData } from "../student-profile.ts";

/** What `baseImportance`/`importance` read, built the same way everywhere (lib/planner/importance-facts.ts). */
export interface ImportanceFacts {
  season: Season;
  today: string;
  gradYear: number | null;
  profile: StudentProfileData | null;
  cycle: Cycle;
  listDeadlines: readonly ListDeadline[];
}

/** A kind not in the table, and a key not in the table under its kind/key, gets this (ranking.md "The table"). */
export const DEFAULT_IMPORTANCE = 50;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/* ------------------------------------------------------------------ */
/* The table (ranking.md "The table")                                  */
/* ------------------------------------------------------------------ */

/**
 * One entry per row of ranking.md's table, keyed `kind:<TaskKind>` (the move's own kind), `playbook:<key>` (the
 * catalog key after `:playbook:`), `cycle:<key>` (after `:cycle:`), `shape_gap:<variant>` (after `:shape_gap:`), or
 * `profile:<section>` (the record's own entry, resolved by `firstMissingSection`). A row whose base varies by season
 * (story, the recommenders move, a course choice, reach-your-score, the build-list/long-list pair, the major
 * section) is still listed here at its resting value; `baseImportance` overrides it with the season rule below
 * before ever consulting the table for those keys.
 */
export const MOVE_IMPORTANCE: Record<string, number> = {
  // 100 | class_year (no graduation year) | Nothing else works without it | always
  "playbook:class_year": 100,
  // 100 | apply / submit (a college's application in its chosen round), deposit, decide_by | Hard deadlines with consequences | as dated
  "kind:apply": 100,
  "kind:submit": 100,
  "kind:deposit": 100,
  "kind:decide_by": 100,
  // 95 | ed_decide in its window, ed2_decide | A binding choice with a date | summer before senior year, senior fall/winter
  "kind:ed_decide": 95,
  "kind:ed2_decide": 95,
  // 92 | test_register (a picked date's registration deadline) | Missing it loses the test date | as dated
  "kind:test_register": 92,
  // 90 | decision_expected (record the decision), confirm_complete, ed2_conditional, continued_interest, waitlist_accept, waitlist_decide | The application's loose ends | senior winter/spring
  "kind:decision_expected": 90,
  "kind:confirm_complete": 90,
  "kind:ed2_conditional": 90,
  "kind:continued_interest": 90,
  "kind:waitlist_accept": 90,
  "kind:waitlist_decide": 90,
  // 88 | test_day | The day itself | as dated
  "kind:test_day": 88,
  // 85 | compare_offers | The money decision before May 1 | senior spring
  "kind:compare_offers": 85,
  // 85 | the record's grades (profile entry when grades are the missing section) | The estimate reads nothing without a GPA and class year | always
  "profile:grades": 85,
  // 80 | the record's test (score or target, or "not testing") | The estimate's second input | always
  "profile:test": 80,
  // 78 | personal_essay_draft (cycle) | The summer's main work | summer before senior year
  "cycle:personal_essay_draft": 78,
  // 75 | the record's AP courses | Rigor is read from them | always
  "profile:courses": 75,
  // 75 | register_spring_test (junior winter), pick_test (junior fall) | A test date before applications | junior fall/winter
  "playbook:register_spring_test": 75,
  "playbook:pick_test": 75,
  // 75 | shape_gap:likely_min (no Likely or Safe you'd attend) | The list's one must-have | junior spring on
  "shape_gap:likely_min": 75,
  // 75 | recommendation tasks (invite each recommender), supplement, transcript, send_scores, fee, portal_setup, portal_check | Pieces of a dated application | senior fall
  "kind:recommendation": 75,
  "kind:supplement": 75,
  "kind:transcript": 75,
  "kind:send_scores": 75,
  "kind:fee": 75,
  "kind:portal_setup": 75,
  "kind:portal_check": 75,
  // 75 | the record's activities, when the move is the "add the activities you've started" entry rather than the generic profile one
  "playbook:activities": 55,
  // 72 | reach_score (under the target) | The owner's example: study and the next date, while there's time | junior fall → senior fall; 0 once no test date's scores would arrive before the earliest deadline
  "playbook:reach_score_junior_fall": 72,
  "playbook:reach_score_junior_winter": 72,
  "playbook:reach_score_junior_spring": 72,
  "playbook:reach_score_summer_before_senior": 72,
  "playbook:reach_score_senior_fall": 72,
  // 70 | choose_courses (any year's course choice) | Inside its February–April window only | 0 outside the window
  "playbook:freshman_choose_courses": 70,
  "playbook:sophomore_choose_courses": 70,
  "playbook:junior_choose_courses": 70,
  "cycle:choose_courses_2027": 70,
  "cycle:choose_courses_2028": 70,
  // 70 | story | The summer's writing | 0 before summer before senior year; 70 summer before senior year; 65 senior fall
  "playbook:story": 70,
  // 68 | pick_recommenders, ask_recommenders (cycle) | Ask before teachers are swamped | 0 before summer before senior year; 68 summer; 75 senior fall (Common App invitations)
  "playbook:pick_recommenders": 68,
  "cycle:ask_recommenders": 68,
  // 65 | build_list / long_list ("Add a few Reach schools"), shape_gap:target_min | The list takes shape | junior fall on; 55 freshman/sophomore
  "playbook:build_list": 65,
  "playbook:long_list": 65,
  "shape_gap:target_min": 65,
  // 65 | mid_year_transcript, thank_recommenders | Senior-year housekeeping | senior winter
  "playbook:mid_year_transcript": 65,
  "cycle:thank_recommenders": 65,
  // 60 | visit_ed (visit an ED candidate) | Binding decisions deserve a visit | junior fall on
  "kind:visit_ed": 60,
  // 60 | the record's high school | Unlocks the school's own data | always
  "profile:high_school": 60,
  // 58 | shape_gap:reach_min ("Add a Reach school") | Room for ambition | senior fall on
  "shape_gap:reach_min": 58,
  // 55 | show_interest where the college says interest is important or very important | A fact the college states | junior fall on
  // (R1b simplification, noted in the "As built" section: the generator doesn't carry the important/considered
  // distinction onto the task, so every show_interest move reads 55 here.)
  "kind:show_interest": 55,
  // 55 | spring_break_visit, fall_break_visit | Advisors' visiting seasons | their season
  "playbook:spring_break_visit": 55,
  "playbook:fall_break_visit": 55,
  // 55 | the record's activities (clubs, sports, work, other) | Depth is read from them | always
  "profile:clubs": 55,
  "profile:sports": 55,
  "profile:work": 55,
  "profile:other": 55,
  // 52 | psat_nmsqt (junior October) | The one that counts for National Merit | junior fall; 40 for the practice years
  "playbook:psat_nmsqt": 52,
  "playbook:freshman_psat_practice": 40,
  "playbook:sophomore_psat_practice": 40,
  // 50 | the record's major | Unlocks "like your list" and majors and earnings | always; 60 from junior spring
  "profile:major": 50,
  // 50 | brag_sheet | Feeds the counselor's letter | junior spring
  "playbook:brag_sheet": 50,
  // 45 | shape_gap:over_max ("Review the list"), shape_gap:total_off | Informational | senior
  "shape_gap:over_max": 45,
  "shape_gap:total_off": 45,
  // 45 | the record's connections, basics, where you'd go | Useful, not urgent | always
  "profile:connections": 45,
  // R1a's record sections (lib/planner/profile-progress.ts): `state` folded into `basics`; `where` is the preferences
  // step. The story and recommenders sections have their own moves and are skipped by firstMissingSection
  // (LATER_SECTIONS); 0 here keeps a stray profile move for them off Now.
  "profile:basics": 45,
  "profile:where": 45,
  "profile:story": 0,
  "profile:recommenders": 0,
  // 40 | outcome_share | A favor to the next class | senior spring
  "kind:outcome_share": 40,
  // 40 | visit_travel (early years) | A walk on any campus | freshman/sophomore
  "playbook:freshman_visit_travel": 40,
  "playbook:sophomore_visit_travel": 40,
  // 35 | summer_program | Optional | junior winter
  "playbook:summer_program": 35,
  // 30 | review_before_submit (a parent's) | The parent's lane | senior fall
  "playbook:review_before_submit": 30,
  // 20 | keep_grades | Informational | senior spring
  "playbook:keep_grades": 20,
  // 0 | the financial moves (aid_forms, cost_check, shape_cost, money_talk, net_price, walk_away, fsa_ids, list_cost, FAFSA/CSS) | Hidden for now (owner, 2026-10-15)
  "kind:aid_forms": 0,
  "kind:cost_check": 0,
  "kind:shape_cost": 0,
  "playbook:money_talk": 0,
  "playbook:net_price": 0,
  "playbook:walk_away": 0,
  "playbook:fsa_ids": 0,
  "playbook:list_cost": 0,
  "cycle:fafsa_opens": 0,
  "cycle:css_profile_opens": 0,
  "cycle:accept_aid": 0,
  "shape_gap:affordable": 0,
  // 0 | follow, request_info, write_visit_notes (the old per-college to-dos) | Not moves
  "kind:follow": 0,
  "kind:request_info": 0,
  "kind:write_visit_notes": 0,
};

/* ------------------------------------------------------------------ */
/* Season-varying rules (ranking.md "Timing rules moved here")         */
/* ------------------------------------------------------------------ */

/** Your story: 0 before `summer_before_senior`, 70 there, 65 senior fall (it carries; elsewhere, 0). */
function storyImportance(season: Season): number {
  if (season === "summer_before_senior") return 70;
  if (season === "senior_fall") return 65;
  return 0;
}

/** Pick/ask your recommenders: the same shape as the story's. */
function recommendersImportance(season: Season): number {
  if (season === "summer_before_senior") return 68;
  if (season === "senior_fall") return 75;
  return 0;
}

/** A course choice: 70 inside its own window (the task's window_start/window_end around today), else 0. */
function chooseCoursesImportance(task: Pick<PlanTask, "window_start" | "window_end" | "due_on">, today: string): number {
  if (task.window_start && task.window_end) return task.window_start <= today && today <= task.window_end ? 70 : 0;
  return 0;
}

/**
 * Reach your score: 72 while at least one remaining test date's scores would arrive before the earliest deadline
 * still on the list (`datesFor` returns something); 0 once none would (a senior told to study for a test that can't
 * count). Without a focus test or without deadlines to check against, `datesFor` can't run — 72 (the move is only
 * generated at all when the student is below a real target, which means a real focus test).
 */
function reachScoreImportance(facts: ImportanceFacts): number {
  const test = facts.profile?.tests.focus ?? null;
  if (test !== "sat" && test !== "act") return 72;
  const dates = datesFor(test as TestKind, facts.cycle, facts.season, facts.today, facts.listDeadlines);
  return dates.length > 0 ? 72 : 0;
}

/** Build/long list: 65 from junior fall on, 55 in freshman/sophomore (ranking.md's row covers both keys). */
function buildListImportance(season: Season): number {
  return seasonRank(season) >= seasonRank("junior_fall") ? 65 : 55;
}

/** The record's major: 50, 60 from junior spring on (ranking.md's row). */
function majorImportance(season: Season): number {
  return seasonRank(season) >= seasonRank("junior_spring") ? 60 : 50;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

function suffixAfter(key: string | null, scope: "playbook" | "cycle" | "shape_gap"): string | null {
  if (!key) return null;
  const m = new RegExp(`:${scope}:([a-z0-9_]+)$`).exec(key);
  return m ? m[1] : null;
}

/** The subset of a profile-section row's facts `baseImportance` needs, read through `firstMissingSection`. */
function profileSectionImportance(section: ProfileSection, season: Season): number {
  if (section === "major") return majorImportance(season);
  return MOVE_IMPORTANCE[`profile:${section}`] ?? DEFAULT_IMPORTANCE;
}

export type ImportanceTask = Pick<PlanTask, "kind" | "key" | "season" | "window_start" | "window_end" | "due_on"> & Partial<Pick<PlanTask, "source">>;

/**
 * The pieces of an application (the college generator's rows per listed college): dated ones follow the season gate,
 * undated ones ("Ask the high school to send transcripts", "Pay the application fee") belong to senior fall and are
 * 0 before it (owner, 2026-10-16: a junior saw both; "she wouldn't apply until the fall of her senior year").
 */
const APPLICATION_KINDS: ReadonlySet<PlanTask["kind"]> = new Set([
  "apply", "submit", "fee", "send_scores", "transcript", "recommendation", "supplement", "portal_setup", "portal_check",
  "confirm_complete", "decision_expected", "continued_interest", "waitlist_accept", "waitlist_deposit_elsewhere", "ed2_conditional",
  "reply_by", "housing_deposit", "deposit", "withdraw", "waitlist_decide", "add_offer", "decide_by", "compare_offers", "outcome_share",
]);
const SENIOR_FALL_RANK = seasonRank("senior_fall");

/** A piece of an application: one of the college generator's kinds, or any row the college generator wrote. */
export function isApplicationPiece(task: Pick<ImportanceTask, "kind" | "source">): boolean {
  return APPLICATION_KINDS.has(task.kind) || task.source === "college";
}

/** Whether a season comes before senior fall, when applications begin ("unknown" doesn't: no class year, no gate). */
export function beforeSeniorFall(season: Season): boolean {
  return season !== "unknown" && seasonRank(season) < SENIOR_FALL_RANK;
}

/** Whether an undated application piece is showing before its time (senior fall). */
export function beforeApplications(task: ImportanceTask, season: Season): boolean {
  return isApplicationPiece(task) && taskDate(task) === null && beforeSeniorFall(season);
}

/**
 * The move's base importance (ranking.md "The rule"), before timing and carry: the season-varying rules first (they
 * can't live as one table number), then the table by kind, playbook key, cycle key, shape-gap variant, or — for the
 * record's own `profile` entry — the first missing section. `DEFAULT_IMPORTANCE` otherwise.
 */
export function baseImportance(task: ImportanceTask, facts: ImportanceFacts): number {
  const playbookKey = suffixAfter(task.key, "playbook");
  const cycleKey = suffixAfter(task.key, "cycle");
  const shapeGapKey = suffixAfter(task.key, "shape_gap");

  if (beforeApplications(task, facts.season)) return 0;
  if (task.kind === "story" || playbookKey === "story") return storyImportance(facts.season);
  if (playbookKey === "pick_recommenders" || cycleKey === "ask_recommenders") return recommendersImportance(facts.season);
  if (playbookKey === "freshman_choose_courses" || playbookKey === "sophomore_choose_courses" || playbookKey === "junior_choose_courses" || (cycleKey !== null && cycleKey.startsWith("choose_courses"))) {
    return chooseCoursesImportance(task, facts.today);
  }
  if (playbookKey !== null && playbookKey.startsWith("reach_score_")) return reachScoreImportance(facts);
  if (playbookKey === "build_list" || playbookKey === "long_list") return buildListImportance(facts.season);
  if (playbookKey === "profile") {
    const section = firstMissingSection(facts.profile);
    return section === null ? DEFAULT_IMPORTANCE : profileSectionImportance(section, facts.season);
  }

  const kindKey = `kind:${task.kind}`;
  if (kindKey in MOVE_IMPORTANCE) return MOVE_IMPORTANCE[kindKey];
  if (playbookKey !== null && `playbook:${playbookKey}` in MOVE_IMPORTANCE) return MOVE_IMPORTANCE[`playbook:${playbookKey}`];
  if (cycleKey !== null && `cycle:${cycleKey}` in MOVE_IMPORTANCE) return MOVE_IMPORTANCE[`cycle:${cycleKey}`];
  if (shapeGapKey !== null && `shape_gap:${shapeGapKey}` in MOVE_IMPORTANCE) return MOVE_IMPORTANCE[`shape_gap:${shapeGapKey}`];
  return DEFAULT_IMPORTANCE;
}

/** A dated move's urgency (ranking.md "The rule"): overdue +30; ≤7 days +20; ≤14 +10; ≤30 +5; later or undated 0. */
export function timingBoost(task: Pick<PlanTask, "due_on" | "window_start" | "window_end">, today: string): number {
  const d = taskDate(task);
  if (d === null) return 0;
  const days = daysBetween(today, d);
  if (days < 0) return 30;
  if (days <= 7) return 20;
  if (days <= 14) return 10;
  if (days <= 30) return 5;
  return 0;
}

/** A move's season, the way `lib/planner/moves.ts`' `taskSeason` reads it, without importing that module (its own
 *  season, else the season its date falls in, else the current one): kept local so `moves.ts` can import this module
 *  without a cycle. */
function moveSeasonOf(task: Pick<PlanTask, "season" | "due_on" | "window_start" | "window_end">, gradYear: number | null, current: Season): Season {
  if (task.season) return task.season;
  const d = task.due_on ?? task.window_start;
  if (d && gradYear !== null) return seasonOfDate(d, gradYear);
  return current;
}

/** importance = clamp(base + timing − carried, 0, 100) (ranking.md "The rule"); carried is −10 when the move's own season is earlier than the current one. */
export function importance(task: ImportanceTask, facts: ImportanceFacts): number {
  const base = baseImportance(task, facts);
  const timing = timingBoost(task, facts.today);
  const season = moveSeasonOf(task, facts.gradYear, facts.season);
  const carried = seasonRank(season) < seasonRank(facts.season) ? 10 : 0;
  return clamp(base + timing - carried, 0, 100);
}

/** Now's order (ranking.md "The rule"): importance desc; dated before undated; the catalog's position; then title. */
export function compareByImportance(a: PlanTask, b: PlanTask, facts: ImportanceFacts): number {
  const ia = importance(a, facts);
  const ib = importance(b, facts);
  if (ia !== ib) return ib - ia;
  const da = taskDate(a);
  const db = taskDate(b);
  if ((da === null) !== (db === null)) return da === null ? 1 : -1;
  if (a.position !== b.position) return a.position - b.position;
  return a.title.localeCompare(b.title);
}
