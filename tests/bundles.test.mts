/**
 * The batched reads' client side (lib/bundle-read.ts, lib/request-memo.ts, lib/planner/people-snapshot.ts; U20 "real
 * speed"): a missing function answers "missing" and is remembered for a minute (one wasted call a minute, not one per
 * request, and picked up within a minute of the SQL); other errors are errors; a plan bundle becomes readPlan's shape;
 * one read per key inside a request scope; the people line's tap snapshot is browser-only and short-lived; and the
 * callers keep their per-table fallbacks. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bundleKnownMissing, callBundle, isMissingFunction, planDataFromBundle, resetMissingBundles, type PlanBundle } from "../lib/bundle-read.ts";
import { forgetRequestMemo, inRequestScope, requestMemo } from "../lib/request-memo.ts";
import { pendingPeople, setPendingPeople } from "../lib/planner/people-snapshot.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function fakeRpc(answer: () => { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: string[] = [];
  const client = {
    rpc(fn: string) {
      calls.push(fn);
      return Promise.resolve(answer());
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

test("isMissingFunction: PostgREST's and Postgres's codes for a function that isn't there", () => {
  assert.equal(isMissingFunction({ code: "PGRST202", message: "Could not find the function public.plan_bundle" }), true);
  assert.equal(isMissingFunction({ code: "42883", message: "function public.plan_bundle(uuid) does not exist" }), true);
  assert.equal(isMissingFunction({ code: "42501", message: "permission denied for function plan_bundle" }), false);
  assert.equal(isMissingFunction(null), false);
});

test("a missing function is remembered for a minute, then asked again", async () => {
  resetMissingBundles();
  let now = 1_000;
  const { client, calls } = fakeRpc(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }));
  assert.deepEqual(await callBundle(client, "plan_bundle", {}, () => now), { kind: "missing" });
  assert.equal(bundleKnownMissing("plan_bundle", () => now), true);
  now += 30_000;
  assert.deepEqual(await callBundle(client, "plan_bundle", {}, () => now), { kind: "missing" });
  assert.equal(calls.length, 1, "no second call within the minute");
  now += 31_000;
  assert.equal(bundleKnownMissing("plan_bundle", () => now), false);
  await callBundle(client, "plan_bundle", {}, () => now);
  assert.equal(calls.length, 2, "asked again after it");
  assert.equal(bundleKnownMissing("viewer_bundle", () => now), false, "per function");
});

test("an installed function answers ok and clears the memory; another error is an error, not 'missing'", async () => {
  resetMissingBundles();
  const ok = fakeRpc(() => ({ data: { list: null }, error: null }));
  assert.deepEqual(await callBundle(ok.client, "plan_bundle"), { kind: "ok", data: { list: null } });
  const denied = fakeRpc(() => ({ data: null, error: { code: "42501", message: "permission denied" } }));
  const r = await callBundle(denied.client, "viewer_bundle");
  assert.equal(r.kind, "error");
  assert.equal(bundleKnownMissing("viewer_bundle"), false);
});

test("guard: treating every error as 'missing' would hide real failures", () => {
  const sloppy = (e: { code?: string }) => Boolean(e);
  assert.notEqual(sloppy({ code: "42501" }), isMissingFunction({ code: "42501" }));
});

test("a plan bundle becomes readPlan's PlanData; no list is null, as readPlan returns", () => {
  const list = { id: "l1", student_id: "s1" } as PlanBundle["list"];
  const b: PlanBundle = { student: null, list, items: [], tasks: [], visits: [], offers: [], nudges: [] };
  assert.deepEqual(planDataFromBundle(b), { list, items: [], tasks: [], visits: [], offers: [], nudges: [] });
  assert.equal(planDataFromBundle({ ...b, list: null }), null);
  assert.equal("sourcesMissing" in (planDataFromBundle(b) ?? {}), false, "the bundle implies the columns exist");
});

test("requestMemo: one load per key inside a scope, every call outside one; a failed load is retried", async () => {
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await requestMemo("k", load), 1);
  assert.equal(await requestMemo("k", load), 2, "no scope: no memo");
  await inRequestScope(async () => {
    const [a, b] = await Promise.all([requestMemo("k", load), requestMemo("k", load)]);
    assert.deepEqual([a, b], [3, 3]);
    assert.equal(await requestMemo("k", load), 3);
    forgetRequestMemo("k");
    assert.equal(await requestMemo("k", load), 4);
    let fails = 0;
    await assert.rejects(requestMemo("bad", async () => Promise.reject(new Error(`no ${++fails}`))));
    await new Promise((r) => setTimeout(r, 0));
    await assert.rejects(requestMemo("bad", async () => Promise.reject(new Error(`no ${++fails}`))));
    assert.equal(fails, 2);
  });
  await inRequestScope(async () => assert.equal(await requestMemo("k", load), 5, "a new scope starts empty"));
});

test("the tap snapshot: nothing on the server; in the browser for a few seconds after a tap", () => {
  setPendingPeople({ people: [], selected: "s2", detail: null, details: {} }, 1_000);
  assert.equal(pendingPeople(1_500), null, "no window: the server never sees a pending line");
  const g = globalThis as { window?: unknown };
  g.window = {};
  try {
    assert.equal(pendingPeople(1_500)?.selected, "s2");
    assert.equal(pendingPeople(20_000), null, "stale after a few seconds");
    setPendingPeople(null);
    assert.equal(pendingPeople(1_500), null);
  } finally {
    delete g.window;
  }
});

/* ------------------------------------------------------------------ */
/* Callers keep their fallbacks                                         */
/* ------------------------------------------------------------------ */

const FALLBACKS: { file: string; bundle: RegExp; table: RegExp }[] = [
  { file: "lib/auth.ts", bundle: /viewerBundle\(\)/, table: /\.from\("profiles"\)/ },
  { file: "lib/auth.ts", bundle: /viewerBundle\(\)/, table: /\.from\("household_members"\)/ },
  { file: "lib/households.ts", bundle: /viewerBundle\(\)/, table: /rpc\("household_roster"/ },
  { file: "lib/student-profile-store.ts", bundle: /viewerBundle\(\)/, table: /\.from\("student_profiles"\)\.select/ },
  { file: "lib/student-profile-store.ts", bundle: /"save_student_profile"/, table: /\.from\("student_profiles"\)\s*\.upsert/ },
  { file: "lib/home-store.ts", bundle: /viewerBundle\(\)/, table: /\.from\("household_homes"\)\.select/ },
  { file: "lib/planner/load.ts", bundle: /planBundle\(/, table: /readPlan\(supabase/ },
  { file: "lib/planner/store-plan.ts", bundle: /freshPlanBundle\(/, table: /readPlan\(supabase/ },
];

function fallbackProblems(entries: { file: string; src: string; bundle: RegExp; table: RegExp }[]): string[] {
  return entries.filter((e) => e.bundle.test(e.src) && !e.table.test(e.src)).map((e) => `${e.file}: ${e.table}`);
}

test("every caller of a bundle keeps its per-table read for when the function isn't installed", () => {
  assert.deepEqual(fallbackProblems(FALLBACKS.map((f) => ({ ...f, src: read(f.file) }))), []);
  for (const f of FALLBACKS) assert.match(read(f.file), f.bundle, `${f.file} uses the bundle`);
});

test("guard: a caller that drops its fallback is flagged", () => {
  assert.equal(fallbackProblems([{ file: "x.ts", src: "await viewerBundle();", bundle: /viewerBundle\(\)/, table: /\.from\("profiles"\)/ }]).length, 1);
});
