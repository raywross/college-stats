/**
 * Product analytics: the event registry and `track()` (specs/product/telemetry.md).
 *
 * App code never talks to PostHog. It calls `track(event, properties)` with a registered event; this module checks
 * the name against the registry, keeps only the registered properties, and hands the event to the sink that
 * components/analytics/AnalyticsProvider.tsx installs once posthog-js has loaded. Without a sink (no key, Global
 * Privacy Control or Do Not Track, the server, tests) every call is a no-op. Server events go through
 * lib/analytics-server.ts, which uses `sanitizeProperties()` from here.
 *
 * Pure module (type-only imports, no PostHog, no React), so it runs under `node --test` and anywhere in the app.
 */
import type { ExploreView } from "./types";
import type { TopicKey } from "./profile-topics";
import type { StandingLabel, StandingLevel } from "./chances/types";
import type { Season } from "./planner/seasons";
import type { ShapeGapKind } from "./planner/list-shape";
import type { VisitEventKind } from "./visit-events/types";
import type { GuideFrom, GuideSlug } from "./planner/guides";

/** How someone reached a college's page (`school_viewed.from`; see the spec's "Attribution of a school view"). */
export type NavigationSource = "search" | "explore" | "compare" | "home" | "similar" | "direct" | "other";
/** Coarse result counts: the search box reports these, never the query or the exact count. */
export type ResultCountBucket = "0" | "1" | "2-5" | "6+";

type RoleHint = "student" | "guardian" | "counselor" | "none";
type SignupMethod = "magic_link" | "password";

/** Every event the site may send and its exact properties. Values: string | number | boolean only. */
export interface AnalyticsEvents {
  search_performed: { source: "hero" | "header" | "tabbar"; result_count: ResultCountBucket; picked: boolean };
  explore_filtered: { filter: string; view: ExploreView; active_filter_count: number };
  explore_view_changed: { view: ExploreView };
  school_viewed: { unit_id: string; from: NavigationSource };
  profile_card_opened: { unit_id: string; topic: TopicKey; from: "card" | "pill" | "anchor" };
  profile_block_viewed: { unit_id: string; topic: TopicKey; block: string };
  score_checked: { test: "sat" | "act"; in_range: boolean };
  citation_opened: { field: string };
  term_opened: { term: string };
  compare_changed: { action: "add" | "remove" | "clear"; count: number };
  compare_viewed: { count: number; preset: boolean };
  /** Compare's "Your major": `field` is the public 2-digit CIP family picked, never a student's own major. */
  major_compared: { field: string; count: number };
  trend_group_opened: { unit_id: string; group: string };
  roadmap_viewed: { slug: string };
  signup_started: { method: SignupMethod; role_hint: RoleHint; has_invite: boolean };
  signup_completed: { method: SignupMethod; role_hint: RoleHint; has_invite: boolean };
  error_shown: { route: string; kind: "error" | "not_found" };
  /* The planner (specs/planner/model.md "Telemetry"): that a stage was used and which college, never a title, a
   * date, a phone number, a count, or a note. */
  /** The redesign (specs/planner/redesign/*.md "Telemetry"): which tab, whose view, and whether it's Everyone. */
  plan_opened: { tab: "next" | "colleges" | "calendar" | "offers"; viewer: "student" | "guardian"; everyone: boolean };
  plan_task_ticked: { kind: string; source: "college" | "cycle" | "stage" | "own" | "season"; assignee: "student" | "guardian" | "either" };
  plan_stage_done: { stage: number };
  plan_nudge_sent: { channel: "email" | "sms" | "app" };
  /** A text consent recorded; `by_guardian` when a guardian turned it on for a student. */
  plan_text_consented: { by_guardian: boolean };
  /** Texts turned off: a provider STOP reply or the account switch. */
  plan_text_opted_out: { via: "stop" | "account" };
  plan_rounds_accepted: { ed: boolean; ed2: boolean };
  plan_offer_added: { unit_id: string };
  plan_choice_made: { unit_id: string };
  /* The planner redesign (specs/planner/redesign/{page,standing,list,rounds,scores,calendar}.md "Telemetry"): which
   * parts get used, never a score, a GPA, a name, or a date. */
  plan_tab: { tab: "next" | "colleges" | "calendar" | "offers" };
  plan_switch_child: { to: "child" | "everyone" };
  plan_signed_out_started: { from: "numbers" | "college" };
  plan_signed_out_saved: { has_numbers: boolean };
  /** `test` is which test the plan uses (sat, act, none), never the score. */
  plan_numbers_set: { test: "sat" | "act" | "none"; practice: boolean };
  /** The intake guide (specs/planner/redesign/intake.md): which step was completed, never the values entered. */
  /** Your record (specs/planner/record/build-plan.md): steps 0–12 and 13 (Review, the save). */
  plan_intake_step: { step: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13; mode: "first" | "edit" };
  plan_group_changed: { from_auto: boolean };
  plan_dream_set: { on: boolean };
  plan_round_changed: { from_auto: boolean; round: "ed" | "ed2" | "ea" | "rea" | "rd" | "rolling" };
  plan_college_removed: { dream: boolean };
  plan_round_problem_shown: { kind: string };
  plan_calendar_opened: { everyone: boolean; color_by: "child" | "round" };
  plan_calendar_feed_added: { everyone: boolean };
  plan_calendar_printed: { everyone: boolean };
  /* The course plan (specs/chances/course-plan.md "Rules"): which reasons were shown, never a course name, a grade, or a score. */
  course_plan_shown: { reasons: string; guardrail: string };
  course_plan_added: { reason: string };
  course_plan_dismissed: { reason: string };
  /** An estimate shown to a student (the profile's card, the planner's drawer): the group, the label, the model version; never an input. */
  estimate_shown: { group: StandingLevel | "none"; label: StandingLabel | "none"; model_version: string };
  /* Next steps (specs/planner/next-steps/*.md "Telemetry"; build-plan.md "Telemetry"): kinds, seasons, levels, and
     rule names only; never a college, a score, or a number from the estimate. */
  /* R1b (specs/planner/record/ranking.md "Rules"): rank is the card's 1-based position in Now (null outside the
     ranked set); importance itself is never sent. */
  plan_move_shown: { kind: string; season: Season; rank: number | null };
  plan_move_done: { kind: string; season: Season; by: "student" | "guardian" };
  plan_move_skipped: { kind: string; season: Season };
  plan_season_explainer_opened: { season: Season };
  plan_ed_pill_shown: { round: "ed" | "ed2" | "ed_alt"; level: StandingLevel; rank: number };
  plan_ed_sheet_opened: { round: "ed" | "ed2" | "ed_alt" };
  plan_ed_started: { round: "ed" | "ed2" | "ed_alt" };
  plan_ed_dismissed: { round: "ed" | "ed2" | "ed_alt" };
  plan_interest_move_shown: { rule: "visit_ed" | "important" | "considered"; level: StandingLevel | "none" };
  /** `action`, not the brief's `act`: "act" is a denied property token (the ACT). */
  plan_interest_act: { action: string };
  plan_shape_gap_shown: { gap: ShapeGapKind; season: Season };
  plan_applied: { round: "ed" | "ed2" | "ea" | "rea" | "rd" | "rolling" | "none" };
  plan_decision_recorded: { outcome: "admitted" | "denied" | "waitlisted" | "deferred" };
  plan_outcome_shared: { yes: boolean };
  story_filled: { length_band: "short" | "medium" | "long" };
  /** Server (U6): one season brief sent. */
  brief_sent: { season: Season; role: "student" | "guardian" };
  /* Plan v3 (specs/planner/v3/build-plan.md "Telemetry"): slugs, kinds, seasons, levels, statuses, and counts; never a
     college on a pill, a teacher's name, a score, a target, or the text of anything typed. "act" is a denied token
     (the ACT), so the act-tracking events carry `action`, as plan_interest_act does. */
  plan_guide_opened: { slug: GuideSlug; from: GuideFrom };
  plan_move_restored: { kind: string; season: Season; by: "student" | "guardian" };
  /** The list guide's Add: the level added at and how alike the college is (points of likeness, never an estimate number). */
  plan_guide_added: { level: StandingLevel; likeness: number };
  plan_guide_shape_explained: { season: Season };
  plan_interest_confirmed: { action: string; via: "prompt" | "email" | "manual" };
  plan_interest_expired: { action: string };
  plan_test_registered: { test: "sat" | "act"; via: "prompt" | "email" | "manual" };
  /** U5 (restored from the deleted Scores tab): "I'll take it" on a test date. */
  plan_test_date_picked: { test: "sat" | "act" };
  plan_courses_added: { count: number };
  plan_recommender_status: { status: "thinking" | "asked" | "agreed" | "invited" };
  recommenders_count: { n: number };
  plan_parent_season_viewed: { season: Season };
  plan_connection_added: { kind: "family" | "recruited" };
  /* Your record (specs/planner/record/build-plan.md "Telemetry"): counts and the viewer, never a major or a value. */
  record_major_picked: { count: number };
  record_overview_opened: { viewer: "student" | "guardian" };
  /** Less text (specs/planner/record/less-text.md): a `WhyFold` opened, by screen and which fold on it. */
  plan_why_opened: { screen: string; section: string };
  /** R6 (specs/planner/record/reading.md "Rules"): the "How Quad reads your record" section shown, once per mount —
   * how many input kinds it's working from and whether it has a "not yet" prompt, never a college or a level. */
  record_reading_shown: { inputs: number; missing: boolean };
  /** R6: the add-college search's level chip shown, once per result set, by level (never the college). */
  plan_add_level_shown: { level: StandingLevel };
  /** R7 (specs/planner/record/explore-levels.md): Explore's "For you" levels changed: how many are picked, never which colleges. */
  explore_for_me: { levels: number };
  /** R7: the list guide's "Show me more" at a level, and whether it was the emphasized one (below the shape's minimum). */
  plan_show_more: { level: StandingLevel; emphasized: boolean };
  /** Server (U4): one interest-confirmation email sent, with how many acts it asks about. */
  interest_confirm_sent: { acts: number };
  /** Visit events (specs/product/visit-events.md "Privacy and telemetry"): which surface and kind filter are viewed, never an address or a distance. */
  visit_events_viewed: { surface: "profile" | "me" | "planner"; kind: VisitEventKind | "all" };
  visit_signup_clicked: { unit_id: string; kind: VisitEventKind; near: boolean };
  visit_alert_muted: { unit_id: string };
  visit_radius_changed: { miles: number };
  /** The nightly visit alert: how many colleges and events, never which or how far. */
  visit_alert_sent: { college_count: number; event_count: number };
}
export type AnalyticsEvent = keyof AnalyticsEvents;
/** Events sent from Server Actions and Route Handlers with `trackServer()` (lib/analytics-server.ts). */
export type ServerAnalyticsEvent = "signup_started" | "signup_completed" | "plan_text_consented" | "plan_text_opted_out" | "brief_sent" | "visit_alert_sent" | "interest_confirm_sent" | "plan_interest_confirmed" | "plan_interest_expired";

type EventSpec<K extends AnalyticsEvent> = {
  properties: readonly (keyof AnalyticsEvents[K] & string)[];
  side: "client" | "server";
  why: string;
};

/**
 * The runtime registry, one entry per event. `satisfies` keeps it in step with `AnalyticsEvents`: a missing event or
 * an unknown property fails the typecheck, and `RegistryComplete` below fails it when a property is left out.
 */
export const EVENTS = {
  search_performed: {
    properties: ["source", "result_count", "picked"],
    side: "client",
    why: "Does search find things",
  },
  explore_filtered: {
    properties: ["filter", "view", "active_filter_count"],
    side: "client",
    why: "Which Explore filters matter",
  },
  explore_view_changed: { properties: ["view"], side: "client", why: "Grid vs table vs chart vs map" },
  school_viewed: { properties: ["unit_id", "from"], side: "client", why: "Which colleges, reached which way" },
  profile_card_opened: {
    properties: ["unit_id", "topic", "from"],
    side: "client",
    why: "Which topic pages get opened from the overview, pills, or old anchors",
  },
  profile_block_viewed: {
    properties: ["unit_id", "topic", "block"],
    side: "client",
    why: "Which blocks of a topic page get read",
  },
  score_checked: { properties: ["test", "in_range"], side: "client", why: "Does the score checker get used" },
  citation_opened: { properties: ["field"], side: "client", why: "Does lineage get read" },
  term_opened: { properties: ["term"], side: "client", why: "Glossary value" },
  compare_changed: { properties: ["action", "count"], side: "client", why: "Compare use" },
  compare_viewed: { properties: ["count", "preset"], side: "client", why: "Compare views, from links or the saved list" },
  major_compared: { properties: ["field", "count"], side: "client", why: "Which fields get compared in Your major" },
  trend_group_opened: { properties: ["unit_id", "group"], side: "client", why: "Which Over-time charts get opened" },
  roadmap_viewed: { properties: ["slug"], side: "client", why: "Interest in planned features" },
  signup_started: { properties: ["method", "role_hint", "has_invite"], side: "server", why: "Accounts: sign-ups begun" },
  signup_completed: {
    properties: ["method", "role_hint", "has_invite"],
    side: "server",
    why: "Accounts: sign-ups confirmed",
  },
  error_shown: { properties: ["route", "kind"], side: "client", why: "Errors people see, by page" },
  plan_opened: { properties: ["tab", "viewer", "everyone"], side: "client", why: "Planner: which tab the plan opens on, for students and parents" },
  plan_task_ticked: { properties: ["kind", "source", "assignee"], side: "client", why: "Planner: which kinds of tasks get done, and by whom" },
  plan_stage_done: { properties: ["stage"], side: "client", why: "Planner: how far families get" },
  plan_nudge_sent: { properties: ["channel"], side: "client", why: "Planner: do parents nudge, and how" },
  plan_text_consented: { properties: ["by_guardian"], side: "server", why: "Planner: text reminders turned on" },
  plan_text_opted_out: { properties: ["via"], side: "server", why: "Planner: text reminders turned off" },
  plan_rounds_accepted: { properties: ["ed", "ed2"], side: "client", why: "Planner: rounds plans accepted, with or without a binding round" },
  plan_offer_added: { properties: ["unit_id"], side: "client", why: "Planner: offers entered, by college" },
  plan_choice_made: { properties: ["unit_id"], side: "client", why: "Planner: the college chosen" },
  plan_tab: { properties: ["tab"], side: "client", why: "Planner: which tabs get opened" },
  plan_switch_child: { properties: ["to"], side: "client", why: "Planner: do parents switch between children" },
  plan_signed_out_started: { properties: ["from"], side: "client", why: "Planner: visitors who start a plan before signing up" },
  plan_signed_out_saved: { properties: ["has_numbers"], side: "client", why: "Planner: signed-out plans saved by signing up" },
  plan_numbers_set: { properties: ["test", "practice"], side: "client", why: "Planner: numbers entered, by test and practice" },
  plan_intake_step: { properties: ["step", "mode"], side: "client", why: "Planner: progress through the intake guide" },
  plan_group_changed: { properties: ["from_auto"], side: "client", why: "Planner: how often a suggested group gets changed" },
  plan_dream_set: { properties: ["on"], side: "client", why: "Planner: Dreams marked" },
  plan_round_changed: { properties: ["from_auto", "round"], side: "client", why: "Planner: which rounds students pick over the starting round" },
  plan_college_removed: { properties: ["dream"], side: "client", why: "Planner: do students prune the list from the plan" },
  plan_round_problem_shown: { properties: ["kind"], side: "client", why: "Planner: which round conflicts come up" },
  plan_calendar_opened: { properties: ["everyone", "color_by"], side: "client", why: "Planner: calendar views, per child or for everyone" },
  plan_calendar_feed_added: { properties: ["everyone"], side: "client", why: "Planner: calendar feeds added" },
  plan_calendar_printed: { properties: ["everyone"], side: "client", why: "Planner: calendars printed" },
  course_plan_shown: { properties: ["reasons", "guardrail"], side: "client", why: "Course plan: which reasons and guardrails the Next year card shows" },
  course_plan_added: { properties: ["reason"], side: "client", why: "Course plan: do suggestions get added, by reason" },
  course_plan_dismissed: { properties: ["reason"], side: "client", why: "Course plan: do suggestions get set aside, by reason" },
  visit_alert_sent: { properties: ["college_count", "event_count"], side: "server", why: "Visit events: alerts sent, by size" },
  estimate_shown: { properties: ["group", "label", "model_version"], side: "client", why: "Quad's estimate: how often it is shown and as which group and label, per model version (never the inputs)" },
  plan_move_shown: { properties: ["kind", "season", "rank"], side: "client", why: "Next steps: which moves families see, by season, and in what order" },
  plan_move_done: { properties: ["kind", "season", "by"], side: "client", why: "Next steps: which moves get done, and by whom" },
  plan_move_skipped: { properties: ["kind", "season"], side: "client", why: "Next steps: which moves get a Not now" },
  plan_season_explainer_opened: { properties: ["season"], side: "client", why: "Next steps: is How this season works read" },
  plan_ed_pill_shown: { properties: ["round", "level", "rank"], side: "client", why: "Next steps: ED opportunity pills shown" },
  plan_ed_sheet_opened: { properties: ["round"], side: "client", why: "Next steps: ED sheets opened" },
  plan_ed_started: { properties: ["round"], side: "client", why: "Next steps: ED opportunities taken" },
  plan_ed_dismissed: { properties: ["round"], side: "client", why: "Next steps: ED opportunities dismissed" },
  plan_interest_move_shown: { properties: ["rule", "level"], side: "client", why: "Next steps: interest moves shown, by rule" },
  plan_interest_act: { properties: ["action"], side: "client", why: "Next steps: which ways of showing interest get used" },
  plan_shape_gap_shown: { properties: ["gap", "season"], side: "client", why: "Next steps: which list-shape gaps come up" },
  plan_applied: { properties: ["round"], side: "client", why: "Next steps: applications marked sent, by round" },
  plan_decision_recorded: { properties: ["outcome"], side: "client", why: "Next steps: decisions recorded" },
  plan_outcome_shared: { properties: ["yes"], side: "client", why: "Next steps: outcome sharing answered" },
  story_filled: { properties: ["length_band"], side: "client", why: "Your story: how long the saved story is, by band (never the text)" },
  brief_sent: { properties: ["season", "role"], side: "server", why: "Next steps: season briefs sent" },
  plan_guide_opened: { properties: ["slug", "from"], side: "client", why: "Plan v3: which guides get opened, and from where" },
  plan_move_restored: { properties: ["kind", "season", "by"], side: "client", why: "Plan v3: skipped moves brought back, and by whom" },
  plan_guide_added: { properties: ["level", "likeness"], side: "client", why: "Plan v3: colleges added from the list guide, by level and likeness" },
  plan_guide_shape_explained: { properties: ["season"], side: "client", why: "Plan v3: is the list guide's shape explainer read" },
  plan_interest_confirmed: { properties: ["action", "via"], side: "server", why: "Plan v3: tracked acts confirmed, by act and how (sent where the answer is written)" },
  plan_interest_expired: { properties: ["action"], side: "server", why: "Plan v3: tracked acts that expired unconfirmed (the morning job)" },
  plan_test_registered: { properties: ["test", "via"], side: "client", why: "Plan v3: test registrations confirmed" },
  plan_test_date_picked: { properties: ["test"], side: "client", why: "Plan v3: test dates picked with \"I'll take it\"" },
  plan_courses_added: { properties: ["count"], side: "client", why: "Plan v3: courses added from the courses guide" },
  plan_recommender_status: { properties: ["status"], side: "client", why: "Plan v3: recommender status changes (never a name)" },
  recommenders_count: { properties: ["n"], side: "client", why: "Plan v3: how many recommenders a student lists" },
  plan_parent_season_viewed: { properties: ["season"], side: "client", why: "Plan v3: parents reading the season's list" },
  plan_connection_added: { properties: ["kind"], side: "client", why: "Plan v3: connections entered, family or recruiting" },
  record_major_picked: { properties: ["count"], side: "client", why: "Your record: how many majors a student picks (never which)" },
  record_overview_opened: { properties: ["viewer"], side: "client", why: "Your record: the overview opened, by students and parents" },
  plan_why_opened: { properties: ["screen", "section"], side: "client", why: "Less text: which folded explanations get opened and read" },
  record_reading_shown: { properties: ["inputs", "missing"], side: "client", why: "R6: how complete the record reads, and whether it has a next input to prompt" },
  plan_add_level_shown: { properties: ["level"], side: "client", why: "R6: level chips shown on the add-college search, by level" },
  explore_for_me: { properties: ["levels"], side: "client", why: "R7: is Explore's For you level filter used, and with how many levels" },
  plan_show_more: { properties: ["level", "emphasized"], side: "client", why: "R7: the list guide's Show me more links, by level and whether it was the emphasized one" },
  interest_confirm_sent: { properties: ["acts"], side: "server", why: "Plan v3: interest-confirmation emails sent, by act count" },
  visit_events_viewed: { properties: ["surface", "kind"], side: "client", why: "Visit events: which surface and kind filter get used" },
  visit_signup_clicked: { properties: ["unit_id", "kind", "near"], side: "client", why: "Visit events: sign-up clicks, by college, kind, and whether it was a near-you event" },
  visit_alert_muted: { properties: ["unit_id"], side: "client", why: "Visit events: per-college alert mutes" },
  visit_radius_changed: { properties: ["miles"], side: "client", why: "Visit events: radius changes" },
} as const satisfies { readonly [K in AnalyticsEvent]: EventSpec<K> };

type AssertTrue<T extends true> = T;
type UnlistedProperties = {
  [K in AnalyticsEvent]: Exclude<keyof AnalyticsEvents[K], (typeof EVENTS)[K]["properties"][number]>;
}[AnalyticsEvent];
/** Compile-time check: every property of every event is listed in `EVENTS` (otherwise `track()` would drop it). */
export type RegistryComplete = AssertTrue<[UnlistedProperties] extends [never] ? true : false>;

/**
 * Tokens a property name may not contain. Names are split on `_`, lowercased, and each token compared whole, so
 * `action` and `in_range` pass while `display_name` and `sat_score` fail (tests/analytics.test.mts).
 */
export const DENIED_PROPERTY_TOKENS: readonly string[] = [
  "gpa", "sat", "act", "score", "scores", "income", "agi", "asset", "assets", "email", "name", "amount", "grade",
  "grades", "address", "zip", "phone", "birth", "age",
];

/** True when a property name carries a denied token (`sat_score`, `display_name`). */
export function isDeniedPropertyName(name: string): boolean {
  return name
    .toLowerCase()
    .split("_")
    .some((token) => DENIED_PROPERTY_TOKENS.includes(token));
}

export function isAnalyticsEvent(name: string): name is AnalyticsEvent {
  return Object.prototype.hasOwnProperty.call(EVENTS, name);
}

type PropertyValue = string | number | boolean;

/**
 * The properties that may be sent for `event`: registered names only, with string, finite number, or boolean
 * values. Null for an unregistered event. Shared by `track()` and `trackServer()`.
 */
export function sanitizeProperties(event: string, properties: object): Record<string, PropertyValue> | null {
  if (!isAnalyticsEvent(event)) return null;
  const allowed: readonly string[] = EVENTS[event].properties;
  const values = properties as Record<string, unknown>;
  const out: Record<string, PropertyValue> = {};
  for (const key of allowed) {
    const value = values[key];
    if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      out[key] = value;
    }
  }
  return out;
}

/** Where events go once posthog-js has loaded (AnalyticsProvider installs it). */
export interface AnalyticsSink {
  capture(event: string, properties: Record<string, string | number | boolean>): void;
  identify(distinctId: string): void;
  reset(): void;
}

let sink: AnalyticsSink | null = null;

export function installAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next;
}

export function hasAnalyticsSink(): boolean {
  return sink !== null;
}

function warn(what: string, error: unknown) {
  if (process.env.NODE_ENV === "development") console.warn(`analytics: ${what} failed`, error);
}

/**
 * Sends a registered event. No-op without a sink; refuses unknown events (returns false); drops properties not in
 * `EVENTS[event].properties`. Never throws. True when the event was handed to the sink.
 */
export function track<K extends AnalyticsEvent>(event: K, properties: AnalyticsEvents[K]): boolean {
  const clean = sanitizeProperties(event, properties);
  if (!clean || !sink) return false;
  try {
    sink.capture(event, clean);
    return true;
  } catch (error) {
    warn(`track(${event})`, error);
    return false;
  }
}

/** Links this visit's events to the signed-in account's opaque id (never an email or name). */
export function identify(distinctId: string): void {
  if (!sink || !distinctId) return;
  try {
    sink.identify(distinctId);
  } catch (error) {
    warn("identify", error);
  }
}

/** Forgets the identified account (on sign-out). */
export function resetIdentity(): void {
  if (!sink) return;
  try {
    sink.reset();
  } catch (error) {
    warn("reset", error);
  }
}

/** A mark older than this is stale (the navigation it announced never happened) and is ignored. */
const VIEW_MARK_TTL_MS = 30_000;
let viewMark: { source: NavigationSource; at: number } | null = null;

/** A component that knows why it navigates marks the source; the provider takes it on the next page view. */
export function markNextViewFrom(source: NavigationSource): void {
  viewMark = { source, at: Date.now() };
}

/** The pending mark, cleared on read; null when none was set or it's stale. */
export function takeNextViewFrom(): NavigationSource | null {
  const mark = viewMark;
  viewMark = null;
  return mark && Date.now() - mark.at <= VIEW_MARK_TTL_MS ? mark.source : null;
}

const underSection = (path: string, section: string) => path === section || path.startsWith(`${section}/`);

/** How a college view was reached, judged by the page before it (used when no component marked the source). */
export function navigationSourceFromPath(previousPath: string | null): NavigationSource {
  if (!previousPath) return "direct";
  if (previousPath === "/") return "home";
  if (underSection(previousPath, "/explore")) return "explore";
  if (underSection(previousPath, "/compare")) return "compare";
  if (underSection(previousPath, "/schools")) return "similar";
  return "other";
}

export function resultCountBucket(n: number): ResultCountBucket {
  if (!(n >= 1)) return "0";
  if (n < 2) return "1";
  if (n < 6) return "2-5";
  return "6+";
}

/** `/schools/{id}` or `/schools/{id}/{topic}` → id (IPEDS unit ids are digits), else null. */
export function unitIdFromPath(pathname: string): string | null {
  return /^\/schools\/(\d+)(?:\/[^/]+)?\/?$/.exec(pathname)?.[1] ?? null;
}

let notFoundPath: string | null = null;

/** The not-found page marks its path so the provider doesn't count `/schools/{unknown id}` as a college view. */
export function markNotFound(pathname: string): void {
  notFoundPath = pathname;
}

export function wasNotFound(pathname: string): boolean {
  return notFoundPath === pathname;
}

/** `/roadmap/{slug}` → slug, else null. */
export function roadmapSlugFromPath(pathname: string): string | null {
  return /^\/roadmap\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
}

/**
 * The admin console is never measured (specs/product/admin.md "The console", telemetry.md): `/admin` and everything
 * under it. AnalyticsProvider renders nothing there, so posthog-js isn't loaded, no page view is sent, and an event
 * fired by a shared component is dropped (there is no sink).
 */
export function isAdminPath(pathname: string | null | undefined): boolean {
  return pathname === "/admin" || (pathname?.startsWith("/admin/") ?? false);
}
