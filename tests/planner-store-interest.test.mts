/**
 * `recordAct` (lib/planner/store-interest.ts; specs/planner/v3/guides/show-interest.md "Tracking what they did";
 * QA finding 3): a second click on the same act (the same item, act, and event — or the same network, for a follow,
 * which has no event) never makes a second pending row. It reuses the existing pending row: `clicked_at` moves to
 * now, `prompted_at` clears (so the return prompt can ask again about this click), and the id and token returned are
 * the first row's. A different event, a different network, or an act that's already resolved gets its own new row.
 *
 * Auth, entitlements, and Supabase are stand-ins (the `tests/lists-save-owner.test.mts` pattern); the table itself is
 * `tests/helpers/fake-supabase.mts`, so every insert and update is visible. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import { fakeSupabase, type FakeClient } from "./helpers/fake-supabase.mts";

const ROOT = join(import.meta.dirname, "..");

let client: FakeClient;
(globalThis as unknown as { __recordActFake: { client: () => FakeClient } }).__recordActFake = { client: () => client };

const AUTH = `
export const authConfigured = () => true;
export const getUser = async () => ({ id: "11111111-1111-4111-8111-111111111111" });
`;
const ENTITLEMENTS = `
export const allowed = async () => true;
export const NOT_ALLOWED_MESSAGE = "not allowed";
`;
const SUPABASE_SERVER = `
const f = () => globalThis.__recordActFake;
export async function createServerSupabase() { return f().client(); }
`;
const ANALYTICS_SERVER = `export async function trackServer() {}`;
const NEXT_CACHE = `export function revalidatePath() {}`;
// store-interest.ts's only other use of "./store" is resolveAct's regenerate call (not recordAct, under test here);
// the real file pulls in lib/bundles.ts (next/headers), which needs a request this test has none of.
const PLAN_STORE = `export async function regenerate() {}`;

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return stub("export {}");
    if (specifier === "next/cache") return stub(NEXT_CACHE);
    if (specifier === "@/lib/auth") return stub(AUTH);
    if (specifier === "@/lib/entitlements") return stub(ENTITLEMENTS);
    if (specifier === "@/lib/supabase-server") return stub(SUPABASE_SERVER);
    if (specifier === "@/lib/analytics-server") return stub(ANALYTICS_SERVER);
    if (specifier === "./store" && context.parentURL?.endsWith("/lib/planner/store-interest.ts")) return stub(PLAN_STORE);
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const { recordAct } = await import("../lib/planner/store-interest.ts");

const ITEM = "33333333-3333-4333-8333-333333333333";
const LIST = "44444444-4444-4444-8444-444444444444";

function db() {
  return fakeSupabase({
    plan_interest_acts: [],
    list_items: [{ id: ITEM, list_id: LIST, unit_id: "198419" }],
  });
}

test("recordAct: a second click on the same event reuses the first pending row (same id, one row)", async () => {
  client = db();
  const event = { id: "admissions.duke.edu:tour-1", startsAt: "2026-11-03T15:00:00.000Z", place: "Durham, NC", title: "Campus Tour" };
  const first = await recordAct({ itemId: ITEM, act: "tour", url: "https://admissions.duke.edu/register", event });
  assert.equal(first.ok, true);
  assert.equal(client.tables.plan_interest_acts.length, 1);
  const firstClickedAt = client.tables.plan_interest_acts[0].clicked_at;

  const second = await recordAct({ itemId: ITEM, act: "tour", url: "https://admissions.duke.edu/register", event });
  assert.equal(second.ok, true);
  assert.equal((first as { id: string }).id, (second as { id: string }).id, "the same row, not a new one");
  assert.equal((first as { token: string }).token, (second as { token: string }).token);
  assert.equal(client.tables.plan_interest_acts.length, 1, "still one pending row");
  assert.equal(client.tables.plan_interest_acts[0].prompted_at, null);
  assert.notEqual(client.tables.plan_interest_acts[0].clicked_at, firstClickedAt, "clicked_at moved to the new click");
});

test("recordAct: a second click still arms the return prompt again after it was already asked once", async () => {
  client = db();
  const event = { id: "admissions.duke.edu:tour-1", startsAt: "2026-11-03T15:00:00.000Z", place: "Durham, NC", title: "Campus Tour" };
  const first = await recordAct({ itemId: ITEM, act: "tour", url: "https://admissions.duke.edu/register", event });
  client.tables.plan_interest_acts[0].prompted_at = "2026-10-20T14:04:00.000Z";
  const second = await recordAct({ itemId: ITEM, act: "tour", url: "https://admissions.duke.edu/register", event });
  assert.equal((second as { id: string }).id, (first as { id: string }).id);
  assert.equal(client.tables.plan_interest_acts[0].prompted_at, null, "cleared so the prompt can ask again");
});

test("recordAct: a different event, or a resolved act, gets its own row rather than reusing one", async () => {
  client = db();
  const event1 = { id: "admissions.duke.edu:tour-1", startsAt: "2026-11-03T15:00:00.000Z", place: "Durham, NC", title: "Campus Tour" };
  const event2 = { id: "admissions.duke.edu:tour-2", startsAt: "2026-11-10T15:00:00.000Z", place: "Durham, NC", title: "Campus Tour" };
  await recordAct({ itemId: ITEM, act: "tour", url: "https://admissions.duke.edu/register", event: event1 });
  await recordAct({ itemId: ITEM, act: "tour", url: "https://admissions.duke.edu/register", event: event2 });
  assert.equal(client.tables.plan_interest_acts.length, 2, "a different event is a different act");

  client.tables.plan_interest_acts[0].status = "confirmed";
  const confirmedEvent = { id: "admissions.duke.edu:tour-1", startsAt: "2026-11-03T15:00:00.000Z", place: "Durham, NC", title: "Campus Tour" };
  await recordAct({ itemId: ITEM, act: "tour", url: "https://admissions.duke.edu/register", event: confirmedEvent });
  assert.equal(client.tables.plan_interest_acts.length, 3, "a resolved act isn't reused; a fresh click starts a new one");
});

test("recordAct: two different follows (no event id) on the same college are two rows, by network", async () => {
  client = db();
  await recordAct({ itemId: ITEM, act: "follow", network: "instagram", url: "https://instagram.com/duke" });
  await recordAct({ itemId: ITEM, act: "follow", network: "tiktok", url: "https://tiktok.com/@duke" });
  assert.equal(client.tables.plan_interest_acts.length, 2);
  const again = await recordAct({ itemId: ITEM, act: "follow", network: "instagram", url: "https://instagram.com/duke" });
  assert.equal(client.tables.plan_interest_acts.length, 2, "the second Instagram click reuses its own row");
  assert.equal((again as { id: string }).id, client.tables.plan_interest_acts.find((r) => r.network === "instagram")!.id);
});
