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
  plan_opened: { tab: "colleges" | "scores" | "calendar" | "offers"; viewer: "student" | "guardian"; everyone: boolean };
  plan_task_ticked: { kind: string; source: "college" | "cycle" | "stage" | "own"; assignee: "student" | "guardian" | "either" };
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
  plan_tab: { tab: "colleges" | "scores" | "calendar" | "offers" };
  plan_switch_child: { to: "child" | "everyone" };
  plan_signed_out_started: { from: "numbers" | "college" };
  plan_signed_out_saved: { has_numbers: boolean };
  /** `test` is which test the plan uses (sat, act, none), never the score. */
  plan_numbers_set: { test: "sat" | "act" | "none"; practice: boolean };
  plan_group_changed: { from_auto: boolean };
  plan_dream_set: { on: boolean };
  plan_round_changed: { from_auto: boolean; round: "ed" | "ed2" | "ea" | "rea" | "rd" | "rolling" };
  plan_drawer_opened: { in_season: boolean };
  plan_ed2_offer_used: { dream_round: "ed" | "rea" };
  plan_round_problem_shown: { kind: string };
  plan_scores_opened: { suggestion: boolean };
  plan_test_date_picked: { test: "sat" | "act" };
  plan_calendar_opened: { everyone: boolean; color_by: "child" | "round" };
  plan_calendar_feed_added: { everyone: boolean };
  plan_calendar_printed: { everyone: boolean };
  /* The course plan (specs/chances/course-plan.md "Rules"): which reasons were shown, never a course name, a grade, or a score. */
  course_plan_shown: { reasons: string; guardrail: string };
  course_plan_added: { reason: string };
  course_plan_dismissed: { reason: string };
}
export type AnalyticsEvent = keyof AnalyticsEvents;
/** Events sent from Server Actions and Route Handlers with `trackServer()` (lib/analytics-server.ts). */
export type ServerAnalyticsEvent = "signup_started" | "signup_completed" | "plan_text_consented" | "plan_text_opted_out";

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
  plan_group_changed: { properties: ["from_auto"], side: "client", why: "Planner: how often a suggested group gets changed" },
  plan_dream_set: { properties: ["on"], side: "client", why: "Planner: Dreams marked" },
  plan_round_changed: { properties: ["from_auto", "round"], side: "client", why: "Planner: which rounds students pick over the starting round" },
  plan_drawer_opened: { properties: ["in_season"], side: "client", why: "Planner: do row details get opened" },
  plan_ed2_offer_used: { properties: ["dream_round"], side: "client", why: "Planner: the ED II offer taken" },
  plan_round_problem_shown: { properties: ["kind"], side: "client", why: "Planner: which round conflicts come up" },
  plan_scores_opened: { properties: ["suggestion"], side: "client", why: "Planner: Scores tab opened, with or without a retake suggestion" },
  plan_test_date_picked: { properties: ["test"], side: "client", why: "Planner: test dates picked, by test" },
  plan_calendar_opened: { properties: ["everyone", "color_by"], side: "client", why: "Planner: calendar views, per child or for everyone" },
  plan_calendar_feed_added: { properties: ["everyone"], side: "client", why: "Planner: calendar feeds added" },
  plan_calendar_printed: { properties: ["everyone"], side: "client", why: "Planner: calendars printed" },
  course_plan_shown: { properties: ["reasons", "guardrail"], side: "client", why: "Course plan: which reasons and guardrails the Next year card shows" },
  course_plan_added: { properties: ["reason"], side: "client", why: "Course plan: do suggestions get added, by reason" },
  course_plan_dismissed: { properties: ["reason"], side: "client", why: "Course plan: do suggestions get set aside, by reason" },
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
