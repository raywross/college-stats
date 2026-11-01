/**
 * The Data API's college routes (specs/product/data-api.md "Endpoints"; app/api/v1/schools/**, app/api/v1/national,
 * lib/api/query.ts), driven through the real route handlers with a stand-in for the publishable-key client that
 * accepts any key:
 * - /schools: for four real Explore URLs the ids equal `getSchools(parseFilters(...))` in the same order, page by page;
 *   the cursor walks the whole dataset with no repeats and ends with `next_cursor: null`; `limit` is clamped and
 *   checked; a bad `sort`, `sortDir`, `cursor`, number, `types`, ZIP, or unknown parameter is `400` naming it;
 *   `fields=` trims records; every key `parseFilters` reads is documented, and the documented sort values are Explore's;
 * - /schools/{id}: the record `publicSchool` serves, 404 for an unknown id, `fields=`;
 * - /history: 404 for a college without a shard, 200 with the shard, its series' definitions, and sources for one that has;
 * - /lineage: every key a public registered field path, equal to `schoolLineage`, `fields=` narrows, hidden names refused;
 * - /changes: `[]` without Supabase (and when it can't be read), `describeChange` text on stored rows, hidden fields left out;
 * - /national: the serializer's numbers; every route answers 401 without a key.
 * Each guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import { miniHistory, miniSchools, miniSnapshotDir, installMiniAsBundledCopy } from "./helpers/snapshot.mts";

const ROOT = join(import.meta.dirname, "..");
// The routes read getData(): make the mini fixture the bundled copy (tests/helpers/snapshot.mts) before lib/data.ts loads.
const MINI_ROOT = installMiniAsBundledCopy();
// Transitional, until lib/zip-centroids.ts reads the bundled copy (unit G1): it still reads
// data/reference/zcta-centroids.csv under the working directory, so give it the fixture's table there too. Delete this
// once G1 is merged (the table then comes from .data/snapshot/reference/).
if (!readFileSync(join(ROOT, "lib", "zip-centroids.ts"), "utf8").includes(".data")) {
  mkdirSync(join(MINI_ROOT, "data", "reference"), { recursive: true });
  symlinkSync(join(miniSnapshotDir(), "reference", "zcta-centroids.csv"), join(MINI_ROOT, "data", "reference", "zcta-centroids.csv"));
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ */
/* Next.js stand-ins (the same ones tests/api-v1.test.mts uses)        */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  "@/lib/supabase":
    "export function supabaseClient(role){ if(!globalThis.__rpc) throw new Error('Supabase is not configured: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY'); return { rpc: async (name, args) => globalThis.__rpc(name, args, role) }; }",
  "@/lib/analytics-server": "export async function trackServer(event, properties){ (globalThis.__events ??= []).push({ event, properties }); }",
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

type Rpc = (name: string, args: Record<string, unknown>, role: string) => Promise<{ data: unknown; error: { message: string } | null }>;
const g = globalThis as unknown as { __rpc?: Rpc };

const { parseFilters, SORT_KEYS } = await import("../lib/params.ts");
const { INDICATORS, INDICATOR_KEYS } = await import("../lib/indicators.ts");
const { isFieldPath, HIDDEN_FIELDS } = await import("../lib/fields.ts");
const { describeChange } = await import("../lib/changes.ts");
const { estimatesShown } = await import("../lib/cost-curve.ts");
const { resolveNear } = await import("../lib/zip-centroids.ts");
const { getData, getHistoryFiles } = await import("../lib/data.ts");
const serialize = await import("../lib/api/serialize.ts");
const query = await import("../lib/api/query.ts");
const { API_ROUTES, routeFilePath } = await import("../lib/api/routes.ts");
const { generateApiKey } = await import("../lib/api/keys.ts");

const listRoute = await import("../app/api/v1/schools/route.ts");
const getRoute = await import("../app/api/v1/schools/[id]/route.ts");
const historyRoute = await import("../app/api/v1/schools/[id]/history/route.ts");
const lineageRoute = await import("../app/api/v1/schools/[id]/lineage/route.ts");
const changesRoute = await import("../app/api/v1/schools/[id]/changes/route.ts");
const nationalRoute = await import("../app/api/v1/national/route.ts");

type Route = { GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> };

const data = await getData();
const schools = data.getAllSchools();
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const HARVARD = "166027";
const hasShard = (id: string) => miniHistory(id) !== null;

/** Every key a request is answered for gets its own per-minute bucket, so a test can make as many calls as it needs. */
g.__rpc = async (name) =>
  name === "api_key_use"
    ? { data: [{ key_id: "key-1", user_id: "user-1", tier: "account", allowed: true, used_today: 1, limit_per_day: 5000 }], error: null }
    : { data: null, error: { message: `unknown function ${name}` } };

async function call(route: Route, path: string, id?: string, key: string | null = generateApiKey()): Promise<Response> {
  const request = new Request(`https://quad.test${path}`, { headers: key === null ? {} : { Authorization: `Bearer ${key}` } });
  return route.GET(request, { params: Promise.resolve(id === undefined ? ({} as { id: string }) : { id }) });
}
const json = async <T,>(res: Response) => (await res.json()) as T;

interface ListBody {
  items: Record<string, unknown>[];
  total: number;
  next_cursor: string | null;
}

/** Every page of a list request, following `next_cursor`. */
async function walkList(qs: string, limit = 100): Promise<{ ids: string[]; total: number; pages: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let total = -1;
  let pages = 0;
  do {
    const sep = qs ? "&" : "";
    const res = await call(listRoute, `/api/v1/schools?${qs}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(res.status, 200, `${qs} page ${pages + 1}`);
    const body = await json<ListBody>(res);
    ids.push(...body.items.map((i) => String(i.unit_id)));
    total = body.total;
    cursor = body.next_cursor;
    pages++;
    assert.ok(pages < 100, "the cursor never ends");
  } while (cursor);
  return { ids, total, pages };
}

/** The colleges Explore shows for a query string, in its order (the Explore page's own steps). */
function exploreIds(qs: string): string[] {
  const params = Object.fromEntries(new URLSearchParams(qs));
  // Explore's address bar says sortBy; the API's own name for it is sort.
  if (params.sort) params.sortBy = params.sort;
  const filters = { ...resolveNear(parseFilters(params)), showEstimates: estimatesShown() };
  return data.getSchools(filters).map((s) => s.unit_id);
}

/* ------------------------------------------------------------------ */
/* /schools                                                            */
/* ------------------------------------------------------------------ */

const EXPLORE_URLS = [
  "states=CA&types=public",
  "q=georgia",
  "minSAT=1400&sort=acceptance_rate",
  "regions=Northeast&sizes=small,medium&sortBy=name&sortDir=desc&view=table&page=2",
  "minAR=10&maxAR=30&sort=sat&sortDir=desc",
];

test("/schools: for real Explore URLs the ids equal getSchools(parseFilters(...)), in the same order, across pages", async () => {
  for (const qs of EXPLORE_URLS) {
    const expected = exploreIds(qs);
    assert.ok(expected.length > 0, `${qs} should match some colleges`);
    const got = await walkList(qs, 4);
    assert.equal(got.total, expected.length, `${qs}: total`);
    assert.deepEqual(got.ids, expected, qs);
  }
  // The order is the sort's: the same filters sorted another way give another order.
  assert.notDeepEqual(exploreIds("states=CA&sort=name"), exploreIds("states=CA&sort=acceptance_rate"));
});

test("guard: the parity check notices a different sort, a dropped filter, and a changed page size", async () => {
  const got = await walkList("states=CA&types=public&sort=name", 1);
  assert.notDeepEqual(got.ids, exploreIds("states=CA&types=public"), "name order is not applicants order");
  assert.notDeepEqual(got.ids, exploreIds("states=CA&sort=name"), "private colleges are missing");
  assert.equal(got.pages, Math.ceil(got.total / 1));
});

test("/schools: the sort keys are Explore's, with sortDir, and a ZIP's distance works like Explore's", async () => {
  for (const key of ["name", "acceptance_rate", "enrollment", "sat", "net_price", "selectivity"]) {
    const asc = (await json<ListBody>(await call(listRoute, `/api/v1/schools?sort=${key}&limit=100`))).items.map((i) => i.unit_id);
    assert.deepEqual(asc, exploreIds(`sort=${key}`).slice(0, 100), key);
  }
  // A ZIP the mini fixture's sampled centroid table has, near Duke, Elon, and UNC (the real data's example was Stanford's).
  const near = "near=27613&within=50&sort=distance";
  const expected = exploreIds(near);
  assert.ok(expected.length > 1 && expected.length < schools.length, "some colleges near the Raleigh ZIP, not all");
  assert.deepEqual((await walkList(near)).ids, expected);
});

test("/schools: the cursor walks the whole dataset, no repeats, and ends with next_cursor null", async () => {
  const walked = await walkList("", 10);
  assert.equal(walked.ids.length, schools.length);
  assert.equal(new Set(walked.ids).size, schools.length, "no college twice");
  assert.equal(walked.total, schools.length);
  assert.equal(walked.pages, Math.ceil(schools.length / 10));
  assert.deepEqual(walked.ids, data.getSchools(parseFilters({})).map((s) => s.unit_id));
  // The last page ends the walk; a cursor past the end is an empty page, not an error.
  const past = await json<ListBody>(await call(listRoute, `/api/v1/schools?cursor=${query.encodeCursor(schools.length + 500)}`));
  assert.deepEqual(past, { items: [], total: schools.length, next_cursor: null });
});

test("/schools: limit defaults to 50, is held to 100, and must be a whole number from 1", async () => {
  // The mini fixture's 38 colleges fit in one default page, so the parsed query shows the default and the clamp, and
  // the route shows a short last page with no cursor.
  const parsed = (qs: string) => {
    const q = query.parseListQuery(new URLSearchParams(qs));
    assert.ok(q.ok, qs);
    return q.query;
  };
  assert.equal(parsed("").limit, query.DEFAULT_LIMIT);
  assert.equal(parsed("limit=500").limit, query.MAX_LIMIT);
  const first = await json<ListBody>(await call(listRoute, "/api/v1/schools"));
  assert.equal(first.items.length, Math.min(query.DEFAULT_LIMIT, schools.length));
  const big = await json<ListBody>(await call(listRoute, "/api/v1/schools?limit=500"));
  assert.equal(big.items.length, Math.min(query.MAX_LIMIT, schools.length));
  if (schools.length <= query.MAX_LIMIT) assert.equal(big.next_cursor, null);
  else assert.equal(query.decodeCursor(big.next_cursor!), query.MAX_LIMIT);
  const two = await json<ListBody>(await call(listRoute, "/api/v1/schools?limit=2"));
  assert.equal(query.decodeCursor(two.next_cursor!), 2);
  assert.equal((await json<ListBody>(await call(listRoute, "/api/v1/schools?limit=1"))).items.length, 1);
  for (const bad of ["0", "-3", "abc", "2.5"]) {
    const res = await call(listRoute, `/api/v1/schools?limit=${bad}`);
    assert.equal(res.status, 400, bad);
    assert.match((await json<{ error: { code: string; message: string } }>(res)).error.message, /^limit:/);
  }
});

test("/schools: a bad value is 400 bad_request naming the parameter", async () => {
  const cases: [string, string][] = [
    ["sort=popularity", "sort"],
    ["sortBy=popularity", "sortBy"],
    ["sort=name&sortDir=sideways", "sortDir"],
    ["cursor=not-a-cursor", "cursor"],
    ["cursor=MDE", "cursor"],
    ["minSAT=high", "minSAT"],
    ["types=public,charter", "types"],
    ["sizes=huge", "sizes"],
    ["near=00000", "near"],
    ["near=abc", "near"],
    ["state=CA", "state"],
    ["fields=unit_id,nope", "fields"],
    ["fields=selectivity.band", "fields"],
  ];
  for (const [qs, param] of cases) {
    const res = await call(listRoute, `/api/v1/schools?${qs}`);
    assert.equal(res.status, 400, qs);
    const body = await json<{ error: { code: string; message: string } }>(res);
    assert.equal(body.error.code, "bad_request", qs);
    assert.ok(body.error.message.startsWith(`${param}:`), `${qs}: ${body.error.message}`);
  }
  // Explore's own page state is accepted and ignored, so a pasted Explore URL works.
  assert.equal((await call(listRoute, "/api/v1/schools?view=map&page=3&chart=value&forMe=reach&limit=1")).status, 200);
});

test("/schools: fields= keeps the named keys plus unit_id and name, for every item", async () => {
  const body = await json<ListBody>(await call(listRoute, "/api/v1/schools?states=CA&limit=3&fields=admissions,location"));
  assert.equal(body.items.length, 3);
  for (const item of body.items) assert.deepEqual(Object.keys(item).sort(), ["admissions", "location", "name", "unit_id"]);
  const full = await json<ListBody>(await call(listRoute, "/api/v1/schools?states=CA&limit=3"));
  assert.deepEqual(full.items.map((i) => i.unit_id), body.items.map((i) => i.unit_id));
  assert.deepEqual(body.items[0].admissions, JSON.parse(JSON.stringify(serialize.publicSchool(byId.get(String(body.items[0].unit_id))!).admissions)));
  assert.ok(Object.keys(full.items[0]).length > 4);
});

test("/schools: items are publicSchool records: no hidden path, no selectivity band", async () => {
  const body = await json<ListBody>(await call(listRoute, "/api/v1/schools?limit=100&sort=selectivity"));
  assert.ok(body.items.some((i) => i.selectivity), "some college in the page has a selectivity record");
  for (const item of body.items) {
    assert.deepEqual(item, JSON.parse(JSON.stringify(serialize.publicSchool(byId.get(String(item.unit_id))!))));
    assert.equal("band" in ((item.selectivity ?? {}) as object), false);
  }
});

/* ------------------------------------------------------------------ */
/* Query parsing                                                       */
/* ------------------------------------------------------------------ */

test("cursor: base64url of a plain offset; anything else is refused", () => {
  for (const n of [0, 1, 50, 100, 1893, 123456]) assert.equal(query.decodeCursor(query.encodeCursor(n)), n);
  assert.equal(query.encodeCursor(50), Buffer.from("50").toString("base64url"));
  for (const bad of ["", "!!", "bm9wZQ", "MDE", "LTE", "MS41", Buffer.from("99999999999").toString("base64url")]) assert.equal(query.decodeCursor(bad), null, bad);
  assert.deepEqual(query.pageOf([1, 2, 3, 4, 5], { limit: 2, offset: 4 }), { items: [5], total: 5, next_cursor: null });
  assert.equal(query.decodeCursor(query.pageOf([1, 2, 3, 4, 5], { limit: 2, offset: 0 }).next_cursor!), 2);
});

test("parseListQuery: Explore's parameters become the filters parseFilters gives; sort is validated against Explore's keys", () => {
  const ok = query.parseListQuery(new URLSearchParams("states=CA,NY&minSAT=1400&sort=name&sortDir=desc&limit=7&fields=admissions"));
  assert.ok(ok.ok);
  assert.deepEqual(ok.query.filters, parseFilters({ states: "CA,NY", minSAT: "1400", sortBy: "name", sortDir: "desc" }));
  assert.equal(ok.query.limit, 7);
  assert.deepEqual(ok.query.fields, ["admissions"]);
  assert.equal(ok.query.offset, 0);
  for (const key of SORT_KEYS) assert.ok(query.parseListQuery(new URLSearchParams({ sort: key })).ok, key);
  const bad = query.parseListQuery(new URLSearchParams("sort=nope"));
  assert.ok(!bad.ok && bad.param === "sort" && bad.message.includes("name"));
  // `sort` wins over Explore's `sortBy` when both are there.
  const both = query.parseListQuery(new URLSearchParams("sortBy=name&sort=enrollment"));
  assert.ok(both.ok && both.query.filters.sortBy === "enrollment");
});

test("guard: a parameter outside the endpoint's list, or a number that isn't one, is refused", () => {
  assert.deepEqual(query.parseListQuery(new URLSearchParams("colour=red")), { ok: false, param: "colour", message: "not a parameter of this endpoint; see /api/v1/openapi.json for the list" });
  const nan = query.parseListQuery(new URLSearchParams("maxAR=half"));
  assert.ok(!nan.ok && nan.param === "maxAR");
});

test("every key parseFilters reads is a documented parameter of /schools, and the documented sort values are Explore's", () => {
  const src = read("lib/params.ts");
  const body = src.slice(src.indexOf("export function parseFilters"), src.indexOf("export const isStandingLevel"));
  const read_ = new Set([...body.matchAll(/params\.(\w+)/g)].map((m) => m[1]));
  for (const k of INDICATOR_KEYS) read_.add(INDICATORS[k].param);
  assert.ok(read_.size > 60, `found ${read_.size} keys in parseFilters`);
  const list = API_ROUTES.find((r) => r.id === "schools.list")!;
  const documented = new Set(list.params.map((p) => p.name));
  const undocumented = [...read_].filter((k) => !documented.has(k) && k !== "sortBy");
  assert.deepEqual(undocumented, []);
  for (const p of list.params) {
    assert.ok(query.LIST_PARAM_NAMES.has(p.name), `${p.name} is documented but refused`);
    assert.ok(p.description.length > 10 && p.description.endsWith("."), `${p.name} needs a one-line description`);
  }
  assert.deepEqual([...list.params.find((p) => p.name === "sort")!.enum!].sort(), [...SORT_KEYS].sort());
  // The guard has teeth: a key missing from the table is found.
  assert.deepEqual([...read_].filter((k) => !new Set([...documented].filter((d) => d !== "minSAT")).has(k) && k !== "sortBy"), ["minSAT"]);
});

/* ------------------------------------------------------------------ */
/* /schools/{id}                                                       */
/* ------------------------------------------------------------------ */

test("/schools/{id}: the publicSchool record; 404 not_found for an unknown id", async () => {
  const res = await call(getRoute, `/api/v1/schools/${HARVARD}`, HARVARD);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Dataset-Retrieved"), data.getMeta().retrieved);
  assert.deepEqual(await json(res), JSON.parse(JSON.stringify(serialize.publicSchool(byId.get(HARVARD)!))));
  for (const id of ["000000", "nope", "166027x"]) {
    const missing = await call(getRoute, `/api/v1/schools/${id}`, id);
    assert.equal(missing.status, 404, id);
    assert.equal((await json<{ error: { code: string } }>(missing)).error.code, "not_found");
  }
});

test("/schools/{id}: fields= keeps the named keys plus unit_id and name; an unknown name is 400", async () => {
  const body = await json<Record<string, unknown>>(await call(getRoute, `/api/v1/schools/${HARVARD}?fields=cost`, HARVARD));
  assert.deepEqual(Object.keys(body).sort(), ["cost", "name", "unit_id"]);
  assert.deepEqual(body.cost, JSON.parse(JSON.stringify(byId.get(HARVARD)!.cost)));
  const bad = await call(getRoute, `/api/v1/schools/${HARVARD}?fields=cost,bogus`, HARVARD);
  assert.equal(bad.status, 400);
  assert.match((await json<{ error: { message: string } }>(bad)).error.message, /^fields:/);
});

/* ------------------------------------------------------------------ */
/* /history                                                            */
/* ------------------------------------------------------------------ */

test("/history: 404 for a college without a shard or an unknown id; the shard plus series definitions and sources for one that has", async () => {
  // Every college in the dataset has a shard today, so point the reader at a folder with none: that college has no history.
  const bare = mkdtempSync(join(tmpdir(), "quad-no-history-"));
  const here = process.cwd();
  process.chdir(bare);
  try {
    const none = await call(historyRoute, `/api/v1/schools/${HARVARD}/history`, HARVARD);
    assert.equal(none.status, 404);
    const error = (await json<{ error: { code: string; message: string } }>(none)).error;
    assert.equal(error.code, "not_found");
    assert.match(error.message, /No history/);
  } finally {
    process.chdir(here);
  }
  assert.equal((await call(historyRoute, "/api/v1/schools/000000/history", "000000")).status, 404);

  assert.ok(hasShard(HARVARD), "Harvard has a shard");
  const res = await call(historyRoute, `/api/v1/schools/${HARVARD}/history`, HARVARD);
  assert.equal(res.status, 200);
  const body = await json<{
    unit_id: string;
    history: { unit_id: string; series: Record<string, unknown> };
    definitions: Record<string, { label: string; unit: string; year_kind: string; breaks: unknown[]; field: string; sources: string[] }>;
    sources: unknown[];
  }>(res);
  assert.equal(body.unit_id, HARVARD);
  assert.deepEqual(body.history, miniHistory(HARVARD));
  const keys = Object.keys(body.history.series);
  assert.ok(keys.length > 5);
  assert.deepEqual(Object.keys(body.definitions).sort(), keys.sort(), "a definition for every series in the shard");
  for (const def of Object.values(body.definitions)) {
    assert.ok(def.label && def.unit.length > 0 && ["fall", "academic", "cohort"].includes(def.year_kind), JSON.stringify(def));
    assert.ok(Array.isArray(def.breaks) && def.sources.length > 0);
  }
  assert.equal(body.definitions.sat_50?.breaks.length, 1, "the SAT break is carried");
  assert.ok(Array.isArray(body.sources), "the files behind the series");
});

/* ------------------------------------------------------------------ */
/* /lineage                                                            */
/* ------------------------------------------------------------------ */

test("/lineage: every key is a public registered field path, and the records are schoolLineage's", async () => {
  const hidden = new Set<string>(HIDDEN_FIELDS);
  for (const id of [HARVARD, schools[0].unit_id, schools[30].unit_id]) {
    const res = await call(lineageRoute, `/api/v1/schools/${id}/lineage`, id);
    assert.equal(res.status, 200);
    const body = await json<{ unit_id: string; fields: Record<string, { label: string }> }>(res);
    assert.equal(body.unit_id, id);
    const keys = Object.keys(body.fields);
    assert.ok(keys.length > 10, `${id}: ${keys.length} fields`);
    for (const k of keys) {
      assert.ok(isFieldPath(k), `${k} is a registered field path`);
      assert.ok(!hidden.has(k) && !serialize.isHiddenPath(k), `${k} is hidden`);
    }
    assert.deepEqual(body.fields, JSON.parse(JSON.stringify(serialize.schoolLineage(byId.get(id)!, data.getMeta()))));
  }
  assert.equal((await call(lineageRoute, "/api/v1/schools/000000/lineage", "000000")).status, 404);
});

test("/lineage: fields= narrows by path or prefix; an unknown or hidden name is 400 and the hidden one is not named", async () => {
  const all = Object.keys((await json<{ fields: object }>(await call(lineageRoute, `/api/v1/schools/${HARVARD}/lineage`, HARVARD))).fields);
  const some = await json<{ fields: Record<string, unknown> }>(await call(lineageRoute, `/api/v1/schools/${HARVARD}/lineage?fields=admissions,cost.tuition_fees`, HARVARD));
  const keys = Object.keys(some.fields);
  assert.ok(keys.length > 0 && keys.length < all.length);
  for (const k of keys) assert.ok(k.startsWith("admissions") || k === "cost.tuition_fees" || "cost.tuition_fees".startsWith(`${k}.`), k);
  for (const bad of ["nonsense", "selectivity.band", "derived.selectivity_score"]) {
    const res = await call(lineageRoute, `/api/v1/schools/${HARVARD}/lineage?fields=${bad}`, HARVARD);
    assert.equal(res.status, 400, bad);
    assert.match((await json<{ error: { message: string } }>(res)).error.message, /^fields:/);
  }
});

/* ------------------------------------------------------------------ */
/* /changes                                                            */
/* ------------------------------------------------------------------ */

test("/changes: without Supabase an empty list, 404 for an unknown id", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.CHANGES_FIXTURE;
  const res = await call(changesRoute, `/api/v1/schools/${HARVARD}/changes`, HARVARD);
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { unit_id: HARVARD, items: [] });
  assert.equal((await call(changesRoute, "/api/v1/schools/000000/changes", "000000")).status, 404);
});

test("/changes: a configured but unreadable Supabase is an empty list, not an error", async () => {
  process.env.SUPABASE_URL = "http://127.0.0.1:9";
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  const errors: unknown[][] = [];
  const log = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    const res = await call(changesRoute, `/api/v1/schools/${schools[3].unit_id}/changes`, schools[3].unit_id);
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { unit_id: schools[3].unit_id, items: [] });
  } finally {
    console.error = log;
    delete process.env.SUPABASE_URL;
  }
});

test("/changes: stored rows come back with describeChange's text; changes to hidden fields are left out", async () => {
  const unit = schools[7].unit_id;
  const row = (field: string, extra: object = {}) => ({
    publish_id: 3, published_at: "2026-10-01T00:00:00Z", unit_id: unit, field, kind: "new_year", old_value: 0.2, new_value: 0.18, old_year: "Fall 2023", new_year: "Fall 2024", source: "IPEDS Admissions", old_source: null, release: null, ...extra,
  });
  const rows = [row("admissions.acceptance_rate"), row("selectivity.band", { new_value: "x" }), row("cost.tuition_fees", { old_value: 1000, new_value: 1100 })];
  const dir = mkdtempSync(join(tmpdir(), "quad-changes-"));
  const fixture = join(dir, "changes.json");
  writeFileSync(fixture, JSON.stringify(rows));
  process.env.CHANGES_FIXTURE = fixture;
  try {
    const res = await call(changesRoute, `/api/v1/schools/${unit}/changes`, unit);
    assert.equal(res.status, 200);
    const body = await json<{ unit_id: string; items: ({ field: string; text: string })[] }>(res);
    assert.equal(body.unit_id, unit);
    assert.deepEqual(body.items.map((i) => i.field), ["admissions.acceptance_rate", "cost.tuition_fees"]);
    assert.equal(body.items[0].text, describeChange(rows[0] as Parameters<typeof describeChange>[0]));
    assert.match(body.items[0].text, /18/);
    assert.deepEqual({ ...body.items[0], text: undefined }, { ...rows[0], text: undefined });
  } finally {
    delete process.env.CHANGES_FIXTURE;
  }
});

/* ------------------------------------------------------------------ */
/* /national                                                           */
/* ------------------------------------------------------------------ */

test("/national: the serializer's medians, counts, and distributions, and the national history", async () => {
  const res = await call(nationalRoute, "/api/v1/national");
  assert.equal(res.status, 200);
  const files = await getHistoryFiles();
  assert.ok(files, "history files exist");
  const expected = JSON.parse(JSON.stringify(serialize.nationalSummary(data, files.national)));
  assert.deepEqual(await json(res), expected);
  const body = expected as { metrics: { key: string; median: number | null; reporting: number }[] };
  assert.ok(body.metrics.length > 10);
  assert.ok(body.metrics.some((m) => m.median !== null && m.reporting > schools.length / 2));
});

/* ------------------------------------------------------------------ */
/* Every route                                                         */
/* ------------------------------------------------------------------ */

test("each route answers 401 without a key and 401 for a malformed one", async () => {
  const routes: [Route, string, string | undefined][] = [
    [listRoute, "/api/v1/schools", undefined],
    [getRoute, `/api/v1/schools/${HARVARD}`, HARVARD],
    [historyRoute, `/api/v1/schools/${HARVARD}/history`, HARVARD],
    [lineageRoute, `/api/v1/schools/${HARVARD}/lineage`, HARVARD],
    [changesRoute, `/api/v1/schools/${HARVARD}/changes`, HARVARD],
    [nationalRoute, "/api/v1/national", undefined],
  ];
  for (const [route, path, id] of routes) {
    assert.equal((await call(route, path, id, null)).status, 401, path);
    assert.equal((await call(route, path, id, "x")).status, 401, path);
  }
});

test("the table has a row, with every path parameter described, for each route this build adds", () => {
  const ids = ["schools.list", "schools.get", "schools.history", "schools.lineage", "schools.changes", "national"];
  for (const id of ids) {
    const row = API_ROUTES.find((r) => r.id === id);
    assert.ok(row, id);
    assert.equal(row.keyed, true);
    assert.ok(existsSync(join(ROOT, routeFilePath(row))), routeFilePath(row));
    for (const name of [...row.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) assert.ok(row.params.some((p) => p.name === name && p.in === "path" && p.required), `${id} ${name}`);
    for (const p of row.params) assert.ok(p.description.length > 5, `${id} ${p.name}`);
  }
  const list = API_ROUTES.find((r) => r.id === "schools.list")!;
  for (const name of ["limit", "cursor", "fields", "sort", "sortDir"]) assert.ok(list.params.some((p) => p.name === name), name);
  for (const id of ["schools.get", "schools.lineage"]) assert.ok(API_ROUTES.find((r) => r.id === id)!.params.some((p) => p.name === "fields"), id);
  const missing = (rows: readonly { id: string }[]) => ids.filter((id) => !rows.some((r) => r.id === id));
  assert.deepEqual(missing(API_ROUTES.filter((r) => r.id !== "national")), ["national"]);
});

test("the dataset the routes serve is the bundled copy's (here the mini fixture)", () => {
  assert.deepEqual(schools.map((s) => s.unit_id), miniSchools().map((s) => s.unit_id));
});
