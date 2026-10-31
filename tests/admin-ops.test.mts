/**
 * The admin console's Health and Operations pages (specs/product/admin.md "The overview",
 * "Operations: reruns and approvals"): the Health table's filters and sort, the CSV route's admin guard, the setup
 * notice when GitHub isn't configured, every Operations action logging before it sends, the Server Actions all
 * checking the admin first, and no email address reaching a GitHub comment, commit message, or PR body. Each guard
 * is shown failing when its rule is broken (a copy of the module with the rule removed fails the same check).
 * No network, no database. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "admin-ops-"));

/* ------------------------------------------------------------------ */
/* Next.js stand-ins                                                   */
/* ------------------------------------------------------------------ */

// The pages, route, and actions are Next.js server code: `server-only`, next/navigation, `@/` paths, and the
// request's session. Stand in for the pieces that need a request (the admin check, Supabase, the data loaders), driven
// by `world` below, and resolve paths the way the bundler does. Everything under lib/admin that is pure runs for real.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
const NOT_FOUND = "const e=new Error('NEXT_HTTP_ERROR_FALLBACK;404');e.digest='NEXT_HTTP_ERROR_FALLBACK;404';throw e";
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  "next/navigation": `export function notFound(){${NOT_FOUND}} export function redirect(u){throw new Error('redirect '+u)}`,
  "next/cache": "export function refresh(){globalThis.__world.refreshed++}",
  "@/lib/admin/auth": "export async function requireAdmin(){globalThis.__world.calls.push('requireAdmin'); if(!globalThis.__world.admin){" + NOT_FOUND + "} return {userId:'admin-1'}}",
  "@/lib/admin/people": "export async function adminSupabase(){globalThis.__world.calls.push('adminSupabase'); return globalThis.__world.supabase()}",
  "@/lib/admin/ops": "export function realOpsDeps(a){globalThis.__world.calls.push('realOpsDeps'); return globalThis.__world.deps(a)} export async function loadOperations(){return globalThis.__world.operations()}",
  // The Health page's Visit events card (lib/admin/visit-events.ts): a loader like the others above, driven by `world`.
  "@/lib/admin/visit-events":
    "export async function loadVisitEventsHealth(){globalThis.__world.calls.push('loadVisitEventsHealth'); return globalThis.__world.visitEvents()} export function cardTone(){return 'green'}",
  // lib/admin/health.ts reaches Supabase through a relative dynamic import; with no auth env the family lists are unavailable.
  "../supabase-server": "export function supabaseAuthEnv(){return false} export async function createServerSupabase(){throw new Error('no request')}",
  "@/lib/data": "export async function getData(){return {getSchoolById:(id)=>globalThis.__world.schools[id]??null}}",
  // The Files view's published files and the estimate inputs (specs/product/admin-health-views.md), tested in
  // tests/admin-health-views.test.mts; here only their shape matters.
  "@/lib/admin/estimate-inputs-load":
    "export async function loadSourceFiles(){return {rows:[],checked:'2026-10-19'}} export async function inputsOverview(){return {all:[],counts:{total:0,overall:{fresh:0,watch:0,stale:0,failing:0},inputs:{}},feeds:{},today:'2026-10-19'}} export function inputsCsv(){return ''}",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return stub(STUBS[specifier]);
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

interface World {
  admin: boolean;
  calls: string[];
  refreshed: number;
  schools: Record<string, unknown>;
  supabase: () => unknown;
  deps: (a: { userId: string }) => unknown;
  operations: () => Promise<unknown>;
  visitEvents: () => Promise<unknown>;
}
const NO_VISIT_EVENTS = async () => ({ runs: [], newest: null, hostsByStatus: { active: 0, unreachable: 0, no_events: 0, off: 0 } });
const world: World = { admin: true, calls: [], refreshed: 0, schools: {}, supabase: () => ({}), deps: () => ({}), operations: async () => ({}), visitEvents: NO_VISIT_EVENTS };
(globalThis as unknown as { __world: World }).__world = world;
function reset(over: Partial<World> = {}) {
  Object.assign(world, { admin: true, calls: [], refreshed: 0, schools: {}, supabase: () => ({}), deps: () => ({}), operations: async () => ({}), visitEvents: NO_VISIT_EVENTS }, over);
}

// No network anywhere in this file.
delete process.env.GITHUB_TOKEN;
delete process.env.GITHUB_APP_ID;
delete process.env.GITHUB_APP_INSTALLATION_ID;
delete process.env.GITHUB_APP_PRIVATE_KEY;
let networkCalls = 0;
globalThis.fetch = (() => {
  networkCalls++;
  throw new Error("network call in a test");
}) as typeof fetch;

const view = await import("../lib/admin/health-view.ts");
const rules = await import("../lib/admin/health-rules.ts");
const opsView = await import("../lib/admin/ops-view.ts");
const opsActions = await import("../lib/admin/ops-actions.ts");
const reviewQueue = await import("../lib/admin/review-queue.ts");
const gh = await import("../lib/github-app.ts");
const { renderPullBody } = await import("../lib/admin/pr-markdown.ts");
const { DISPATCHABLE_RUNS } = await import("../lib/admin/workflows.ts");
type CollegeHealth = import("../lib/admin/health.ts").CollegeHealth;
type HealthRowView = import("../lib/admin/health-view.ts").HealthRowView;
type HealthStatus = import("../lib/admin/health-rules.ts").HealthStatus;
type HealthGroup = import("../lib/admin/health-rules.ts").HealthGroup;
type WorkflowRun = import("../lib/github-app.ts").WorkflowRun;
type ReviewItem = import("../lib/reported.ts").ReviewItem;
type OpsDeps = import("../lib/admin/ops-actions.ts").OpsDeps;

/** A 404 as Next.js throws it. */
const is404 = (e: unknown) => (e as { digest?: string })?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";

/* ------------------------------------------------------------------ */
/* Health: filters and sort                                            */
/* ------------------------------------------------------------------ */

type GroupSpec = Partial<Record<HealthGroup, HealthStatus | null>>;

function college(unit: string, overall: HealthStatus, groups: GroupSpec = {}, extras: { name?: string; state?: string; level?: number; failures?: string[]; queue?: number; rate?: number | null } = {}): HealthRowView {
  const rows = rules.HEALTH_GROUPS.map((group) => ({
    group,
    status: group in groups ? (groups[group] ?? null) : overall,
    judgedBy: "2026-10-01",
    reason: `${group} reason`,
  }));
  const health: CollegeHealth = {
    unitId: unit,
    overall,
    rows,
    changed: null,
    failures: (extras.failures ?? []).map((reason) => ({ reason, stage: "fetch" })),
    queueItems: extras.queue ?? 0,
  };
  const level = extras.level ?? 2;
  return { health, name: extras.name ?? `College ${unit}`, state: extras.state ?? "OH", admitRate: "rate" in extras ? (extras.rate ?? null) : 0.4, tier: { label: `tier ${level}`, level } };
}

const ROWS: HealthRowView[] = [
  college("100001", "fresh", {}, { name: "Alpha", state: "OH", level: 1 }),
  college("100002", "watch", { reported: "watch", federal: "fresh", identity: "fresh", campus: "fresh" }, { name: "Bravo", state: "CA", level: 3 }),
  college("100003", "stale", { reported: "stale", identity: "watch", federal: "fresh", campus: "fresh" }, { name: "Charlie", state: "OH", level: 2, queue: 2 }),
  college("100004", "failing", { reported: "failing", federal: "fresh", identity: "fresh", campus: null }, { name: "Delta", state: "CA", level: 4, failures: ["fetch_failed", "fetch_failed", "read_failed"], queue: 5 }),
  college("100005", "failing", { reported: "failing", identity: "stale", federal: "watch", campus: "fresh" }, { name: "Echo", state: "TX", level: 2, failures: ["fetch_failed"] }),
  college("90", "fresh", {}, { name: "Foxtrot", state: "TX", level: 0, rate: null }),
];
const units = (rows: readonly HealthRowView[]) => rows.map((r) => r.health.unitId);
const filtersOf = (query: string) => view.parseHealthFilters(new URLSearchParams(query));
const FAMILY = new Set(["100002", "100004", "90"]);

test("parseHealthFilters reads the URL and drops anything it doesn't recognize", () => {
  assert.deepEqual(filtersOf(""), { status: null, group: null, reason: null, state: null, tier: null, family: false, sort: "worst", page: 1 });
  assert.deepEqual(filtersOf("status=stale&group=reported&reason=fetch_failed&state=oh&tier=3&family=1&sort=name&page=4"), {
    status: "stale", group: "reported", reason: "fetch_failed", state: "OH", tier: 3, family: true, sort: "name", page: 4,
  });
  const junk = filtersOf("status=bogus&group=nope&reason=A%20B;drop&state=Ohio&tier=9&family=yes&sort=sideways&page=-2");
  assert.deepEqual(junk, filtersOf(""), "every bad value is ignored, the page still opens");
  assert.equal(filtersOf("status=unjudged").status, null, "unjudged means a group's files are missing, so it needs a group");
  assert.equal(filtersOf("status=unjudged&group=campus").status, "unjudged");
  assert.equal(view.parseHealthFilters({ status: ["failing", "fresh"], page: "2" }).status, "failing", "a repeated parameter uses its first value");
  assert.equal(view.parseHealthFilters({ page: "2.5" }).page, 1);
});

test("healthQuery and healthHref round-trip the filters and reset the page when a filter changes", () => {
  const f = filtersOf("status=stale&group=reported&state=OH&sort=queue&page=3");
  assert.equal(view.healthQuery(f), "status=stale&group=reported&state=OH&sort=queue&page=3");
  assert.deepEqual(view.parseHealthFilters(new URLSearchParams(view.healthQuery(f))), f);
  assert.equal(view.healthHref("/admin/health", f, { status: "failing" }), "/admin/health?status=failing&group=reported&state=OH&sort=queue");
  assert.equal(view.healthHref("/admin/health", f, { page: 2 }), "/admin/health?status=stale&group=reported&state=OH&sort=queue&page=2");
  assert.equal(view.healthHref("/admin/health", filtersOf(""), {}), "/admin/health");
  assert.equal(view.isFiltered(filtersOf("sort=name&page=2")), false);
  assert.equal(view.isFiltered(filtersOf("family=1")), true);
});

/** The filter semantics, as one check that takes the filter function under test (so a broken one can be shown failing). */
function checkFilter(filter: typeof view.filterHealthRows) {
  const f = (q: string, family: ReadonlySet<string> | null = FAMILY) => units(filter(ROWS, filtersOf(q), family));
  assert.deepEqual(f(""), units(ROWS), "no filter keeps everything, in order");
  assert.deepEqual(f("status=failing"), ["100004", "100005"], "status alone judges the overall status");
  assert.deepEqual(f("status=stale&group=reported"), ["100003"], "status with a group judges that group's status");
  assert.deepEqual(f("status=failing&group=reported"), ["100004", "100005"]);
  assert.deepEqual(f("group=identity"), ["100003", "100005"], "a group alone lists colleges where it isn't fresh");
  assert.deepEqual(f("status=unjudged&group=campus"), ["100004"], "a group that could not be judged");
  assert.deepEqual(f("reason=read_failed"), ["100004"]);
  assert.deepEqual(f("reason=fetch_failed"), ["100004", "100005"]);
  assert.deepEqual(f("state=ca"), ["100002", "100004"]);
  assert.deepEqual(f("tier=2"), ["100003", "100005"]);
  assert.deepEqual(f("tier=0"), ["90"]);
  assert.deepEqual(f("family=1"), ["100002", "100004", "90"], "on a family's list");
  assert.deepEqual(f("family=1", null), units(ROWS), "with the family lists unavailable the filter is ignored, not empty");
  assert.deepEqual(f("status=failing&state=CA&family=1"), ["100004"], "filters combine with and");
  assert.deepEqual(f("status=fresh&state=CA"), [], "no match is an empty list");
}

test("filterHealthRows: overall status, group status, reason, state, tier, and a family's list", () => {
  checkFilter(view.filterHealthRows);
});

test("the filter check fails when the filter is broken", () => {
  assert.throws(() => checkFilter((rows) => [...rows]), "a filter that keeps everything");
  assert.throws(() => checkFilter((rows, f, family) => view.filterHealthRows(rows, { ...f, group: null }, family)), "a group filter that judges the overall status instead");
  assert.throws(() => checkFilter((rows, f) => view.filterHealthRows(rows, f, new Set())), "a family filter that always runs, even when unavailable");
});

function checkSort(sort: typeof view.sortHealthRows) {
  const input = [...ROWS];
  const before = units(input);
  assert.deepEqual(units(sort(input, "worst")), ["100005", "100004", "100003", "100002", "90", "100001"], "failing before stale before watch before fresh; more non-fresh groups first; unit ids numerically");
  assert.deepEqual(units(sort(input, "name")), ["100001", "100002", "100003", "100004", "100005", "90"]);
  assert.deepEqual(units(sort(input, "failures")).slice(0, 2), ["100004", "100005"], "most open failures first");
  assert.deepEqual(units(sort(input, "queue")).slice(0, 2), ["100004", "100003"], "most review-queue items first");
  assert.deepEqual(units(input), before, "the input is not reordered");
}

test("sortHealthRows: worst first by default, with stable tie-breaks, and the other sorts", () => {
  checkSort(view.sortHealthRows);
  const same = [college("200002", "stale"), college("200001", "stale")];
  assert.deepEqual(units(view.sortHealthRows(same)), ["200001", "200002"], "equal rows fall back to unit id");
});

test("the sort check fails when the sort is broken", () => {
  assert.throws(() => checkSort((rows) => [...rows].reverse()), "best first");
  assert.throws(() => checkSort((rows, s) => view.sortHealthRows(rows, s === "worst" ? "name" : s)), "worst first replaced by name order");
  assert.throws(() => checkSort((rows, s) => (s === "queue" ? ((rows as HealthRowView[]).sort((a, b) => a.health.queueItems - b.health.queueItems)) : view.sortHealthRows(rows, s))), "a sort that reorders its input or sorts ascending");
});

test("pageOf, reasonOptions, stateOptions, failureSummary", () => {
  const many = Array.from({ length: 250 }, (_, i) => i);
  const p = view.pageOf(many, 3);
  assert.deepEqual([p.page, p.pages, p.total, p.from, p.to, p.rows.length], [3, 3, 250, 201, 250, 50]);
  assert.equal(view.pageOf(many, 99).page, 3, "a page past the end is the last page");
  assert.deepEqual(view.pageOf([], 1), { rows: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
  assert.deepEqual(view.reasonOptions(ROWS), [{ code: "fetch_failed", colleges: 2 }, { code: "read_failed", colleges: 1 }], "distinct colleges per reason, most common first");
  assert.deepEqual(view.stateOptions(ROWS), ["CA", "OH", "TX"]);
  assert.equal(view.failureSummary(ROWS[3].health.failures), "fetch failed ×2, read failed");
  assert.equal(view.failureSummary([]), "");
});

test("buildHealthRows joins the dataset's facts; a unit the dataset lacks keeps its id as its name", () => {
  const known = { name: "Alpha", state: "OH", admitRate: 0.31, tier: { label: "Selective", level: 2 } };
  const rows = view.buildHealthRows([ROWS[0].health, ROWS[1].health], (u) => (u === "100001" ? known : null));
  assert.deepEqual([rows[0].name, rows[0].admitRate, rows[0].tier.label], ["Alpha", 0.31, "Selective"]);
  assert.deepEqual([rows[1].name, rows[1].admitRate, rows[1].state], ["100002", null, ""]);
});

/* ------------------------------------------------------------------ */
/* Health: the CSV route's admin guard                                 */
/* ------------------------------------------------------------------ */

const routePath = join(ROOT, "app/admin/health/csv/route.ts");
const request = (query = "") => ({ nextUrl: new URL(`https://example.test/admin/health/csv${query}`) }) as never;

test("the CSV route is a 404 for a signed-out visitor or a non-admin, before anything is read", async () => {
  const route = (await import(pathToFileURL(routePath).href)) as { GET: (r: never) => Promise<Response> };
  reset({ admin: false });
  await assert.rejects(route.GET(request()), is404);
  assert.deepEqual(world.calls, ["requireAdmin"], "nothing else ran: no health read, no database read");
});

test("the CSV route sends the health overview for an admin, honoring the page's filters and sort", async () => {
  const route = (await import(pathToFileURL(routePath).href)) as { GET: (r: never) => Promise<Response> };
  const { healthOverview } = await import("../lib/admin/health.ts");
  const overview = await healthOverview();
  reset({ admin: true });
  const all = await route.GET(request());
  assert.equal(all.status, 200);
  assert.match(all.headers.get("content-type") ?? "", /^text\/csv/);
  assert.match(all.headers.get("content-disposition") ?? "", /^attachment; filename="college-health-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(all.headers.get("cache-control"), "no-store");
  const lines = (await all.text()).trimEnd().split("\r\n");
  assert.match(lines[0], /^unit_id,name,overall,/);
  assert.equal(lines.length - 1, overview.colleges.length, "one line per college");
  const failing = (await (await route.GET(request("?status=failing"))).text()).trimEnd().split("\r\n").slice(1);
  assert.equal(failing.length, overview.counts.overall.failing, "the status filter applies");
  assert.ok(failing.every((l) => l.includes(",failing,")));
  const byName = (await (await route.GET(request("?sort=name&state=OH"))).text()).trimEnd().split("\r\n").slice(1);
  assert.deepEqual(byName.map((l) => l.split(",")[1]).filter((n) => !n.startsWith('"')), [...byName.map((l) => l.split(",")[1]).filter((n) => !n.startsWith('"'))].sort((a, b) => a.localeCompare(b, "en")));
});

/** The route with its admin check removed, as a module. */
async function loadWithout(path: string, snippet: string, replacement: string, name: string) {
  const source = readFileSync(path, "utf8");
  assert.ok(source.includes(snippet), `${name}: the snippet to remove is in the source`);
  const file = join(tmp, name);
  writeFileSync(file, source.replace(snippet, replacement));
  return import(pathToFileURL(file).href);
}

test("the CSV guard test fails when the route skips requireAdmin()", async () => {
  const broken = (await loadWithout(routePath, "  await requireAdmin();\n", "", "route-unguarded.mts")) as { GET: (r: never) => Promise<Response> };
  reset({ admin: false });
  // With the guard gone a non-admin gets the data: the test above would have failed.
  const response = await broken.GET(request());
  assert.equal(response.status, 200);
  assert.ok(!world.calls.includes("requireAdmin"));
});

/* ------------------------------------------------------------------ */
/* Operations: every action logs before it sends                       */
/* ------------------------------------------------------------------ */

const TODAY = "2026-10-12";
const REQ = "0f8c2d1e-4b5a-4c3d-9e8f-123456789abc";

function c1Item(code: string, value: number, over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    unit_id: "999001",
    name: "Example College",
    urls: ["https://www.example.edu/ir/cds-2025-2026.pdf"],
    entering_term: "Fall 2025",
    failures: [{ check: "residency-sum", detail: "applied by residency sums to 15,912, C1 total C.116 is 7,956 (more than 1%)" }],
    queued: "2026-10-11",
    run: "20261011-024817-48",
    code,
    edition: "2025-26",
    sha256: "a".repeat(64),
    value,
    ...over,
  };
}
const TRIO = [c1Item("C.116", 7956), c1Item("C.117", 5006), c1Item("C.118", 1040)];
const HELD = c1Item("H.210", 12, { unit_id: "999002", name: "Other College" });
const QUEUE_TEXT = reviewQueue.linesJson("2026-10-11", "items", [...TRIO, HELD]);
const OVERRIDES_TEXT = read("data/overrides.json");
const FILES: Record<string, { content: string; sha: string }> = {
  "data/review-queue.json": { content: QUEUE_TEXT, sha: "q1" },
  "data/overrides.json": { content: OVERRIDES_TEXT, sha: "o1" },
};

function run(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 1, workflow: "college-reported.yml", name: "College-reported data", title: "College-reported data · x", requestId: null, runNumber: 48, event: "workflow_dispatch",
    status: "in_progress", conclusion: null, createdAt: "2026-10-12T14:00:00Z", startedAt: "2026-10-12T14:00:05Z", updatedAt: "2026-10-12T14:10:00Z", durationMs: null,
    url: "https://github.com/raywross/college-stats/actions/runs/1", actor: "someone", headBranch: "main", ...over,
  };
}

interface FakeOver {
  configured?: boolean;
  noteOk?: boolean;
  runs?: WorkflowRun[];
  dispatch?: { ok: true } | { ok: false; reason: string };
  merge?: Awaited<ReturnType<OpsDeps["gh"]["mergePull"]>>;
  commit?: Awaited<ReturnType<OpsDeps["gh"]["commitFileAndOpenPull"]>>;
  name?: string;
}

/** Fake dependencies that record every call in order, so a test can read the sequence. */
function fakeOps(over: FakeOver = {}) {
  const log: string[] = [];
  const notes: { action: string; details: Record<string, unknown>; requestId: string | null }[] = [];
  const dispatches: { file: string; inputs: Record<string, string>; requestId: string; ref: string }[] = [];
  const commits: import("../lib/github-app.ts").CommitAndPullOptions[] = [];
  const comments: { call: string; admin: string }[] = [];
  const deps: OpsDeps = {
    gh: {
      configured: () => over.configured ?? true,
      dispatchWorkflow: async (file, inputs, requestId, opts) => {
        log.push(`dispatch ${file}`);
        dispatches.push({ file, inputs, requestId, ref: opts.ref });
        return over.dispatch ?? { ok: true };
      },
      listRuns: async () => over.runs ?? [],
      findRunByRequestId: async (requestId) => run({ id: 2, requestId, runNumber: 49 }),
      mergePull: async (n) => {
        log.push(`merge ${n}`);
        return over.merge ?? { ok: true };
      },
      holdPull: async (n, admin) => {
        log.push(`hold ${n}`);
        comments.push({ call: "hold", admin });
        return { ok: true };
      },
      closePull: async (n, admin) => {
        log.push(`close ${n}`);
        comments.push({ call: "close", admin });
        return { ok: true };
      },
      readRepoFile: async (path) => ({ ok: true, ...FILES[path] }),
      commitFileAndOpenPull: async (opts) => {
        log.push(`commit ${opts.branch}`);
        commits.push(opts);
        return over.commit ?? { ok: true, number: 150, url: "https://github.com/raywross/college-stats/pull/150", autoMerge: true };
      },
      readQueue: async () => reviewQueue.readQueue(async (path) => ({ ok: true, ...FILES[path] })),
    },
    note: async (action, details, requestId) => {
      log.push(`note ${action}`);
      notes.push({ action, details, requestId });
      return over.noteOk === false ? { ok: false, message: "the log is down" } : { ok: true };
    },
    adminName: async () => over.name ?? "Ray",
    now: () => new Date(`${TODAY}T15:00:00Z`),
    requestId: () => REQ,
    sleep: async () => undefined,
  };
  return { deps, log, notes, dispatches, commits, comments };
}

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });
const itemId = (i: ReviewItem) => reviewQueue.rowId(i);

/** Every action's log-before-send contract, run against an `ops-actions` module (the real one, or a broken copy). */
async function checkLogBeforeSend(m: typeof opsActions) {
  // dispatch
  let f = fakeOps();
  let r = await m.dispatchRun(f.deps, { run: "college", values: { college: "999001", rediscover: false, auto_merge: true } });
  assert.deepEqual(f.log, ["note ops.dispatch", "dispatch college-reported.yml"], "dispatch: logged first");
  assert.equal(f.notes[0].requestId, REQ, "the log row carries the request id the run is found by");
  assert.equal(f.dispatches[0].requestId, REQ);
  assert.deepEqual(f.notes[0].details, { run: "college", workflow: "college-reported.yml", ref: "main", inputs: { college: "999001", rediscover: "false", auto_merge: "true", mode: "college" } });
  assert.equal(r.status, "done");
  // a log that fails stops the dispatch
  f = fakeOps({ noteOk: false });
  r = await m.dispatchRun(f.deps, { run: "pilot", values: { auto_merge: true } });
  assert.deepEqual(f.log, ["note ops.dispatch"], "dispatch: nothing is sent that the log doesn't show");
  assert.equal(r.status, "error");
  // merge, hold, close
  for (const [fn, action, call] of [[m.mergeDataPull, "ops.merge", "merge 7"], [m.holdDataPull, "ops.hold", "hold 7"], [m.closeDataPull, "ops.close", "close 7"]] as const) {
    f = fakeOps();
    await fn(f.deps, 7);
    assert.deepEqual(f.log, [`note ${action}`, call], `${action}: logged first`);
    assert.deepEqual(f.notes[0].details, { pull: 7 });
    f = fakeOps({ noteOk: false });
    await fn(f.deps, 7);
    assert.deepEqual(f.log, [`note ${action}`], `${action}: not sent when it can't be logged`);
  }
  // review: accept, reject, re-run discovery
  f = fakeOps();
  r = await m.acceptReviewItem(f.deps, itemId(TRIO[0]));
  assert.equal(r.status, "done", JSON.stringify(r));
  assert.deepEqual(f.log.map((l) => l.split(" ")[0] + " " + l.split(" ")[1]?.split("/")[0]), ["note review.accept", "commit review"], "accept: logged before the PR is opened");
  f = fakeOps();
  await m.rejectReviewItem(f.deps, itemId(TRIO[0]));
  assert.equal(f.log[0], "note review.reject");
  assert.match(f.log[1], /^commit review\//);
  f = fakeOps();
  await m.rediscoverReviewItem(f.deps, itemId(TRIO[0]));
  assert.deepEqual(f.log, ["note review.rediscover", "dispatch college-reported.yml"], "re-run discovery: logged, then one dispatch and no PR");
  f = fakeOps({ noteOk: false });
  await m.acceptReviewItem(f.deps, itemId(TRIO[0]));
  assert.deepEqual(f.log, ["note review.accept"], "accept: no PR when it can't be logged");
}

test("every Operations action logs to the admin log before it sends anything to GitHub", async () => {
  await checkLogBeforeSend(opsActions);
});

test("the log-before-send check fails when an action sends first or ignores a failed log", async () => {
  const path = join(ROOT, "lib/admin/ops-actions.ts");
  /** A copy of ops-actions.ts with `edits` applied; its relative imports point at the real files. */
  async function broken(name: string, edits: [string, string][]) {
    let source = readFileSync(path, "utf8");
    for (const [from, to] of edits) {
      assert.ok(source.includes(from), `${name}: snippet is in the source: ${from.slice(0, 50)}`);
      source = source.replace(from, to);
    }
    source = source.replace(/from "(\.\.?\/[^"]+)"/g, (_m, p: string) => `from ${JSON.stringify(pathToFileURL(join(ROOT, "lib/admin", p)).href)}`);
    const file = join(tmp, `${name}.mts`);
    writeFileSync(file, source);
    return (await import(pathToFileURL(file).href)) as typeof opsActions;
  }
  const sendsFirst = await broken("merge-first", [
    ['const blocked = await logBefore(deps, "ops.merge", { pull: n }, null);\n  if (blocked) return blocked;\n  const r = await deps.gh.mergePull(n);', 'const r = await deps.gh.mergePull(n);\n  await logBefore(deps, "ops.merge", { pull: n }, null);'],
  ]);
  await assert.rejects(checkLogBeforeSend(sendsFirst), "a merge that logs after sending");
  const ignoresFailure = await broken("ignores-log-failure", [["  if (blocked) return blocked;\n\n  const sent", "  const sent"]]);
  await assert.rejects(checkLogBeforeSend(ignoresFailure), "a dispatch that goes ahead when it can't be logged");
  const noLog = await broken("no-hold-log", [['const blocked = await logBefore(deps, "ops.hold", { pull: n }, null);\n  if (blocked) return blocked;\n', ""]]);
  await assert.rejects(checkLogBeforeSend(noLog), "a hold that isn't logged");
});

test("dispatch guards: the typed table, the word for a full run, the one-at-a-time rule, and a refused send", async () => {
  let f = fakeOps();
  let r = await opsActions.dispatchRun(f.deps, { run: "all", values: { auto_merge: true, max_cost: "150" } });
  assert.equal(r.status, "error", "a full run needs the word");
  assert.deepEqual(f.log, [], "refused before anything is logged or sent");
  r = await opsActions.dispatchRun(f.deps, { run: "all", values: { auto_merge: true, max_cost: "150" }, confirm: "all" });
  assert.equal(r.status, "done");
  assert.deepEqual(f.dispatches[0].inputs, { auto_merge: "true", max_cost: "150", mode: "all" });

  f = fakeOps({ runs: [run({ status: "in_progress" })] });
  r = await opsActions.dispatchRun(f.deps, { run: "college", values: { college: "999001", rediscover: false, auto_merge: true } });
  assert.equal(r.status, "error");
  assert.match(r.status === "error" ? r.message : "", /already in progress/);
  assert.deepEqual(f.log, [], "a running workflow is not logged or dispatched again");
  f = fakeOps({ runs: [run({ status: "in_progress" })] });
  assert.equal((await opsActions.dispatchRun(f.deps, { run: "publish", values: { what: "all" } })).status, "done", "publish has no one-at-a-time guard");

  f = fakeOps();
  r = await opsActions.dispatchRun(f.deps, { run: "college", values: { college: "12", rediscover: false, auto_merge: true } });
  assert.equal(r.status, "error", "a unit id is six digits");
  assert.deepEqual(f.log, []);
  r = await opsActions.dispatchRun(f.deps, { run: "rm-rf", values: {} });
  assert.equal(r.status, "error", "only the console's own table can be dispatched");

  f = fakeOps({ dispatch: { ok: false, reason: "dispatch 422" } });
  r = await opsActions.dispatchRun(f.deps, { run: "pilot", values: { auto_merge: true } });
  assert.deepEqual(f.log, ["note ops.dispatch", "dispatch college-reported.yml", "note ops.failed"], "a refused send is logged as a failure");
  assert.equal(f.notes[1].details.reason, "dispatch 422");
  assert.equal(r.status, "error");

  f = fakeOps();
  r = await opsActions.dispatchRun(f.deps, { run: "verify", values: {}, branch: "data/identity-refresh-20261012" });
  assert.equal(f.dispatches[0].ref, "data/identity-refresh-20261012", "Re-run CI runs on the pull request's branch");
  r = await opsActions.dispatchRun(f.deps, { run: "verify", values: {}, branch: "main" });
  assert.equal(r.status, "error", "never on main by that route");
});

test("a dispatch finds its run by request id and links it; when GitHub hasn't listed it yet, it says so", async () => {
  let f = fakeOps();
  let r = await opsActions.dispatchRun(f.deps, { run: "identity", values: { force: false } });
  assert.deepEqual(r, { status: "done", message: "Refresh links, social, brand started.", link: { href: "https://github.com/raywross/college-stats/actions/runs/1", label: "Run #49 on GitHub" } });
  f = fakeOps();
  let looked = 0;
  f.deps.gh.findRunByRequestId = async () => {
    looked++;
    return null;
  };
  r = await opsActions.dispatchRun(f.deps, { run: "identity", values: { force: false } });
  assert.equal(looked, opsActions.FIND_RUN_ATTEMPTS);
  assert.equal(r.status, "done");
  assert.match(r.status === "done" ? r.message : "", /appears under Runs/);
});

test("merge: a refusal comes back in words and is logged as a failure", async () => {
  const f = fakeOps({ merge: { ok: false, reason: "checks_pending" } });
  const r = await opsActions.mergeDataPull(f.deps, 7);
  assert.deepEqual(f.log, ["note ops.merge", "merge 7", "note ops.failed"]);
  assert.match(r.status === "error" ? r.message : "", /checks are still running/);
  const failed = fakeOps({ merge: { ok: false, reason: "checks_failed" } });
  assert.match((await opsActions.mergeDataPull(failed.deps, 7)).status === "error" ? "ok" : "", /ok/);
});

test("review: Accept opens the override PR with the item; a refusal is the plan's reason and sends nothing", async () => {
  let f = fakeOps();
  const r = await opsActions.acceptReviewItem(f.deps, itemId(TRIO[0]));
  assert.equal(r.status, "done");
  assert.equal(f.commits[0].branch, `review/999001-c-116-${TODAY}`);
  assert.equal(f.commits[0].path, "data/overrides.json");
  assert.deepEqual(f.notes[0].details, { unit: "999001", code: "C.116", edition: "2025-26", branch: `review/999001-c-116-${TODAY}`, items: ["C.116", "C.117", "C.118"] });
  assert.equal(r.status === "done" ? r.link?.href : "", "https://github.com/raywross/college-stats/pull/150");

  f = fakeOps();
  const refused = await opsActions.acceptReviewItem(f.deps, itemId(HELD));
  assert.equal(refused.status, "error");
  assert.match(refused.status === "error" ? refused.message : "", /H\.210/, "the plan's own reason");
  assert.deepEqual(f.log, [], "an item that can't be accepted is not logged as accepted or committed");

  f = fakeOps();
  assert.equal((await opsActions.acceptReviewItem(f.deps, "999999|x|y")).status, "error", "an id that isn't in the queue on main");
  assert.deepEqual(f.log, []);

  f = fakeOps();
  const rejected = await opsActions.rejectReviewItem(f.deps, itemId(HELD));
  assert.equal(rejected.status, "done", "an item that can't be accepted can still be rejected");
  assert.equal(f.commits[0].path, "data/review-queue.json");

  f = fakeOps();
  await opsActions.rediscoverReviewItem(f.deps, itemId(HELD));
  assert.deepEqual(f.dispatches[0].inputs, { college: "999002", rediscover: "true", auto_merge: "true", mode: "college" });
  assert.deepEqual(f.commits, [], "Re-run discovery only dispatches");
});

test("nothing is logged or sent when GitHub isn't configured", async () => {
  const f = fakeOps({ configured: false });
  const results = [
    await opsActions.dispatchRun(f.deps, { run: "pilot", values: { auto_merge: true } }),
    await opsActions.mergeDataPull(f.deps, 7),
    await opsActions.holdDataPull(f.deps, 7),
    await opsActions.closeDataPull(f.deps, 7),
    await opsActions.acceptReviewItem(f.deps, "x"),
    await opsActions.rejectReviewItem(f.deps, "x"),
    await opsActions.rediscoverReviewItem(f.deps, "x"),
  ];
  assert.ok(results.every((r) => r.status === "error"));
  assert.deepEqual(f.log, []);
});

test("readDispatchForm reads each shown input: a ticked box is true, an unticked box false", () => {
  const college = opsActions.readDispatchForm(form({ run: "college", college: " 999001 ", auto_merge: "on" }));
  assert.deepEqual(college, { run: "college", values: { college: " 999001 ", rediscover: false, auto_merge: true }, confirm: "", branch: "" });
  const unknown = opsActions.readDispatchForm(form({ run: "nope", sneaky: "1" }));
  assert.deepEqual(unknown.values, {}, "fields the table doesn't declare are never passed on");
  assert.equal(opsActions.pullNumber(form({ pull: "12" })), 12);
  assert.equal(opsActions.pullNumber(form({ pull: "12abc" })), null);
  assert.equal(opsActions.pullNumber(form({ pull: "-1" })), null);
});

/* ------------------------------------------------------------------ */
/* Server Actions check the admin first                                */
/* ------------------------------------------------------------------ */

const actionsPath = join(ROOT, "app/admin/operations/actions.ts");
const formData = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const ACTION_FORMS: Record<string, Record<string, string>> = {
  dispatchAction: { run: "pilot", auto_merge: "on" },
  mergeAction: { pull: "7" },
  holdAction: { pull: "7" },
  closeAction: { pull: "7" },
  rerunCiAction: { branch: "data/x-1" },
  acceptAction: { item: "x" },
  rejectAction: { item: "x" },
  rediscoverAction: { item: "x" },
};

test("every Server Action is a 404 for a non-admin before it builds dependencies or reads the form", async () => {
  const actions = (await import(pathToFileURL(actionsPath).href)) as Record<string, (prev: unknown, f: FormData) => Promise<unknown>>;
  assert.deepEqual(Object.keys(actions).sort(), Object.keys(ACTION_FORMS).sort(), "this test covers every exported action");
  for (const [name, fields] of Object.entries(ACTION_FORMS)) {
    reset({ admin: false });
    await assert.rejects(actions[name]({ status: "idle" }, formData(fields)), is404, name);
    assert.deepEqual(world.calls, ["requireAdmin"], `${name}: nothing ran after the admin check failed`);
  }
  assert.equal(networkCalls, 0);
});

test("a Server Action for an admin runs the work and refreshes the page after a success", async () => {
  const actions = (await import(pathToFileURL(actionsPath).href)) as Record<string, (prev: unknown, f: FormData) => Promise<{ status: string }>>;
  const f = fakeOps();
  reset({ admin: true, deps: () => f.deps });
  assert.equal((await actions.holdAction({ status: "idle" }, formData({ pull: "7" }))).status, "done");
  assert.deepEqual(f.log, ["note ops.hold", "hold 7"]);
  assert.equal(world.refreshed, 1);
  assert.equal((await actions.holdAction({ status: "idle" }, formData({ pull: "oops" }))).status, "error", "a malformed form");
  assert.equal(world.refreshed, 1, "no refresh after an error");
});

test("the Server Action guard test fails when an action skips requireAdmin()", async () => {
  const broken = (await loadWithout(actionsPath, "export async function closeAction(_previous: OpsState, form: FormData): Promise<OpsState> {\n  const admin = await requireAdmin();", "export async function closeAction(_previous: OpsState, form: FormData): Promise<OpsState> {\n  const admin = { userId: 'x' };", "actions-unguarded.mts")) as Record<string, (prev: unknown, f: FormData) => Promise<{ status: string }>>;
  const f = fakeOps();
  reset({ admin: false, deps: () => f.deps });
  assert.equal((await broken.closeAction({ status: "idle" }, formData({ pull: "7" }))).status, "done", "a non-admin could close a pull request: the guard test above would have failed");
});

test("static: each exported action starts with requireAdmin(); the pages and route call it before reading anything", () => {
  const actions = read("app/admin/operations/actions.ts");
  assert.ok(actions.startsWith('"use server";'));
  const bodies = [...actions.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n(.*)\n/g)];
  assert.equal(bodies.length, Object.keys(ACTION_FORMS).length);
  for (const [, name, firstLine] of bodies) assert.match(firstLine, /await requireAdmin\(\)/, `${name} starts with requireAdmin()`);
  for (const file of ["app/admin/health/page.tsx", "app/admin/health/files/page.tsx", "app/admin/operations/page.tsx"]) {
    const src = read(file);
    const body = src.slice(src.indexOf("export default async function"));
    assert.match(body, /\{\n\s+await requireAdmin\(\);/, `${file} calls requireAdmin() first`);
    assert.match(src, /robots: \{ index: false \}/, `${file} is noindex`);
  }
  for (const file of ["app/admin/health/csv/route.ts", "app/admin/health/inputs-csv/route.ts"]) {
    const route = read(file);
    assert.match(route.slice(route.indexOf("export async function GET")), /\{\n\s+await requireAdmin\(\);/, `${file} calls requireAdmin() first`);
  }
});

test("static: client components import none of the server-only modules (the GitHub client, the App key's module, the log)", () => {
  const dir = join(ROOT, "components/admin/ops");
  const forbidden = /from "@\/lib\/(github-app|admin\/ops|admin\/ops-actions|admin\/people|admin\/auth|admin\/review-queue)"/;
  for (const name of readdirSync(dir)) {
    const src = readFileSync(join(dir, name), "utf8");
    if (!/^"use client"/.test(src)) continue;
    const imports = src.split("\n").filter((l) => /^import /.test(l) && !/^import type /.test(l));
    assert.deepEqual(imports.filter((l) => forbidden.test(l) && !/import type/.test(l)), [], `${name} (a client component) imports server code`);
  }
});

/* ------------------------------------------------------------------ */
/* The pages: setup notice, run forms, family filter                   */
/* ------------------------------------------------------------------ */

const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(reactUrl)};\nexport default ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);`);

/** A component stand-in that renders as `<div data-stub="Name" data-props='{…}'>` with its primitive props, so a page's layout can be read without its client code. */
function stubModule(name: string, names: string[]): string {
  const file = join(tmp, `stub-${name}.mjs`);
  writeFileSync(
    file,
    `import React from ${JSON.stringify(reactUrl)};
const make = (n) => ({ children, ...props }) => {
  const plain = Object.fromEntries(Object.entries(props).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v) || v === null));
  return React.createElement("div", { "data-stub": n, "data-props": JSON.stringify(plain) }, children);
};
${names.map((n) => `export const ${n} = make(${JSON.stringify(n)});`).join("\n")}\n`,
  );
  return pathToFileURL(file).href;
}

/** Transpiles a page, replaces its component imports with stand-ins, and loads it with the real lib modules. */
async function loadTsx(rel: string): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  let n = 0;
  const code = outputText
    .replace(/from "next\/link"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "link.mjs")).href)}`)
    .replace(/import \{([^}]*)\} from "(@\/(?:components|app)\/[^"]+)";/g, (_m, names: string, spec: string) => {
      const list = names.split(",").map((s) => s.trim().split(" as ").pop()!.trim()).filter(Boolean);
      return `import {${names}} from ${JSON.stringify(stubModule(`${rel.replace(/[^a-z]/gi, "_")}${n++}-${spec.split("/").pop()}`, list))};`;
    });
  const file = join(tmp, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}
type Page = (props: { searchParams: Promise<Record<string, string | undefined>> }) => Promise<import("react").ReactElement>;
const loadPage = async (rel: string) => ((await loadTsx(rel)).default as Page);
const html = (element: import("react").ReactElement) => renderToStaticMarkup(element);
const stubsIn = (markup: string) => [...markup.matchAll(/data-stub="(\w+)" data-props="([^"]*)"/g)].map((m) => ({ name: m[1], props: JSON.parse(m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Record<string, unknown> }));

test("Operations without GitHub credentials shows the setup notice and no buttons or forms", async () => {
  const page = await loadPage("app/admin/operations/page.tsx");
  reset({ admin: true, operations: async () => ({ configured: null, runs: [], pulls: [], queue: null, cost: null }) });
  const markup = html(await page({ searchParams: Promise.resolve({}) }));
  assert.match(markup, /Operations isn&#x27;t set up yet/);
  assert.match(markup, /GITHUB_APP_ID/);
  assert.match(markup, /GITHUB_TOKEN/);
  assert.equal(stubsIn(markup).length, 0, "no run form, no pull request list, no queue");
  assert.doesNotMatch(markup, /<button|<form|<input/);
  assert.equal(world.calls[0], "requireAdmin");
  reset({ admin: false });
  await assert.rejects(page({ searchParams: Promise.resolve({}) }), is404, "and a 404 for anyone but an admin");
});

test("loadOperations makes no GitHub call without credentials", async () => {
  const real = (await import("../lib/admin/ops.ts")) as typeof import("../lib/admin/ops.ts");
  const before = networkCalls;
  assert.deepEqual(await real.loadOperations(), { configured: null, runs: [], pulls: [], queue: null, cost: null });
  assert.equal(networkCalls, before);
});

test("Operations with credentials: a form per dispatchable run, the running one shown instead of its button, ?unit= prefilled", async () => {
  const page = await loadPage("app/admin/operations/page.tsx");
  const running = run({ status: "in_progress", runNumber: 51 });
  const queueRows = reviewQueue.queueRows({ updated: "2026-10-11", items: [...TRIO, HELD] } as never);
  reset({
    admin: true,
    operations: async () => ({
      configured: { mode: "app" },
      runs: [{ run: running, consoleAdmin: null, failedStep: null, pull: null }],
      pulls: [],
      queue: { ok: true, updated: "2026-10-11", rows: queueRows, items: [...TRIO, HELD] },
      cost: { last: { run: "r", finished: null, colleges: 1900, costUsd: 15.56 }, projection: null },
    }),
  });
  const markup = html(await page({ searchParams: Promise.resolve({ unit: "999001" }) }));
  const stubs = stubsIn(markup);
  const formCount = stubs.filter((s) => s.name === "RunForm").length;
  const guarded = DISPATCHABLE_RUNS.filter((r) => r.guards.oneAtATime && r.workflow === "college-reported.yml");
  assert.equal(formCount, DISPATCHABLE_RUNS.length - guarded.length, "the four college-reported runs show the running run instead of a form");
  assert.equal((markup.match(/is already in progress/g) ?? []).length, guarded.length);
  assert.match(markup, /Run #51 on GitHub/);
  assert.ok(stubs.filter((s) => s.name === "RunForm").every((s) => s.props.prefillUnit === "999001"), "?unit= prefills the college run");
  assert.match(markup, /<details open=""[^>]*>[\s\S]*?Re-read one college/, "and opens the college run");
  assert.equal(stubs.filter((s) => s.name === "ReviewQueueTable").length, 1);
  assert.match(markup, /for college 999001/, "the queue is narrowed to the college");
});

test("Operations shows the review queue's read error instead of a table", async () => {
  const page = await loadPage("app/admin/operations/page.tsx");
  reset({ admin: true, operations: async () => ({ configured: { mode: "pat" }, runs: [], pulls: [], queue: { ok: false, reason: "read 404" }, cost: null }) });
  const markup = html(await page({ searchParams: Promise.resolve({}) }));
  assert.match(markup, /Couldn&#x27;t read the review queue from GitHub: read 404/);
  assert.equal(stubsIn(markup).filter((s) => s.name === "ReviewQueueTable").length, 0);
});

test("the Health page's Files view shows the inputs' date, hides the family filter when the lists can't be read, and links the CSV with the filters", async () => {
  const page = await loadPage("app/admin/health/files/page.tsx");
  reset({ admin: true });
  const markup = html(await page({ searchParams: Promise.resolve({ status: "failing", state: "oh" }) }));
  const stubs = stubsIn(markup);
  assert.equal(world.calls[0], "requireAdmin");
  assert.match(markup, /Health inputs are from [A-Z][a-z]{2} \d{1,2}, \d{4}; measured [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
  const filterForm = stubs.find((s) => s.name === "HealthFilterForm");
  assert.equal(filterForm?.props.familyAvailable, false, "no family lists in this environment, so the filter is hidden");
  assert.equal(filterForm?.props.csvHref, "/admin/health/csv?status=failing&state=OH");
  assert.deepEqual(stubs.map((s) => s.name).filter((n) => n.startsWith("Health")), ["HealthTabs", "HealthStats", "HealthFilterForm", "HealthTable"]);
  assert.ok(stubs.some((s) => s.name === "SourceFilesTable"), "the published files come first");
  reset({ admin: false });
  await assert.rejects(page({ searchParams: Promise.resolve({}) }), is404);
});

test("HealthFilterForm renders the family-list checkbox only when the lists were read", async () => {
  const mod = (await loadTsx("components/admin/ops/HealthFilterForm.tsx")) as { HealthFilterForm: (p: Record<string, unknown>) => import("react").ReactElement };
  const props = { filters: filtersOf("status=stale&group=reported&reason=fetch_failed&state=OH&sort=queue"), reasons: [{ code: "fetch_failed", colleges: 3 }], states: ["CA", "OH"], csvHref: "/admin/health/csv" };
  const without = html(mod.HealthFilterForm({ ...props, familyAvailable: false }));
  const withIt = html(mod.HealthFilterForm({ ...props, familyAvailable: true }));
  assert.doesNotMatch(without, /name="family"/);
  assert.match(withIt, /name="family"/);
  assert.match(without, /<form [^>]*action="\/admin\/health\/files" method="get"/);
  assert.match(without, /<option value="stale" selected/, "the URL's filters are the form's values");
  assert.match(without, /<option value="fetch_failed" selected/);
  assert.match(without, /fetch failed \(3\)/);
  assert.match(without, /<option value="OH" selected/);
  assert.match(without, /<option value="queue" selected/);
});

test("HealthTable lists each college with its tier, admit rate, groups, failures and queue, linking the college's console page", async () => {
  const mod = (await loadTsx("components/admin/ops/HealthTable.tsx")) as { HealthTable: (p: Record<string, unknown>) => import("react").ReactElement };
  const markup = html(mod.HealthTable({ rows: [ROWS[3], ROWS[0]] }));
  assert.ok(markup.indexOf("Delta") < markup.indexOf("Alpha"), "rows keep the order they are given (worst first from the page)");
  assert.match(markup, /href="\/admin\/colleges\/100004"/);
  assert.match(markup, /fetch failed ×2, read failed/);
  assert.match(markup, /href="\/admin\/operations\?unit=100004#review-queue"/, "queue items link to that college's queue");
  assert.match(markup, /tier 4/);
  assert.match(markup, /40% admitted/);
  assert.match(markup, /Oct 1, 2026/, "each group cell shows the date it is judged by");
  assert.match(html(mod.HealthTable({ rows: [ROWS[5]] })), /no admit rate/);
  assert.match(html(mod.HealthTable({ rows: [] })), /No college matches these filters/);
});

test("HealthStats links every count to the table filtered to it and marks the filter that is on", async () => {
  const mod = (await loadTsx("components/admin/ops/HealthStats.tsx")) as { HealthStats: (p: Record<string, unknown>) => import("react").ReactElement };
  const zero = { fresh: 0, watch: 0, stale: 0, failing: 0 };
  const counts = {
    total: 9,
    overall: { fresh: 2, watch: 3, stale: 1, failing: 3 },
    groups: Object.fromEntries(rules.HEALTH_GROUPS.map((g) => [g, { ...zero, fresh: 5, stale: g === "reported" ? 4 : 0, unjudged: 0 }])),
  };
  const markup = html(mod.HealthStats({ counts, filters: filtersOf("status=stale&group=reported") }));
  assert.match(markup, /href="\/admin\/health\/files\?status=failing"/);
  assert.match(markup, /<a href="\/admin\/health\/files"[^>]*aria-current="true"[^>]*>4<\/a>/, "the filter that is on is marked, and clicking it clears it");
  assert.match(markup, /href="\/admin\/health\/files\?status=fresh&amp;group=federal"/);
  assert.doesNotMatch(markup, /Not judged/, "the column appears only when some group could not be judged");
  assert.match(html(mod.HealthStats({ counts: { ...counts, groups: { ...counts.groups, campus: { ...zero, unjudged: 2 } } }, filters: filtersOf("") })), /Not judged/);
});

/* ------------------------------------------------------------------ */
/* No email address reaches GitHub                                     */
/* ------------------------------------------------------------------ */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

test("publicName never lets an email address (or anything shaped like one) through", () => {
  for (const bad of ["ray@example.com", "Ray <ray@example.com>", "ray.wross", "example.com", "", "   ", null, undefined]) {
    assert.equal(opsActions.publicName(bad as never), "an admin", String(bad));
  }
  assert.equal(opsActions.publicName("Ray Ross"), "Ray Ross");
  assert.equal(opsActions.publicName("  Ray\nRoss\t "), "Ray Ross", "one line");
  assert.equal(opsActions.publicName("R".repeat(200)).length, 80);
});

test("the publicName check fails when the filter is removed", async () => {
  const source = read("lib/admin/ops-actions.ts").replace('if (!name || name.includes("@") || /\\b[\\w-]+\\.[a-z]{2,}\\b/i.test(name)) return "an admin";', 'if (!name) return "an admin";');
  assert.notEqual(source, read("lib/admin/ops-actions.ts"));
  const file = join(tmp, "ops-actions-leaky.mts");
  writeFileSync(file, source.replace(/from "(\.\.?\/[^"]+)"/g, (_m, p: string) => `from ${JSON.stringify(pathToFileURL(join(ROOT, "lib/admin", p)).href)}`));
  const leaky = (await import(pathToFileURL(file).href)) as typeof opsActions;
  assert.equal(leaky.publicName("ray@example.com"), "ray@example.com", "the broken copy leaks, so the test above would fail");
});

test("the acting admin's name comes from their profile's display name; an email there becomes 'an admin'", async () => {
  const real = (await import("../lib/admin/ops.ts")) as typeof import("../lib/admin/ops.ts");
  const profile = (display_name: string | null) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name }, error: null }) }) }) }),
  });
  reset({ supabase: () => profile("Ray Ross") });
  assert.equal(await real.realOpsDeps({ userId: "u1" }).adminName(), "Ray Ross");
  reset({ supabase: () => profile("rayuno@gmail.com") });
  assert.equal(await real.realOpsDeps({ userId: "u1" }).adminName(), "an admin");
  reset({ supabase: () => profile(null) });
  assert.equal(await real.realOpsDeps({ userId: "u1" }).adminName(), "an admin");
});

test("hold, close, and the review PRs carry the display name and no email: every request body GitHub receives is checked", async () => {
  // The real client over a fake fetch, with an admin whose profile name is an email address.
  const API = "https://api.github.com/repos/raywross/college-stats";
  const bodies: string[] = [];
  const pull = { number: 7, node_id: "PR_7", state: "open", draft: false, auto_merge: { x: 1 }, base: { ref: "main" }, head: { ref: "review/999001-c-116-2026-10-12", sha: "s", repo: { full_name: "raywross/college-stats" } } };
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (init?.body) bodies.push(String(init.body));
    const u = String(url);
    if (u === `${API}/pulls/7` && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify(pull), { status: 200 });
    if (u.endsWith("/issues/7/comments")) return new Response("{}", { status: 201 });
    if (u.endsWith("/graphql")) return new Response(JSON.stringify({ data: {} }), { status: 200 });
    if (u === `${API}/pulls/7`) return new Response("{}", { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  gh.resetTokenCache();
  const env = { GITHUB_TOKEN: "github_pat_test" };
  const name = opsActions.publicName("rayuno@gmail.com");
  assert.deepEqual(await gh.holdPull(7, name, { env, fetch: fetchImpl, log: () => undefined }), { ok: true });
  assert.deepEqual(await gh.closePull(7, name, { env, fetch: fetchImpl, log: () => undefined }), { ok: true });
  assert.ok(bodies.some((b) => b.includes("Held by an admin")) && bodies.some((b) => b.includes("Closed by an admin")));

  // The review change: commit message, PR title and body, release note, with the same name.
  const built = reviewQueue.acceptChange(TRIO[0], { content: OVERRIDES_TEXT, sha: "o1" }, TRIO, { admin: name, today: TODAY, placeholder: gh.PR_NUMBER_PLACEHOLDER });
  assert.ok(built.ok);
  if (built.ok) for (const text of [built.change.message, built.change.title, built.change.body, built.change.releaseNote.content, built.change.branch]) assert.doesNotMatch(text, EMAIL);
  for (const text of bodies) assert.doesNotMatch(text, EMAIL);

  // And through the action: whatever name the dependencies give, an email-shaped one never reaches the client.
  const f = fakeOps({ name });
  await opsActions.holdDataPull(f.deps, 7);
  await opsActions.closeDataPull(f.deps, 7);
  await opsActions.acceptReviewItem(f.deps, itemId(TRIO[0]));
  assert.deepEqual(f.comments.map((c) => c.admin), ["an admin", "an admin"]);
  for (const c of f.commits) for (const text of [c.message, c.title, c.body, c.releaseNote.content]) assert.doesNotMatch(text, EMAIL);
});

test("the leak check fails when a raw email is used as the admin's name", () => {
  const built = reviewQueue.acceptChange(TRIO[0], { content: OVERRIDES_TEXT, sha: "o1" }, TRIO, { admin: "rayuno@gmail.com", today: TODAY, placeholder: gh.PR_NUMBER_PLACEHOLDER });
  assert.ok(built.ok);
  if (built.ok) assert.match(built.change.message, EMAIL, "an email as the name reaches the commit message: why publicName stands in front of every call");
});

test("the action and library sources never read an auth email", () => {
  for (const file of ["app/admin/operations/actions.ts", "lib/admin/ops-actions.ts", "lib/admin/ops.ts"]) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(code, /\bemail\b|admin_user_auth|auth\.getUser|\.user\.email/i, `${file} doesn't touch an email`);
  }
});

/* ------------------------------------------------------------------ */
/* Pull request bodies render as untrusted text                        */
/* ------------------------------------------------------------------ */

test("renderPullBody: markdown renders, raw HTML is shown as text, images and unsafe links lose their power", () => {
  const out = renderPullBody(
    [
      "**Tripped:** the breaker",
      "",
      "| College | Cost |\n|---|---|\n| A | $1 |",
      "",
      "<script>alert(1)</script>",
      "",
      '<img src="https://evil.example/x.png" onerror="alert(1)">',
      "",
      "[ok](https://github.com/raywross/college-stats/pull/1) [bad](javascript:alert(1)) ![pixel](https://evil.example/p.png)",
    ].join("\n"),
  );
  assert.match(out, /<strong>Tripped:<\/strong>/);
  assert.match(out, /<div class="spec-table"><table>/);
  assert.doesNotMatch(out, /<script|<img|<[^>]*onerror|href="javascript/i, "no live script, image, handler, or javascript: link");
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /<a href="https:\/\/github\.com\/raywross\/college-stats\/pull\/1" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>/);
  assert.match(out, /<a href="https:\/\/evil\.example\/p\.png"[^>]*>pixel<\/a>/, "an image is a link, never loaded");
});

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

test("run display: who started it, how long, how it ended, and the merge block", () => {
  assert.equal(opsView.startedBy(run({ event: "schedule" }), null), "Schedule");
  assert.equal(opsView.startedBy(run({ requestId: REQ }), "Ray Ross"), "Console, Ray Ross");
  assert.equal(opsView.startedBy(run({ requestId: REQ }), null), "Console");
  assert.equal(opsView.startedBy(run({ requestId: null, actor: "octocat" }), null), "GitHub, octocat");
  assert.equal(opsView.formatDuration(42_000), "42 s");
  assert.equal(opsView.formatDuration(14 * 60_000), "14 min");
  assert.equal(opsView.formatDuration(3_900_000), "1 h 5 min");
  assert.equal(opsView.formatDuration(null), "—");
  assert.deepEqual(opsView.runOutcome(run({ status: "completed", conclusion: "failure" })), { label: "Failed", tone: "failed" });
  assert.deepEqual(opsView.runOutcome(run({ status: "queued" })), { label: "Queued", tone: "running" });
  assert.equal(opsView.runFailed(run({ status: "completed", conclusion: "success" })), false);
  assert.equal(opsView.dayLabel("2026-10-04T10:00:00Z"), "Oct 4, 2026");
  assert.equal(opsView.timeLabel("2026-10-04T14:02:33Z"), "Oct 4, 14:02 UTC");
  assert.equal(opsView.usd(1234.5), "$1,234.50");
  assert.equal(opsView.mergeBlock({ draft: false, checks: "success" }), null);
  for (const checks of ["pending", "none", "failure"] as const) assert.ok(opsView.mergeBlock({ draft: false, checks }), checks);
  assert.ok(opsView.mergeBlock({ draft: true, checks: "success" }));
  assert.match(opsView.flagLabel("breaker") ?? "", /circuit breaker/);
  assert.equal(opsView.flagLabel(null), null);
});

test("review queue view: parameters, filters, and item labels", () => {
  const rows = reviewQueue.queueRows({ updated: null, items: [...TRIO, HELD, { ...c1Item("C.901", 0.3), resolved: "rejected" as const, resolved_on: TODAY }] } as never);
  const p = (q: Record<string, string>) => opsView.parseOperationsParams(q);
  assert.deepEqual(p({}), { unit: null, queueStatus: "open", code: null, college: null, page: 1 });
  assert.deepEqual(p({ unit: "12345", qstatus: "weird", code: "c.116", qpage: "0" }), { unit: null, queueStatus: "open", code: "C.116", college: null, page: 1 });
  assert.equal(opsView.filterQueueRows(rows, p({})).length, 4, "open by default");
  assert.equal(opsView.filterQueueRows(rows, p({ qstatus: "rejected" })).length, 1);
  assert.equal(opsView.filterQueueRows(rows, p({ qstatus: "all" })).length, 5);
  assert.deepEqual(opsView.filterQueueRows(rows, p({ unit: "999002" })).map((r) => r.item.code), ["H.210"]);
  assert.deepEqual(opsView.filterQueueRows(rows, p({ code: "C.117" })).map((r) => r.item.code), ["C.117"]);
  assert.equal(opsView.filterQueueRows(rows, p({ college: "other" })).length, 1);
  assert.deepEqual(opsView.queueCodes(rows), ["C.116", "C.117", "C.118", "C.901", "H.210"]);
  assert.equal(opsView.operationsQuery({ unit: "999001", queueStatus: "open", page: 2 }), "unit=999001&qpage=2");
  assert.equal(opsView.itemEdition(TRIO[0]), "2025-26");
  assert.equal(opsView.itemValue(TRIO[0]), "7956");
  assert.equal(opsView.itemValue({ ...TRIO[0], code: undefined, extraction: { applicants: 100, admitted: 50, enrolled: 20 } } as never), "applied 100, admitted 50, enrolled 20");
  assert.equal(opsView.documentLabel("https://www.example.edu/ir/cds-2025-2026.pdf"), "example.edu / cds-2025-2026.pdf");
  assert.equal(opsView.safeHref("javascript:alert(1)"), null);
  assert.equal(opsView.safeHref("https://example.edu/x"), "https://example.edu/x");
});

test("the files stay inside their folders and name no data year", () => {
  const mine = ["lib/admin/health-view.ts", "lib/admin/ops-view.ts", "lib/admin/ops-actions.ts", "lib/admin/ops.ts", "lib/admin/pr-markdown.ts", "lib/admin/health-load.ts"];
  const files = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((n) => (statSync(join(ROOT, dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
  for (const f of [...mine, ...files("app/admin/health"), ...files("app/admin/operations"), ...files("components/admin/ops")]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /\b[Ff]all 20\d\d\b|\b20\d\d[–-]\d\d\b/, `${relative(ROOT, join(ROOT, f))} hard-codes a data year`);
  }
});
