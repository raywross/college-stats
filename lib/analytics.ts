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
  trend_group_opened: { unit_id: string; group: string };
  roadmap_viewed: { slug: string };
  signup_started: { method: SignupMethod; role_hint: RoleHint; has_invite: boolean };
  signup_completed: { method: SignupMethod; role_hint: RoleHint; has_invite: boolean };
  error_shown: { route: string; kind: "error" | "not_found" };
}
export type AnalyticsEvent = keyof AnalyticsEvents;
/** Events sent from Server Actions and Route Handlers with `trackServer()` (lib/analytics-server.ts). */
export type ServerAnalyticsEvent = "signup_started" | "signup_completed";

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
  trend_group_opened: { properties: ["unit_id", "group"], side: "client", why: "Which Over-time charts get opened" },
  roadmap_viewed: { properties: ["slug"], side: "client", why: "Interest in planned features" },
  signup_started: { properties: ["method", "role_hint", "has_invite"], side: "server", why: "Accounts: sign-ups begun" },
  signup_completed: {
    properties: ["method", "role_hint", "has_invite"],
    side: "server",
    why: "Accounts: sign-ups confirmed",
  },
  error_shown: { properties: ["route", "kind"], side: "client", why: "Errors people see, by page" },
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

/** `/schools/{id}` or `/schools/{id}/{topic}` → id, else null. */
export function unitIdFromPath(pathname: string): string | null {
  return /^\/schools\/([^/]+)(?:\/[^/]+)?\/?$/.exec(pathname)?.[1] ?? null;
}

/** `/roadmap/{slug}` → slug, else null. */
export function roadmapSlugFromPath(pathname: string): string | null {
  return /^\/roadmap\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
}
