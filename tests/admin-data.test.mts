/**
 * The Data console's Overview and Snapshots screens (specs/data-platform/change-sets.md "The console", Overview and
 * Snapshots rows; specs/data-platform/publish.md "Environments", "The admin's publish controls"): which snapshot
 * each environment serves, the last publish and the change sets since it, holds, the snapshot list, Publish now,
 * and Point back here. Runs the real reads and actions against a fake Supabase client, a fake fetch, and fake
 * GitHub dependencies; the pages, which can't render under node:test, are checked by reading their source and (for
 * the two pages this unit owns) by rendering them with their data loaders and GitHub dispatch stubbed, the way
 * tests/admin-ops.test.mts renders Operations. Each guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "admin-data-"));

/* ------------------------------------------------------------------ */
/* Next.js stand-ins, for the two pages only (lib/admin/data-reads.ts and lib/admin/data-actions.ts are plain modules  */
/* and are imported for real below)                                                                                   */
/* ------------------------------------------------------------------ */

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
  "next/server": "export async function connection(){}",
  "@/lib/admin/auth": `export async function requireAdmin(){globalThis.__world.calls.push('requireAdmin'); if(!globalThis.__world.admin){${NOT_FOUND}} return {userId:'admin-1'}}`,
  "@/lib/admin/people": "export async function adminSupabase(){globalThis.__world.calls.push('adminSupabase'); return globalThis.__world.supabase()}",
  // The pages' data-reads: the Overview and Snapshots loaders stubbed as before; everything else (the Change sets
  // reads) is the real module, run over the fake Supabase client the page gets from adminSupabase().
  "@/lib/admin/data-reads":
    `export * from ${JSON.stringify(pathToFileURL(join(ROOT, "lib/admin/data-reads.ts")).href)}; ` +
    "export async function loadDataOverview(){globalThis.__world.calls.push('loadDataOverview'); return globalThis.__world.overview} " +
    "export async function loadSnapshots(){globalThis.__world.calls.push('loadSnapshots'); return globalThis.__world.snapshots} " +
    "export function currentSnapshotId(rows){return globalThis.__world.currentId} " +
    "export function formatBytes(n){return n + ' B'} export function manifestBytes(m){return (m && m.colleges) || 0} " +
    "export function manifestDownloadUrl(id){return 'https://example.test/snapshots/'+id+'/manifest.json'}",
  // Families' lists (lib/admin/essays.ts listsByUnit reads list_items with the admin's session): driven by `world`.
  "@/lib/admin/essays": "export async function listsByUnit(){globalThis.__world.calls.push('listsByUnit'); return globalThis.__world.lists}",
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
  overview: unknown;
  snapshots: unknown[];
  currentId: number | null;
  supabase: () => unknown;
  lists: Map<string, number> | null;
}
const world: World = { admin: true, calls: [], refreshed: 0, overview: { environments: [], lastPublished: null, changeSets: [], holds: [] }, snapshots: [], currentId: null, supabase: () => ({}), lists: null };
(globalThis as unknown as { __world: World }).__world = world;
function reset(over: Partial<World> = {}) {
  Object.assign(
    world,
    { admin: true, calls: [], refreshed: 0, overview: { environments: [], lastPublished: null, changeSets: [], holds: [] }, snapshots: [], currentId: null, supabase: () => ({}), lists: null },
    over,
  );
}

// No network anywhere in this file: the environment probes and GitHub calls are faked.
let networkCalls = 0;
globalThis.fetch = (() => {
  networkCalls++;
  throw new Error("network call in a test");
}) as typeof fetch;

const reads = await import("../lib/admin/data-reads.ts");
const actions = await import("../lib/admin/data-actions.ts");
type OpsDeps = import("../lib/admin/ops-actions.ts").OpsDeps;
type DataActionDeps = import("../lib/admin/data-actions.ts").DataActionDeps;
type SnapshotRow = import("../lib/admin/data-reads.ts").SnapshotRow;
type ReviewItem = import("../lib/reported.ts").ReviewItem;
type ChangeSetRow = import("../lib/admin/change-set-view.ts").ChangeSetRow;
const { reviewKey } = await import("../lib/reported.ts");
const view = await import("../lib/admin/change-set-view.ts");
const reviewQueue = await import("../lib/admin/review-queue.ts");
const is404 = (e: unknown) => (e as { digest?: string })?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";

/* ------------------------------------------------------------------ */
/* Pure helpers: environments, the meta tag, bytes, the current snapshot */
/* ------------------------------------------------------------------ */

test("parseDataEnvironments: the default is production alone; a comma-separated label=url list; malformed entries drop", () => {
  assert.deepEqual(reads.parseDataEnvironments(undefined), [{ label: "usequad.app", url: "https://usequad.app" }]);
  assert.deepEqual(reads.parseDataEnvironments(""), [{ label: "usequad.app", url: "https://usequad.app" }]);
  assert.deepEqual(reads.parseDataEnvironments("usequad.app=https://usequad.app,this preview=https://pr-1.vercel.app"), [
    { label: "usequad.app", url: "https://usequad.app" },
    { label: "this preview", url: "https://pr-1.vercel.app" },
  ]);
  assert.deepEqual(reads.parseDataEnvironments("bogus,=https://x.test,nope=ftp://x.test"), [{ label: "usequad.app", url: "https://usequad.app" }], "every entry malformed falls back to the default");
  assert.deepEqual(reads.parseDataEnvironments("a=https://a.test,bogus,b=https://b.test"), [
    { label: "a", url: "https://a.test" },
    { label: "b", url: "https://b.test" },
  ]);
});

test("parseSnapshotMeta reads the x-quad-snapshot meta tag, attributes in either order, and is null without it", () => {
  assert.equal(reads.parseSnapshotMeta('<html><head><meta name="x-quad-snapshot" content="42"></head></html>'), "42");
  assert.equal(reads.parseSnapshotMeta('<meta content="legacy" name="x-quad-snapshot">'), "legacy");
  assert.equal(reads.parseSnapshotMeta("<meta name=\"other\" content=\"1\">"), null);
  assert.equal(reads.parseSnapshotMeta("<html><body>nothing here</body></html>"), null);
});

test("fetchEnvironmentSnapshot reads the meta tag over a fake fetch, and fails soft to 'unknown' on a bad status, a missing tag, or a thrown error", async () => {
  const env = { label: "usequad.app", url: "https://usequad.app" };
  const ok = (html: string) => (async () => ({ ok: true, text: async () => html }) as unknown as Response) as typeof fetch;
  assert.equal((await reads.fetchEnvironmentSnapshot(env, ok('<meta name="x-quad-snapshot" content="7">'))).snapshot, "7");
  assert.equal((await reads.fetchEnvironmentSnapshot(env, ok("<html></html>"))).snapshot, "unknown", "no tag");
  assert.equal((await reads.fetchEnvironmentSnapshot(env, (async () => ({ ok: false, text: async () => "" }) as unknown as Response) as typeof fetch)).snapshot, "unknown", "a bad status");
  assert.equal((await reads.fetchEnvironmentSnapshot(env, (async () => { throw new Error("timed out"); }) as unknown as typeof fetch)).snapshot, "unknown", "a thrown error (a timeout)");
});

test("loadEnvironmentSnapshots probes every configured environment in parallel and never throws", async () => {
  const before = process.env.DATA_ENVIRONMENTS;
  process.env.DATA_ENVIRONMENTS = "usequad.app=https://usequad.app,this preview=https://pr-1.vercel.app";
  const seen: string[] = [];
  const fake = (async (url: string) => {
    seen.push(url);
    return { ok: true, text: async () => `<meta name="x-quad-snapshot" content="${url.includes("pr-1") ? "9" : "8"}">` } as unknown as Response;
  }) as typeof fetch;
  const out = await reads.loadEnvironmentSnapshots(fake);
  process.env.DATA_ENVIRONMENTS = before;
  assert.deepEqual(seen.sort(), ["https://pr-1.vercel.app", "https://usequad.app"]);
  assert.deepEqual(out, [
    { label: "usequad.app", url: "https://usequad.app", snapshot: "8" },
    { label: "this preview", url: "https://pr-1.vercel.app", snapshot: "9" },
  ]);
  assert.equal(networkCalls, 0, "the real fetch was never called");
});

test("formatBytes: whole numbers past the first significant digit", () => {
  assert.equal(reads.formatBytes(0), "0 B");
  assert.equal(reads.formatBytes(890), "890 B");
  assert.equal(reads.formatBytes(412_000), "412 KB");
  assert.equal(reads.formatBytes(6_140_000), "6.1 MB");
  assert.equal(reads.formatBytes(-1), "—");
  assert.equal(reads.formatBytes(NaN), "—");
});

test("manifestBytes sums every object's bytes; currentSnapshotId picks the newest pointer_at, even on an older row (a point-back)", () => {
  assert.equal(reads.manifestBytes({ objects: { a: { bytes: 100, sha256: "x" }, b: { bytes: 50, sha256: "y" } } }), 150);
  assert.equal(reads.manifestBytes({}), 0);
  assert.equal(reads.manifestBytes(null), 0);
  const rows = [
    { id: 1, pointer_at: "2026-10-01T00:00:00Z" } as SnapshotRow,
    { id: 2, pointer_at: "2026-10-20T00:00:00Z" } as SnapshotRow,
    { id: 3, pointer_at: null } as unknown as SnapshotRow,
  ];
  assert.equal(reads.currentSnapshotId(rows), 2);
  rows[0].pointer_at = "2026-10-25T00:00:00Z"; // a point-back to the older snapshot moves pointer_at forward in time
  assert.equal(reads.currentSnapshotId(rows), 1);
  assert.equal(reads.currentSnapshotId([]), null);
});

test("manifestDownloadUrl is null without DATA_SNAPSHOT_URL, else the manifest's public object path", () => {
  const before = process.env.DATA_SNAPSHOT_URL;
  delete process.env.DATA_SNAPSHOT_URL;
  assert.equal(reads.manifestDownloadUrl(12), null);
  process.env.DATA_SNAPSHOT_URL = "https://proj.supabase.co/storage/v1/object/public/snapshots/";
  assert.equal(reads.manifestDownloadUrl(12), "https://proj.supabase.co/storage/v1/object/public/snapshots/12/manifest.json");
  process.env.DATA_SNAPSHOT_URL = before;
});

/* ------------------------------------------------------------------ */
/* data_snapshots and data_change_sets, over a fake Supabase client    */
/* ------------------------------------------------------------------ */

const { fakeSupabase } = await import("./helpers/fake-supabase.mts");

function snapshot(id: number, over: Partial<SnapshotRow> = {}): Record<string, unknown> {
  return { id, created_at: `2026-10-${String(10 + id).padStart(2, "0")}T00:00:00Z`, created_by: null, status: "published", manifest: { colleges: 1900, objects: {}, layers: {} }, change_set_ids: [], previous_id: id > 1 ? id - 1 : null, pointer_at: null, notes: null, ...over };
}

function changeSet(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, kind: "pipeline", source: "college-reported", run_ref: null, status: "applied", held_reason: null, summary: {}, created_by: null, created_at: "2026-10-15T00:00:00Z", closed_at: null, snapshot_id: null, reverted_by: null, ...over };
}

test("lastPublishedSnapshot: the newest published row, or null before the first publish", async () => {
  const client = fakeSupabase({ data_snapshots: [snapshot(1), snapshot(2), snapshot(3, { status: "failed" })] });
  const last = await reads.lastPublishedSnapshot(client as never);
  assert.equal(last?.id, 2);
  assert.equal(await reads.lastPublishedSnapshot(fakeSupabase() as never), null);
});

test("changeSetCounts: by source and status, most first; 'since' filters to created_at after the last publish", async () => {
  const client = fakeSupabase({
    data_change_sets: [
      changeSet(1, { source: "college-reported", status: "applied", created_at: "2026-10-16T00:00:00Z" }),
      changeSet(2, { source: "college-reported", status: "applied", created_at: "2026-10-17T00:00:00Z" }),
      changeSet(3, { source: "identity", status: "held", created_at: "2026-10-18T00:00:00Z" }),
      changeSet(4, { source: "identity", status: "held", created_at: "2026-10-10T00:00:00Z" }),
    ],
  });
  const since = await reads.changeSetCounts(client as never, "2026-10-15T00:00:00Z");
  assert.deepEqual(since, [
    { source: "college-reported", status: "applied", count: 2 },
    { source: "identity", status: "held", count: 1 },
  ]);
  const all = await reads.changeSetCounts(client as never, null);
  assert.equal(all.reduce((n, c) => n + c.count, 0), 4, "null reads every change set, not only the ones since a publish");
});

test("heldChangeSets: held sets only, newest first", async () => {
  const client = fakeSupabase({
    data_change_sets: [
      changeSet(1, { status: "applied" }),
      changeSet(2, { status: "held", held_reason: "the breaker tripped", created_at: "2026-10-20T00:00:00Z" }),
      changeSet(3, { status: "held", held_reason: "a person held it", created_at: "2026-10-22T00:00:00Z" }),
    ],
  });
  const held = await reads.heldChangeSets(client as never);
  assert.deepEqual(held.map((h) => h.id), [3, 2]);
  assert.equal(held[0].held_reason, "a person held it");
});

test("loadDataOverview reads the environments, the last publish, the change sets since it, and the holds together", async () => {
  const client = fakeSupabase({
    data_snapshots: [snapshot(1, { created_at: "2026-10-10T00:00:00Z" })],
    data_change_sets: [changeSet(1, { source: "essays", status: "applied", created_at: "2026-10-12T00:00:00Z" }), changeSet(2, { status: "held", created_at: "2026-10-13T00:00:00Z" })],
  });
  const fake = (async () => ({ ok: true, text: async () => "<meta name=\"x-quad-snapshot\" content=\"1\">" }) as unknown as Response) as typeof fetch;
  const overview = await reads.loadDataOverview(client as never, fake);
  assert.equal(overview.lastPublished?.id, 1);
  assert.deepEqual(
    [...overview.changeSets].sort((a, b) => a.source.localeCompare(b.source)),
    [
      { source: "college-reported", status: "held", count: 1 },
      { source: "essays", status: "applied", count: 1 },
    ],
    "both change sets since the publish, by source and status (the held one is also a hold, below)",
  );
  assert.equal(overview.holds.length, 1);
  assert.equal(overview.environments[0].snapshot, "1");
});

test("loadSnapshots: the newest 50, newest first", async () => {
  const rows = Array.from({ length: 3 }, (_, i) => snapshot(i + 1));
  const client = fakeSupabase({ data_snapshots: rows });
  const out = await reads.loadSnapshots(client as never);
  assert.deepEqual(out.map((s) => s.id), [3, 2, 1]);
});

/* ------------------------------------------------------------------ */
/* lib/admin/data-actions.ts: Publish now, Point back here             */
/* ------------------------------------------------------------------ */

interface FakeOver {
  configured?: boolean;
  noteOk?: boolean;
  dispatch?: { ok: true } | { ok: false; reason: string };
  pointOk?: boolean;
  pointMessage?: string;
  /** An admin_data_* function that refuses, with the database's raw message. */
  refuse?: { fn: string; error: string };
  /** What admin_data_revert returns (the revert change set's id). */
  revertId?: number;
  items?: Map<string, ReviewItem>;
}

type RpcCall = { fn: string; args: Record<string, unknown> };

/** Fake OpsDeps + the data functions and the store read, recording every call in order. */
function fakeDeps(over: FakeOver = {}): { deps: DataActionDeps; log: string[]; dispatches: { file: string; inputs: Record<string, string> }[]; calls: RpcCall[] } {
  const log: string[] = [];
  const calls: RpcCall[] = [];
  const dispatches: { file: string; inputs: Record<string, string> }[] = [];
  const ops: OpsDeps = {
    gh: {
      configured: () => over.configured ?? true,
      dispatchWorkflow: async (file, inputs) => {
        log.push(`dispatch ${file}`);
        dispatches.push({ file, inputs });
        return over.dispatch ?? { ok: true };
      },
      listRuns: async () => [],
      findRunByRequestId: async () => null,
      mergePull: async () => ({ ok: true }),
      holdPull: async () => ({ ok: true }),
      closePull: async () => ({ ok: true }),
    },
    note: async (action) => {
      log.push(`note ${action}`);
      return over.noteOk === false ? { ok: false, message: "the log is down" } : { ok: true };
    },
    adminName: async () => "Ray",
    now: () => new Date("2026-10-31T15:00:00Z"),
    requestId: () => "0f8c2d1e-4b5a-4c3d-9e8f-123456789abc",
    sleep: async () => undefined,
  };
  return {
    deps: {
      ops,
      pointSnapshot: async (id: number) => {
        log.push(`point ${id}`);
        return over.pointOk === false ? { ok: false, message: over.pointMessage ?? "a later change set touched this document" } : { ok: true };
      },
      rpc: async (fn, args) => {
        log.push(`rpc ${fn}`);
        calls.push({ fn, args });
        if (over.refuse?.fn === fn) return { ok: false, error: over.refuse.error };
        return { ok: true, data: fn === "admin_data_revert" ? (over.revertId ?? 77) : fn === "admin_data_edit" ? 1 : null };
      },
      readItems: async (keys) => {
        log.push(`read ${keys.join(",")}`);
        const items = over.items ?? ITEMS;
        return new Map(keys.filter((k) => items.has(k)).map((k) => [k, items.get(k)!] as const));
      },
    },
    log,
    dispatches,
    calls,
  };
}

/** Held review items, keyed as the store keys them. */
function c1Item(code: string, value: number, over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    unit_id: "999001",
    name: "Example College",
    urls: ["https://www.example.edu/ir/cds-2025-2026.pdf"],
    entering_term: "Fall 2025",
    failures: [{ check: "residency-sum", detail: "applied by residency sums to 15,912" }],
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
const ITEMS = new Map([...TRIO, HELD].map((i) => [reviewKey(i), i] as const));

const form = (fields: Record<string, string>): { get(name: string): unknown } => ({ get: (name) => (name in fields ? fields[name] : null) });

test("publishNow dispatches publish-snapshot.yml with force, logged before it sends (ops.dispatch, via dispatchRun)", async () => {
  const { deps, log, dispatches } = fakeDeps();
  const result = await actions.publishNow(deps);
  assert.equal(result.status, "done");
  assert.deepEqual(log, ["note ops.dispatch", "dispatch publish-snapshot.yml"], "logged before it was sent");
  // The request id is a third, separate argument to dispatchWorkflow (lib/github-app.ts merges it in for real); the
  // console's own dispatch table only ever sends the run's fixed and shown inputs.
  assert.deepEqual(dispatches, [{ file: "publish-snapshot.yml", inputs: { force: "true" } }]);
});

test("publishNow refuses, and never dispatches, when the log write fails", async () => {
  const { deps, log, dispatches } = fakeDeps({ noteOk: false });
  const result = await actions.publishNow(deps);
  assert.equal(result.status, "error");
  assert.match((result as { message: string }).message, /could not be logged/);
  assert.deepEqual(dispatches, []);
  assert.deepEqual(log, ["note ops.dispatch"]);
});

test("publishNow surfaces GitHub's refusal without hiding it", async () => {
  const { deps } = fakeDeps({ dispatch: { ok: false, reason: "workflow not found" } });
  const result = await actions.publishNow(deps);
  assert.equal(result.status, "error");
  assert.match((result as { message: string }).message, /workflow not found/);
});

test("pointBackHere: a bad or missing snapshot id is refused before anything runs", async () => {
  const { deps, log } = fakeDeps();
  for (const fields of [{}, { snapshot: "0" }, { snapshot: "-3" }, { snapshot: "abc" }, { snapshot: "1.5" }] as Record<string, string>[]) {
    const result = await actions.pointBackHere(deps, form({ confirm: actions.CONFIRM_POINT_BACK, ...fields }));
    assert.equal(result.status, "error", JSON.stringify(fields));
  }
  assert.deepEqual(log, [], "nothing ran: the id never reached the RPC or the dispatch");
});

test("pointBackHere needs the typed confirmation ('point back'), case- and space-insensitively; a forged form without it changes nothing", async () => {
  const { deps, log } = fakeDeps();
  const bad = await actions.pointBackHere(deps, form({ snapshot: "7", confirm: "yes" }));
  assert.equal(bad.status, "error");
  assert.match((bad as { message: string }).message, /point back/);
  assert.deepEqual(log, [], "the RPC was never called");
  const noConfirm = await actions.pointBackHere(deps, form({ snapshot: "7" }));
  assert.equal(noConfirm.status, "error");
  const ok = await actions.pointBackHere(deps, form({ snapshot: "7", confirm: "  POINT Back  " }));
  assert.equal(ok.status, "done");
});

test("pointBackHere: the RPC (admin_data_point_snapshot) runs first; dispatching the workflow's point job happens only if it succeeds", async () => {
  const { deps, log, dispatches } = fakeDeps();
  const result = await actions.pointBackHere(deps, form({ snapshot: "9", confirm: actions.CONFIRM_POINT_BACK }));
  assert.equal(result.status, "done");
  assert.deepEqual(log, ["point 9", "note ops.dispatch", "dispatch publish-snapshot.yml"], "the database call, then the log, then the dispatch, in that order");
  assert.deepEqual(dispatches[0].inputs.point, "9");
});

test("pointBackHere: a refused RPC (a later change set touched the document) stops before any dispatch", async () => {
  const { deps, log, dispatches } = fakeDeps({ pointOk: false, pointMessage: "That snapshot can't be reverted to: a later change set touched one of its documents." });
  const result = await actions.pointBackHere(deps, form({ snapshot: "4", confirm: actions.CONFIRM_POINT_BACK }));
  assert.equal(result.status, "error");
  assert.match((result as { message: string }).message, /later change set/);
  assert.deepEqual(dispatches, []);
  assert.deepEqual(log, ["point 4"], "the dispatch's own log entry never ran");
});

test("pointBackHere also logs before it sends, and refuses without dispatching, when the log write fails (after a successful RPC)", async () => {
  const { deps, log, dispatches } = fakeDeps({ noteOk: false });
  const result = await actions.pointBackHere(deps, form({ snapshot: "2", confirm: actions.CONFIRM_POINT_BACK }));
  assert.equal(result.status, "error");
  assert.deepEqual(dispatches, []);
  assert.deepEqual(log, ["point 2", "note ops.dispatch"]);
});

test("neither action ever puts anything but a positive integer snapshot id, or the fixed 'force' input, into a dispatch: no email (or any form field) reaches it", async () => {
  const { deps, dispatches } = fakeDeps();
  await actions.publishNow(deps);
  await actions.pointBackHere(deps, form({ snapshot: "3", confirm: actions.CONFIRM_POINT_BACK, email: "someone@example.com", note: "unrelated text" }));
  for (const d of dispatches) {
    for (const [key, value] of Object.entries(d.inputs)) {
      assert.ok(key === "point" || key === "force" || key === "request_id", `unexpected input "${key}"`);
      assert.doesNotMatch(value, /@/, `${key}=${value} looks like it carries an address`);
    }
  }
});

test("snapshotIdFromForm: a positive integer only", () => {
  assert.equal(actions.snapshotIdFromForm(form({ snapshot: "42" })), 42);
  for (const bad of [{}, { snapshot: "" }, { snapshot: "0" }, { snapshot: "-1" }, { snapshot: "1.2" }, { snapshot: "abc" }] as Record<string, string>[]) assert.equal(actions.snapshotIdFromForm(form(bad)), null, JSON.stringify(bad));
});

/* ------------------------------------------------------------------ */
/* Static: requireAdmin(), noindex, the rail entry, ownership           */
/* ------------------------------------------------------------------ */

test("static: both pages call requireAdmin() before reading anything, and are noindex", () => {
  for (const file of ["app/admin/data/page.tsx", "app/admin/data/snapshots/page.tsx"]) {
    const src = read(file);
    const body = src.slice(src.indexOf("export default async function"));
    assert.match(body, /\{\n\s+await connection\(\);\n\s+await requireAdmin\(\);/, `${file} calls requireAdmin() first`);
    assert.match(src, /robots: \{ index: false, follow: false \}/, `${file} is noindex`);
  }
});

test("static: every exported Server Action in app/admin/data/actions.ts starts with requireAdmin()", () => {
  const src = read("app/admin/data/actions.ts");
  assert.ok(src.startsWith('"use server";'));
  const bodies = [...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n(.*)\n/g)];
  assert.ok(bodies.length >= 2);
  for (const [, name, firstLine] of bodies) assert.match(firstLine, /await requireAdmin\(\)/, `${name} starts with requireAdmin()`);
});

test("guard: an action that skips requireAdmin() is caught by the check above", () => {
  const broken = read("app/admin/data/actions.ts").replace("const admin = await requireAdmin();", "const admin = { userId: 'x' };");
  const bodies = [...broken.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n(.*)\n/g)];
  assert.ok(bodies.some(([, , firstLine]) => !/await requireAdmin\(\)/.test(firstLine)), "the guard would have failed to catch this");
});

test("the rail has a Data entry, under /admin/data, outside the swipeable ADMIN_SECTIONS row (like Settings and Who is an admin)", () => {
  const rail = read("components/admin/AdminRail.tsx");
  assert.match(rail, /href="\/admin\/data"/);
  assert.match(rail, /pathname\.startsWith\("\/admin\/data"\)/);
  assert.match(rail, />\s*Data\s*</);
});

test("every file this unit touches is under the paths it owns", () => {
  const owned = [
    "app/admin/data/page.tsx",
    "app/admin/data/actions.ts",
    "app/admin/data/snapshots/page.tsx",
    "app/admin/data/change-sets/page.tsx",
    "app/admin/data/change-sets/[id]/page.tsx",
    "app/admin/data/holds/page.tsx",
    "lib/admin/data-reads.ts",
    "lib/admin/data-actions.ts",
    "lib/admin/change-set-view.ts",
    "components/admin/Snapshots.tsx",
    "components/admin/ChangeSets.tsx",
    "components/admin/Holds.tsx",
    "tests/admin-data.test.mts",
  ];
  for (const f of owned) assert.ok(existsSync(join(ROOT, f)), f);
});

/* ------------------------------------------------------------------ */
/* The pages, rendered with their data loaders and the admin guard stubbed */
/* ------------------------------------------------------------------ */

const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(reactUrl)};\nexport default ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);`);

/** A component stand-in rendered as `<div data-stub="Name" data-props='{…}'>` with its primitive props. */
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

/** Transpiles a page, replaces its component imports with stand-ins, and loads it with the real lib modules (stubbed above). */
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
type Page = () => Promise<import("react").ReactElement>;
const html = (element: import("react").ReactElement) => renderToStaticMarkup(element);

// Panel, Fields, StatusChip, AdminForm, and SnapshotsTable are all `@/components/...` imports, so the page tests
// below see them as generic stand-ins (stubModule): a prop passed as `children` renders for real (so the plain
// <ul>/<li> text inside a Panel does too), but a prop passed any other way (Panel's `aside`, Fields' `items`,
// SnapshotsTable's `snapshots`) is swallowed by the stand-in, the way Operations' own page tests only check such
// props by reading `data-props`. So these two tests check the page's own wiring (requireAdmin, which loaders ran,
// which stand-in got which top-level prop, the "deploy" word never appearing) and leave what a snapshot row itself
// renders (Point back here, Download manifest, "Live") to the direct component test below, as
// tests/admin-ops.test.mts leaves HealthTable's own rendering to a direct test of HealthTable, not the Health page.

test("the Overview page calls requireAdmin() then loadDataOverview(), and is a 404 for a non-admin before anything is read", async () => {
  const page = (await loadTsx("app/admin/data/page.tsx")).default as Page;
  reset({
    admin: true,
    overview: {
      environments: [{ label: "usequad.app", url: "https://usequad.app", snapshot: "41" }],
      lastPublished: { id: 41, created_at: "2026-10-30T08:00:00Z", manifest: { colleges: 1900 }, change_set_ids: [1, 2, 3] },
      changeSets: [{ source: "college-reported", status: "applied", count: 5 }],
      holds: [{ id: 9, kind: "pipeline", source: "essays", held_reason: "the held share tripped the breaker", created_at: "2026-10-30T09:00:00Z" }],
    },
  });
  const markup = html(await page());
  assert.deepEqual(world.calls, ["requireAdmin", "adminSupabase", "loadDataOverview"]);
  assert.match(markup, /Live on usequad\.app/, "a StatusChip nested inside the (stubbed) Panel still renders: it's a normal child, not a prop the stand-in drops");
  assert.match(markup, /college-reported/, "the change-set counts are the page's own <ul>, a real child of the (stubbed) Panel");
  assert.match(markup, /the held share tripped the breaker/);
  assert.doesNotMatch(markup, /deploy/i, "a data change is never called a deploy");
  reset({ admin: false });
  await assert.rejects(page(), is404);
  assert.deepEqual(world.calls, ["requireAdmin"], "a non-admin's 404 happens before any read");
});

test("the Overview page says 'Nothing has published yet' and 'Nothing is held' with nothing to show", async () => {
  const page = (await loadTsx("app/admin/data/page.tsx")).default as Page;
  reset({ admin: true });
  const markup = html(await page());
  assert.match(markup, /Nothing has published yet/);
  assert.match(markup, /Nothing is held/);
});

test("static: the Overview page's Publish now is an AdminForm calling publishNowAction", () => {
  const src = read("app/admin/data/page.tsx");
  assert.match(src, /<AdminForm action=\{publishNowAction\}/);
});

test("the Snapshots page calls requireAdmin() then the snapshot reads, and hands SnapshotsTable the current id; a non-admin gets a 404", async () => {
  const page = (await loadTsx("app/admin/data/snapshots/page.tsx")).default as Page;
  reset({ admin: true, snapshots: [snapshot(1) as unknown as SnapshotRow, snapshot(2) as unknown as SnapshotRow], currentId: 2 });
  const markup = html(await page());
  assert.deepEqual(world.calls, ["requireAdmin", "adminSupabase", "loadSnapshots"]);
  assert.match(markup, /data-stub="SnapshotsTable"/);
  assert.match(markup, /currentId&quot;:2/, "the current id (an attribute's JSON, HTML-escaped) reached the stand-in");
  reset({ admin: false });
  await assert.rejects(page(), is404);
});

/* ------------------------------------------------------------------ */
/* components/admin/Snapshots.tsx, rendered directly with real rows    */
/* ------------------------------------------------------------------ */

test("SnapshotsTable: each row, the current one marked Live with no Point back here on it, and Download manifest", async () => {
  const mod = (await loadTsx("components/admin/Snapshots.tsx")) as { SnapshotsTable: (p: { snapshots: SnapshotRow[]; currentId: number | null }) => import("react").ReactElement };
  const rows = [
    snapshot(2, { manifest: { colleges: 1900, objects: { "colleges.json.gz": { bytes: 6_000_000, sha256: "a" } } }, change_set_ids: [1, 2] }) as unknown as SnapshotRow,
    snapshot(1, { status: "failed", manifest: { colleges: 1899, objects: {} }, change_set_ids: [1] }) as unknown as SnapshotRow,
  ];
  const markup = html(mod.SnapshotsTable({ snapshots: rows, currentId: 2 }));
  assert.match(markup, /Snapshot 2/);
  assert.match(markup, /Snapshot 1/);
  assert.match(markup, /label&quot;:&quot;Live&quot;/, "the current snapshot is marked (an attribute's JSON, HTML-escaped)");
  assert.match(markup, /label&quot;:&quot;Failed&quot;/);
  // Point back here is an AdminForm (stubbed here too); its hidden snapshot id and typed confirmation are primitive
  // props, so they reach data-props even though the stand-in can't run the real confirmation UI.
  const forms = [...markup.matchAll(/data-stub="AdminForm" data-props="([^"]*)"/g)].map((m) => JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#x27;/g, "'")) as Record<string, unknown>);
  assert.equal(forms.length, 1, "Point back here appears once: not on the current snapshot");
  assert.equal(forms[0].trigger, "Point back here");
  assert.match(markup, /Download manifest/);
  assert.match(markup, /https:\/\/example\.test\/snapshots\/1\/manifest\.json/, "Download manifest links the snapshot's own manifest object");
});

test("SnapshotsTable says there is nothing to show before the first publish", async () => {
  const mod = (await loadTsx("components/admin/Snapshots.tsx")) as { SnapshotsTable: (p: { snapshots: SnapshotRow[]; currentId: number | null }) => import("react").ReactElement };
  const markup = html(mod.SnapshotsTable({ snapshots: [], currentId: null }));
  assert.match(markup, /No snapshot has been published yet/);
});

/* ------------------------------------------------------------------ */
/* Change sets: the view helpers                                       */
/* ------------------------------------------------------------------ */

function setRow(id: number, over: Partial<ChangeSetRow> = {}): ChangeSetRow {
  return changeSet(id, over) as unknown as ChangeSetRow;
}

test("change-set view: counts, cost, the run link, and which actions each status offers", () => {
  assert.equal(view.countsLabel({ documents: 412, added: 3, changed: 405, removed: 4 }), "412 documents: 3 added, 405 changed, 4 removed");
  assert.equal(view.countsLabel({ documents: 1, changed: 1 }), "1 document: 1 changed");
  assert.equal(view.countsLabel({ documents: 0 }), "No documents");
  assert.equal(view.countsLabel({}), "—");
  assert.equal(view.costLabel({ cost_usd: 12.4 }), "$12.40");
  assert.equal(view.costLabel({}), null);
  assert.equal(view.runHref("18876543210", "raywross/college-stats"), "https://github.com/raywross/college-stats/actions/runs/18876543210");
  assert.equal(view.runHref("abc123", "raywross/college-stats"), null, "a commit or a local stamp isn't a run");
  assert.equal(view.runHref(null, "raywross/college-stats"), null);
  assert.deepEqual(view.changeSetActions({ status: "applied", snapshot_id: null }), { hold: true, publishAnyway: false, revert: true, releaseNote: true });
  assert.deepEqual(view.changeSetActions({ status: "applied", snapshot_id: 4 }), { hold: false, publishAnyway: false, revert: true, releaseNote: true }, "a published set can't be held");
  assert.deepEqual(view.changeSetActions({ status: "held", snapshot_id: null }), { hold: false, publishAnyway: true, revert: true, releaseNote: true });
  assert.deepEqual(view.changeSetActions({ status: "reverted", snapshot_id: null }), { hold: false, publishAnyway: false, revert: false, releaseNote: true });
  assert.deepEqual(view.changeSetActions({ status: "open", snapshot_id: null }), { hold: false, publishAnyway: false, revert: false, releaseNote: false });
  assert.equal(view.summaryText({ body: "**Tripped:** the breaker" }), "**Tripped:** the breaker");
  assert.equal(view.summaryText({ documents: 3 }), null);
});

test("groupTouched: by collection, each key once, its last write deciding whether it was removed", () => {
  const groups = view.groupTouched([
    { collection: "reported.entries", key: "166027", version: 4, deleted: false },
    { collection: "reported.cds_records", key: "100654", version: 2, deleted: false },
    { collection: "reported.entries", key: "100654", version: 7, deleted: false },
    { collection: "reported.entries", key: "166027", version: 5, deleted: true },
  ]);
  assert.deepEqual(groups, [
    { collection: "reported.cds_records", documents: [{ key: "100654", deleted: false }] },
    {
      collection: "reported.entries",
      documents: [
        { key: "100654", deleted: false },
        { key: "166027", deleted: true },
      ],
    },
  ]);
});

test("lineDiff and diffHunks: a document's changed lines with context, unchanged runs collapsed, created and deleted documents whole", () => {
  const before = view.documentLines({ a: 1, b: [1, 2, 3], c: "x", d: true, e: null, f: 6, g: 7, h: 8 });
  const after = view.documentLines({ a: 1, b: [1, 2, 3], c: "y", d: true, e: null, f: 6, g: 7, h: 8 });
  const diff = view.lineDiff(before, after);
  assert.deepEqual(diff.filter((l) => l.op !== "same"), [
    { op: "del", text: '  "c": "x",' },
    { op: "add", text: '  "c": "y",' },
  ]);
  assert.deepEqual(diff.filter((l) => l.op !== "del").map((l) => l.text), after, "the same and added lines are the after document");
  assert.deepEqual(diff.filter((l) => l.op !== "add").map((l) => l.text), before, "the same and removed lines are the before document");
  const hunks = view.diffHunks(diff, 1);
  assert.deepEqual(hunks[0], { skipped: 6 }, "the unchanged head collapses to a count");
  assert.ok("lines" in hunks[1] && hunks[1].lines.length === 4, "one line of context either side");
  assert.deepEqual(hunks[2], { skipped: 5 }, "and the unchanged tail");
  assert.ok(view.lineDiff([], view.documentLines({ a: 1 })).every((l) => l.op === "add"), "a created document is all added");
  assert.ok(view.lineDiff(view.documentLines({ a: 1 }), view.documentLines(null)).every((l) => l.op === "del"), "a deleted document is all removed");
  assert.deepEqual(view.diffHunks(view.lineDiff(before, before)), [{ skipped: before.length }], "no change, no hunk");
  // Past the size limit, the changed middle is shown as replaced whole rather than computed line by line.
  const big = Array.from({ length: 2100 }, (_, i) => `line ${i}`);
  const big2 = big.map((l, i) => (i % 2 ? `${l} changed` : l));
  const bigDiff = view.lineDiff(big, big2);
  assert.equal(bigDiff.filter((l) => l.op === "del").length + bigDiff.filter((l) => l.op === "same").length, big.length);
});

test("releaseNoteText: a valid data note for the site's readers, its slug and path from the change set, no person named", async () => {
  const { parseReleaseNote } = await import("../lib/release-notes.ts");
  const row = setRow(45, { source: "college-reported", closed_at: "2026-10-31T09:12:00Z", summary: { documents: 312, collections: ["reported.entries", "reported.cds_records"] } });
  const note = view.releaseNoteText(row);
  assert.equal(note.path, "release-notes/data-college-reported-2026-10-31-45.md");
  assert.match(note.content, /^---\ntitle: "Updated figures colleges report in their Common Data Sets"\npr: <number>\ndate: 2026-10-31\nkind: data\nsummary: /);
  assert.match(note.content, /## What's new[\s\S]*312 updated records[\s\S]*## Behind the scenes[\s\S]*Change set 45/);
  const parsed = parseReleaseNote(note.path, note.content.replace("pr: <number>", "pr: 212"));
  assert.equal(parsed.kind, "data");
  assert.equal(parsed.pr, 212);
  assert.equal(parsed.slug, "data-college-reported-2026-10-31-45");
  const revert = view.releaseNoteText(setRow(46, { kind: "revert", source: "console", closed_at: "2026-10-31T10:00:00Z" }));
  assert.match(revert.content, /title: "An update to values corrected by Quad's editors was undone"/);
  assert.doesNotMatch(note.content + revert.content, /@|deploy/i);
});

/* ------------------------------------------------------------------ */
/* Change sets: the reads, over a fake Supabase client                 */
/* ------------------------------------------------------------------ */

function version(id: number, collection: string, key: string, v: number, changeSetId: number, body: unknown, deleted = false): Record<string, unknown> {
  return { id, collection, key, version: v, body: deleted ? null : body, deleted, change_set_id: changeSetId, created_at: `2026-10-${10 + changeSetId}T00:00:00Z` };
}

test("loadChangeSets: newest first, at most a page, optionally one status; parseStatusFilter keeps only the four statuses", async () => {
  const client = fakeSupabase({ data_change_sets: [changeSet(1), changeSet(2, { status: "held" }), changeSet(3), changeSet(4, { status: "held" })] });
  assert.deepEqual((await reads.loadChangeSets(client as never)).map((r) => r.id), [4, 3, 2, 1]);
  assert.deepEqual((await reads.loadChangeSets(client as never, { status: "held" })).map((r) => r.id), [4, 2]);
  assert.equal(reads.parseStatusFilter("held"), "held");
  assert.equal(reads.parseStatusFilter(["reverted"]), "reverted");
  assert.equal(reads.parseStatusFilter("deployed"), null);
  assert.equal(reads.parseStatusFilter(undefined), null);
  assert.equal((await reads.loadChangeSet(client as never, 3))?.id, 3);
  assert.equal(await reads.loadChangeSet(client as never, 99), null);
});

test("touchedDocuments lists the versions a set wrote, up to the limit, and says when there were more", async () => {
  const rows = Array.from({ length: reads.TOUCHED_LIMIT + 5 }, (_, i) => version(i + 1, "reported.entries", String(100000 + i), 1, 7, {}));
  const client = fakeSupabase({ data_document_versions: [...rows, version(9999, "essays.records", "1", 1, 8, {})] });
  const out = await reads.touchedDocuments(client as never, 7);
  assert.equal(out.rows.length, reads.TOUCHED_LIMIT);
  assert.equal(out.truncated, true);
  assert.ok(out.rows.every((r) => r.collection === "reported.entries"), "only this change set's versions");
  assert.equal((await reads.touchedDocuments(client as never, 8)).truncated, false);
});

test("documentBeforeAfter: the set's last version, and the version just before its first; null before when the set created it", async () => {
  const client = fakeSupabase({
    data_document_versions: [
      version(1, "reported.entries", "166027", 1, 1, { applicants: 100 }),
      version(2, "reported.entries", "166027", 2, 2, { applicants: 120 }),
      version(3, "reported.entries", "166027", 3, 2, { applicants: 125 }),
      version(4, "reported.entries", "166027", 4, 3, null, true),
      version(5, "reported.entries", "200000", 1, 2, { applicants: 9 }),
    ],
  });
  const changed = await reads.documentBeforeAfter(client as never, 2, "reported.entries", "166027");
  assert.deepEqual(changed?.before?.body, { applicants: 100 }, "the version before the set's first write");
  assert.deepEqual(changed?.after.body, { applicants: 125 }, "the set's last write");
  const created = await reads.documentBeforeAfter(client as never, 2, "reported.entries", "200000");
  assert.equal(created?.before, null);
  const deleted = await reads.documentBeforeAfter(client as never, 3, "reported.entries", "166027");
  assert.equal(deleted?.after.deleted, true);
  assert.equal(await reads.documentBeforeAfter(client as never, 1, "reported.entries", "200000"), null, "a document the set didn't touch");
  assert.deepEqual(reads.parseDocumentParam("reported.review_queue", "166027|2025-26|C.116"), { collection: "reported.review_queue", key: "166027|2025-26|C.116" });
  assert.equal(reads.parseDocumentParam("Reported;drop", "1"), null);
  assert.equal(reads.parseDocumentParam("reported.entries", "x".repeat(201)), null);
  assert.equal(reads.parseDocumentParam(undefined, "1"), null);
});

/* ------------------------------------------------------------------ */
/* Holds: the store reads                                              */
/* ------------------------------------------------------------------ */

function doc(collection: string, key: string, body: unknown, updated = "2026-10-30T00:00:00Z"): Record<string, unknown> {
  return { collection, key, version: 1, body, change_set_id: 1, updated_at: updated };
}

test("the collections Holds reads are the store's own names (scripts/lib/data-platform/layers.mts), keyed as the import keys them", async () => {
  const { COLLECTIONS } = await import("../scripts/lib/data-platform/layers.mts");
  assert.equal(reviewQueue.REVIEW_QUEUE_COLLECTION, COLLECTIONS.reported.reviewQueue);
  assert.equal(reviewQueue.ESSAYS_HELD_COLLECTION, COLLECTIONS.essays.held);
  assert.match(read("scripts/import-data-from-git.mts"), /put\(COLLECTIONS\.reported\.reviewQueue, reviewKey\(i\), i\)/, "the import keys review items by reviewKey, as Holds reads and resolves them");
});

test("readCollection pages through a whole collection by key (keyset), and readDocuments reads a few by key", async () => {
  const many = Array.from({ length: 2345 }, (_, i) => doc("reported.review_queue", `${String(100000 + i)}|2025-26|C.116`, { n: i }));
  const client = fakeSupabase({ data_documents: [...many, doc("essays.held", "100654", { unit_id: "100654" })] });
  const all = await reviewQueue.readCollection<{ n: number }>(client as never, "reported.review_queue");
  assert.equal(all.size, 2345, "every page read, none twice");
  assert.equal(all.get("102344|2025-26|C.116")?.n, 2344);
  const some = await reviewQueue.readDocuments(client as never, "reported.review_queue", ["100001|2025-26|C.116", "nope"]);
  assert.deepEqual([...some.keys()], ["100001|2025-26|C.116"]);
});

test("readQueue: rows from the store, read whole again only after a new write (or once the cache is old), never throwing", async () => {
  reviewQueue.resetQueueCache();
  const rejected = { ...c1Item("C.901", 0.3), resolved: "rejected" as const, resolved_on: "2026-10-30" };
  const tables = { data_documents: [...TRIO, HELD, rejected].map((i) => doc("reported.review_queue", reviewKey(i), i)) };
  const client = fakeSupabase(tables);
  let selects = 0;
  const counting = { from: (t: string) => ({ select: () => (selects++, client.from(t).select()) }) };
  let now = 1_000_000;
  const first = await reviewQueue.readQueue(counting as never, () => now);
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.deepEqual(first.rows.map((r) => r.status), ["open", "open", "open", "open", "rejected"], "open rows first");
  assert.equal(first.rows.find((r) => r.id === "999002|2025-26|H.210")?.accept.ok, false, "H.210 can't be accepted");
  const afterFirst = selects;
  const second = await reviewQueue.readQueue(counting as never, () => now);
  assert.ok(second.ok && second.rows === first.rows, "served from the cache");
  assert.equal(selects, afterFirst + 1, "one small query on the newest write, nothing more");
  tables.data_documents[0] = doc("reported.review_queue", reviewKey(TRIO[0]), { ...TRIO[0], resolved: "accepted" }, "2026-10-31T00:00:00Z");
  const third = await reviewQueue.readQueue(counting as never, () => now);
  assert.ok(third.ok && third.rows.some((r) => r.status === "accepted"), "a new write is read");
  now += reviewQueue.QUEUE_CACHE_MS + 1;
  const before = selects;
  await reviewQueue.readQueue(counting as never, () => now);
  assert.ok(selects > before + 1, "an old cache is read again even without a new write (a deletion moves no updated_at)");
  const broken = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "paused" } }) }) }) }) }) };
  assert.deepEqual(await reviewQueue.readQueue(broken as never), { ok: false, reason: "admin: reading reported.review_queue failed: paused" });
  reviewQueue.resetQueueCache();
});

test("byLists: most-listed college first, then by name; readHeldEssays reads essays.held", async () => {
  const lists = new Map([["999002", 5], ["999001", 2]]);
  const rows = reviewQueue.byLists(reviewQueue.queueRows([...TRIO, HELD, c1Item("C.901", 0.3, { unit_id: "999003", name: "Aardvark College" })]), (r) => r.item.unit_id, (r) => r.item.name, lists);
  assert.deepEqual(rows.map((r) => r.item.unit_id), ["999002", "999001", "999001", "999001", "999003"]);
  assert.deepEqual(reviewQueue.byLists(rows, (r) => r.item.unit_id, (r) => r.item.name, null).map((r) => r.item.name)[0], "Aardvark College", "by name when the lists can't be read");
  const client = fakeSupabase({ data_documents: [doc("essays.held", "100654", { unit_id: "100654", name: "Alabama A & M University", held: "2026-10-29", problems: ["no prompts"], record: {} })] });
  const held = await reviewQueue.readHeldEssays(client as never);
  assert.ok(held.ok && held.records[0].name === "Alabama A & M University");
});

/* ------------------------------------------------------------------ */
/* Change sets and Holds: the actions                                  */
/* ------------------------------------------------------------------ */

test("Hold needs a reason and calls admin_data_hold with it; a refusal comes back in words", async () => {
  let f = fakeDeps();
  assert.equal((await actions.holdChangeSet(f.deps, form({ change_set: "12" }))).status, "error", "no reason");
  assert.equal((await actions.holdChangeSet(f.deps, form({ change_set: "x", reason: "looks wrong" }))).status, "error", "a bad id");
  assert.deepEqual(f.calls, []);
  const r = await actions.holdChangeSet(f.deps, form({ change_set: "12", reason: "  the counts\nlook wrong " }));
  assert.equal(r.status, "done");
  assert.deepEqual(f.calls, [{ fn: "admin_data_hold", args: { p_change_set: 12, p_reason: "the counts look wrong" } }]);
  assert.deepEqual(f.dispatches, [], "holding sends nothing to GitHub");
  f = fakeDeps({ refuse: { fn: "admin_data_hold", error: "change_set_published" } });
  const refused = await actions.holdChangeSet(f.deps, form({ change_set: "12", reason: "x" }));
  assert.match(refused.status === "error" ? refused.message : "", /already carries this change set/);
});

test("Publish anyway: admin_data_unhold, then the publish logged before it is dispatched with force; a refused unhold sends nothing", async () => {
  let f = fakeDeps();
  const r = await actions.publishAnyway(f.deps, form({ change_set: "9" }));
  assert.equal(r.status, "done");
  assert.deepEqual(f.log, ["rpc admin_data_unhold", "note ops.dispatch", "dispatch publish-snapshot.yml"], "the unhold, then the log, then the dispatch");
  assert.deepEqual(f.dispatches, [{ file: "publish-snapshot.yml", inputs: { force: "true" } }]);
  f = fakeDeps({ refuse: { fn: "admin_data_unhold", error: "change_set_not_held" } });
  const refused = await actions.publishAnyway(f.deps, form({ change_set: "9" }));
  assert.match(refused.status === "error" ? refused.message : "", /isn't held any more/);
  assert.deepEqual(f.dispatches, []);
  assert.deepEqual(f.log, ["rpc admin_data_unhold"]);
  f = fakeDeps({ noteOk: false });
  const unlogged = await actions.publishAnyway(f.deps, form({ change_set: "9" }));
  assert.match(unlogged.status === "error" ? unlogged.message : "", /no longer held, but the publish didn't start/);
  assert.deepEqual(f.dispatches, [], "nothing is dispatched that the log doesn't show");
});

test("Revert needs the typed word; a later change set's refusal names it so the admin reverts that one first", async () => {
  let f = fakeDeps();
  assert.equal((await actions.revertChangeSet(f.deps, form({ change_set: "45", confirm: "yes" }))).status, "error");
  assert.deepEqual(f.calls, [], "the function was never called");
  const r = await actions.revertChangeSet(f.deps, form({ change_set: "45", confirm: " REVERT ", note: "bad batch" }));
  assert.equal(r.status, "done");
  assert.match(r.status === "done" ? (r.message ?? "") : "", /change set #77 puts back what #45 changed/);
  assert.deepEqual(f.calls, [{ fn: "admin_data_revert", args: { p_change_set: 45, p_note: "bad batch" } }]);
  f = fakeDeps({ refuse: { fn: "admin_data_revert", error: "later change set touched reported.entries/166027 (change set 51)" } });
  const refused = await actions.revertChangeSet(f.deps, form({ change_set: "45", confirm: "revert" }));
  assert.equal(refused.status, "error");
  assert.equal(refused.status === "error" ? refused.message : "", "Change set #51 changed reported.entries/166027 after this one. Revert #51 first, then this one.");
  assert.deepEqual(f.dispatches, [], "a revert dispatches nothing: the next publish carries it");
  assert.equal(actions.dataErrorMessage("admin only"), "Only an admin signed in with their second factor can do that.");
  assert.equal(actions.dataErrorMessage("something new"), "That didn't work. Try again in a moment.");
});

test("Holds: Accept the value writes every edit, then resolves each item accepted; Reject resolves with the note; Re-run discovery logs before dispatching", async () => {
  let f = fakeDeps();
  const accepted = await actions.acceptHeldItem(f.deps, form({ item: reviewKey(TRIO[0]) }));
  assert.equal(accepted.status, "done", JSON.stringify(accepted));
  const fns = f.calls.map((c) => c.fn);
  assert.deepEqual(fns, [...Array(5).fill("admin_data_edit"), ...Array(3).fill("admin_data_resolve_review")], "the edits first, then the resolves");
  assert.deepEqual(f.calls[1].args, { p_unit: "999001", p_path: "admissions.applicants", p_value: 7956, p_note: "Accepted from the review queue: https://www.example.edu/ir/cds-2025-2026.pdf" });
  assert.deepEqual(f.calls[5].args, { p_key: "999001|2025-26|C.116", p_resolution: "accepted", p_note: null });
  assert.deepEqual(f.dispatches, []);

  f = fakeDeps({ refuse: { fn: "admin_data_edit", error: "invalid_path" } });
  const failed = await actions.acceptHeldItem(f.deps, form({ item: reviewKey(TRIO[0]) }));
  assert.match(failed.status === "error" ? failed.message : "", /Nothing was accepted: That isn't a field the console can edit/);
  assert.ok(!f.calls.some((c) => c.fn === "admin_data_resolve_review"), "an item is never marked accepted without its value");

  f = fakeDeps();
  const rejected = await actions.rejectHeldItem(f.deps, form({ item: reviewKey(HELD), note: "misread" }));
  assert.equal(rejected.status, "done");
  assert.deepEqual(f.calls, [{ fn: "admin_data_resolve_review", args: { p_key: "999002|2025-26|H.210", p_resolution: "rejected", p_note: "misread" } }]);

  f = fakeDeps();
  await actions.rediscoverHeldItem(f.deps, form({ item: reviewKey(HELD) }));
  assert.deepEqual(f.log, ["read 999002|2025-26|H.210", "note review.rediscover", "dispatch college-reported.yml"]);
  f = fakeDeps({ noteOk: false });
  await actions.rediscoverHeldItem(f.deps, form({ item: reviewKey(HELD) }));
  assert.deepEqual(f.dispatches, [], "not sent when it can't be logged");

  f = fakeDeps();
  for (const fn of [actions.acceptHeldItem, actions.rejectHeldItem, actions.rediscoverHeldItem]) assert.equal((await fn(f.deps, form({ item: "not a key" }))).status, "error");
  assert.deepEqual(f.log, [], "a malformed key reaches nothing");
});

test("no email (or any form field) reaches a dispatch input from Publish anyway or Re-run discovery", async () => {
  const f = fakeDeps();
  await actions.publishAnyway(f.deps, form({ change_set: "3", email: "someone@example.com" }));
  await actions.rediscoverHeldItem(f.deps, form({ item: reviewKey(HELD), email: "someone@example.com", college: "123456" }));
  assert.equal(f.dispatches.length, 2);
  for (const d of f.dispatches) {
    for (const [key, value] of Object.entries(d.inputs)) {
      assert.ok(["force", "college", "rediscover", "auto_merge", "mode"].includes(key), `unexpected input "${key}"`);
      assert.doesNotMatch(value, /@/);
    }
  }
  assert.equal(f.dispatches[1].inputs.college, "999002", "the college comes from the held item, not the form");
});

/* ------------------------------------------------------------------ */
/* Change sets and Holds: the pages                                    */
/* ------------------------------------------------------------------ */

type QueryPage = (props: { params?: Promise<Record<string, string>>; searchParams: Promise<Record<string, string | undefined>> }) => Promise<import("react").ReactElement>;
const stubsIn = (markup: string) => [...markup.matchAll(/data-stub="(\w+)" data-props="([^"]*)"/g)].map((m) => ({ name: m[1], props: JSON.parse(m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'")) as Record<string, unknown> }));

test("static: the three new pages call requireAdmin() before reading anything, and are noindex", () => {
  for (const file of ["app/admin/data/change-sets/page.tsx", "app/admin/data/change-sets/[id]/page.tsx", "app/admin/data/holds/page.tsx"]) {
    const src = read(file);
    const body = src.slice(src.indexOf("export default async function"));
    assert.match(body, /\{\n\s+await connection\(\);\n\s+await requireAdmin\(\);/, `${file} calls requireAdmin() first`);
    assert.match(src, /robots: \{ index: false, follow: false \}/, `${file} is noindex`);
  }
});

test("the Change sets page lists the store's change sets for an admin, filters by status, and is a 404 for anyone else", async () => {
  const page = (await loadTsx("app/admin/data/change-sets/page.tsx")).default as QueryPage;
  reset({ admin: true, supabase: () => fakeSupabase({ data_change_sets: [changeSet(1), changeSet(2, { status: "held", held_reason: "breaker" })] }) });
  let markup = html(await page({ searchParams: Promise.resolve({}) }));
  assert.deepEqual(world.calls, ["requireAdmin", "adminSupabase"]);
  assert.match(markup, /data-stub="ChangeSetsTable"/);
  assert.match(markup, /href="\/admin\/data\/change-sets\?status=held"/);
  reset({ admin: true, supabase: () => fakeSupabase({ data_change_sets: [changeSet(1), changeSet(2, { status: "held" })] }) });
  markup = html(await page({ searchParams: Promise.resolve({ status: "held" }) }));
  assert.match(markup, /aria-current="page"[^>]*>Held</);
  reset({ admin: false });
  await assert.rejects(page({ searchParams: Promise.resolve({}) }), is404);
  assert.deepEqual(world.calls, ["requireAdmin"]);
});

test("ChangeSetsTable: each set links its page, with status chips, counts, cost and the run link", async () => {
  const mod = (await loadTsx("components/admin/ChangeSets.tsx")) as unknown as { ChangeSetsTable: (p: { rows: ChangeSetRow[]; repo: string }) => import("react").ReactElement };
  const markup = html(
    mod.ChangeSetsTable({
      rows: [setRow(2, { status: "held", held_reason: "the breaker tripped", run_ref: "18876543210", summary: { documents: 12, changed: 12, cost_usd: 3.5 } }), setRow(1, { kind: "import", source: "git", run_ref: "abc" })],
      repo: "raywross/college-stats",
    }),
  );
  assert.match(markup, /href="\/admin\/data\/change-sets\/2"/);
  assert.match(markup, /the breaker tripped/);
  assert.match(markup, /12 documents: 12 changed/);
  assert.match(markup, /\$3\.50/);
  assert.match(markup, /href="https:\/\/github\.com\/raywross\/college-stats\/actions\/runs\/18876543210"/);
  assert.match(markup, /label&quot;:&quot;Held&quot;/);
  assert.doesNotMatch(markup, /deploy|\bPR\b/i, "never deploy or PR for data");
});

test("the change set page: summary, documents touched, one document's diff, and the actions its status allows; 404 for a missing set or a non-admin", async () => {
  const page = (await loadTsx("app/admin/data/change-sets/[id]/page.tsx")).default as QueryPage;
  const tables = () =>
    fakeSupabase({
      data_change_sets: [changeSet(1, { status: "applied" }), changeSet(2, { status: "held", held_reason: "more than half held", summary: { documents: 1, changed: 1, collections: ["reported.entries"] }, closed_at: "2026-10-31T00:00:00Z" })],
      data_document_versions: [version(1, "reported.entries", "166027", 1, 1, { applicants: 100 }), version(2, "reported.entries", "166027", 2, 2, { applicants: 120 })],
    });
  reset({ admin: true, supabase: tables });
  const markup = html(await page({ params: Promise.resolve({ id: "2" }), searchParams: Promise.resolve({ c: "reported.entries", k: "166027" }) }));
  assert.match(markup, /Change set #2/);
  assert.match(markup, /more than half held/);
  const stubs = stubsIn(markup);
  assert.ok(stubs.some((s) => s.name === "ChangeSetActions"), "the actions");
  assert.ok(stubs.some((s) => s.name === "ReleaseNoteDraft"), "Write a release note, for a closed set");
  const diff = stubs.find((s) => s.name === "DocumentDiff");
  assert.deepEqual([diff?.props.beforeVersion, diff?.props.afterVersion, diff?.props.deleted], [1, 2, false], "version 1 → version 2");

  for (const id of ["99", "abc", "0"]) {
    reset({ admin: true, supabase: tables });
    await assert.rejects(page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }), is404, id);
  }
  reset({ admin: false });
  await assert.rejects(page({ params: Promise.resolve({ id: "2" }), searchParams: Promise.resolve({}) }), is404);
  assert.deepEqual(world.calls, ["requireAdmin"]);
});

test("ChangeSetActions offers Publish anyway and Revert on a held set, Hold and Revert on an applied one, nothing on an open one; Revert asks for the typed word", async () => {
  const mod = (await loadTsx("components/admin/ChangeSets.tsx")) as unknown as { ChangeSetActions: (p: { row: ChangeSetRow }) => import("react").ReactElement; ReleaseNoteDraft: (p: { note: { path: string; content: string } }) => import("react").ReactElement };
  const triggers = (row: ChangeSetRow) => stubsIn(html(mod.ChangeSetActions({ row }))).filter((s) => s.name === "AdminForm").map((s) => s.props.trigger);
  assert.deepEqual(triggers(setRow(1, { status: "held" })), ["Publish anyway", "Revert"]);
  assert.deepEqual(triggers(setRow(1, { status: "applied" })), ["Hold", "Revert"]);
  assert.deepEqual(triggers(setRow(1, { status: "applied", snapshot_id: 3 })), ["Revert"]);
  assert.deepEqual(triggers(setRow(1, { status: "open" })), []);
  assert.deepEqual(triggers(setRow(1, { status: "reverted" })), []);
  assert.match(read("components/admin/ChangeSets.tsx"), /typed=\{\{ expected: CONFIRM_REVERT/);
  const note = html(mod.ReleaseNoteDraft({ note: view.releaseNoteText(setRow(4, { closed_at: "2026-10-31T00:00:00Z" })) }));
  assert.match(note, /Write a release note/);
  assert.match(note, /release-notes\/data-college-reported-2026-10-31-4\.md/);
  assert.match(note, /data-stub="CopyButton"/, "the note text, to copy");
});

test("the Holds page shows the open review items (most-listed first) and the held essay records for an admin; a 404 for anyone else", async () => {
  reviewQueue.resetQueueCache();
  const page = (await loadTsx("app/admin/data/holds/page.tsx")).default as QueryPage;
  const rejected = { ...c1Item("C.901", 0.3, { unit_id: "999003", name: "Third College" }), resolved: "rejected" as const };
  reset({
    admin: true,
    lists: new Map([["999002", 4]]),
    supabase: () =>
      fakeSupabase({
        data_documents: [
          ...[...TRIO, HELD, rejected].map((i) => doc("reported.review_queue", reviewKey(i), i)),
          doc("essays.held", "100654", { unit_id: "100654", name: "Alabama A & M University", held: "2026-10-29", problems: ["no prompts"], record: {} }),
        ],
        data_change_sets: [changeSet(5, { status: "held" })],
      }),
  });
  const markup = html(await page({ searchParams: Promise.resolve({}) }));
  assert.equal(world.calls[0], "requireAdmin");
  assert.ok(world.calls.includes("listsByUnit"));
  assert.match(markup, /showing 1 to 4</, "four open items: the rejected one isn't held any more");
  assert.match(markup, /1 change set is held as a whole/);
  assert.match(markup, /href="\/admin\/data\/change-sets\?status=held"/);
  assert.ok(stubsIn(markup).some((s) => s.name === "HeldItemsTable"));
  assert.ok(stubsIn(markup).some((s) => s.name === "HeldEssaysList"));
  assert.match(markup, /Most-listed college first/);
  reset({ admin: false });
  await assert.rejects(page({ searchParams: Promise.resolve({}) }), is404);
  assert.deepEqual(world.calls, ["requireAdmin"]);
  reviewQueue.resetQueueCache();
});

test("HeldItemsTable: Accept the value where the mapping allows it (naming the fields), its refusal otherwise, and Reject and Re-run discovery on every row", async () => {
  const mod = (await loadTsx("components/admin/Holds.tsx")) as unknown as {
    HeldItemsTable: (p: { rows: unknown[]; lists: Map<string, number> | null }) => import("react").ReactElement;
    HeldEssaysList: (p: { records: unknown[]; lists: Map<string, number> | null }) => import("react").ReactElement;
  };
  const rows = reviewQueue.byLists(reviewQueue.queueRows([...TRIO, HELD]), (r) => r.item.unit_id, (r) => r.item.name, new Map([["999002", 4]]));
  const markup = html(mod.HeldItemsTable({ rows, lists: new Map([["999002", 4]]) }));
  const forms = stubsIn(markup).filter((s) => s.name === "AdminForm");
  assert.equal(forms.filter((s) => s.props.trigger === "Accept the value").length, 3, "the three C1 totals");
  assert.equal(forms.filter((s) => s.props.trigger === "Reject").length, 4);
  assert.equal(forms.filter((s) => s.props.trigger === "Re-run discovery").length, 4);
  assert.match(markup, /Can&#x27;t accept: H\.210 is published from the college&#x27;s CDS record/);
  assert.match(markup, /999002 · on 4 lists/);
  assert.ok(markup.indexOf("Other College") < markup.indexOf("Example College"), "most-listed college first");
  const essays = html(mod.HeldEssaysList({ records: [{ unit_id: "100654", name: "Alabama A & M University", held: "2026-10-29", problems: ["no prompts"], record: { url: "https://www.aamu.edu/admissions" } }], lists: null }));
  assert.match(essays, /href="\/admin\/essays\/100654"/);
  assert.match(essays, /no prompts/);
  assert.match(essays, /aamu\.edu/);
});
