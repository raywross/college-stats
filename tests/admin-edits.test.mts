/**
 * The field editor at /admin/colleges/[unit]/edit (specs/data-platform/change-sets.md "Admin edits"; brief F2): the
 * input each path gets (lib/admin/edits-view.ts inferKind), how a submitted value is parsed and refused, the stored
 * derived fields an input feeds, which paths are offered and how they group, the marker "a newer pipeline value exists",
 * the reads (over a fake Supabase client and a fake fetch), the actions (over fake dependencies: the registry check
 * before any call, revalidation only on success), the Server Actions (requireAdmin() before anything), and the page
 * (a 404 signed out, a row for an admin), rendered under node:test with Next stubbed the way tests/admin-data.test.mts
 * does. No network, no database, never the live snapshot. `npm test`.
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
import type { DatasetMeta, School } from "../lib/types";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "admin-edits-"));

/* ------------------------------------------------------------------ */
/* Next.js and the console's server modules, stood in for              */
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
  "next/cache": "export function refresh(){globalThis.__world.calls.push('refresh')} export function revalidatePath(p,t){globalThis.__world.revalidated.push(p+' '+t)}",
  "next/server": "export async function connection(){}",
  "@/lib/admin/auth": `export async function requireAdmin(){globalThis.__world.calls.push('requireAdmin'); if(!globalThis.__world.admin){${NOT_FOUND}} return {userId:'admin-1'}}`,
  "@/lib/admin/people": "export async function adminSupabase(){globalThis.__world.calls.push('adminSupabase'); return globalThis.__world.supabase()}",
  "@/lib/admin/console-actions":
    "export async function withAdmin(what, run){globalThis.__world.calls.push('withAdmin'); return run({userId:'admin-1', supabase: globalThis.__world.supabase()})}",
  "@/lib/data": "export async function getData(){globalThis.__world.calls.push('getData'); return globalThis.__world.data} export async function getSnapshotId(){return globalThis.__world.snapshotId}",
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
  revalidated: string[];
  supabase: () => unknown;
  data: unknown;
  snapshotId: string;
}
const world: World = { admin: true, calls: [], revalidated: [], supabase: () => ({}), data: null, snapshotId: "legacy" };
(globalThis as unknown as { __world: World }).__world = world;
function reset(over: Partial<World> = {}) {
  Object.assign(world, { admin: true, calls: [], revalidated: [], supabase: () => ({}), snapshotId: "legacy" }, over);
}

// No network anywhere in this file.
let networkCalls = 0;
globalThis.fetch = (() => {
  networkCalls++;
  throw new Error("network call in a test");
}) as typeof fetch;

const view = await import("../lib/admin/edits-view.ts");
const actions = await import("../lib/admin/edits-actions.ts");
const reads = await import("../lib/admin/edits-reads.ts");
const { FIELDS } = await import("../lib/fields.ts");
const { lineageFor } = await import("../lib/lineage.ts");
const { createDataset } = await import("../lib/dataset.ts");
const { fakeSupabase } = await import("./helpers/fake-supabase.mts");
type EditRecord = import("../lib/admin/edits-view.ts").EditRecord;
type EditActionDeps = import("../lib/admin/edits-actions.ts").EditActionDeps;
type SnapshotEditsObject = import("../lib/data-platform/snapshot.ts").SnapshotEditsObject;
type FieldDef = import("../lib/fields.ts").FieldDef;

const FIXTURE = "tests/fixtures/snapshot-mini/snapshot";
const schools = JSON.parse(read(`${FIXTURE}/colleges.json`)) as School[];
const meta = JSON.parse(read(`${FIXTURE}/meta.json`)) as DatasetMeta;
const HARVARD = "166027";
const harvard = schools.find((s) => s.unit_id === HARVARD)!;
const cite = (path: Parameters<typeof lineageFor>[0], school: School) => lineageFor(path, school, meta);
const is404 = (e: unknown) => (e as { digest?: string })?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";

/** A bare college with values at dotted paths (inferKind reads nothing else). */
function college(unit: string, values: Record<string, unknown> = {}): School {
  const out: Record<string, unknown> = { unit_id: unit, name: `College ${unit}` };
  for (const [path, v] of Object.entries(values)) {
    const keys = path.split(".");
    let cur = out;
    for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
    cur[keys[keys.length - 1]] = v;
  }
  return out as unknown as School;
}

function form(values: Record<string, string | undefined>) {
  return { get: (k: string) => values[k] ?? null };
}

function edit(over: Partial<EditRecord> = {}): EditRecord & Record<string, unknown> {
  return { id: 1, unit_id: HARVARD, path: "admissions.admitted", value: 2100, note: null, created_at: "2026-10-31T15:00:00Z", released_at: null, created_by: null, ...over };
}

/* ------------------------------------------------------------------ */
/* inferKind                                                           */
/* ------------------------------------------------------------------ */

test("inferKind: from the college's value: number, boolean, date, text, JSON; a share gets the percent hint", () => {
  const a = college("100001", { "admissions.admitted": 900, "location.city": "2026-01-15", name: "Alpha", "admissions.sat_math_25_75": [600, 700], "admissions.acceptance_rate": 0.4 });
  const b = college("100002", { "admissions.sat_math_25_75": [500, 650] });
  const all = [a, b];
  const k = (p: string) => view.inferKind(p, a, all);
  assert.equal(k("admissions.admitted").kind, "number");
  assert.equal(k("admissions.admitted").share, false);
  assert.equal(k("admissions.admitted").hint, null);
  assert.equal(k("location.city").kind, "date", "a YYYY-MM-DD string is a date");
  assert.equal(k("name").kind, "text");
  const json = k("admissions.sat_math_25_75");
  assert.equal(json.kind, "json");
  assert.equal(json.shape, "[500,650]", "the shape hint is another college's value, not this one's");
  const share = k("admissions.acceptance_rate");
  assert.equal(share.kind, "number");
  assert.equal(share.share, true, "notify.unit percent");
  assert.equal(share.hint, "a share, 0 to 1: 0.42 is 42%");
  const c = college("100003", { "location.zip": true });
  assert.equal(view.inferKind("location.zip", c, [c]).kind, "boolean");
});

test("inferKind: a string with at most 12 repeated values across colleges is a select; more, or all different, is text", () => {
  const policies = ["required", "considered", "not_considered"];
  const all = Array.from({ length: 9 }, (_, i) => college(String(200000 + i), { "admissions.test_policy": policies[i % 3] }));
  const kind = view.inferKind("admissions.test_policy", all[0], all);
  assert.equal(kind.kind, "enum");
  assert.deepEqual(kind.options, ["considered", "not_considered", "required"]);
  const many = Array.from({ length: 26 }, (_, i) => college(String(300000 + i), { "admissions.test_policy": `policy ${i % 13}` }));
  assert.equal(view.inferKind("admissions.test_policy", many[0], many).kind, "text", "13 distinct values: free text");
  const unique = Array.from({ length: 5 }, (_, i) => college(String(400000 + i), { "admissions.test_policy": `only ${i}` }));
  assert.equal(view.inferKind("admissions.test_policy", unique[0], unique).kind, "text", "nothing repeats: free text, not a list of five");
});

test("inferKind: with no value here, the type most colleges have; with none anywhere, a number for a numeric notify unit, else text", () => {
  const empty = college("500000");
  const all = [empty, college("500001", { "admissions.sat_math_25_75": [1, 2] }), college("500002", { "admissions.sat_math_25_75": [3, 4] }), college("500003", { "admissions.sat_math_25_75": "odd" })];
  assert.equal(view.inferKind("admissions.sat_math_25_75", empty, all).kind, "json");
  assert.equal(view.inferKind("admissions.admitted", empty, [empty]).kind, "number", "notify unit count");
  assert.equal(view.inferKind("admissions.acceptance_rate", empty, [empty]).share, true);
  assert.equal(view.inferKind("location.city", empty, [empty]).kind, "text", "no notify unit");
});

/* ------------------------------------------------------------------ */
/* parseInput                                                          */
/* ------------------------------------------------------------------ */

test("parseInput accepts each kind's values", () => {
  assert.deepEqual(view.parseInput("number", form({ value: " 2,100 " })), { ok: true, value: 2100 });
  assert.deepEqual(view.parseInput("number", form({ value: "-1.5" })), { ok: true, value: -1.5 });
  assert.deepEqual(view.parseInput("number", form({ value: "0.42", share: "1" })), { ok: true, value: 0.42 });
  assert.deepEqual(view.parseInput("number", form({ value: "42%", share: "1" })), { ok: true, value: 0.42 });
  assert.deepEqual(view.parseInput("boolean", form({ value: "true" })), { ok: true, value: true });
  assert.deepEqual(view.parseInput("boolean", form({ value: "false" })), { ok: true, value: false });
  assert.deepEqual(view.parseInput("boolean", form({ value: "none" })), { ok: true, value: null });
  assert.deepEqual(view.parseInput("date", form({ value: "2026-10-31" })), { ok: true, value: "2026-10-31" });
  assert.deepEqual(view.parseInput("text", form({ value: "  Harvard College " })), { ok: true, value: "Harvard College" });
  assert.deepEqual(view.parseInput("enum", form({ value: "required" })), { ok: true, value: "required" });
  assert.deepEqual(view.parseInput("json", form({ value: '{"a": [1, 2]}' })), { ok: true, value: { a: [1, 2] } });
  assert.deepEqual(view.parseInput("number", form({ value: "", clear: "on" })), { ok: true, value: null }, "Clear this value saves null");
  assert.deepEqual(view.parseInput("json", form({ value: "[1]", clear: "on" })), { ok: true, value: null }, "the box wins over the text");
});

test("parseInput refuses in plain words", () => {
  const problem = (r: ReturnType<typeof view.parseInput>) => (r.ok ? null : r.problem);
  assert.equal(problem(view.parseInput("number", form({ value: "twelve" }))), "Enter a number");
  assert.equal(problem(view.parseInput("number", form({ value: "1e999" }))), "Enter a number");
  assert.equal(problem(view.parseInput("number", form({ value: "4.2", share: "1" }))), "Enter a share from 0 to 1: 0.42 is 42%");
  assert.equal(problem(view.parseInput("json", form({ value: "{a: 1}" }))), "Not valid JSON");
  assert.equal(problem(view.parseInput("boolean", form({ value: "yes" }))), "Pick true, false or none");
  assert.equal(problem(view.parseInput("date", form({ value: "2026-02-30" }))), "Enter a date as YYYY-MM-DD");
  assert.equal(problem(view.parseInput("date", form({ value: "10/31/2026" }))), "Enter a date as YYYY-MM-DD");
  assert.match(problem(view.parseInput("text", form({ value: "   " })))!, /Clear this value/, "an empty box needs the Clear box");
  assert.match(problem(view.parseInput("json", form({ value: "null" })))!, /Clear this value/, "JSON null is a clear too");
});

/* ------------------------------------------------------------------ */
/* Derived fields, the paths offered, and grouping                     */
/* ------------------------------------------------------------------ */

test("derivedReaders names the stored derived fields an input feeds", () => {
  assert.ok(view.derivedReaders("admissions.admitted").includes("admissions.acceptance_rate"));
  assert.ok(view.derivedReaders("admissions.applicants").includes("admissions.acceptance_rate"));
  for (const p of view.derivedReaders("admissions.admitted")) assert.ok(!(FIELDS[p] as FieldDef).computed, `${p} is stored, not computed`);
  assert.deepEqual(view.derivedReaders("links.website"), []);
});

test("editableRows: every registered path but computed, hidden and unit_id, grouped by topic in the registry's order; name is editable", () => {
  const groups = view.editableRows(harvard, schools, [], null, { cite });
  const paths = groups.flatMap((g) => g.rows.map((r) => r.path));
  const defs = FIELDS as Record<string, FieldDef>;
  const expected = Object.keys(FIELDS).filter((p) => p !== "unit_id" && !defs[p].computed && !defs[p].hidden);
  assert.deepEqual(new Set(paths), new Set(expected));
  assert.ok(!paths.includes("unit_id"));
  assert.ok(paths.includes("name"), "a rename is a real correction");
  for (const p of paths) assert.ok(!defs[p].computed && !defs[p].hidden, p);
  const topicOrder = [...new Set(expected.map((p) => defs[p].topic))];
  assert.deepEqual(groups.map((g) => g.topic), topicOrder);
  for (const g of groups) for (const r of g.rows) assert.equal(defs[r.path].topic, g.topic);
  const rate = groups.flatMap((g) => g.rows).find((r) => r.path === "admissions.acceptance_rate")!;
  assert.match(rate.display, /^4\.2% \(0\.04182/, "a share shows as a percent and the raw share");
  assert.match(rate.derivedNote!, /^Derived: Admitted ÷ applicants.*Editing an input does not recompute it; set this value too if it should change$/);
  const admitted = groups.flatMap((g) => g.rows).find((r) => r.path === "admissions.admitted")!;
  assert.equal(admitted.display, "2,003");
  assert.match(admitted.readersNote!, /Acceptance rate/);
  assert.doesNotMatch(admitted.cited, /Edited by Quad/);
  assert.equal(admitted.edited, false);
  const city = groups.flatMap((g) => g.rows).find((r) => r.path === "location.city")!;
  assert.equal(city.cited, view.citationText(cite("location.city", harvard)), "the citation is the dataset's, in one line");
  assert.ok(city.cited.startsWith(`Reported in ${meta.sources.scorecard!.label}`), city.cited);
});

test("editableRows: a live edit is shown, cited as Quad's, chipped, with its history newest first and who made it", () => {
  const rows = [
    edit({ id: 7, value: 2100, note: "From the 2026 class profile", created_at: "2026-10-31T15:00:00Z", created_by: "u1" }),
    edit({ id: 5, value: 2050, created_at: "2026-10-20T15:00:00Z", released_at: "2026-10-21T00:00:00Z", created_by: "u2" }),
  ];
  const groups = view.editableRows(harvard, schools, rows, null, { cite, names: new Map([["u1", "Ray"]]) });
  const r = groups.flatMap((g) => g.rows).find((x) => x.path === "admissions.admitted")!;
  assert.equal(r.current, 2100);
  assert.equal(r.edited, true);
  assert.equal(r.liveEditId, 7);
  assert.equal(r.cited, "Edited by Quad on October 31, 2026. From the 2026 class profile");
  assert.deepEqual(r.history.map((h) => [h.id, h.status, h.who]), [[7, "live", "Ray"], [5, "released", "an admin"]]);
});

test("citationText: an edit reads 'Edited by Quad on {Month D, YYYY}' and the note; another source keeps its name and year", () => {
  const edited = view.citationText(cite("admissions.admitted", harvard), { source: "quad-edit", method: "edited", retrieved: "2026-10-31", note: "Fixed a typo" });
  assert.equal(edited, "Edited by Quad on October 31, 2026. Fixed a typo");
  const plain = view.citationText(cite("location.city", harvard));
  assert.doesNotMatch(plain, /Edited by Quad/);
  assert.ok(plain.startsWith(`Reported in ${meta.sources.scorecard!.label}`), plain);
  assert.match(view.citationText(cite("admissions.admitted", harvard)), /^Reported by Harvard University/, "a college's own figure");
});

/* ------------------------------------------------------------------ */
/* The marker                                                          */
/* ------------------------------------------------------------------ */

function snap(pipeline: SnapshotEditsObject["edits"][number]["pipeline"]): SnapshotEditsObject {
  return { snapshot: 9, edits: [{ id: 1, unit_id: HARVARD, path: "admissions.admitted", value: 2100, note: null, created_at: "2026-10-20T15:00:00Z", pipeline }] };
}

test("the marker: a different pipeline value retrieved after the edit's day is shown; the same, an older one, or no object is not", () => {
  const live = edit({ value: 2100, created_at: "2026-10-20T15:00:00Z" });
  const label = (k: string) => (k === "cds" ? "Common Data Set" : k);
  assert.equal(
    view.newerPipeline(live, snap({ value: 2150, lineage: { source: "cds", retrieved: "2026-10-28" } }), { sourceLabel: label }),
    "A newer pipeline value exists: 2,150 from Common Data Set, October 28, 2026",
  );
  assert.equal(view.newerPipeline(live, snap({ value: 2100, lineage: { source: "cds", retrieved: "2026-10-28" } })), null, "the same value");
  assert.equal(view.newerPipeline(live, snap({ value: 2150, lineage: { source: "cds", retrieved: "2026-10-01" } })), null, "older than the edit");
  assert.equal(view.newerPipeline(live, snap({ value: 2150, lineage: { source: "cds", retrieved: "2026-10-20" } })), null, "the edit's own day is not after it");
  assert.equal(view.newerPipeline(live, snap(null)), null, "no pipeline value");
  assert.equal(view.newerPipeline(live, null), null, "no edits.json");
  assert.equal(view.newerPipeline({ ...live, path: "admissions.enrolled" }, snap({ value: 1, lineage: { source: "cds", retrieved: "2026-10-28" } })), null, "another path's entry");
  // No lineage record at the path (the field's default source): the date is unknown, so no marker.
  assert.equal(view.newerPipeline(live, snap({ value: 2150, lineage: null })), null, "no lineage record: unknown, no marker");
  // A stored null is a real pipeline value (the key was there); pipeline: null means it was absent.
  assert.equal(view.newerPipeline(live, snap({ value: null, lineage: { source: "cds", retrieved: "2026-10-28" } })), "A newer pipeline value exists: None from cds, October 28, 2026");
  assert.equal(view.newerPipeline({ ...live, value: null }, snap({ value: null, lineage: { source: "cds", retrieved: "2026-10-28" } })), null, "a cleared edit and a stored null agree");
  // Deep equality for JSON values.
  const json = edit({ path: "admissions.sat_math_25_75", value: [700, 780] });
  const entry = (value: unknown): SnapshotEditsObject => ({ snapshot: 9, edits: [{ ...snap(null).edits[0], path: json.path, pipeline: { value, lineage: { source: "cds", retrieved: "2026-11-02" } } }] });
  assert.equal(view.newerPipeline(json, entry([700, 780])), null);
  assert.ok(view.newerPipeline(json, entry([710, 780])));
});

test("editableRows carries the marker onto the edited row only", () => {
  const groups = view.editableRows(harvard, schools, [edit({ created_at: "2026-10-20T15:00:00Z" })], snap({ value: 2150, lineage: { source: "cds", retrieved: "2026-10-28" } }), { cite });
  const rows = groups.flatMap((g) => g.rows);
  assert.match(rows.find((r) => r.path === "admissions.admitted")!.newerPipeline!, /^A newer pipeline value exists: 2,150/);
  assert.equal(rows.filter((r) => r.newerPipeline).length, 1);
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

test("collegeEdits reads every row for the college newest first; editorNames reads profiles once, and an empty list reads nothing", async () => {
  const sb = fakeSupabase({
    data_field_edits: [edit({ id: 1, created_at: "2026-10-01T00:00:00Z" }), edit({ id: 3, created_at: "2026-10-03T00:00:00Z" }), edit({ id: 2, unit_id: "190415" })],
    profiles: [{ id: "u1", display_name: "Ray" }],
  });
  const rows = await reads.collegeEdits(sb as never, HARVARD);
  assert.deepEqual(rows.map((r) => r.id), [3, 1]);
  assert.deepEqual([...(await reads.editorNames(sb as never, ["u1", null, "u1"]))], [["u1", "Ray"]]);
  assert.equal((await reads.editorNames({ from: () => assert.fail("no read") } as never, [null])).size, 0);
});

test("snapshotEdits: the served snapshot's edits.json over a fake fetch; no base, no numeric id, a 404, a bad status or a malformed body is null", async () => {
  const body: SnapshotEditsObject = { snapshot: 12, edits: [] };
  const seen: string[] = [];
  const ok = (async (url: string) => {
    seen.push(url);
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  assert.deepEqual(await reads.snapshotEdits({ base: "https://x.test/snapshots/", id: "12", fetchImpl: ok }), body);
  assert.deepEqual(seen, ["https://x.test/snapshots/12/edits.json"]);
  assert.equal(await reads.snapshotEdits({ base: "", id: "12", fetchImpl: ok }), null);
  assert.equal(await reads.snapshotEdits({ base: "https://x.test", id: "legacy", fetchImpl: ok }), null);
  assert.equal(await reads.snapshotEdits({ base: "https://x.test", id: "0", fetchImpl: ok }), null, "the bundled fixture's id");
  assert.equal(seen.length, 1, "none of those fetched");
  const status = (s: number, json: unknown = {}) => (async () => ({ ok: s < 300, status: s, json: async () => json }) as unknown as Response) as unknown as typeof fetch;
  assert.equal(await reads.snapshotEdits({ base: "https://x.test", id: "12", fetchImpl: status(404) }), null);
  assert.equal(await reads.snapshotEdits({ base: "https://x.test", id: "12", fetchImpl: status(500) }), null);
  assert.equal(await reads.snapshotEdits({ base: "https://x.test", id: "12", fetchImpl: status(200, { nope: 1 }) }), null);
  const thrown = (async () => {
    throw new Error("timed out");
  }) as unknown as typeof fetch;
  assert.equal(await reads.snapshotEdits({ base: "https://x.test", id: "12", fetchImpl: thrown }), null);
  assert.equal(networkCalls, 0);
});

/* ------------------------------------------------------------------ */
/* Actions, over fake dependencies                                     */
/* ------------------------------------------------------------------ */

function fakeDeps(opts: { rpcError?: string; rows?: EditRecord[] } = {}) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const revalidated: string[][] = [];
  const order: string[] = [];
  const deps: EditActionDeps = {
    async rpc(fn, args) {
      rpcs.push({ fn, args });
      return opts.rpcError ? { ok: false, error: opts.rpcError } : { ok: true, data: 99 };
    },
    async readEdit(id) {
      return (opts.rows ?? []).find((r) => r.id === id) ?? null;
    },
    revalidate(paths) {
      order.push("revalidate");
      revalidated.push(paths);
    },
    forget() {
      order.push("forget");
    },
  };
  return { deps, rpcs, revalidated, order };
}

test("saveEdit: parses by kind, calls admin_data_edit, then revalidates the profile and the admin pages", async () => {
  const f = fakeDeps();
  const r = await actions.saveEdit(f.deps, form({ unit: HARVARD, path: "admissions.admitted", kind: "number", value: "2,100", note: "  from the  class profile " }));
  assert.equal(r.status, "done");
  assert.deepEqual(f.rpcs, [{ fn: "admin_data_edit", args: { p_unit: HARVARD, p_path: "admissions.admitted", p_value: 2100, p_note: "from the class profile" } }]);
  assert.deepEqual(f.revalidated, [[`/schools/${HARVARD}`, `/admin/colleges/${HARVARD}`]]);
  assert.deepEqual(f.order, ["forget", "revalidate"], "the overlay's memo is forgotten before the pages regenerate");
});

test("saveEdit: an unregistered, computed or hidden path, the key, a bad value, or a bad form never reaches the rpc", async () => {
  const defs = FIELDS as Record<string, FieldDef>;
  const computed = Object.keys(FIELDS).find((p) => defs[p].computed)!;
  const hidden = Object.keys(FIELDS).find((p) => defs[p].hidden)!;
  for (const path of ["admissions.nope", computed, hidden, "unit_id"]) {
    const f = fakeDeps();
    const r = await actions.saveEdit(f.deps, form({ unit: HARVARD, path, kind: "text", value: "x" }));
    assert.equal(r.status, "error", path);
    assert.equal(f.rpcs.length, 0, path);
  }
  const f = fakeDeps();
  const bad = await actions.saveEdit(f.deps, form({ unit: HARVARD, path: "admissions.admitted", kind: "number", value: "lots" }));
  assert.deepEqual(bad, { status: "error", message: "Enter a number." });
  assert.equal((await actions.saveEdit(f.deps, form({ unit: "abc", path: "name", kind: "text", value: "x" }))).status, "error");
  assert.equal((await actions.saveEdit(f.deps, form({ unit: HARVARD, path: "name", kind: "color", value: "x" }))).status, "error");
  assert.equal(f.rpcs.length, 0);
  assert.equal(f.revalidated.length, 0);
  assert.deepEqual(f.order, []);
});

test("a refused rpc revalidates nothing and says why in plain words", async () => {
  const f = fakeDeps({ rpcError: "invalid_note", rows: [edit({ id: 4 })] });
  const r = await actions.saveEdit(f.deps, form({ unit: HARVARD, path: "name", kind: "text", value: "Harvard" }));
  assert.deepEqual(r, { status: "error", message: "Keep the note under 500 characters." });
  assert.deepEqual(f.order, [], "a refusal forgets and revalidates nothing");
  const rel = await actions.releaseEdit(fakeDeps({ rpcError: "edit_released", rows: [edit({ id: 4 })] }).deps, form({ edit: "4" }));
  assert.deepEqual(rel, { status: "error", message: "That edit was already released. Reload the page." });
  assert.equal(f.revalidated.length, 0);
});

test("releaseEdit releases the live row and revalidates its college; an unknown id is refused before any rpc", async () => {
  const f = fakeDeps({ rows: [edit({ id: 4, unit_id: "190415" })] });
  const r = await actions.releaseEdit(f.deps, form({ edit: "4" }));
  assert.equal(r.status, "done");
  assert.deepEqual(f.rpcs, [{ fn: "admin_data_release_edit", args: { p_edit: 4 } }]);
  assert.deepEqual(f.revalidated, [["/schools/190415", "/admin/colleges/190415"]]);
  assert.deepEqual(f.order, ["forget", "revalidate"]);
  const g = fakeDeps();
  assert.equal((await actions.releaseEdit(g.deps, form({ edit: "5" }))).status, "error");
  assert.equal((await actions.releaseEdit(g.deps, form({ edit: "x" }))).status, "error");
  assert.equal(g.rpcs.length, 0);
});

test("revertToEdit saves the older row's value as a new edit with the fixed note", async () => {
  const f = fakeDeps({ rows: [edit({ id: 3, value: [1, 2], path: "admissions.sat_math_25_75", created_at: "2026-10-12T09:00:00Z" })] });
  const r = await actions.revertToEdit(f.deps, form({ edit: "3" }));
  assert.equal(r.status, "done");
  assert.deepEqual(f.rpcs, [{ fn: "admin_data_edit", args: { p_unit: HARVARD, p_path: "admissions.sat_math_25_75", p_value: [1, 2], p_note: "Reverted to the edit of October 12, 2026" } }]);
  assert.equal(f.revalidated.length, 1);
});

test("the new refusals have plain words", async () => {
  const { dataErrorMessage } = await import("../lib/admin/data-actions.ts");
  assert.equal(dataErrorMessage("edit_not_found"), "That edit doesn't exist any more. Reload the page.");
  assert.equal(dataErrorMessage("edit_released"), "That edit was already released. Reload the page.");
});

/* ------------------------------------------------------------------ */
/* The Server Actions and the page                                     */
/* ------------------------------------------------------------------ */

const fd = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

test("the Server Actions call requireAdmin() before anything: a non-admin gets a 404 with no read and no rpc", async () => {
  const mod = await import("../app/admin/colleges/[unit]/edit/actions.ts");
  const rpcs: string[] = [];
  const supabase = () => ({ rpc: async (fn: string) => (rpcs.push(fn), { data: 1, error: null }), from: () => assert.fail("no read") });
  for (const [name, values] of [
    ["saveEditAction", { unit: HARVARD, path: "name", kind: "text", value: "Harvard" }],
    ["releaseEditAction", { edit: "4" }],
    ["revertEditAction", { edit: "4" }],
  ] as const) {
    reset({ admin: false, supabase });
    const action = (mod as unknown as Record<string, (p: unknown, f: FormData) => Promise<unknown>>)[name];
    await assert.rejects(action({ status: "idle" }, fd(values)), is404, name);
    assert.deepEqual(world.calls, ["requireAdmin"], name);
  }
  assert.deepEqual(rpcs, []);
  reset({ admin: true, supabase });
  const done = await mod.saveEditAction({ status: "idle" }, fd({ unit: HARVARD, path: "name", kind: "text", value: "Harvard" }));
  assert.equal(done.status, "done");
  assert.deepEqual(world.calls, ["requireAdmin", "withAdmin", "refresh"]);
  assert.deepEqual(rpcs, ["admin_data_edit"]);
  assert.deepEqual(world.revalidated, [`/schools/${HARVARD} layout`, `/admin/colleges/${HARVARD} layout`]);
});

const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(reactUrl)};\nexport default ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);`);
writeFileSync(join(tmp, "actions.mjs"), "export async function saveEditAction(){} export async function releaseEditAction(){} export async function revertEditAction(){}");

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

/** Transpiles a .tsx file; component imports become stand-ins, except those in `real`, which are transpiled the same way. */
async function loadTsx(rel: string, real: string[] = []): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  let n = 0;
  const reals: Record<string, string> = {};
  for (const r of real) {
    await loadTsx(`${r.slice(2)}.tsx`);
    reals[r] = pathToFileURL(join(tmp, `${`${r.slice(2)}.tsx`.replace(/[^a-z]/gi, "_")}.mjs`)).href;
  }
  const code = outputText
    .replace(/from "react"/g, `from ${JSON.stringify(reactUrl)}`)
    .replace(/from "next\/link"/g,`from ${JSON.stringify(pathToFileURL(join(tmp, "link.mjs")).href)}`)
    .replace(/from "\.\/actions"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "actions.mjs")).href)}`)
    .replace(/import \{([^}]*)\} from "(@\/(?:components|app)\/[^"]+)";/g, (_m, names: string, spec: string) => {
      if (reals[spec]) return `import {${names}} from ${JSON.stringify(reals[spec])};`;
      const list = names.split(",").map((s) => s.trim().replace(/^type\s+/, "").split(" as ").pop()!.trim()).filter(Boolean);
      return `import {${names}} from ${JSON.stringify(stubModule(`${rel.replace(/[^a-z]/gi, "_")}${n++}-${spec.split("/").pop()}`, list))};`;
    });
  const file = join(tmp, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}
type EditPage = (props: { params: Promise<{ unit: string }> }) => Promise<import("react").ReactElement>;

const dataset = createDataset({ schools, meta, releaseCalendar: JSON.parse(read(`${FIXTURE}/release-calendar.json`)) });

test("the edit page: a 404 signed out before any read; for an admin, a row per field with its input, Save, the Edited chip, Release and History", async () => {
  const page = (await loadTsx("app/admin/colleges/[unit]/edit/page.tsx", ["@/components/admin/FieldEditor", "@/components/admin/Panel"])).default as EditPage;
  reset({ admin: false, data: dataset });
  await assert.rejects(page({ params: Promise.resolve({ unit: HARVARD }) }), is404);
  assert.deepEqual(world.calls, ["requireAdmin"]);

  reset({ admin: true, data: dataset, supabase: () => fakeSupabase({ data_field_edits: [edit({ id: 7, value: 2100, note: "From the class profile" })], profiles: [] }) });
  const markup = renderToStaticMarkup(await page({ params: Promise.resolve({ unit: HARVARD }) }));
  assert.deepEqual(world.calls.slice(0, 3), ["requireAdmin", "getData", "adminSupabase"]);
  assert.match(markup, /Edit Harvard University/);
  assert.match(markup, /href="\/schools\/166027"/, "the public profile link");
  assert.match(markup, /href="\/admin\/colleges\/166027"/, "the back link");
  assert.match(markup, /data-path="admissions\.admitted"/);
  assert.match(markup, /data-path="name"/);
  assert.doesNotMatch(markup, /data-path="unit_id"/);
  assert.match(markup, />Save</);
  assert.match(markup, />Edited</);
  assert.match(markup, /Edited by Quad on October 31, 2026\. From the class profile/);
  assert.match(markup, /data-stub="AdminForm"[^>]*trigger&quot;:&quot;Release/);
  assert.match(markup, /History \(1\)/);
  assert.match(markup, /a share, 0 to 1: 0\.42 is 42%/);
  assert.match(markup, /<details open=""/, "groups are open on desktop (the server's render)");
  assert.doesNotMatch(markup, /override|deploy|\bPR\b/i, "the console's words");

  reset({ admin: true, data: dataset, supabase: () => fakeSupabase({ data_field_edits: [] }) });
  await assert.rejects(page({ params: Promise.resolve({ unit: "999999" }) }), is404, "an unknown college");
  await assert.rejects(page({ params: Promise.resolve({ unit: "abc" }) }), is404, "not a unit id");
});

test("static: the page calls connection() then requireAdmin() first and is noindex; the college page links Edit; the editor imports only types from the view", () => {
  const src = read("app/admin/colleges/[unit]/edit/page.tsx");
  assert.match(src.slice(src.indexOf("export default async function")), /\{\n\s+await connection\(\);\n\s+await requireAdmin\(\);/);
  assert.match(src, /robots: \{ index: false, follow: false \}/);
  assert.match(read("app/admin/colleges/[unit]/page.tsx"), /href=\{`\/admin\/colleges\/\$\{unit\}\/edit`\}[^>]*>\s*Edit\s*</);
  const editor = read("components/admin/FieldEditor.tsx");
  assert.match(editor, /^"use client";/);
  assert.match(editor, /import type \{[^}]*\} from "@\/lib\/admin\/edits-view";/);
  assert.doesNotMatch(editor, /import \{[^}]*\} from "@\/lib\/admin\/edits-(view|reads|actions)"/, "nothing but types from the server-side modules");
  for (const f of ["components/admin/FieldEditor.tsx", "app/admin/colleges/[unit]/edit/page.tsx", "lib/admin/edits-actions.ts", "lib/admin/edits-view.ts"]) {
    assert.doesNotMatch(read(f), /SUPABASE_SECRET|service_role/i, f);
    assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /\boverride|\bdeploy/i, f);
  }
});
