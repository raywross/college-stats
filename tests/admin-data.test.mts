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
  "@/lib/admin/data-reads":
    "export async function loadDataOverview(){globalThis.__world.calls.push('loadDataOverview'); return globalThis.__world.overview} " +
    "export async function loadSnapshots(){globalThis.__world.calls.push('loadSnapshots'); return globalThis.__world.snapshots} " +
    "export function currentSnapshotId(rows){return globalThis.__world.currentId} " +
    "export function formatBytes(n){return n + ' B'} export function manifestBytes(m){return (m && m.colleges) || 0} " +
    "export function manifestDownloadUrl(id){return 'https://example.test/snapshots/'+id+'/manifest.json'}",
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
}
const world: World = { admin: true, calls: [], refreshed: 0, overview: { environments: [], lastPublished: null, changeSets: [], holds: [] }, snapshots: [], currentId: null, supabase: () => ({}) };
(globalThis as unknown as { __world: World }).__world = world;
function reset(over: Partial<World> = {}) {
  Object.assign(
    world,
    { admin: true, calls: [], refreshed: 0, overview: { environments: [], lastPublished: null, changeSets: [], holds: [] }, snapshots: [], currentId: null, supabase: () => ({}) },
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
}

/** Fake OpsDeps + the Point back here RPC, recording every call in order. */
function fakeDeps(over: FakeOver = {}): { deps: DataActionDeps; log: string[]; dispatches: { file: string; inputs: Record<string, string> }[] } {
  const log: string[] = [];
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
      readRepoFile: async () => ({ ok: false, reason: "not used" }),
      commitFileAndOpenPull: async () => ({ ok: false, reason: "not used" }),
      readQueue: async () => null,
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
    },
    log,
    dispatches,
  };
}

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
  const owned = ["app/admin/data/page.tsx", "app/admin/data/actions.ts", "app/admin/data/snapshots/page.tsx", "lib/admin/data-reads.ts", "lib/admin/data-actions.ts", "components/admin/Snapshots.tsx", "tests/admin-data.test.mts"];
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
