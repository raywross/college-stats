/**
 * Request timing (lib/timing.ts; specs/serving-architecture.md "Timing a request"): off unless QUAD_TIMING=1, one
 * line per request naming tables and spans only (never an id, a query string, or a value), round trips grouped into
 * waves of parallel calls, and the wiring that keeps it off by default (the Supabase clients, proxy.ts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentTiming, dbWaves, RequestTiming, runWithTiming, span, supabaseCallName, timedFetch, timingEnabled } from "../lib/timing.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("off unless QUAD_TIMING is exactly 1", () => {
  assert.equal(timingEnabled({}), false);
  assert.equal(timingEnabled({ QUAD_TIMING: "" }), false);
  assert.equal(timingEnabled({ QUAD_TIMING: "0" }), false);
  assert.equal(timingEnabled({ QUAD_TIMING: "true" }), false);
  assert.equal(timingEnabled({ QUAD_TIMING: "1" }), true);
});

test("the test process itself runs with timing off (the default)", () => {
  assert.equal(process.env.QUAD_TIMING === "1", timingEnabled());
  if (process.env.QUAD_TIMING === undefined) assert.equal(timingEnabled(), false);
});

test("a Supabase URL is named by its table or function, never its query string or ids", () => {
  const id = "56e84181-28ab-49c1-9eb1-9e1fcb350473";
  assert.equal(supabaseCallName(`https://x.supabase.co/rest/v1/list_items?select=*&list_id=eq.${id}`), "list_items");
  assert.equal(supabaseCallName(`https://x.supabase.co/rest/v1/rpc/log_access?p_student=${id}`), "rpc log_access");
  assert.equal(supabaseCallName("https://x.supabase.co/auth/v1/token?grant_type=refresh_token"), "auth");
  assert.equal(supabaseCallName("not a url"), "other");
});

test("waves: overlapping calls are one wave; a call that starts after the wave ends starts the next", () => {
  const waves = dbWaves([
    { name: "profiles", start: 0, dur: 40 },
    { name: "students", start: 45, dur: 40 },
    { name: "household_members", start: 46, dur: 50 },
    { name: "lists", start: 100, dur: 30 },
  ]);
  assert.deepEqual(
    waves.map((w) => w.calls.map((c) => c.name)),
    [["profiles"], ["students", "household_members"], ["lists"]],
  );
  assert.deepEqual(
    waves.map((w) => w.dur),
    [40, 51, 30],
  );
});

test("the line and the Server-Timing value: route, counts, tables, spans, milliseconds; nothing personal", () => {
  let now = 0;
  const t = new RequestTiming("/plan save", () => now);
  t.recordDb("student_profiles", 0, 40);
  t.recordDb("students", 50, 30);
  t.recordDb("household_members", 55, 30);
  now = 120;
  t.responded();
  now = 400;
  const line = t.line();
  assert.match(line, /^\/plan save 120ms \(\+280ms after\): db 3× in 2 waves 75ms \(student_profiles 40; students 30 ‖ household_members 30\)$/);
  const header = t.serverTiming();
  assert.match(header, /^db;dur=75;desc="3 queries, 2 waves", total;dur=400$/);
});

test("spans nest under the request; same-named spans are summed", async () => {
  let now = 0;
  const t = new RequestTiming("/plan", () => now);
  await runWithTiming(t, async () => {
    assert.equal(currentTiming(), t);
    await span("estimates", () => {
      now += 10;
    });
    await span("estimates", () => {
      now += 5;
    });
  });
  assert.equal(currentTiming(), null);
  assert.match(t.line(), /estimates 15ms \(2×\)/);
});

test("outside a timed request, span and timedFetch are pass-throughs that record nothing", async () => {
  assert.equal(await span("x", () => 7), 7);
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    return new Response("[]");
  }) as typeof fetch;
  try {
    await timedFetch("https://x.supabase.co/rest/v1/lists?id=eq.1");
    const t = new RequestTiming("/plan");
    await runWithTiming(t, () => timedFetch("https://x.supabase.co/rest/v1/lists?id=eq.1"));
    assert.equal(called, 2);
    assert.deepEqual(
      t.db.map((c) => c.name),
      ["lists"],
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ------------------------------------------------------------------ */
/* Wiring: off by default                                               */
/* ------------------------------------------------------------------ */

/** Each place that turns timing on must ask timingEnabled() first. */
function wiringProblems(files: { file: string; src: string }[]): string[] {
  const out: string[] = [];
  for (const { file, src } of files) {
    if (/timedFetch/.test(src) && !/timingEnabled\(\)\s*\?\s*\{\s*global:\s*\{\s*fetch:\s*timedFetch\s*\}\s*\}/.test(src)) out.push(`${file}: timedFetch not behind timingEnabled()`);
    if (/Server-Timing/.test(src) && !/if \(timingEnabled\(\)\)[^\n]*Server-Timing/.test(src)) out.push(`${file}: Server-Timing header not behind timingEnabled()`);
  }
  return out;
}

const WIRED = ["lib/supabase-server.ts", "lib/supabase.ts", "proxy.ts"];

test("the Supabase clients and proxy.ts add timing only when timingEnabled()", () => {
  const files = WIRED.map((file) => ({ file, src: read(file) }));
  assert.deepEqual(wiringProblems(files), []);
  assert.match(read("lib/supabase-server.ts"), /timedFetch/);
  assert.match(read("proxy.ts"), /Server-Timing/);
});

test("guard: a client that always uses timedFetch, or an unconditional header, is flagged", () => {
  assert.equal(wiringProblems([{ file: "a.ts", src: "createClient(url, key, { global: { fetch: timedFetch } })" }]).length, 1);
  assert.equal(wiringProblems([{ file: "proxy.ts", src: 'response.headers.set("Server-Timing", "x")' }]).length, 1);
});

test("withTiming does nothing extra when timing is off", () => {
  const src = read("lib/timing-server.ts");
  assert.match(src, /if \(!timingEnabled\(\) \|\| currentTiming\(\)\) return fn\(\);/);
});
