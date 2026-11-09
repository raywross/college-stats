/**
 * /advisor in two database waves (specs/serving-architecture.md "Left, after this PR"; lib/planner/load.ts): the
 * loader starts every first-wave read before it awaits anything; the planner's two settings are one read; the plan's
 * essays carry their open comments and suggestions, so the Essays tab reads nothing more; the estimate's high-school
 * reads start the moment the profile resolves; and a prepared estimate context gives the same estimates. Also prints
 * the estimate's split (`estimates.context` / `estimates.compute`) over the mini fixture. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const fileUrl = (p: string) => pathToFileURL(join(ROOT, p)).href;

/* ------------------------------------------------------------------ */
/* Stand-ins (narrow: each only for the module that needs it)          */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
type Call = { table: string; columns: string; filters: [string, string, unknown][] };
const g = globalThis as unknown as { __planWaves: { calls: Call[]; tables: Record<string, Row[]> }; __tabStub: { lookups: number; readEssays: number } };
g.__planWaves = { calls: [], tables: {} };
g.__tabStub = { lookups: 0, readEssays: 0 };

/** A Supabase stand-in: records each query (table, columns, filters) and answers from `tables`, applying eq/in/is/neq. */
function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { table, columns: "", filters: [] };
      g.__planWaves.calls.push(call);
      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(c: string, v: unknown) {
          call.filters.push(["eq", c, v]);
          return builder;
        },
        neq(c: string, v: unknown) {
          call.filters.push(["neq", c, v]);
          return builder;
        },
        is(c: string, v: unknown) {
          call.filters.push(["is", c, v]);
          return builder;
        },
        in(c: string, v: unknown) {
          call.filters.push(["in", c, v]);
          return builder;
        },
        order: () => builder,
        then(resolve: (r: { data: Row[]; error: null }) => unknown) {
          const rows = (g.__planWaves.tables[table] ?? []).filter((r) =>
            call.filters.every(([op, c, v]) => {
              const val = c.includes(".") ? c.split(".").reduce<unknown>((o, k) => (o as Row | undefined)?.[k], r) : r[c];
              if (op === "eq") return val === v;
              if (op === "neq") return val !== v;
              if (op === "is") return (val ?? null) === v;
              return (v as unknown[]).includes(val);
            }),
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}
(globalThis as unknown as { __fakeClient: typeof fakeClient }).__fakeClient = fakeClient;

const SUPABASE_STUB = `export * from "${fileUrl("lib/supabase-server.ts")}";
export async function createServerSupabase() { return globalThis.__fakeClient(); }`;
// React's `cache` outside a server render doesn't memoize; one module lifetime stands in for one request here.
const REACT_STUB = `export function cache(fn) { const m = new Map(); return (...a) => { const k = JSON.stringify(a); if (!m.has(k)) m.set(k, fn(...a)); return m.get(k); }; }`;
const LOAD_STUB = `export async function promptLookup() { globalThis.__tabStub.lookups++; return { school: () => null, schoolRecord: () => null, platform: null }; }
export async function readEssays() { globalThis.__tabStub.readEssays++; return { kind: "ready", essays: [], links: [], openComments: {}, openSuggestions: {}, mySuggestions: {} }; }`;
const data = (src: string) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const SETTINGS_FILES = /lib\/planner\/(settings-server|today-server|all-moves-server)\.ts$/;
registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ?? "";
    if (specifier === "server-only") return data("export {}");
    // lib/data.ts schedules its pointer check with after(), which throws outside a request, as here.
    if (specifier === "next/server") return data("export function after() { throw new Error('after() outside a request') }");
    if (specifier === "next/headers") return data("export function cookies(){throw new Error('no request')} export function headers(){throw new Error('no request')}");
    if (specifier === "@/lib/supabase-server" && !parent.startsWith("data:")) return data(SUPABASE_STUB);
    if (specifier === "react" && SETTINGS_FILES.test(parent)) return data(REACT_STUB);
    if (specifier === "./context" && parent.endsWith("lib/planner/today-server.ts")) return data(`export const todayIso = () => "2026-11-08";`);
    if (parent.endsWith("lib/essays/tab-data.ts")) {
      if (specifier === "./load") return data(LOAD_STUB);
      if (specifier === "@/lib/households") return data("export async function scheduleStudentReadLog() {}");
      if (specifier === "@/lib/auth") return data(`export async function getUser() { return { id: "guardian-1" }; }`);
    }
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && parent ? new URL(spec, parent).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const reset = (tables: Record<string, Row[]> = {}) => {
  g.__planWaves.calls = [];
  g.__planWaves.tables = tables;
};

/* ------------------------------------------------------------------ */
/* The loader's source: wave 1 starts at once, wave 2 on the profile   */
/* ------------------------------------------------------------------ */

/** loadPlanFor's text up to the first wave's gather, without the early-bundle helper (an async function of its own). */
function firstWaveSource(src: string): { before: string; gather: string } {
  const body = src.slice(src.indexOf("export async function loadPlanFor("));
  const at = body.indexOf('await span("access+plan"');
  assert.ok(at > 0, "loadPlanFor gathers its first wave in one span");
  const before = body.slice(0, at).replace(/const bundleP = \(async \(\) => \{[\s\S]*?\}\)\(\);/, "");
  const gather = body.slice(at, body.indexOf("\n  );", at));
  return { before, gather };
}

test("loadPlanFor starts every first-wave read, and the high-school chain, before it awaits anything", () => {
  const src = read("lib/planner/load.ts");
  const { before, gather } = firstWaveSource(src);
  assert.doesNotMatch(before, /\bawait\b/, "no await between the first wave's starts and its Promise.all");
  for (const start of ["studentsICanSee()", "getAccount()", "profileP", "myHome()", "bundleP", "essaysP", "appSettings()", "readEssayOverrides(null)"]) {
    assert.ok(gather.includes(start), `the first wave gathers ${start}`);
  }
  assert.match(before, /const profileP = profileFor\(studentId\);/);
  assert.match(before, /const estimateContextP = afterOne\(profileP, \(p\) => startEstimateContext\(p\?\.data \?\? null\)\);/, "wave 2 chains on the profile alone");
  assert.match(before, /readPlanEssays\(s, studentId\)/);
  // The estimate takes the started context, so it never waits for the high-school reads twice.
  assert.match(src, /planEstimates\(profileData, read\.items, \{ gradYear, today, visits: read\.visits, context: estimateContextP \}\)/);
  // planSchools reads the open cycle's prompts the same way promptLookup does: one cached read per request.
  assert.match(read("lib/planner/context.ts"), /const overrides = await readEssayOverrides\(null\);/);
  assert.match(read("lib/essays/load.ts"), /readEssayOverrides\(null\)/);
});

test("round 5: the tab panels' reads add no wave: the asks in the first wave's gather, the Offers reads chained on the bundle and the profile", () => {
  const src = read("lib/planner/load.ts");
  const { before, gather } = firstWaveSource(src);
  // The asks: one call in the same Promise.all, only when the advisor asks for the tabs and the viewer isn't a counselor.
  assert.match(before, /const asksP = opts\.tabs && viewer\?\.relation !== "counselor" \? asksFor\(studentId\) : Promise\.resolve\(null\);/);
  assert.ok(gather.includes("asksP"), "the first wave gathers the asks");
  // The Offers reads start the moment the bundle and the profile resolve (not the whole first wave)...
  assert.match(before, /const offersEarlyP = opts\.tabs\s*\? afterOne\(Promise\.all\(\[bundleP, profileP, supabaseP\]\), \(\[b, p, s\]\) => \{[\s\S]*?offersFor\(s, fromBundle, p\?\.data \?\? null\)/);
  // ...run beside the colleges and the estimate, never after them...
  assert.match(src, /const \[schoolsInput, estimates, offers\] = await Promise\.all\(\[[\s\S]*?span\("planSchools"[\s\S]*?span\("estimates"[\s\S]*?offersP,\s*\]\);/);
  // ...and only when the plan has a decision (the tab's own gate); a failed read is logged and leaves the stage to read.
  assert.match(src, /function offersFor\([^)]*\): Promise<OffersRead \| null> \{\s*if \(!hasDecision\(plan\.items\)\) return Promise\.resolve\(null\);\s*return readOffers\(supabase, plan, profile\)\.catch\(/);
  // Only the advisor page asks for them (not the print page, the guides, the record, or the APIs).
  const page = read("app/advisor/page.tsx");
  assert.equal((page.match(/loadPlanFor\([^\n]*\{ tabs: true/g) ?? []).length, 3);
  assert.equal((page.match(/tabsRead=\{(loaded|load)\.tabs \?\? null\}/g) ?? []).length, 3);
  for (const other of ["app/advisor/print/page.tsx", "app/advisor/guide/[slug]/page.tsx", "app/household/[person]/record/page.tsx", "app/api/plan/levels/route.ts"]) {
    assert.doesNotMatch(read(other), /tabs: true/, `${other} reads no tab panels`);
  }
});

test("guard: an await before the first wave's gather is caught", () => {
  const broken = read("lib/planner/load.ts").replace("const profileP = profileFor(studentId);", "const profileP = Promise.resolve(await profileFor(studentId));");
  const { before } = firstWaveSource(broken);
  assert.match(before, /\bawait\b/);
});

test("the high-school reads start when the profile resolves, before the rest of the first wave", async () => {
  const { afterOne } = await import("../lib/planner/load-waves.ts");
  const order: string[] = [];
  let finishBundle!: () => void;
  const bundleP = new Promise<void>((r) => (finishBundle = r)).then(() => order.push("plan bundle resolved"));
  const profileP = Promise.resolve({ data: { basics: { highSchoolId: "hs-1" } } }).then((p) => (order.push("profile resolved"), p));
  const contextP = afterOne(profileP, async (p) => {
    order.push(`high-school reads started for ${p.data.basics.highSchoolId}`);
    return "context";
  });
  const gathered = Promise.all([profileP, bundleP]).then(() => order.push("first wave resolved"));
  await contextP;
  assert.deepEqual(order, ["profile resolved", "high-school reads started for hs-1"], "started while the plan bundle was still out");
  finishBundle();
  await gathered;
  assert.deepEqual(order.slice(2), ["plan bundle resolved", "first wave resolved"]);
  // A failed profile surfaces where the chain is awaited, never as an unhandled rejection.
  const failed = afterOne(Promise.reject(new Error("no profile")), async () => "never");
  await assert.rejects(failed, /no profile/);
});

/* ------------------------------------------------------------------ */
/* One settings read                                                   */
/* ------------------------------------------------------------------ */

test("appSettings reads both planner settings in one query; pretend today and the all-moves preview read from it", async () => {
  const hadEnv = process.env.VERCEL_ENV;
  delete process.env.VERCEL_ENV;
  reset({ app_settings: [{ key: "planner.today", value: "2027-03-15" }, { key: "planner.all_moves", value: true }, { key: "other", value: 1 }] });
  const { plannerToday, plannerTodayOverride } = await import("../lib/planner/today-server.ts");
  const { allMovesEnabled } = await import("../lib/planner/all-moves-server.ts");
  const { appSettings, PLANNER_SETTING_KEYS } = await import("../lib/planner/settings-server.ts");
  const [day, today, allMoves] = await Promise.all([plannerTodayOverride(), plannerToday(), allMovesEnabled()]);
  await appSettings();
  assert.equal(day, "2027-03-15");
  assert.equal(today, "2027-03-15");
  assert.equal(allMoves, true);
  assert.equal(g.__planWaves.calls.length, 1, "one read for both settings");
  assert.equal(g.__planWaves.calls[0].table, "app_settings");
  assert.deepEqual(g.__planWaves.calls[0].filters, [["in", "key", [...PLANNER_SETTING_KEYS]]]);
  assert.deepEqual([...PLANNER_SETTING_KEYS].sort(), ["planner.all_moves", "planner.today"]);
  if (hadEnv !== undefined) process.env.VERCEL_ENV = hadEnv;
  // Neither reader queries the table on its own any more.
  for (const f of ["lib/planner/today-server.ts", "lib/planner/all-moves-server.ts"]) assert.doesNotMatch(read(f), /from\("app_settings"\)/, f);
});

/* ------------------------------------------------------------------ */
/* The plan's essays carry the tab's counts                            */
/* ------------------------------------------------------------------ */

const S = "student-1";
const essay = (id: string, student = S) => ({ id, student_id: student, prompt_ref: "main", title: id, updated: "2026-11-01", essays: { student_id: student } });

test("readPlanEssays reads drafts, links, open comments, and suggestions by student in one round", async () => {
  const { readPlanEssays } = await import("../lib/planner/read-plan.ts");
  reset({
    essays: [essay("e1"), essay("e2"), essay("x1", "student-2")],
    essay_links: [{ essay_id: "e1", prompt_ref: "college:100", created: "2026-11-01", essays: { student_id: S } }],
    essay_comments: [
      { essay_id: "e1", resolved_at: null, essays: { student_id: S } },
      { essay_id: "e1", resolved_at: "2026-11-02", essays: { student_id: S } },
      { essay_id: "x1", resolved_at: null, essays: { student_id: "student-2" } },
    ],
    essay_suggestions: [
      { essay_id: "e1", author_id: "guardian-1", status: "open", created: "2026-11-03", essays: { student_id: S } },
      { essay_id: "e2", author_id: "guardian-1", status: "withdrawn", created: "2026-11-02", essays: { student_id: S } },
    ],
  });
  const got = await readPlanEssays(fakeClient() as never, S);
  assert.deepEqual(got?.rows.map((r) => r.id), ["e1", "e2"]);
  assert.deepEqual(got?.links, [{ essay_id: "e1", prompt_ref: "college:100", created: "2026-11-01" }]);
  assert.deepEqual(got?.comments, [{ essay_id: "e1", resolved_at: null }]);
  assert.deepEqual(got?.suggestions, [{ essay_id: "e1", author_id: "guardian-1", status: "open", created: "2026-11-03" }]);
  assert.deepEqual(g.__planWaves.calls.map((c) => c.table).sort(), ["essay_comments", "essay_links", "essay_suggestions", "essays"]);
  for (const c of g.__planWaves.calls.filter((c) => c.table !== "essays")) {
    assert.match(c.columns, /essays!inner\(student_id\)/, `${c.table} joins its draft by student`);
    assert.ok(c.filters.some(([op, col, v]) => op === "eq" && col === "essays.student_id" && v === S));
  }
  // The move's tick asks for the drafts alone.
  reset({ essays: [essay("e1")] });
  const bare = await readPlanEssays(fakeClient() as never, S, { counts: false });
  assert.equal(bare?.comments, undefined);
  assert.deepEqual(g.__planWaves.calls.map((c) => c.table).sort(), ["essay_links", "essays"]);
});

test("the counts: open comments per draft; open suggestions per draft; a guardian's own newest by draft", async () => {
  const { openCommentCounts, suggestionCounts } = await import("../lib/essays/counts.ts");
  assert.deepEqual(openCommentCounts([{ essay_id: "a" }, { essay_id: "a", resolved_at: null }, { essay_id: "b", resolved_at: "2026-11-01" }]), { a: 2 });
  const rows = [
    { essay_id: "a", author_id: "g1", status: "decided" as const, created: "2026-11-05" },
    { essay_id: "a", author_id: "g1", status: "open" as const, created: "2026-11-04" },
    { essay_id: "a", author_id: "g2", status: "open" as const, created: "2026-11-03" },
    { essay_id: "b", author_id: "g1", status: "withdrawn" as const, created: "2026-11-06" },
    { essay_id: "b", author_id: "g1", status: "open" as const, created: "2026-11-01" },
  ];
  assert.deepEqual(suggestionCounts(rows, { role: "guardian", userId: "g1" }), { openSuggestions: { a: 2, b: 1 }, mySuggestions: { a: "decided", b: "open" } });
  assert.deepEqual(suggestionCounts(rows, { role: "student", userId: "g1" }).mySuggestions, {}, "a student has no 'Waiting for' rows");
  assert.deepEqual(suggestionCounts(rows, { role: "counselor", userId: null }).mySuggestions, {});
});

test("essaysTabData counts the plan's rows and makes no further read; without them it falls back to readEssays", async () => {
  const { essaysTabData } = await import("../lib/essays/tab-data.ts");
  const ctx = {
    student: { id: S },
    items: [],
    schools: {},
    essays: {
      rows: [{ id: "e1", prompt_ref: "main" }],
      links: [],
      comments: [{ essay_id: "e1", resolved_at: null }],
      suggestions: [{ essay_id: "e1", author_id: "guardian-1", status: "open", created: "2026-11-03" }],
    },
  };
  reset();
  g.__tabStub.lookups = 0;
  g.__tabStub.readEssays = 0;
  const got = await essaysTabData(ctx as never, "guardian");
  assert.equal(got?.kind, "ready");
  assert.deepEqual(got && got.kind === "ready" ? [got.openComments, got.openSuggestions, got.mySuggestions] : null, [{ e1: 1 }, { e1: 1 }, { e1: "open" }]);
  assert.equal(g.__planWaves.calls.length, 0, "no Supabase read");
  assert.equal(g.__tabStub.readEssays, 0, "no readEssays");
  assert.equal(g.__tabStub.lookups, 1, "only the prompt lookup (its one read started in the plan's first wave)");
  // A plan without drafts (the tables missing, or the read failed) still reads them itself.
  await essaysTabData({ ...ctx, essays: null } as never, "student");
  assert.equal(g.__tabStub.readEssays, 1);
  assert.doesNotMatch(read("lib/essays/tab-data.ts"), /createServerSupabase|from\("essay_/, "the tab never reads the tables itself");
});

/* ------------------------------------------------------------------ */
/* Estimates: same results with a prepared context; the split          */
/* ------------------------------------------------------------------ */

test("planEstimates with a prepared context equals planEstimates without one; prints the context/compute split", async () => {
  const { planEstimates, startEstimateContext } = await import("../lib/planner/plan-estimates.ts");
  const { emptyProfile } = await import("../lib/student-profile.ts");
  const { getData } = await import("../lib/data.ts");
  const { RequestTiming, runWithTiming } = await import("../lib/timing.ts");
  const base = emptyProfile();
  const profile = {
    ...base,
    basics: { ...base.basics, stateOfResidence: "OH", gradYear: 2027 },
    academics: { ...base.academics, gpa: 3.8 },
    tests: { ...base.tests, satTotal: 1400, satMath: 720, satReading: 680 },
  } as unknown as Parameters<typeof planEstimates>[0];
  const all = (await getData()).getAllSchools().map((s) => s.unit_id);
  const items = (ids: string[]) => ids.map((unit_id, i) => ({ id: `item-${i}`, unit_id, visited_on: null, info_requested_on: null }));
  const opts = { gradYear: 2027, today: "2026-11-08" };

  // The first call loads the dataset and fits the GPA models (a cold instance's cost, inside estimates.context).
  const first = new RequestTiming("first");
  const plain = await runWithTiming(first, () => planEstimates(profile, items(all), opts));
  const firstBy = (n: string) => Math.round(first.spans.filter((s) => s.name === n).reduce((a, s) => a + s.dur, 0));
  const prepared = await planEstimates(profile, items(all), { ...opts, context: startEstimateContext(profile) });
  assert.ok(Object.keys(plain).length > 0);
  assert.deepEqual(prepared, plain, "the prepared context changes nothing");

  // The split, warm (the dataset and the fitted models already loaded), for ten colleges and for every one.
  const split = async (ids: string[]) => {
    const t = new RequestTiming("estimates");
    await runWithTiming(t, () => planEstimates(profile, items(ids), opts));
    const by = (n: string) => Math.round(t.spans.filter((s) => s.name === n).reduce((a, s) => a + s.dur, 0) * 10) / 10;
    return { context: by("estimates.context"), compute: by("estimates.compute") };
  };
  const ten = await split(all.slice(0, 10));
  const every = await split(all);
  console.log(`[plan-waves] estimates split, first call (cold), mini fixture, ${all.length} colleges: context ${firstBy("estimates.context")}ms compute ${firstBy("estimates.compute")}ms`);
  console.log(`[plan-waves] estimates split, warm, mini fixture: 10 colleges context ${ten.context}ms compute ${ten.compute}ms; ${all.length} colleges context ${every.context}ms compute ${every.compute}ms`);
  assert.ok(ten.compute < 100, `compute for ten colleges is ${ten.compute}ms (the brief's bar is 100 ms)`);
});
