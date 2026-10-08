/**
 * Product analytics foundation (specs/product/telemetry.md "Tests"): the event registry and its denied property
 * tokens, `track()`, the navigation helpers, the rule that only two files talk to PostHog, the /ingest rewrites, and
 * `trackServer()` without a key. `npm test`.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  DENIED_PROPERTY_TOKENS,
  EVENTS,
  hasAnalyticsSink,
  identify,
  installAnalyticsSink,
  isDeniedPropertyName,
  markNextViewFrom,
  navigationSourceFromPath,
  resetIdentity,
  resultCountBucket,
  roadmapSlugFromPath,
  sanitizeProperties,
  takeNextViewFrom,
  track,
  unitIdFromPath,
  type AnalyticsEvent,
  type AnalyticsSink,
  type ServerAnalyticsEvent,
} from "../lib/analytics.ts";
import nextConfig, { posthogRewrites } from "../next.config.ts";

const ROOT = join(import.meta.dirname, "..");
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

// ---- Registry ----

test("every event has a side, a reason, and a non-empty list of distinct snake_case properties", () => {
  const entries = Object.entries(EVENTS);
  assert.ok(entries.length >= 16);
  for (const [name, spec] of entries) {
    assert.match(name, SNAKE, `event name ${name}`);
    assert.ok(spec.side === "client" || spec.side === "server", `${name}.side`);
    assert.ok(spec.why.trim().length > 0, `${name}.why`);
    assert.ok(spec.properties.length > 0, `${name}.properties`);
    assert.equal(new Set(spec.properties).size, spec.properties.length, `${name} lists a property twice`);
    for (const p of spec.properties) assert.match(p, SNAKE, `${name}.${p}`);
  }
});

test("server events are exactly the ones trackServer accepts", () => {
  const server = Object.entries(EVENTS)
    .filter(([, spec]) => spec.side === "server")
    .map(([name]) => name)
    .sort();
  const expected: ServerAnalyticsEvent[] = ["plan_text_consented", "plan_text_opted_out", "signup_completed", "signup_started"];
  assert.deepEqual(server, expected);
});

test("no registered property name carries a denied token (no scores, GPA, income, names, emails)", () => {
  const offenders = Object.entries(EVENTS).flatMap(([name, spec]) =>
    spec.properties.filter((p) => isDeniedPropertyName(p)).map((p) => `${name}.${p}`),
  );
  assert.deepEqual(offenders, []);
});

test("the denied-token check is live: made-up personal property names are caught, lookalikes pass", () => {
  for (const bad of ["display_name", "sat_score", "act", "gpa", "household_income", "email", "zip", "birth_year", "award_amount"]) {
    assert.equal(isDeniedPropertyName(bad), true, bad);
  }
  for (const ok of ["action", "in_range", "unit_id", "has_invite", "result_count", "satisfied", "page"]) {
    assert.equal(isDeniedPropertyName(ok), false, ok);
  }
  for (const token of ["gpa", "sat", "act", "score", "income", "agi", "asset", "email", "name", "amount", "grade", "address", "zip", "phone", "birth", "age"]) {
    assert.ok(DENIED_PROPERTY_TOKENS.includes(token), token);
  }
});

// ---- track() ----

function recordingSink() {
  const calls: { kind: string; event?: string; properties?: Record<string, unknown>; id?: string }[] = [];
  const sink: AnalyticsSink = {
    capture: (event, properties) => calls.push({ kind: "capture", event, properties }),
    identify: (id) => calls.push({ kind: "identify", id }),
    reset: () => calls.push({ kind: "reset" }),
  };
  return { sink, calls };
}

test("track() without a sink does nothing and doesn't throw", () => {
  installAnalyticsSink(null);
  assert.equal(hasAnalyticsSink(), false);
  assert.equal(track("roadmap_viewed", { slug: "telemetry" }), false);
  assert.doesNotThrow(() => identify("abc"));
  assert.doesNotThrow(() => resetIdentity());
});

test("track() forwards a registered event with only its registered properties", () => {
  const { sink, calls } = recordingSink();
  installAnalyticsSink(sink);
  try {
    const props = { unit_id: "166027", from: "search", query: "harvard", gpa: 3.9 } as unknown as {
      unit_id: string;
      from: "search";
    };
    assert.equal(track("school_viewed", props), true);
    assert.deepEqual(calls, [{ kind: "capture", event: "school_viewed", properties: { unit_id: "166027", from: "search" } }]);
  } finally {
    installAnalyticsSink(null);
  }
});

test("track() refuses an unregistered event name", () => {
  const { sink, calls } = recordingSink();
  installAnalyticsSink(sink);
  try {
    assert.equal(track("score_entered" as AnalyticsEvent, { score: 1500 } as never), false);
    assert.equal(track("toString" as AnalyticsEvent, {} as never), false);
    assert.deepEqual(calls, []);
  } finally {
    installAnalyticsSink(null);
  }
});

test("track() drops non-primitive and non-finite values, and never throws when the sink does", () => {
  assert.deepEqual(sanitizeProperties("compare_changed", { action: "add", count: Number.NaN }), { action: "add" });
  assert.deepEqual(sanitizeProperties("citation_opened", { field: { path: "x" } }), {});
  assert.equal(sanitizeProperties("not_an_event", { a: 1 }), null);
  installAnalyticsSink({
    capture: () => {
      throw new Error("boom");
    },
    identify: () => {
      throw new Error("boom");
    },
    reset: () => {
      throw new Error("boom");
    },
  });
  try {
    assert.equal(track("term_opened", { term: "yield" }), false);
    assert.doesNotThrow(() => identify("abc"));
    assert.doesNotThrow(() => resetIdentity());
  } finally {
    installAnalyticsSink(null);
  }
});

test("identify() and resetIdentity() reach the sink", () => {
  const { sink, calls } = recordingSink();
  installAnalyticsSink(sink);
  try {
    identify("00000000-0000-4000-8000-000000000000");
    identify("");
    resetIdentity();
    assert.deepEqual(calls, [{ kind: "identify", id: "00000000-0000-4000-8000-000000000000" }, { kind: "reset" }]);
  } finally {
    installAnalyticsSink(null);
  }
});

// ---- Navigation helpers ----

test("navigationSourceFromPath: the page before a college view decides where it came from", () => {
  assert.equal(navigationSourceFromPath(null), "direct");
  assert.equal(navigationSourceFromPath(""), "direct");
  assert.equal(navigationSourceFromPath("/"), "home");
  assert.equal(navigationSourceFromPath("/explore"), "explore");
  assert.equal(navigationSourceFromPath("/explore/"), "explore");
  assert.equal(navigationSourceFromPath("/explorer"), "other");
  assert.equal(navigationSourceFromPath("/compare"), "compare");
  assert.equal(navigationSourceFromPath("/compare/cost"), "compare");
  assert.equal(navigationSourceFromPath("/schools/166027"), "similar");
  assert.equal(navigationSourceFromPath("/schools/166027/cost"), "similar");
  assert.equal(navigationSourceFromPath("/roadmap/telemetry"), "other");
  assert.equal(navigationSourceFromPath("/me/list"), "other");
});

test("markNextViewFrom: taken once, and a stale mark is ignored", () => {
  assert.equal(takeNextViewFrom(), null);
  markNextViewFrom("search");
  assert.equal(takeNextViewFrom(), "search");
  assert.equal(takeNextViewFrom(), null);

  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  try {
    markNextViewFrom("compare");
    mock.timers.tick(10_000);
    assert.equal(takeNextViewFrom(), "compare");
    markNextViewFrom("compare");
    mock.timers.tick(60_000);
    assert.equal(takeNextViewFrom(), null);
  } finally {
    mock.timers.reset();
  }
});

test("resultCountBucket edges", () => {
  assert.equal(resultCountBucket(0), "0");
  assert.equal(resultCountBucket(-3), "0");
  assert.equal(resultCountBucket(Number.NaN), "0");
  assert.equal(resultCountBucket(1), "1");
  assert.equal(resultCountBucket(2), "2-5");
  assert.equal(resultCountBucket(5), "2-5");
  assert.equal(resultCountBucket(6), "6+");
  assert.equal(resultCountBucket(1000), "6+");
});

test("unitIdFromPath and roadmapSlugFromPath read only their own routes", () => {
  assert.equal(unitIdFromPath("/schools/166027"), "166027");
  assert.equal(unitIdFromPath("/schools/166027/"), "166027");
  assert.equal(unitIdFromPath("/schools/166027/admissions"), "166027");
  assert.equal(unitIdFromPath("/schools/166027/admissions/extra"), null);
  assert.equal(unitIdFromPath("/schools/nope"), null, "unit ids are digits; a 404's slug isn't one");
  assert.equal(unitIdFromPath("/schools"), null);
  assert.equal(unitIdFromPath("/schools/"), null);
  assert.equal(unitIdFromPath("/compare"), null);
  assert.equal(unitIdFromPath("/"), null);

  assert.equal(roadmapSlugFromPath("/roadmap/telemetry"), "telemetry");
  assert.equal(roadmapSlugFromPath("/roadmap/telemetry/"), "telemetry");
  assert.equal(roadmapSlugFromPath("/roadmap"), null);
  assert.equal(roadmapSlugFromPath("/roadmap/a/b"), null);
  assert.equal(roadmapSlugFromPath("/schools/166027"), null);
});

// ---- Only two files talk to PostHog ----

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(tsx?|mts|jsx?|mjs)$/.test(name) ? [p] : [];
  });
}

/** Code with comments removed, so documentation examples don't trip the guard. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const POSTHOG_USE = /["']posthog-(js|node)(\/[^"']*)?["']|\bposthog\.(capture|identify)\b/;
const POSTHOG_FILES = ["components/analytics/AnalyticsProvider.tsx", "lib/analytics-server.ts"];

test("only AnalyticsProvider and analytics-server import PostHog or call it directly", () => {
  const files = ["app", "components", "lib"].flatMap((d) => sourceFiles(join(ROOT, d)));
  const offenders = files
    .map((f) => relative(ROOT, f))
    .filter((f) => !POSTHOG_FILES.includes(f) && POSTHOG_USE.test(code(join(ROOT, f))));
  assert.deepEqual(offenders, []);
  // The pattern is live: both allowed files do match it.
  for (const f of POSTHOG_FILES) assert.match(code(join(ROOT, f)), POSTHOG_USE, f);
});

test("the error and not-found pages report themselves, and the layout mounts the provider", () => {
  assert.match(code(join(ROOT, "app/error.tsx")), /<ErrorTracker kind="error" \/>/);
  assert.match(code(join(ROOT, "app/global-error.tsx")), /<ErrorTracker kind="error" \/>/);
  assert.match(code(join(ROOT, "app/not-found.tsx")), /<ErrorTracker kind="not_found" \/>/);
  const layout = code(join(ROOT, "app/layout.tsx"));
  assert.match(layout, /<Suspense fallback=\{null\}>\s*<AnalyticsProvider \/>\s*<\/Suspense>/);
  assert.match(layout, /<SpeedInsights \/>/);
});

// ---- Rewrites ----

test("next.config.ts proxies /ingest to PostHog and skips trailing-slash redirects", async () => {
  assert.deepEqual(posthogRewrites("https://us.i.posthog.com"), [
    { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
    { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
  ]);
  assert.deepEqual(posthogRewrites("https://eu.i.posthog.com/"), [
    { source: "/ingest/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
    { source: "/ingest/:path*", destination: "https://eu.i.posthog.com/:path*" },
  ]);
  assert.equal(nextConfig.skipTrailingSlashRedirect, true);
  const rewrites = await nextConfig.rewrites!();
  assert.ok(Array.isArray(rewrites));
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
  assert.deepEqual(rewrites, posthogRewrites(host));
  // The existing redirects stay.
  const redirects = await nextConfig.redirects!();
  assert.ok(redirects.some((r) => r.source === "/sources"));
});

// ---- trackServer() ----

type FakePostHogState = { constructed: number; captured: Record<string, unknown>[]; fail: boolean };
const g = globalThis as typeof globalThis & { __fakePostHog?: FakePostHogState };

/** Loads lib/analytics-server.ts in node: `server-only` becomes an empty module and posthog-node a recording fake. */
async function loadServerModule() {
  g.__fakePostHog = { constructed: 0, captured: [], fail: false };
  const fake = `export class PostHog {
    constructor() { globalThis.__fakePostHog.constructed++; }
    async captureImmediate(message) {
      if (globalThis.__fakePostHog.fail) throw new Error("network down");
      globalThis.__fakePostHog.captured.push(message);
    }
  }`;
  type Resolve = (specifier: string, context: unknown, next: (s: string, c: unknown) => unknown) => unknown;
  (nodeModule as unknown as { registerHooks(hooks: { resolve: Resolve }): void }).registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
      if (specifier === "posthog-node") {
        return { url: `data:text/javascript,${encodeURIComponent(fake)}`, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  return import("../lib/analytics-server.ts");
}

test("trackServer() without a key resolves without creating a client or touching the network", async () => {
  const { analyticsConfigured, trackServer } = await loadServerModule();
  const saved = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched++;
    throw new Error("no network in tests");
  }) as typeof fetch;
  try {
    delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    assert.equal(analyticsConfigured(), false);
    await trackServer("signup_started", { method: "password", role_hint: "none", has_invite: false });
    assert.equal(g.__fakePostHog!.constructed, 0);
    assert.equal(fetched, 0);

    // With a key: registered properties only; anonymous events get a random id and no person profile.
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    assert.equal(analyticsConfigured(), true);
    const props = { method: "magic_link", role_hint: "student", has_invite: true, email: "a@b.c" } as unknown as {
      method: "magic_link";
      role_hint: "student";
      has_invite: boolean;
    };
    await trackServer("signup_started", props);
    await trackServer("signup_completed", props, "user-1");
    const [anon, known] = g.__fakePostHog!.captured;
    assert.equal(anon.event, "signup_started");
    assert.match(String(anon.distinctId), /^[0-9a-f-]{36}$/);
    assert.deepEqual(anon.properties, { method: "magic_link", role_hint: "student", has_invite: true, $process_person_profile: false });
    assert.deepEqual(known, {
      distinctId: "user-1",
      event: "signup_completed",
      properties: { method: "magic_link", role_hint: "student", has_invite: true },
    });
    assert.equal(g.__fakePostHog!.constructed, 1);

    // A failure is swallowed (sign-up never fails because analytics did).
    g.__fakePostHog!.fail = true;
    const warn = mock.method(console, "warn", () => {});
    await assert.doesNotReject(trackServer("signup_started", props));
    assert.equal(warn.mock.callCount(), 1);
    warn.mock.restore();
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    else process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = saved;
  }
});
