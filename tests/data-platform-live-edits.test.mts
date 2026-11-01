/**
 * The live overlay (lib/data-platform/live-edits.ts; specs/data-platform/change-sets.md "Admin edits"): the reader
 * over a fake GET (rows become edits; a 500, a timeout and a malformed body each fail open to no edits, logged once);
 * the 30 s memo; nothing read without Supabase configured; `withLiveEdits` on a mini-fixture college; the module reads
 * over node:http(s), never `fetch`; and the Data API's one-college routes and the MCP tools serving the overlaid value
 * with the table served by a local node:http server. Nothing here reaches the database or the network. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { School } from "../lib/types";

const ROOT = join(import.meta.dirname, "..");

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
// The API routes' key check runs over a stand-in Supabase client that accepts any key (as tests/api-v1-routes.test.mts).
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  "@/lib/supabase":
    "export function supabaseClient(){ return { rpc: async (name) => name === 'api_key_use' ? { data: [{ key_id: 'key-1', user_id: 'user-1', tier: 'account', allowed: true, used_today: 1, limit_per_day: 5000 }], error: null } : { data: null, error: { message: 'unknown function ' + name } } }; }",
  "@/lib/analytics-server": "export async function trackServer(){}",
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

// Never the live snapshot or the real project: the dataset is data/ (legacy), the table a local server below.
delete process.env.DATA_SNAPSHOT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_PUBLISHABLE_KEY;

const live = await import("../lib/data-platform/live-edits.ts");
type LiveGet = import("../lib/data-platform/live-edits.ts").LiveGet;

const ENV = { SUPABASE_URL: "https://project.example.test/", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const ROW = { id: 7, unit_id: "138558", path: "admissions.applicants", value: 3000, note: "Per the registrar", created_at: "2026-10-31T15:04:05.123+00:00" };
const rowsBody = (rows: unknown) => Buffer.from(JSON.stringify(rows));

function fakeGet(answer: (url: string) => Promise<{ status: number; body: Buffer }>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const get: LiveGet = (url, headers) => {
    calls.push({ url, headers });
    return answer(url);
  };
  return { get, calls };
}

function logger() {
  const lines: string[] = [];
  return { lines, log: (line: string) => void lines.push(line) };
}

/* ------------------------------------------------------------------ */
/* The reader                                                          */
/* ------------------------------------------------------------------ */

test("the reader asks PostgREST for every unreleased edit with the publishable key, and parses the rows", async () => {
  const { get, calls } = fakeGet(async () => ({ status: 200, body: rowsBody([ROW, { ...ROW, id: 8, path: "not.a.field" }, { ...ROW, id: 9, path: "derived.yield" }]) }));
  const reader = live.createLiveEditsReader({ env: ENV, get });
  const edits = await reader.read();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://project.example.test/rest/v1/data_field_edits?select=id,unit_id,path,value,note,created_at&released_at=is.null&order=id");
  assert.equal(calls[0].headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(calls[0].headers.Authorization, `Bearer ${ENV.SUPABASE_PUBLISHABLE_KEY}`);
  // The unregistered and the computed rows are skipped, as the publisher skips them.
  assert.deepEqual(edits, [{ ...ROW, released_at: null }]);
});

test("without SUPABASE_URL or the publishable key nothing is read", async () => {
  for (const env of [{}, { SUPABASE_URL: ENV.SUPABASE_URL }, { SUPABASE_PUBLISHABLE_KEY: ENV.SUPABASE_PUBLISHABLE_KEY }]) {
    const { get, calls } = fakeGet(async () => ({ status: 200, body: rowsBody([ROW]) }));
    assert.deepEqual(await live.createLiveEditsReader({ env, get }).read(), []);
    assert.equal(calls.length, 0);
  }
});

for (const [kind, answer] of [
  ["http", async () => ({ status: 500, body: Buffer.from("oops") })],
  ["timeout", () => new Promise<never>(() => {})],
  ["malformed", async () => ({ status: 200, body: Buffer.from("<html>not rows</html>") })],
  ["malformed", async () => ({ status: 200, body: rowsBody({ rows: [] }) })],
  ["malformed", async () => ({ status: 200, body: rowsBody([{ id: 1, path: "admissions.applicants" }]) })],
  ["network", async () => Promise.reject(new Error("ECONNREFUSED"))],
] as [string, (url: string) => Promise<{ status: number; body: Buffer }>][]) {
  test(`a ${kind} failure fails open to no edits and logs once a minute`, async () => {
    let clock = 0;
    const { get, calls } = fakeGet(answer);
    const { lines, log } = logger();
    const reader = live.createLiveEditsReader({ env: ENV, get, log, now: () => clock, timeoutMs: 20 });
    assert.deepEqual(await reader.read(), []);
    clock += live.LIVE_EDITS_TTL_MS; // past the memo, inside the log interval
    assert.deepEqual(await reader.read(), []);
    assert.equal(calls.length, 2);
    assert.equal(lines.length, 1, lines.join("\n"));
    assert.match(lines[0], new RegExp(`\\(${kind}\\)`));
    clock += live.LIVE_EDITS_LOG_INTERVAL_MS;
    await reader.read();
    assert.equal(lines.length, 2);
  });
}

test("the 30 s memo: two reads, one request; once the clock moves past it, a second request", async () => {
  let clock = 1_000;
  const { get, calls } = fakeGet(async () => ({ status: 200, body: rowsBody([ROW]) }));
  const reader = live.createLiveEditsReader({ env: ENV, get, now: () => clock });
  const [a, b] = await Promise.all([reader.read(), reader.read()]);
  assert.equal(calls.length, 1);
  assert.equal(a, b);
  clock += live.LIVE_EDITS_TTL_MS - 1;
  await reader.read();
  assert.equal(calls.length, 1);
  clock += 1;
  await reader.read();
  assert.equal(calls.length, 2);
  reader.forget();
  await reader.read();
  assert.equal(calls.length, 3, "forget() drops the memo");
});

test("the module reads over node:http(s), never fetch, and stays server-only", () => {
  const source = readFileSync(join(ROOT, "lib/data-platform/live-edits.ts"), "utf8");
  assert.match(source, /from "node:https"/);
  assert.match(source, /from "node:http"/);
  assert.match(source, /^import "server-only";/m);
  assert.doesNotMatch(source, /\bfetch\(/);
  assert.doesNotMatch(source, /SUPABASE_SECRET_KEY/);
});

/* ------------------------------------------------------------------ */
/* The overlay, over a local server standing in for PostgREST          */
/* ------------------------------------------------------------------ */

let served: unknown = [ROW];
let requests = 0;
const server = createServer((req, res) => {
  requests++;
  assert.equal(req.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(served));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.SUPABASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.SUPABASE_PUBLISHABLE_KEY = ENV.SUPABASE_PUBLISHABLE_KEY;
test.after(() => server.close());

const MINI = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/snapshot-mini/snapshot/colleges.json"), "utf8")) as School[];

test("withLiveEdits sets the value and its lineage on a mini-fixture college; others pass through as is", async () => {
  live.forgetLiveEdits();
  const abac = MINI.find((s) => s.unit_id === ROW.unit_id)!;
  const other = MINI.find((s) => s.unit_id !== ROW.unit_id)!;
  assert.notEqual(abac.admissions.applicants, ROW.value);
  const out = await live.withLiveEdits(abac);
  assert.equal(out.admissions.applicants, 3000);
  assert.deepEqual(out.lineage?.["admissions.applicants"], { source: "quad-edit", method: "edited", retrieved: "2026-10-31", note: "Per the registrar" });
  assert.equal(abac.admissions.applicants, 2694, "the snapshot's record is untouched");
  assert.equal(await live.withLiveEdits(other), other);
  const all = await live.withLiveEditsAll([other, abac]);
  assert.equal(all[0], other);
  assert.equal(all[1].admissions.applicants, 3000);
});

test("a released or missing table answers the snapshot's college unchanged", async () => {
  served = [];
  live.forgetLiveEdits();
  const abac = MINI.find((s) => s.unit_id === ROW.unit_id)!;
  assert.equal(await live.withLiveEdits(abac), abac);
  served = [ROW];
  live.forgetLiveEdits();
});

/* ------------------------------------------------------------------ */
/* Where the overlay applies: the Data API and the MCP tools            */
/* ------------------------------------------------------------------ */

const { generateApiKey } = await import("../lib/api/keys.ts");
const getRoute = await import("../app/api/v1/schools/[id]/route.ts");
const lineageRoute = await import("../app/api/v1/schools/[id]/lineage/route.ts");
type Route = { GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> };

async function call(route: Route, path: string, id: string): Promise<Response> {
  const request = new Request(`https://quad.test${path}`, { headers: { Authorization: `Bearer ${generateApiKey()}` } });
  return route.GET(request, { params: Promise.resolve({ id }) });
}

test("GET /api/v1/schools/{id} serves the edited value", async () => {
  live.forgetLiveEdits();
  const res = await call(getRoute, `/api/v1/schools/${ROW.unit_id}`, ROW.unit_id);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data?: { admissions: { applicants: number } }; admissions?: { applicants: number } };
  const record = body.data ?? body;
  assert.equal(record.admissions?.applicants, 3000);
});

test("GET /api/v1/schools/{id}/lineage cites the edit (quad-edit, edited, the day, the note)", async () => {
  live.forgetLiveEdits();
  const res = await call(lineageRoute, `/api/v1/schools/${ROW.unit_id}/lineage?fields=admissions.applicants`, ROW.unit_id);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data?: { fields: Record<string, Record<string, unknown>> }; fields?: Record<string, Record<string, unknown>> };
  const cited = (body.data ?? body).fields!["admissions.applicants"];
  assert.equal(cited.key, "quad-edit");
  assert.equal(cited.method, "edited");
  assert.equal(cited.label, "Quad's editors");
  assert.equal(cited.year, null);
  assert.equal(cited.retrieved, "2026-10-31");
  assert.equal(cited.note, "Per the registrar");
});

test("the MCP one-college tools serve the edit when the context carries the overlay, and the record as is without it", async () => {
  live.forgetLiveEdits();
  const { runTool } = await import("../lib/api/mcp.ts");
  const { getData } = await import("../lib/data.ts");
  const data = await getData();
  const ctx = { data, getHistory: async () => null, liveSchool: live.withLiveEdits };
  const text = (o: { result: { content: unknown[] } }) => (o.result.content[0] as { text: string }).text;
  const college = JSON.parse(text(await runTool("get_college", { unit_id: ROW.unit_id, fields: ["admissions"] }, ctx)));
  assert.equal(college.admissions.applicants, 3000);
  const lineage = JSON.parse(text(await runTool("get_lineage", { unit_id: ROW.unit_id, fields: ["admissions.applicants"] }, ctx)));
  assert.equal(lineage.fields["admissions.applicants"].key, "quad-edit");
  const doc = JSON.parse(text(await runTool("fetch", { id: ROW.unit_id }, ctx)));
  assert.match(doc.text, /: 3,000 \(Edited by Quad on October 31, 2026\)/);
  const plain = JSON.parse(text(await runTool("get_college", { unit_id: ROW.unit_id, fields: ["admissions"] }, { data, getHistory: async () => null })));
  assert.equal(plain.admissions.applicants, data.getSchoolById(ROW.unit_id)!.admissions.applicants);
  assert.ok(requests > 0, "the overlay read the stand-in table");
});
