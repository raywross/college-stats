/**
 * The admin console's Visit events card (lib/admin/visit-events.ts, components/admin/VisitEventsCard.tsx;
 * specs/product/visit-events.md "Keeping it running (round 2, 2026-10-15)", specs/product/admin.md "Health"):
 * cardTone()'s colour rules as a pure function for each state, shapeVisitEventsHealth()'s row shaping (Supabase rows,
 * nulls and all, since the 2026-10-14 population runs predate the new columns) as a pure function, and the loader's
 * admin-only gate and query shape (the "console reads go through adminSupabase()" rule every new admin read follows,
 * tests/require-admin.test.mts "the console's reads send the x-quad-console header"). Runs the real module against a
 * fake Supabase client. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";

const ROOT = join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

/* ------------------------------------------------------------------ */
/* Harness: stand in for "server-only", next/navigation, and the       */
/* request-bound Supabase client, the way tests/require-admin.test.mts */
/* does for the rest of lib/admin/*.ts.                                */
/* ------------------------------------------------------------------ */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const FAKE_SUPABASE = "export function supabaseAuthEnv(){return globalThis.__visitEventsTest.env} export async function createServerSupabase(o){return globalThis.__visitEventsTest.client(o)}";
const FAKE_BUNDLES = "export async function viewerBundle(){return null}";
const FAKE_NAVIGATION =
  "export function redirect(u){const e=new Error('NEXT_REDIRECT');e.digest='NEXT_REDIRECT;replace;'+u+';307;';throw e} export function notFound(){const e=new Error('NEXT_HTTP_ERROR_FALLBACK;404');e.digest='NEXT_HTTP_ERROR_FALLBACK;404';throw e}";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier === "@/lib/supabase-server") return { url: `data:text/javascript,${encodeURIComponent(FAKE_SUPABASE)}`, shortCircuit: true };
    if (specifier === "@/lib/bundles") return { url: `data:text/javascript,${encodeURIComponent(FAKE_BUNDLES)}`, shortCircuit: true };
    if (specifier === "next/navigation") return { url: `data:text/javascript,${encodeURIComponent(FAKE_NAVIGATION)}`, shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

interface Fake {
  isAdmin: boolean;
  headers: Record<string, string>[];
  sync: Record<string, unknown>[];
  hosts: Record<string, unknown>[];
}
const state = { fake: null as unknown as Fake };
function reset(o: Partial<Fake> = {}): Fake {
  state.fake = { isAdmin: true, headers: [], sync: [], hosts: [], ...o };
  return state.fake;
}

const ALICE = "11111111-1111-4111-8111-111111111111";
const PROFILE = { id: ALICE, display_name: "Alice", birth_year: 2009, role_hint: "student", created: "2026-10-01", updated: "2026-10-01", deleted_at: null, suspended_at: null };

/** A Supabase-style chainable query: every builder method returns itself, `await` resolves to the configured rows. */
function queryBuilder(rows: Record<string, unknown>[]) {
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: () => q,
    then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
  };
  return q;
}

function fakeClient(options?: { headers?: Record<string, string> }) {
  const fake = state.fake;
  if (options?.headers) fake.headers.push(options.headers);
  return {
    auth: {
      getClaims: async () => ({ data: { claims: { sub: ALICE, email: "alice@example.com", aal: "aal2" } }, error: null }),
      mfa: { listFactors: async () => ({ data: { all: [{ factor_type: "totp", status: "verified" }], totp: [] }, error: null }) },
    },
    rpc: async (name: string) => {
      if (name !== "is_admin_any_aal") return { data: null, error: { message: `unexpected rpc ${name}` } };
      return { data: fake.isAdmin, error: null };
    },
    from: (table: string) => {
      if (table === "profiles") {
        let columns = "";
        const builder = {
          select(cols: string) {
            columns = cols;
            return builder;
          },
          eq: () => builder,
          async maybeSingle() {
            return { data: Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, (PROFILE as Record<string, unknown>)[c] ?? null])), error: null };
          },
        };
        return builder;
      }
      if (table === "visit_event_sync") return queryBuilder(fake.sync);
      if (table === "slate_hosts") return queryBuilder(fake.hosts);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

(globalThis as unknown as { __visitEventsTest: unknown }).__visitEventsTest = { env: { url: "https://x.supabase.co", key: "sb_publishable_x" }, client: fakeClient };

const visitEvents = await import("../lib/admin/visit-events.ts");
const { cardTone, shapeVisitEventsHealth, loadVisitEventsHealth } = visitEvents;
type RawSyncRow = import("../lib/admin/visit-events.ts").RawSyncRow;
type RawHostStatusRow = import("../lib/admin/visit-events.ts").RawHostStatusRow;
type VisitRunRow = import("../lib/admin/visit-events.ts").VisitRunRow;

/** "404" or "allowed: <json>" so a test can tell a guard refusal from a successful read. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    return `allowed: ${JSON.stringify(await run())}`;
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "404";
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* cardTone: the shared colour rule                                    */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-10-15T12:00:00Z");

/** A run with every field at its "nothing wrong" value; tests override one field at a time. */
function run(over: Partial<VisitRunRow> = {}): VisitRunRow {
  return {
    id: 1,
    ranAt: "2026-10-15T07:05:00Z", // 4h55m before NOW
    finishedAt: "2026-10-15T07:40:00Z",
    hostsRead: 820,
    hostsFailed: 0,
    hostsCollapsed: 0,
    hostsRetried: 0,
    retriesFailed: 0,
    eventsNew: 12,
    eventsChanged: 30,
    eventsRemoved: 2,
    pagesFetched: 900,
    errors: [],
    missesWithheld: false,
    checkFailures: 0,
    checkWarnings: 0,
    checkSummary: { checkedAt: "2026-10-15T07:45:00Z", hosts: 650, events: 48000, failing: 0, warned: 0, listed: [], omitted: 0 },
    ...over,
  };
}

test("cardTone: no run ever recorded is red", () => {
  assert.equal(cardTone(null, NOW), "red");
});

test("cardTone: a clean run is green", () => {
  assert.equal(cardTone(run(), NOW), "green");
});

test("cardTone: a run that errored and read no hosts is red (the collapse the guard exists for)", () => {
  assert.equal(cardTone(run({ hostsRead: 0, errors: ["every host returned zero rows"] }), NOW), "red");
});

test("cardTone: errors with hosts still read isn't the 'failed' case on its own (a handful of host failures, not a collapse)", () => {
  assert.equal(cardTone(run({ hostsRead: 800, hostsFailed: 20, errors: ["UF: timed out"] }), NOW), "green");
});

test("cardTone: misses_withheld is red even with hosts read and no errors", () => {
  assert.equal(cardTone(run({ missesWithheld: true }), NOW), "red");
});

test("cardTone: a failing data check is red", () => {
  assert.equal(cardTone(run({ checkFailures: 3 }), NOW), "red");
});

test("cardTone: a data-check warning with no failure is amber", () => {
  assert.equal(cardTone(run({ checkWarnings: 2 }), NOW), "amber");
});

test("cardTone: a run older than 36 hours is red; just under 36 hours is not stale on that account alone", () => {
  const justUnder = new Date(NOW.getTime() - (36 * 60 * 60 * 1000 - 1000));
  const justOver = new Date(NOW.getTime() - (36 * 60 * 60 * 1000 + 1000));
  assert.equal(cardTone(run({ ranAt: justUnder.toISOString() }), NOW), "green");
  assert.equal(cardTone(run({ ranAt: justOver.toISOString() }), NOW), "red");
});

test("cardTone: null check_failures/check_warnings (rows from before the check wrote them) read as clean, not a crash", () => {
  assert.equal(cardTone(run({ checkFailures: null, checkWarnings: null }), NOW), "green");
});

test("guard: a tone function that only looks at errors (ignoring misses_withheld, the check, and staleness) is caught", () => {
  const broken = (r: VisitRunRow | null): "red" | "amber" | "green" => {
    if (!r) return "red";
    if (r.errors.length > 0 && r.hostsRead === 0) return "red";
    return "green";
  };
  const cases: [string, VisitRunRow, "red" | "amber" | "green"][] = [
    ["misses withheld", run({ missesWithheld: true }), "red"],
    ["check failing", run({ checkFailures: 1 }), "red"],
    ["check warning", run({ checkWarnings: 1 }), "amber"],
    ["stale", run({ ranAt: "2026-10-01T00:00:00Z" }), "red"],
  ];
  const missed = cases.filter(([, r, expected]) => broken(r) !== expected).map(([label]) => label);
  assert.deepEqual(missed, ["misses withheld", "check failing", "check warning", "stale"]);
});

/* ------------------------------------------------------------------ */
/* shapeVisitEventsHealth: the loader's row shaping as a pure function */
/* ------------------------------------------------------------------ */

const FULL_SYNC_ROW: RawSyncRow = {
  id: 7,
  ran_at: "2026-10-15T07:05:00Z",
  finished_at: "2026-10-15T07:40:00Z",
  hosts_read: 820,
  hosts_failed: 1,
  hosts_collapsed: 2,
  hosts_retried: 630,
  retries_failed: 1,
  events_new: 12,
  events_changed: 30,
  events_removed: 2,
  pages_fetched: 900,
  errors: ["UF: timed out"],
  misses_withheld: true,
  check_failures: 1,
  check_warnings: 4,
  // The real shape (scripts/lib/visit-events/check.mts CheckRecord, written by `check:visit-events --record`).
  check_summary: {
    checked_at: "2026-10-15T07:45:00Z",
    hosts: 650,
    events: 48000,
    failing: 1,
    warned: 3,
    omitted: 1,
    listed: [
      { host: "visit.uf.edu", unit_id: "134130", events: 527, failures: ["staff share 55% is above 40%"], warnings: [] },
      { host: "admission.amherst.edu", unit_id: "166027", events: 86, failures: [], warnings: ["located share below target"] },
      "not an object",
      { host: "clean.example.edu", events: 10, failures: [], warnings: [] },
    ],
  },
};

/** The 2026-10-14 population runs: written before this migration, so every new column is null (the integer columns
 * default to 0 by the migration, but a hand-run insert from the old code, or a row from before the migration applied
 * cleanly, could still carry nulls; the card must render all the same). */
const PRE_UPKEEP_SYNC_ROW: RawSyncRow = {
  id: 3,
  ran_at: "2026-10-14T07:00:00Z",
  finished_at: "2026-10-14T07:50:00Z",
  hosts_read: 780,
  hosts_failed: null,
  hosts_collapsed: null,
  events_new: 69000,
  events_changed: 0,
  events_removed: 0,
  pages_fetched: 1200,
  errors: null,
  misses_withheld: null,
  check_failures: null,
  check_warnings: null,
  check_summary: null,
};

test("shapeVisitEventsHealth: a full row shapes to camelCase with the check summary truncated and defended against bad entries", () => {
  const shaped = shapeVisitEventsHealth([FULL_SYNC_ROW], []);
  assert.equal(shaped.runs.length, 1);
  const r = shaped.runs[0];
  assert.equal(r.hostsRead, 820);
  assert.equal(r.hostsFailed, 1);
  assert.equal(r.hostsCollapsed, 2);
  assert.equal(r.hostsRetried, 630);
  assert.equal(r.retriesFailed, 1);
  assert.equal(r.missesWithheld, true);
  assert.equal(r.checkFailures, 1);
  assert.equal(r.checkWarnings, 4);
  assert.deepEqual(r.errors, ["UF: timed out"]);
  assert.deepEqual(r.checkSummary, {
    checkedAt: "2026-10-15T07:45:00Z",
    hosts: 650,
    events: 48000,
    failing: 1,
    warned: 3,
    omitted: 1,
    listed: [
      { host: "visit.uf.edu", unit_id: "134130", events: 527, failures: ["staff share 55% is above 40%"], warnings: [] },
      { host: "admission.amherst.edu", unit_id: "166027", events: 86, failures: [], warnings: ["located share below target"] },
      { host: "", unit_id: "", events: 0, failures: [], warnings: [] },
      { host: "clean.example.edu", unit_id: "", events: 10, failures: [], warnings: [] },
    ],
  });
  assert.equal(shaped.newest, r);
});

test("shapeVisitEventsHealth: nulls on the new columns (the 2026-10-14 runs, before this migration) render as zero/false/null, not a crash", () => {
  const shaped = shapeVisitEventsHealth([PRE_UPKEEP_SYNC_ROW], []);
  const r = shaped.runs[0];
  assert.equal(r.hostsFailed, 0);
  assert.equal(r.hostsCollapsed, 0);
  assert.equal(r.missesWithheld, false);
  assert.equal(r.checkFailures, null);
  assert.equal(r.checkWarnings, null);
  assert.equal(r.checkSummary, null);
  assert.deepEqual(r.errors, []);
  // And the card still renders a colour for it: no crash, reads as clean since nothing measurable failed.
  assert.equal(cardTone(r, new Date("2026-10-14T08:00:00Z")), "green");
});

test("shapeVisitEventsHealth: hosts by status counts only the four known statuses, an unknown one doesn't throw", () => {
  const hosts: RawHostStatusRow[] = [{ status: "active" }, { status: "active" }, { status: "unreachable" }, { status: "no_events" }, { status: "off" }, { status: "active" }, { status: "something_new" }, { status: null }];
  const shaped = shapeVisitEventsHealth([], hosts);
  assert.deepEqual(shaped.hostsByStatus, { active: 3, unreachable: 1, no_events: 1, off: 1 });
});

test("shapeVisitEventsHealth: no runs at all shapes to an empty list and a null newest", () => {
  const shaped = shapeVisitEventsHealth([], []);
  assert.deepEqual(shaped.runs, []);
  assert.equal(shaped.newest, null);
});

test("guard: row shaping that trusts check_summary.listed's shape (no defensive mapping) breaks on a malformed entry", () => {
  const brokenShape = (raw: unknown) => (raw as { listed: { host: string }[] }).listed.map((h) => h.host.toUpperCase());
  assert.throws(() => brokenShape(FULL_SYNC_ROW.check_summary), /Cannot read properties|toUpperCase/);
  // The real shaper doesn't: a non-object entry becomes empty strings/arrays, never a thrown error.
  assert.doesNotThrow(() => shapeVisitEventsHealth([FULL_SYNC_ROW], []));
});

/* ------------------------------------------------------------------ */
/* loadVisitEventsHealth: admin only, through adminSupabase()           */
/* ------------------------------------------------------------------ */

test("loadVisitEventsHealth: a 404 for a non-admin", async () => {
  reset({ isAdmin: false });
  assert.equal(await outcome(() => loadVisitEventsHealth()), "404");
});

test("loadVisitEventsHealth: an admin reads the last runs and host statuses, shaped the same way as the pure function, through the console header", async () => {
  reset({ isAdmin: true, sync: [FULL_SYNC_ROW as unknown as Record<string, unknown>], hosts: [{ status: "active" }, { status: "unreachable" }] });
  const health = await loadVisitEventsHealth();
  assert.deepEqual(health, shapeVisitEventsHealth([FULL_SYNC_ROW], [{ status: "active" }, { status: "unreachable" }]));
  assert.deepEqual(state.fake.headers, [{ "x-quad-console": "1" }]);
});

test("lib/admin/visit-events.ts reads through adminSupabase(), never the plain client", () => {
  const src = read("lib/admin/visit-events.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /createServerSupabase\(/);
  assert.match(src, /adminSupabase\(\)/);
  assert.match(src, /requireAdmin\(\)/);
});
