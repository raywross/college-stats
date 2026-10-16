/**
 * The playbook (specs/planner/next-steps/seasons.md "The playbook"; build-plan.md "The playbook"): the moves a season
 * holds that aren't built tasks already, the "How this season works" explainer per season, and the titles and whys of
 * the rule units' moves (MOVE_TEXT). Every word a move card shows comes from here, and
 * tests/planner-moves-catalog.test.mts fails on a percentage, a multiple, "odds", "chance", a probability "likely",
 * or a bare number (dates and the list-size ranges are allowed).
 *
 * Built tasks are moves already and are not listed (review note 1): the cycle file's entries (`ask_recommenders`,
 * `personal_essay_draft`, `common_app_opens`, `fafsa_opens`, `css_profile_opens`, `choose_courses_*` when the cycle
 * has one, `final_transcript` …), test dates the student picked, and the college, apply, offers, and rounds generators'
 * rows. Moves another part owns (the list's shape, ED, interest) are the rule modules' (lib/planner/{list-shape,
 * ed-opportunities,interest}.ts), with their words in MOVE_TEXT.
 *
 * Wording: a why is a fact or an advisor placement ("Advisors place this in junior spring"), never "you should".
 * A title may hold `{target}` (plan v3 review note 8): `playbookTask` fills it from the profile, and skips the entry
 * when it can't.
 * Pure; safe in server code, client components, and tests.
 */
import { SECTION_STEP, sectionDone, PROFILE_SECTIONS, SECTION_MOVE_TITLE, firstMissingSection } from "./profile-progress.ts";
import { listGapTitle, LIST_SHAPE } from "./list-shape.ts";
import type { MoveApplies } from "./generators/season.ts";
import type { Season } from "./seasons.ts";
import type { Assignee, MoveAction, PlanItem, PlanSchool, TaskKind } from "./types.ts";
import type { StudentProfileData } from "../student-profile.ts";
import type { StandingLevel } from "../chances/types.ts";

/** What an entry's action reads: the plan's student (for the Numbers page), its colleges, and the profile. */
export interface PlaybookActionInput {
  studentId: string | null;
  items: readonly Pick<PlanItem, "id" | "unit_id" | "withdrawn_on" | "position">[];
  schools: Record<string, Pick<PlanSchool, "links" | "distanceMiles">>;
  profile: StudentProfileData | null;
  /** The list's counts by level (shape_gap's `levelCounts`), null while nothing has an estimate yet
   *  (`build_list`/`long_list`'s `titleFor`, plan-v3-fix-cards). */
  counts: Record<StandingLevel, number> | null;
}

/** A dated entry's window: a start and end, or one due date (ISO). */
export type PlaybookWindow = { start: string; end: string } | { due: string };

export interface PlaybookEntry {
  /** The task key's suffix (`{list}:playbook:{key}`); unique. An entry repeated in several seasons carries the season in its key. */
  key: string;
  season: Season;
  title: string;
  why: string;
  who: Assignee;
  /** Still generated in later seasons while it applies (seasons.md "What a late joiner sees"). */
  carries: boolean;
  applies: MoveApplies;
  action: (ctx: PlaybookActionInput) => MoveAction | null;
  /** The entry's title computed from the plan, preferred over the static `title` (plan-v3-fix-cards, 2026-10-16); a
   *  null result falls back to the static title (run through `fillTitle`), so the task key stays stable either way. */
  titleFor?: (ctx: PlaybookActionInput) => string | null;
  /** Dated entries only: the window from the entry's own season's bounds (ISO, inclusive). */
  window?: (bounds: { start: string; end: string }) => PlaybookWindow | null;
  source: "advisors" | "profile" | "list" | "depth" | "story" | "shape" | "ed" | "interest";
  /**
   * Additions beyond the brief (U1): the task kind when it isn't `playbook` (the story move is kind `story`, so U7's
   * card renders it); a cycle-file key prefix whose entry, when the student's cycle has one inside this entry's window,
   * is the move instead (the course choice); and an earlier entry this one replaces when both apply.
   */
  kind?: TaskKind;
  builtBy?: string;
  replaces?: string;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const NUMBERS = (ctx: PlaybookActionInput): MoveAction => (ctx.studentId ? { kind: "href", href: `/household/${ctx.studentId}/record` } : { kind: "open_intake", step: 0 });
const COLLEGES: MoveAction = { kind: "open_tab", tab: "colleges" };
const TICK: MoveAction = { kind: "tick" };
const PSAT_PAGE: MoveAction = { kind: "href", href: "https://satsuite.collegeboard.org/psat-nmsqt" };
const FSA_ID_PAGE: MoveAction = { kind: "href", href: "https://studentaid.gov/fsa-id/create-account/launch" };

/** The intake step of the first missing profile section (every section is a tour step now; record.ts). */
function firstMissingStep(ctx: PlaybookActionInput): MoveAction {
  const p = ctx.profile;
  const missing = p ? PROFILE_SECTIONS.find((s) => !sectionDone(p, s)) : "high_school";
  const step = missing ? SECTION_STEP[missing] : 0;
  return { kind: "open_intake", step };
}

const open = (ctx: PlaybookActionInput) => ctx.items.filter((i) => !i.withdrawn_on).sort((a, b) => a.position - b.position);

/** The visit page of the nearest listed college that has one, else Explore. */
function nearestVisit(ctx: PlaybookActionInput): MoveAction {
  const withPage = open(ctx)
    .map((i) => ctx.schools[i.unit_id])
    .filter((s): s is Pick<PlanSchool, "links" | "distanceMiles"> => Boolean(s?.links?.visit))
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
  const href = withPage[0]?.links?.visit;
  return href ? { kind: "href", href } : { kind: "href", href: "/explore" };
}

/** The first listed college's net price calculator, else the Colleges tab. */
function firstCalculator(ctx: PlaybookActionInput): MoveAction {
  const href = open(ctx).map((i) => ctx.schools[i.unit_id]?.links?.price_calculator).find(Boolean);
  return href ? { kind: "href", href } : COLLEGES;
}

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

const yearOf = (iso: string) => Number(iso.slice(0, 4));
/** October of the season's first calendar year (the PSAT). */
const OCTOBER = (b: { start: string }): PlaybookWindow => ({ start: `${yearOf(b.start)}-10-01`, end: `${yearOf(b.start)}-10-31` });
/** February to April of the season's spring (the course choice; the cycle file's `choose_courses_*` window). */
const COURSE_CHOICE = (b: { end: string }): PlaybookWindow => ({ start: `${yearOf(b.end)}-02-01`, end: `${yearOf(b.end)}-04-30` });
/** The whole season. */
const SEASON_LONG = (b: { start: string; end: string }): PlaybookWindow => ({ start: b.start, end: b.end });

/* ------------------------------------------------------------------ */
/* The playbook                                                        */
/* ------------------------------------------------------------------ */

function earlyYears(season: "freshman" | "sophomore"): PlaybookEntry[] {
  return [
    {
      key: `${season}_psat_practice`,
      season,
      title: "PSAT in October, for practice this year",
      why: "A practice run on the real format. Only the junior-year PSAT counts toward National Merit.",
      who: "student",
      carries: false,
      // Plan v3 (now.md "Timing rules"): no practice test for a student with a real score.
      applies: "no_real_score",
      action: () => PSAT_PAGE,
      window: OCTOBER,
      source: "advisors",
    },
    {
      key: `${season}_choose_courses`,
      season,
      title: "Plan next year's courses",
      why: "Colleges read the courses as closely as the grades. Schools ask for next year's choices in late winter.",
      who: "student",
      carries: false,
      applies: "always",
      action: () => TICK,
      window: COURSE_CHOICE,
      source: "advisors",
      builtBy: "choose_courses",
    },
    {
      key: `${season}_visit_travel`,
      season,
      title: "Visit a campus when you travel; any campus",
      why: "Walking one campus, any campus, shows what big, small, city, and rural feel like before there's a list.",
      who: "either",
      carries: false,
      applies: "always",
      action: nearestVisit,
      source: "advisors",
    },
  ];
}

/**
 * "Work toward your {target}" (plan v3 review note 8; guides/test-prep.md): one entry per season from junior fall to
 * senior fall, so each season's skip is its own. Only below the student's own target; the test guide is the button.
 */
function reachScore(season: "junior_fall" | "junior_winter" | "junior_spring" | "summer_before_senior" | "senior_fall"): PlaybookEntry[] {
  return [
    {
      key: `reach_score_${season}`,
      season,
      title: "Work toward your {target}",
      why: "Your target is your own. The dates below are the ones whose scores would arrive in time.",
      who: "student",
      carries: false,
      applies: "below_target",
      action: () => null,
      source: "advisors",
    },
  ];
}

export const PLAYBOOK: readonly PlaybookEntry[] = [
  // A plan with no class year has one move (seasons.md "The season").
  {
    key: "class_year",
    season: "unknown",
    title: "Add your class year",
    why: "The plan follows the school calendar, so it needs to know when you graduate.",
    who: "student",
    carries: false,
    applies: "always",
    action: () => ({ kind: "open_intake", step: 0 }),
    source: "profile",
  },
  // Freshman and sophomore: few moves, none dated except the PSAT and the course choice.
  {
    key: "profile",
    season: "freshman",
    title: "Fill in your numbers and courses",
    why: "Every college's level on your list reads from them. A few minutes now, updated each term.",
    who: "student",
    carries: true,
    applies: "profile_incomplete",
    action: firstMissingStep,
    // Plan v3 fix (2026-10-16, owner: "it should say what's needed, like 'add APs'"): the first missing section's
    // own words, in PROFILE_SECTIONS' order; "Add your class standing" once the GPA is already in.
    titleFor: (ctx) => {
      const section = firstMissingSection(ctx.profile);
      if (section === null) return null;
      if (section === "grades" && ctx.profile?.academics.gpa != null) return "Add your class standing";
      return SECTION_MOVE_TITLE[section];
    },
    source: "profile",
  },
  {
    key: "activities",
    season: "freshman",
    title: "Add the activities you've started; pick one or two to go deeper in",
    why: "Colleges look for depth over a long list: a few things done for years, with growing responsibility.",
    who: "student",
    carries: true,
    applies: "profile_missing:clubs",
    action: () => ({ kind: "open_intake", step: SECTION_STEP.clubs as number }),
    source: "depth",
  },
  ...earlyYears("freshman"),
  {
    key: "long_list",
    season: "freshman",
    title: "Start a long list: places that interest you, no sorting yet",
    why: "A long list is for noticing what you like. Sorting comes in junior year.",
    who: "student",
    carries: true,
    applies: "list_empty",
    action: () => COLLEGES,
    // Plan v3 fix (2026-10-16): names the thinnest level once there's something to judge (list_empty rarely leaves
    // a shortfall, but a late joiner's carried entry might).
    titleFor: (ctx) => listGapTitle(ctx.counts, LIST_SHAPE.senior_fall!),
    source: "list",
  },
  {
    key: "money_talk",
    season: "freshman",
    title: "Talk about what you can pay, privately",
    why: "Advisors suggest the family settles a budget before the list grows, so no one falls for a college the family can't pay for.",
    who: "guardian",
    carries: true,
    applies: "cost_limit_unset",
    action: NUMBERS,
    source: "advisors",
  },
  ...earlyYears("sophomore"),
  // Junior fall (Aug–Dec).
  {
    key: "psat_nmsqt",
    season: "junior_fall",
    title: "PSAT/NMSQT in October",
    why: "The junior-year PSAT is the one that counts toward National Merit, and a practice run for the SAT.",
    who: "student",
    carries: false,
    // Plan v3 review note 9 (overview question 4): dropped too for a student with a real score.
    applies: "no_real_score",
    action: () => PSAT_PAGE,
    window: OCTOBER,
    source: "advisors",
  },
  {
    key: "pick_test",
    season: "junior_fall",
    title: "Pick your test and a first date",
    why: "A first date in the winter or spring of junior year leaves room for a retake before applications.",
    who: "student",
    carries: true,
    applies: "tests_focus_null",
    action: () => ({ kind: "open_intake", step: SECTION_STEP.test as number }),
    source: "advisors",
  },
  {
    key: "build_list",
    season: "junior_fall",
    title: "Build the list toward 15–20 to visit and cut",
    why: "Advisors place a broad list in junior year, trimmed after visits.",
    who: "student",
    carries: true,
    applies: "always",
    action: () => COLLEGES,
    // Plan v3 fix (2026-10-16, owner: "it should say 'add a few reach schools'"): the level with the largest
    // shortfall against the senior shape's minimums; the built title stays with no shortfall or no estimates yet.
    titleFor: (ctx) => listGapTitle(ctx.counts, LIST_SHAPE.senior_fall!),
    source: "shape",
  },
  {
    key: "fall_break_visit",
    season: "junior_fall",
    title: "Visit over fall break",
    why: "Campuses are in session, so a visit shows real classes and students.",
    who: "either",
    carries: false,
    applies: "always",
    action: nearestVisit,
    source: "interest",
  },
  ...reachScore("junior_fall"),
  {
    key: "net_price",
    season: "junior_fall",
    title: "Run the net price calculator at three colleges on the list",
    why: "The price a family pays often differs from the sticker. Advisors place this before the list is final.",
    who: "guardian",
    carries: true,
    applies: "list_nonempty",
    action: firstCalculator,
    source: "advisors",
  },
  // Junior winter (Jan–Feb).
  ...reachScore("junior_winter"),
  {
    key: "register_spring_test",
    season: "junior_winter",
    title: "Register for a spring SAT or ACT",
    why: "Spring dates fill up, and registration closes weeks before each one.",
    who: "student",
    carries: false,
    applies: "test_unplanned",
    action: () => ({ kind: "open_intake", step: SECTION_STEP.test as number }),
    source: "advisors",
  },
  {
    key: "junior_choose_courses",
    season: "junior_winter",
    title: "Choose senior-year courses",
    why: "Colleges see senior-year courses on the application and the mid-year transcript.",
    who: "student",
    carries: false,
    applies: "always",
    action: () => TICK,
    window: COURSE_CHOICE,
    source: "advisors",
    builtBy: "choose_courses",
  },
  {
    key: "walk_away",
    season: "junior_winter",
    title: "Set the family's walk-away number",
    why: "The most a year can cost before a college is off the list. It decides which colleges count as affordable.",
    who: "guardian",
    carries: true,
    applies: "cost_limit_unset",
    action: NUMBERS,
    source: "advisors",
    replaces: "money_talk",
  },
  {
    key: "fsa_ids",
    season: "junior_winter",
    title: "Create your FSA IDs, both of you",
    why: "The FAFSA needs one for the student and one for a parent, and a new ID can take days to confirm.",
    who: "either",
    carries: true,
    applies: "always",
    action: () => FSA_ID_PAGE,
    window: SEASON_LONG,
    source: "advisors",
  },
  {
    key: "summer_program",
    season: "junior_winter",
    title: "Apply to a summer program by its deadline",
    why: "Optional. Many summer programs close their applications in winter.",
    who: "student",
    carries: false,
    applies: "always",
    action: () => null,
    source: "advisors",
  },
  // Junior spring (Mar–May).
  ...reachScore("junior_spring"),
  {
    key: "spring_break_visit",
    season: "junior_spring",
    title: "Visit over spring break",
    why: "Advisors call junior spring the season to visit, while there's time to change the list.",
    who: "either",
    carries: false,
    applies: "always",
    action: nearestVisit,
    source: "interest",
  },
  {
    key: "brag_sheet",
    season: "junior_spring",
    title: "Fill in the counselor's brag sheet; your story helps",
    why: "The counselor's letter draws on it. Your story already answers most of its questions.",
    who: "student",
    carries: true,
    applies: "always",
    action: () => ({ kind: "story" }),
    source: "story",
  },
  // Summer before senior year (Jun–Jul).
  ...reachScore("summer_before_senior"),
  {
    // R1b (specs/planner/record/ranking.md "Timing rules moved here"): moved from junior fall; the owner, 2026-10-16,
    // "it probably doesn't need to be filled out until the summer before senior year."
    key: "story",
    season: "summer_before_senior",
    title: "Write your story",
    why: "One page in your own words. The counselor's questionnaire and the essay both start from it.",
    who: "student",
    carries: true,
    applies: "story_missing",
    action: () => ({ kind: "story" }),
    source: "story",
    kind: "story",
  },
  {
    // R1b (ranking.md "Timing rules moved here"): moved from junior spring; same owner note as `story` above.
    key: "pick_recommenders",
    season: "summer_before_senior",
    title: "Pick your recommenders",
    why: "Junior-year teachers in core subjects know your work best. Advisors say ask before summer, while they remember it.",
    who: "student",
    carries: true,
    applies: "recommenders_open",
    // The recommenders guide is the button (lib/planner/guides.ts).
    action: () => null,
    source: "advisors",
  },
  {
    key: "list_cost",
    season: "summer_before_senior",
    title: "Review the list's cost together",
    why: "Before applications, every college on the list is one the family could pay for.",
    who: "guardian",
    carries: true,
    applies: "list_nonempty",
    action: firstCalculator,
    source: "advisors",
  },
  // Senior fall (Aug–Dec).
  ...reachScore("senior_fall"),
  {
    key: "review_before_submit",
    season: "senior_fall",
    title: "Review before they submit; don't write",
    why: "Advisors suggest a parent reads for typos and missing pieces. The words stay the student's.",
    who: "guardian",
    carries: false,
    applies: "list_nonempty",
    action: () => TICK,
    source: "advisors",
  },
  // Senior winter (Jan–Feb).
  {
    key: "mid_year_transcript",
    season: "senior_winter",
    title: "Ask for the mid-year transcript",
    why: "Most colleges ask the counselor for first-semester senior grades.",
    who: "student",
    carries: false,
    applies: "list_nonempty",
    action: () => TICK,
    source: "advisors",
  },
  // Senior spring (Mar–May).
  {
    key: "keep_grades",
    season: "senior_spring",
    title: "Keep the grades up (offers can be withdrawn)",
    why: "Every offer depends on the final transcript.",
    who: "student",
    carries: false,
    applies: "always",
    action: () => null,
    source: "advisors",
  },
];

/** The entry a task came from (its key's last part), or null for a task that isn't a playbook row. */
export function playbookEntryFor(key: string | null): PlaybookEntry | null {
  if (!key) return null;
  const m = /:playbook:([a-z0-9_]+)$/.exec(key);
  return m ? (PLAYBOOK.find((e) => e.key === m[1]) ?? null) : null;
}

/* ------------------------------------------------------------------ */
/* How this season works                                               */
/* ------------------------------------------------------------------ */

export const SEASON_EXPLAINER: Record<Season, { lead: string; paragraph: string; next?: string }> = {
  freshman: {
    lead: "This year is for trying things.",
    paragraph:
      "Take the courses that interest you at the level you can do well in, try activities, and keep the ones you like. The plan asks for little now: your numbers, a long list if you want one, and a campus walk when you're nearby anyway.",
  },
  sophomore: {
    lead: "This year is for trying things, and keeping what you like.",
    paragraph:
      "Go deeper in one or two activities, take the PSAT for practice, and plan next year's courses with an eye on what you might study. Nothing here is a deadline yet.",
  },
  junior_fall: {
    lead: "Junior year is when the plan starts.",
    paragraph: "The PSAT/NMSQT in October, a first test date, and a list that grows toward something to visit and cut.",
    next: "Next: junior winter, when you register for a spring test and choose senior-year courses.",
  },
  junior_winter: {
    lead: "A short season of setting things up.",
    paragraph: "Register for a spring test, choose senior-year courses, and set the family's walk-away number so the list can be sorted by what you can pay.",
    next: "Next: junior spring, the season advisors call pivotal.",
  },
  junior_spring: {
    lead: "The season advisors call pivotal.",
    paragraph:
      "Tests, visits, and asking two teachers before summer. The list takes its shape: a few Reaches, some Targets, and Likely colleges you'd be happy at. Early decision opportunities show up on the list from now.",
    next: "Next: the summer before senior year, for the essay and the final list.",
  },
  summer_before_senior: {
    lead: "The summer for the essay and the final list.",
    paragraph:
      "Draft the personal essay, settle the list, decide whether an early round makes sense, and check the list's cost together before applications open. Write your story while there's no deadline.",
    next: "Next: senior fall, when applications go out.",
  },
  senior_fall: {
    lead: "Applications go out.",
    paragraph: "Dated moves lead: each college's deadline in the round you chose, the FAFSA and CSS Profile from October, and showing interest where it counts. A parent reviews; the student writes.",
    next: "Next: senior winter, for early decisions and the regular round.",
  },
  senior_winter: {
    lead: "Early decisions arrive and the regular round goes out.",
    paragraph: "Record each decision as it comes, submit the regular-decision colleges, and ask for the mid-year transcript. Aid deadlines vary by college.",
    next: "Next: senior spring, for decisions and the choice.",
  },
  senior_spring: {
    lead: "Decisions, offers, and the choice.",
    paragraph: "Record each decision, compare the offers side by side, and decide by the reply date. Keep the grades up: every offer depends on the final transcript.",
    next: "Next: the summer after, with the enrolled college's list.",
  },
  summer_after: {
    lead: "The summer list for the college you chose.",
    paragraph: "The final transcript, orientation, housing, health forms, and the parts of the aid offer you'll use.",
  },
  graduated: {
    lead: "On to college.",
    paragraph: "The plan stays here for reference.",
  },
  unknown: {
    lead: "Add your class year to start.",
    paragraph: "The plan follows the school calendar: what to do this season and what's next. It needs to know when you graduate.",
  },
};

/* ------------------------------------------------------------------ */
/* The rule units' moves                                               */
/* ------------------------------------------------------------------ */

/**
 * Titles and whys for the rule units' kinds, keyed by kind or `kind:variant` (`shape_gap:likely_min`). `{college}`,
 * `{edCollege}`, `{date}`, `{counts}`, and `{count}` (U4's unsorted move, a plain number) are filled by the unit
 * that emits the move. U4's `shape_gap:likely_min`/`affordable`/`target_min`/`reach_min` read their why from
 * `countLine` directly rather than this dict's `why` (unused for those four); `over_max`, `total_off`, and
 * `shape_cost` use their `why` here as written, since those three aren't about the list's counts.
 */
export const MOVE_TEXT: Record<string, { title: string; why: string }> = {
  ed_decide: { title: "Decide on ED (due {date})", why: "Early decision is binding. The colleges on your list that offer it are one tap away, each with its own reported numbers and what a binding application would mean there." },
  ed2_decide: { title: "ED II at {college}, if you want it", why: "{edCollege} said no. ED II at {college} is due {date}." },
  visit_ed: { title: "Visit {college} before you decide on a binding round", why: "Early decision is binding, so seeing the campus first matters more than usual." },
  show_interest: { title: "Show {college} you're interested", why: "{college} says applicant interest is {label}." },
  "shape_gap:likely_min": { title: "Add a Likely you'd be happy at", why: "{counts}" },
  "shape_gap:affordable": { title: "Add a Likely within your family's limit", why: "{counts}" },
  "shape_gap:target_min": { title: "Add a Target or two", why: "{counts}" },
  "shape_gap:reach_min": { title: "Add a Reach school", why: "{counts}" },
  "shape_gap:over_max": { title: "Review the list", why: "Several High reaches crowd out colleges you'd get into; which would you drop?" },
  "shape_gap:total_off": { title: "Review the list's size", why: "Common App's own average is about seven applications." },
  "shape_gap:unsorted": { title: "Add your numbers so Quad can sort {count} colleges", why: "Quad sorts a college into a level once it has your numbers." },
  shape_cost: { title: "Check the cost of a Likely or Safe together", why: "A college you'd get into is only a safe choice if the family can pay for it." },
  confirm_complete: { title: "Confirm {college} has everything", why: "Colleges list missing pieces in the applicant portal, often weeks after the application." },
  compare_offers: { title: "Compare your offers", why: "Side by side, the cost after grants is what differs most." },
  decide_by: { title: "Decide by May 1", why: "The national reply date, unless a college published its own." },
  outcome_share: { title: "Tell us where you landed", why: "It helps the next class's estimate. What's shared: the college, the round, the outcome, and your state; never your name." },
  story: { title: "Write your story", why: "One page in your own words. The counselor's questionnaire and the essay both start from it." },
};
