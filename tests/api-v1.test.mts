/**
 * The Data API's foundation (specs/product/data-api.md; lib/api/*, app/api/v1/{me,meta,fields,openapi.json}):
 * - serializer parity for every college in data/schools.json: every non-hidden leaf equals the dataset's, no hidden
 *   path, no hidden lineage record, and no selectivity band survives; `fields=` keeps the named keys plus unit_id and
 *   name; resolved lineage names only public fields and equals lineageFor; the registry lists every public field;
 * - the key check with an injected lookup: no key → 401 missing_key, unknown → 401 invalid_key, over the day → 429
 *   with Retry-After, lookup throws (or Supabase unconfigured) → 503, and the per-minute bucket → 429;
 * - responses: the error shape and headers, ETag and If-None-Match → 304, the real routes end to end (with a stand-in
 *   for the publishable-key client) and api_request recorded for each;
 * - the route table: every app/api/v1/**\/route.ts has a row and every row a file, each keyed file wraps withApiKey
 *   with its own id; the OpenAPI document is 3.1.0 with every path and a bearerAuth scheme;
 * - imports: nothing under lib/api/ or the API routes reaches the method (lib/selectivity.ts, lib/chances/*, lib/admin/*).
 * Each guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import type { DatasetMeta, School } from "../lib/types";
import type { ReleaseCalendar } from "../lib/releases";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ */
/* Next.js stand-ins                                                   */
/* ------------------------------------------------------------------ */

// lib/api/auth.ts and the routes are server code: `server-only`, `@/` paths, Supabase, PostHog. Resolve paths the way
// the bundler does, and stand in for the publishable-key client (its rpc answers from `__rpc`, or it throws "not
// configured" like the real one without SUPABASE_URL) and for trackServer (events land in `__events`).
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
const g = globalThis as unknown as { __rpc?: Rpc; __events?: { event: string; properties: Record<string, unknown> }[] };

const { FIELDS, HIDDEN_FIELDS, registeredPathFor } = await import("../lib/fields.ts");
const { leafPaths, lineageFor } = await import("../lib/lineage.ts");
const { METRICS } = await import("../lib/metrics.ts");
const { createDataset } = await import("../lib/dataset.ts");
const serialize = await import("../lib/api/serialize.ts");
const { API_ROUTES, MCP_TOOLS, API_BASE, MCP_PATH, routeFilePath, apiRoute } = await import("../lib/api/routes.ts");
const { buildOpenApi } = await import("../lib/api/openapi.ts");
const { apiJson, apiError, authFailure, etagFor } = await import("../lib/api/respond.ts");
const auth = await import("../lib/api/auth.ts");
const { withApiKey } = await import("../lib/api/handler.ts");
const { TokenBuckets } = await import("../lib/chances/rate-limit.ts");
const { generateApiKey, hashApiKey, API_KEY_LIMITS } = await import("../lib/api/keys.ts");
const { EVENTS } = await import("../lib/analytics.ts");
const { walk } = await import("./helpers/client-reach.mts");

type KeyUseRow = import("../lib/api/auth.ts").KeyUseRow;
type FieldPath = import("../lib/fields.ts").FieldPath;
type FieldDef = import("../lib/fields.ts").FieldDef;

const schools = JSON.parse(read("data/schools.json")) as School[];
const meta = JSON.parse(read("data/meta.json")) as DatasetMeta;
const calendar = JSON.parse(read("data/release-calendar.json")) as ReleaseCalendar;
const data = createDataset({ schools, meta, releaseCalendar: calendar });
const HIDDEN = new Set<string>(HIDDEN_FIELDS);
const HARVARD = "166027";
const byId = new Map(schools.map((s) => [s.unit_id, s]));

function valueAt(record: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), record);
}

/* ------------------------------------------------------------------ */
/* PublicSchool                                                        */
/* ------------------------------------------------------------------ */

const isHidden = (path: string) => {
  const reg = registeredPathFor(path);
  return HIDDEN.has(path) || (reg !== null && HIDDEN.has(reg));
};

/** Every leaf of a record as its key path (keys may themselves contain dots), skipping the top-level metadata keys. */
function leaves(value: unknown, path: string[] = []): string[][] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return path.length ? [path] : [];
  return Object.entries(value).flatMap(([k, v]) => (v === undefined || (path.length === 0 && (k === "lineage" || k === "cds")) ? [] : leaves(v, [...path, k])));
}
const at = (record: unknown, path: string[]): unknown => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), record);

/** What a served record leaks or gets wrong against its college: hidden leaves, hidden lineage, a band, changed or added values. */
function parityProblems(school: School, served: Record<string, unknown>): string[] {
  const out: string[] = [];
  const id = school.unit_id;
  for (const leaf of leaves(school)) {
    const name = leaf.join(".");
    if (isHidden(name)) {
      if (at(served, leaf) !== undefined) out.push(`${id}: hidden ${name} survived`);
    } else if (JSON.stringify(at(served, leaf)) !== JSON.stringify(at(school, leaf))) {
      out.push(`${id}: ${name} differs`);
    }
  }
  for (const leaf of leaves(served)) if (at(school, leaf) === undefined) out.push(`${id}: ${leaf.join(".")} was added`);
  const sel = served.selectivity as Record<string, unknown> | undefined;
  if (sel && "band" in sel) out.push(`${id}: selectivity band survived`);
  const lineage = (served.lineage ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(lineage)) if (isHidden(k)) out.push(`${id}: hidden lineage ${k} survived`);
  for (const k of Object.keys(school.lineage ?? {})) {
    if (!isHidden(k) && JSON.stringify(lineage[k]) !== JSON.stringify((school.lineage as Record<string, unknown>)[k])) out.push(`${id}: lineage ${k} differs`);
  }
  if (JSON.stringify(served.cds) !== JSON.stringify(school.cds)) out.push(`${id}: cds differs`);
  return out;
}

test("publicSchool, for every college: every public value equals the dataset's, and nothing hidden survives", () => {
  const before = JSON.stringify(schools[0]);
  const problems = schools.flatMap((s) => parityProblems(s, serialize.publicSchool(s) as Record<string, unknown>));
  assert.deepEqual(problems, []);
  assert.equal(JSON.stringify(schools[0]), before, "the dataset's own record is untouched");
  // The rule has teeth: some colleges carry a band, and none comes out with one.
  const banded = schools.filter((s) => s.selectivity && "band" in s.selectivity);
  assert.ok(banded.length > 0, "no college in the dataset has a band to strip");
  for (const s of banded) assert.equal("band" in ((serialize.publicSchool(s).selectivity ?? {}) as object), false);
  assert.ok(HIDDEN.has("selectivity.band"), "the band is a registered hidden field");
});

test("guard: a strip list without the band leaks it, and the parity check says so", () => {
  const s = schools.find((x) => x.selectivity && "band" in x.selectivity)!;
  const leaky = serialize.stripPaths(s, HIDDEN_FIELDS.filter((p) => p !== "selectivity.band")) as unknown as Record<string, unknown>;
  const problems = parityProblems(s, leaky);
  assert.ok(problems.some((p) => p.includes("hidden selectivity.band survived")), problems.join("; "));
  assert.ok(problems.some((p) => p.includes("selectivity band survived")));
  // And a hidden lineage record left in place is caught too.
  const withHiddenLineage = { ...(serialize.publicSchool(s) as Record<string, unknown>), lineage: { ...s.lineage, "selectivity.band": { source: "ipeds-adm" } } };
  assert.ok(parityProblems(s, withHiddenLineage).some((p) => p.includes("hidden lineage selectivity.band")));
});

test("stripPaths removes a hidden path's lineage record too", () => {
  const s = structuredClone(byId.get(HARVARD)!);
  (s.lineage as Record<string, unknown>) = { ...s.lineage, "selectivity.band": { source: "ipeds-adm", method: "derived" } };
  const out = serialize.publicSchool(s);
  assert.equal("selectivity.band" in (out.lineage ?? {}), false);
});

test("fields= keeps the named top-level keys plus unit_id and name, and nothing else", () => {
  const s = byId.get(HARVARD)!;
  const out = serialize.publicSchool(s, ["admissions", "selectivity"]);
  assert.deepEqual(Object.keys(out).sort(), ["admissions", "name", "selectivity", "unit_id"]);
  assert.deepEqual(out.admissions, s.admissions);
  assert.equal("band" in (out.selectivity ?? {}), false, "fields= doesn't bring hidden values back");
  assert.deepEqual(Object.keys(serialize.publicSchool(s, ["nonsense"])).sort(), ["name", "unit_id"]);
  assert.deepEqual(serialize.publicSchool(s, []), serialize.publicSchool(s), "an empty list means everything");
});

/* ------------------------------------------------------------------ */
/* Lineage and the registry                                            */
/* ------------------------------------------------------------------ */

/** Lineage keys that aren't public registered fields, or whose record isn't lineageFor's. */
function lineageProblems(school: School, cited: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [path, c] of Object.entries(cited)) {
    if (!(path in FIELDS)) out.push(`${school.unit_id}: ${path} isn't registered`);
    else if (HIDDEN.has(path)) out.push(`${school.unit_id}: hidden ${path}`);
    else if (JSON.stringify(c) !== JSON.stringify(lineageFor(path as FieldPath, school, meta))) out.push(`${school.unit_id}: ${path} isn't lineageFor's`);
  }
  return out;
}

test("schoolLineage: for every college every key is a public registered field; every record is lineageFor's (a sample)", () => {
  const badKeys = schools.flatMap((s) => Object.keys(serialize.schoolLineage(s, meta)).filter((k) => !(k in FIELDS) || HIDDEN.has(k)).map((k) => `${s.unit_id}: ${k}`));
  assert.deepEqual(badKeys, []);
  const sample = schools.filter((_, i) => i % 15 === 0).concat(byId.get(HARVARD)!, ...schools.filter((s) => s.selectivity && "band" in s.selectivity));
  for (const s of sample) assert.deepEqual(lineageProblems(s, serialize.schoolLineage(s, meta)), []);
  const harvard = serialize.schoolLineage(byId.get(HARVARD)!, meta);
  assert.ok("admissions.acceptance_rate" in harvard && "name" in harvard);
  assert.ok("derived.yield" in harvard, "computed metrics come through derived.* fields");
  assert.ok(Object.keys(harvard).every((k) => !(FIELDS[k as FieldPath] as FieldDef).computed || k.startsWith("derived.")));
});

test("schoolLineage skips missing values and keeps registry order; fields= narrows by path or prefix", () => {
  const s = byId.get(HARVARD)!;
  const all = serialize.schoolLineage(s, meta);
  const order = Object.keys(FIELDS);
  const keys = Object.keys(all);
  assert.deepEqual([...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b)), keys);
  for (const k of keys) if (!k.startsWith("derived.")) assert.ok(leafPaths(s).some((l) => registeredPathFor(l) === k && valueAt(s, l) !== null), k);
  const adm = serialize.schoolLineage(s, meta, ["admissions"]);
  assert.ok(Object.keys(adm).length > 3 && Object.keys(adm).every((k) => k.startsWith("admissions.")));
  assert.deepEqual(Object.keys(serialize.schoolLineage(s, meta, ["name", "derived.yield"])), ["name", "derived.yield"]);
});

test("guard: a lineage record for a hidden field, or a changed record, is caught", () => {
  const s = byId.get(HARVARD)!;
  const cited = serialize.schoolLineage(s, meta) as Record<string, unknown>;
  const bad = { ...cited, "derived.selectivity_score": lineageFor("derived.selectivity_score" as FieldPath, s, meta), name: { ...(cited.name as object), year: "1066" } };
  assert.deepEqual(lineageProblems(s, bad), [`${HARVARD}: name isn't lineageFor's`, `${HARVARD}: hidden derived.selectivity_score`]);
});

test("fieldRegistry lists every public field once, no hidden field or input, with years from lineage", () => {
  const rows = serialize.fieldRegistry(meta);
  const publicPaths = (Object.keys(FIELDS) as FieldPath[]).filter((p) => !HIDDEN.has(p));
  assert.deepEqual(rows.map((r) => r.path), publicPaths);
  for (const r of rows) {
    assert.ok(!HIDDEN.has(r.path));
    for (const i of r.inputs ?? []) assert.ok(!HIDDEN.has(i), `${r.path} names hidden input ${i}`);
  }
  const rate = rows.find((r) => r.path === "admissions.acceptance_rate")!;
  assert.equal(rate.source, "ipeds-adm");
  assert.equal(rate.year, lineageFor("admissions.acceptance_rate", undefined, meta).year);
  assert.equal(rate.notify, true);
  const yieldRow = rows.find((r) => r.path === "derived.yield")!;
  assert.ok(yieldRow.computed && yieldRow.formula && yieldRow.inputs?.length);
  assert.equal(rows.find((r) => r.source === "cds")?.year ?? null, null, "per-document sources carry their own years");
  assert.ok(serialize.fieldTopics().includes("admissions"));
});

test("datasetMeta, compareTable, nationalSummary, schoolSummary read the dataset's own numbers", () => {
  const info = serialize.datasetMeta({ meta, calendar, summary: data.getDatasetSummary() });
  assert.equal(info.retrieved, meta.retrieved);
  assert.deepEqual(info.vintages, meta.vintages);
  assert.equal(info.counts.count, schools.length);
  assert.deepEqual(info.release_calendar, calendar);

  const picked = data.getSchoolsByIds([HARVARD, "110635"]);
  const table = serialize.compareTable(picked, data, ["acceptance", "sat"]);
  assert.deepEqual(table.map((r) => r.key), ["acceptance", "sat"]);
  assert.equal(table[0].median, data.metricMedian("acceptance"));
  assert.deepEqual(table[0].values[0], { unit_id: HARVARD, value: METRICS.acceptance.get(picked[0]), rank: data.rankOf(picked[0], "acceptance") });
  assert.equal(table[0].field, "admissions.acceptance_rate");
  assert.ok(serialize.compareTable(picked, data).length === serialize.COMPARE_DEFAULT_METRICS.length);

  const national = serialize.nationalSummary(data, null);
  const acc = national.metrics.find((m) => m.key === "acceptance")!;
  assert.equal(acc.reporting, data.reportingCount("acceptance"));
  assert.deepEqual(acc.distribution, data.distribution("acceptance"));
  assert.equal(national.history, null);

  assert.deepEqual(serialize.schoolSummary(byId.get(HARVARD)!), {
    unit_id: HARVARD,
    name: byId.get(HARVARD)!.name,
    city: byId.get(HARVARD)!.location.city,
    state: "MA",
    type: byId.get(HARVARD)!.type,
    acceptance_rate: byId.get(HARVARD)!.admissions.acceptance_rate,
  });
});

/* ------------------------------------------------------------------ */
/* The key check                                                       */
/* ------------------------------------------------------------------ */

const row = (o: Partial<KeyUseRow> = {}): KeyUseRow => ({ key_id: "k1", user_id: "u1", tier: "account", allowed: true, used_today: 1, limit_per_day: API_KEY_LIMITS.perDay, ...o });
const keyed = (key: string | null, extra: Record<string, string> = {}) => new Request("https://quad.test/api/v1/meta", { headers: { ...(key === null ? {} : { Authorization: `Bearer ${key}` }), ...extra } });
const fresh = () => new TokenBuckets({ capacity: API_KEY_LIMITS.perMinute, refillPerSecond: API_KEY_LIMITS.perMinute / 60 });

test("no key → 401 missing_key; a malformed key → 401 invalid_key without a lookup", async () => {
  let calls = 0;
  const lookup = async () => (calls++, row());
  const none = await auth.authenticateApiRequest(keyed(null), "meta", { lookup, buckets: fresh() });
  assert.deepEqual(none.ok ? null : [none.status, none.code], [401, "missing_key"]);
  const basic = await auth.authenticateApiRequest(new Request("https://quad.test/", { headers: { Authorization: "Basic abc" } }), "meta", { lookup, buckets: fresh() });
  assert.deepEqual(basic.ok ? null : [basic.status, basic.code], [401, "missing_key"]);
  const bad = await auth.authenticateApiRequest(keyed("x"), "meta", { lookup, buckets: fresh() });
  assert.deepEqual(bad.ok ? null : [bad.status, bad.code], [401, "invalid_key"]);
  assert.equal(calls, 0);
  if (!none.ok) assert.match(none.message, /\/account\/api-keys/);
});

test("the lookup gets the key's hash and the endpoint; unknown → 401 invalid_key; known → the principal", async () => {
  const key = generateApiKey();
  const seen: string[][] = [];
  const unknown = await auth.authenticateApiRequest(keyed(key), "schools.get", { lookup: async (h, e) => (seen.push([h, e]), null), buckets: fresh() });
  assert.deepEqual(seen, [[hashApiKey(key), "schools.get"]]);
  assert.deepEqual(unknown.ok ? null : [unknown.status, unknown.code], [401, "invalid_key"]);
  const ok = await auth.authenticateApiRequest(keyed(key), "schools.get", { lookup: async () => row({ used_today: 7 }), buckets: fresh() });
  assert.deepEqual(ok, { ok: true, principal: { keyId: "k1", userId: "u1", tier: "account", usedToday: 7, limitPerDay: API_KEY_LIMITS.perDay } });
});

test("over the day's limit → 429 rate_limited, Retry-After until midnight UTC", async () => {
  const now = Date.UTC(2026, 9, 20, 23, 0, 0);
  const r = await auth.authenticateApiRequest(keyed(generateApiKey()), "meta", { lookup: async () => row({ allowed: false, used_today: 5001 }), now: () => now, buckets: fresh() });
  assert.ok(!r.ok);
  assert.deepEqual([r.status, r.code, r.retryAfter], [429, "rate_limited", 3600]);
  const res = authFailure(r);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "3600");
  assert.deepEqual(await res.json(), { error: { code: "rate_limited", message: r.message } });
});

test("a lookup that throws → 503 unavailable; so does the real lookup with Supabase unconfigured", async () => {
  const thrown = await auth.authenticateApiRequest(keyed(generateApiKey()), "meta", { lookup: async () => { throw new Error("connection refused"); }, buckets: fresh() });
  assert.deepEqual(thrown.ok ? null : [thrown.status, thrown.code], [503, "unavailable"]);
  delete g.__rpc;
  const unconfigured = await auth.authenticateApiRequest(keyed(generateApiKey()), "meta", { buckets: fresh() });
  assert.deepEqual(unconfigured.ok ? null : [unconfigured.status, unconfigured.code], [503, "unavailable"]);
  // A Supabase error (the migration not applied) is a 503 too, not a 401.
  g.__rpc = async () => ({ data: null, error: { message: "Could not find the function public.api_key_use" } });
  const missing = await auth.authenticateApiRequest(keyed(generateApiKey()), "meta", { buckets: fresh() });
  assert.deepEqual(missing.ok ? null : [missing.status, missing.code], [503, "unavailable"]);
  delete g.__rpc;
});

test("60 a minute per key: the 61st within the minute → 429 without a lookup; a second later one more passes", async () => {
  const key = generateApiKey();
  const buckets = fresh();
  let calls = 0;
  const lookup = async () => (calls++, row());
  const t0 = 1_000_000;
  for (let i = 0; i < API_KEY_LIMITS.perMinute; i++) assert.ok((await auth.authenticateApiRequest(keyed(key), "meta", { lookup, now: () => t0, buckets })).ok, `request ${i + 1}`);
  const over = await auth.authenticateApiRequest(keyed(key), "meta", { lookup, now: () => t0, buckets });
  assert.deepEqual(over.ok ? null : [over.status, over.code, over.retryAfter], [429, "rate_limited", 1]);
  assert.equal(calls, API_KEY_LIMITS.perMinute, "the refused request never reached the database");
  assert.ok((await auth.authenticateApiRequest(keyed(key), "meta", { lookup, now: () => t0 + 1000, buckets })).ok);
  // Another key has its own minute.
  assert.ok((await auth.authenticateApiRequest(keyed(generateApiKey()), "meta", { lookup, now: () => t0, buckets })).ok);
  // Refused keys spend nothing: an unknown key never fills a bucket.
  const unknownKey = generateApiKey();
  for (let i = 0; i < API_KEY_LIMITS.perMinute + 5; i++) {
    const r = await auth.authenticateApiRequest(keyed(unknownKey), "meta", { lookup: async () => null, now: () => t0, buckets });
    assert.equal(r.ok ? 0 : r.status, 401);
  }
});

test("guard: without the bucket check, the 61st request goes through", async () => {
  const key = generateApiKey();
  const t0 = 5_000_000;
  // A bucket that never runs dry stands for a check that was removed.
  const noLimit = new TokenBuckets({ capacity: Number.MAX_SAFE_INTEGER, refillPerSecond: 1 });
  for (let i = 0; i < API_KEY_LIMITS.perMinute; i++) await auth.authenticateApiRequest(keyed(key), "meta", { lookup: async () => row(), now: () => t0, buckets: noLimit });
  assert.ok((await auth.authenticateApiRequest(keyed(key), "meta", { lookup: async () => row(), now: () => t0, buckets: noLimit })).ok);
});

test("secondsUntilUtcMidnight", () => {
  assert.equal(auth.secondsUntilUtcMidnight(Date.UTC(2026, 9, 20, 0, 0, 0)), 86400);
  assert.equal(auth.secondsUntilUtcMidnight(Date.UTC(2026, 9, 20, 23, 59, 59, 500)), 1);
});

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

test("apiJson: no-store, the retrieved header, an ETag of the body; If-None-Match with it → 304 and no body", async () => {
  const body = { a: 1 };
  const res = apiJson(body, { retrieved: meta.retrieved });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.equal(res.headers.get("X-Dataset-Retrieved"), meta.retrieved);
  assert.match(res.headers.get("Content-Type")!, /application\/json/);
  const etag = res.headers.get("ETag")!;
  assert.equal(etag, etagFor(JSON.stringify(body)));
  for (const inm of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
    const again = apiJson(body, { retrieved: meta.retrieved, request: new Request("https://quad.test/", { headers: { "If-None-Match": inm } }) });
    assert.equal(again.status, 304, inm);
    assert.equal(await again.text(), "");
    assert.equal(again.headers.get("ETag"), etag);
  }
  const changed = apiJson({ a: 2 }, { request: new Request("https://quad.test/", { headers: { "If-None-Match": etag } }) });
  assert.equal(changed.status, 200);
  const notOk = apiJson(body, { status: 201, request: new Request("https://quad.test/", { headers: { "If-None-Match": etag } }) });
  assert.equal(notOk.status, 201, "only a 200 becomes 304");
});

test("apiError and authFailure: the error shape, WWW-Authenticate on 401, Retry-After when given", async () => {
  const e = apiError(404, "not_found", "No college 1.");
  assert.equal(e.status, 404);
  assert.deepEqual(await e.json(), { error: { code: "not_found", message: "No college 1." } });
  assert.equal(e.headers.get("Cache-Control"), "private, no-store");
  const r401 = authFailure({ ok: false, status: 401, code: "invalid_key", message: "m" });
  assert.match(r401.headers.get("WWW-Authenticate")!, /^Bearer realm="Quad API", error="invalid_token"/);
  assert.equal(r401.headers.get("Retry-After"), null);
  const r503 = authFailure({ ok: false, status: 503, code: "unavailable", message: "m", retryAfter: 60 });
  assert.equal(r503.headers.get("Retry-After"), "60");
});

test("withApiKey: failures answer with their error and are recorded without a key; a throwing handler answers 500", async () => {
  g.__events = [];
  const handler = withApiKey("meta", async ({ request }) => apiJson({ ok: true }, { request }), { lookup: async () => null, buckets: fresh() });
  const res = await handler(keyed(generateApiKey()), { params: Promise.resolve({}) });
  assert.equal(res.status, 401);
  assert.deepEqual(g.__events, [{ event: "api_request", properties: { endpoint: "meta", status: 401, transport: "rest", key_id: "" } }]);

  g.__events = [];
  const boom = withApiKey("meta", async () => { throw new Error("secret detail"); }, { lookup: async () => row({ key_id: "k9" }), buckets: fresh() });
  const r500 = await boom(keyed(generateApiKey()), { params: Promise.resolve({}) });
  assert.equal(r500.status, 500);
  assert.doesNotMatch(await r500.text(), /secret detail/);
  assert.deepEqual(g.__events, [{ event: "api_request", properties: { endpoint: "meta", status: 500, transport: "rest", key_id: "k9" } }]);

  const withParams = withApiKey<{ id: string }>("meta", async ({ params, principal }) => apiJson({ id: params.id, key: principal.keyId }), { lookup: async () => row(), buckets: fresh() });
  assert.deepEqual(await (await withParams(keyed(generateApiKey()), { params: Promise.resolve({ id: "42" }) })).json(), { id: "42", key: "k1" });
});

/* ------------------------------------------------------------------ */
/* The routes, end to end                                              */
/* ------------------------------------------------------------------ */

const meRoute = await import("../app/api/v1/me/route.ts");
const metaRoute = await import("../app/api/v1/meta/route.ts");
const fieldsRoute = await import("../app/api/v1/fields/route.ts");
const openapiRoute = await import("../app/api/v1/openapi.json/route.ts");
const noParams = { params: Promise.resolve({}) };

/** The publishable-key client answering api_key_use and api_key_info for one key, counting calls. */
function fakeSupabase(key: string, opts: { allowed?: boolean } = {}) {
  const calls: { name: string; args: Record<string, unknown>; role: string }[] = [];
  let used = 0;
  g.__rpc = async (name, args, role) => {
    calls.push({ name, args, role });
    if (args.p_hash !== hashApiKey(key)) return { data: [], error: null };
    if (name === "api_key_use") return { data: [row({ key_id: "key-1", user_id: "user-1", used_today: ++used, allowed: opts.allowed ?? true })], error: null };
    if (name === "api_key_info") return { data: [{ key_id: "key-1", key_name: "My notebook", key_prefix: key.slice(0, 13), tier: "account", created: "2026-10-20T00:00:00Z", last_used_at: null, display_name: "Ana" }], error: null };
    return { data: null, error: { message: `unknown function ${name}` } };
  };
  return calls;
}

test("the routes without Supabase: no key → 401, a bad key → 401, a key-shaped one → 503; openapi.json → 200 and public", async () => {
  delete g.__rpc;
  for (const route of [meRoute, metaRoute, fieldsRoute]) {
    assert.equal((await route.GET(keyed(null), noParams)).status, 401);
    assert.equal((await route.GET(keyed("x"), noParams)).status, 401);
    const res = await route.GET(keyed(generateApiKey()), noParams);
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "unavailable");
  }
  const doc = await openapiRoute.GET(new Request("https://quad.test/api/v1/openapi.json"));
  assert.equal(doc.status, 200);
  assert.equal(doc.headers.get("Cache-Control"), "public, max-age=3600");
  const body = (await doc.json()) as { openapi: string; servers: { url: string }[] };
  assert.equal(body.openapi, "3.1.0");
  assert.deepEqual(body.servers, [{ url: "https://quad.test" }]);
});

test("/meta with a valid key: the dataset's metadata, its headers, a 304 on revalidation, each request recorded", async () => {
  const key = generateApiKey();
  const calls = fakeSupabase(key);
  g.__events = [];
  const res = await metaRoute.GET(keyed(key), noParams);
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0], { name: "api_key_use", args: { p_hash: hashApiKey(key), p_endpoint: "meta" }, role: "read" });
  const body = (await res.json()) as { retrieved: string; counts: { count: number } };
  assert.equal(body.retrieved, meta.retrieved);
  assert.equal(body.counts.count, schools.length);
  assert.deepEqual(body, JSON.parse(JSON.stringify(serialize.datasetMeta({ meta, calendar, summary: data.getDatasetSummary() }))));
  assert.equal(res.headers.get("X-Dataset-Retrieved"), meta.retrieved);
  const etag = res.headers.get("ETag")!;
  const again = await metaRoute.GET(keyed(key, { "If-None-Match": etag }), noParams);
  assert.equal(again.status, 304);
  assert.deepEqual(
    g.__events.map((e) => e.properties),
    [
      { endpoint: "meta", status: 200, transport: "rest", key_id: "key-1" },
      { endpoint: "meta", status: 304, transport: "rest", key_id: "key-1" },
    ],
  );
  delete g.__rpc;
});

test("/meta over the day's limit → 429 with Retry-After", async () => {
  const key = generateApiKey();
  fakeSupabase(key, { allowed: false });
  const res = await metaRoute.GET(keyed(key), noParams);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("Retry-After")) >= 1);
  delete g.__rpc;
});

test("/me: the owner's display name, the key, today's count, and the limits; never an email", async () => {
  const key = generateApiKey();
  fakeSupabase(key);
  const body = (await (await meRoute.GET(keyed(key), noParams)).json()) as Record<string, unknown>;
  assert.deepEqual(body, {
    owner: { display_name: "Ana" },
    key: { id: "key-1", name: "My notebook", prefix: key.slice(0, 13), tier: "account", created: "2026-10-20T00:00:00Z", last_used_at: null },
    used_today: 1,
    limits: { per_day: API_KEY_LIMITS.perDay, per_minute: API_KEY_LIMITS.perMinute, keys_per_user: API_KEY_LIMITS.keysPerUser },
  });
  assert.doesNotMatch(JSON.stringify(body), /@/);
  delete g.__rpc;
});

test("/fields: the public registry; topic= narrows it; an unknown topic → 400 naming the parameter", async () => {
  const key = generateApiKey();
  fakeSupabase(key);
  const all = (await (await fieldsRoute.GET(keyed(key), noParams)).json()) as { fields: { path: string; topic: string }[] };
  assert.deepEqual(all.fields, JSON.parse(JSON.stringify(serialize.fieldRegistry(meta))));
  const adm = (await (await fieldsRoute.GET(new Request("https://quad.test/api/v1/fields?topic=admissions", { headers: { Authorization: `Bearer ${key}` } }), noParams)).json()) as { fields: { topic: string }[] };
  assert.ok(adm.fields.length > 10 && adm.fields.every((f) => f.topic === "admissions"));
  const bad = await fieldsRoute.GET(new Request("https://quad.test/api/v1/fields?topic=nope", { headers: { Authorization: `Bearer ${key}` } }), noParams);
  assert.equal(bad.status, 400);
  const err = (await bad.json()) as { error: { code: string; message: string } };
  assert.equal(err.error.code, "bad_request");
  assert.match(err.error.message, /^topic: /);
  assert.doesNotMatch(JSON.stringify(all), /selectivity_score|selectivity\.band/);
  delete g.__rpc;
});

/* ------------------------------------------------------------------ */
/* The route table and the OpenAPI document                            */
/* ------------------------------------------------------------------ */

/** Route files with no row, and rows with no file. */
function tableMismatch(files: string[], routes: readonly { path: string }[]): { noRow: string[]; noFile: string[] } {
  const expected = routes.map(routeFilePath);
  return { noRow: files.filter((f) => !expected.includes(f)), noFile: expected.filter((f) => !files.includes(f)) };
}

const ROUTE_FILES = [...walk("app/api/v1").keys()].filter((f) => f.endsWith("/route.ts")).sort();

test("every app/api/v1 route file has a row in API_ROUTES, and every row has its file", () => {
  assert.deepEqual(tableMismatch(ROUTE_FILES, API_ROUTES), { noRow: [], noFile: [] });
  for (const id of ["me", "meta", "fields", "openapi"]) assert.ok(API_ROUTES.some((r) => r.id === id), id);
  assert.equal(new Set(API_ROUTES.map((r) => r.id)).size, API_ROUTES.length, "ids are unique");
  assert.equal(new Set(API_ROUTES.map((r) => r.path)).size, API_ROUTES.length, "paths are unique");
  for (const r of API_ROUTES) assert.ok(r.path.startsWith(`${API_BASE}/`), r.path);
  assert.equal(MCP_PATH, "/api/mcp");
  assert.ok(Array.isArray(MCP_TOOLS));
});

test("guard: a route file without a row, or a row without a file, is caught", () => {
  assert.deepEqual(tableMismatch([...ROUTE_FILES, "app/api/v1/secret/route.ts"], API_ROUTES).noRow, ["app/api/v1/secret/route.ts"]);
  assert.deepEqual(tableMismatch(ROUTE_FILES, [...API_ROUTES, { path: "/api/v1/schools/{id}/ghost" }]).noFile, ["app/api/v1/schools/[id]/ghost/route.ts"]);
  assert.equal(routeFilePath({ path: "/api/v1/schools/{id}/history" }), "app/api/v1/schools/[id]/history/route.ts");
});

/** Keyed route files that don't wrap withApiKey with their own row's id, and unkeyed ones that do. */
function wrapperProblems(files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const r of API_ROUTES) {
    const src = files.get(routeFilePath(r));
    if (src === undefined) continue;
    const ids = [...src.matchAll(/withApiKey(?:<[^>]*>)?\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
    if (r.keyed && (ids.length !== 1 || ids[0] !== r.id)) out.push(`${r.id}: ${ids.join(",") || "no withApiKey"}`);
    if (!r.keyed && ids.length) out.push(`${r.id}: unkeyed but wrapped`);
  }
  return out;
}

test("each keyed route wraps withApiKey with its own id; the OpenAPI route needs no key", () => {
  assert.deepEqual(wrapperProblems(walk("app/api/v1")), []);
  assert.throws(() => apiRoute("nope"), /No API route/);
});

test("guard: a keyed route with another route's id, or none, is caught", () => {
  const files = walk("app/api/v1");
  files.set("app/api/v1/meta/route.ts", files.get("app/api/v1/meta/route.ts")!.replace('withApiKey("meta"', 'withApiKey("fields"'));
  files.set("app/api/v1/me/route.ts", "export async function GET() { return new Response('{}'); }");
  assert.deepEqual(wrapperProblems(files), ["me: no withApiKey", "meta: fields"]);
});

type Doc = ReturnType<typeof buildOpenApi>;

/** Structural problems with an OpenAPI document against the table. */
function openApiProblems(doc: Doc, routes: readonly import("../lib/api/routes.ts").ApiRoute[]): string[] {
  const out: string[] = [];
  if (doc.openapi !== "3.1.0") out.push(`openapi ${doc.openapi}`);
  if (!doc.info?.title || !doc.info?.version) out.push("info");
  const scheme = doc.components.securitySchemes.bearerAuth as { type?: string; scheme?: string } | undefined;
  if (scheme?.type !== "http" || scheme?.scheme !== "bearer") out.push("bearerAuth");
  const ops = new Set<string>();
  for (const r of routes) {
    const op = doc.paths[r.path]?.get as { operationId: string; security: unknown[]; parameters: { name: string; in: string; required: boolean }[]; responses: Record<string, unknown> } | undefined;
    if (!op) {
      out.push(`missing ${r.path}`);
      continue;
    }
    if (ops.has(op.operationId)) out.push(`duplicate ${op.operationId}`);
    ops.add(op.operationId);
    if (JSON.stringify(op.security) !== JSON.stringify(r.keyed ? [{ bearerAuth: [] }] : [])) out.push(`${r.path} security`);
    for (const name of [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) {
      if (!op.parameters.some((p) => p.name === name && p.in === "path" && p.required)) out.push(`${r.path} path parameter ${name}`);
    }
    if (!op.responses["200"]) out.push(`${r.path} 200`);
    if (r.keyed && (!op.responses["401"] || !op.responses["429"])) out.push(`${r.path} errors`);
  }
  for (const p of Object.keys(doc.paths)) if (!routes.some((r) => r.path === p)) out.push(`extra ${p}`);
  // Every $ref points at something in the document.
  const text = JSON.stringify(doc);
  for (const m of text.matchAll(/"\$ref":"#\/([^"]+)"/g)) {
    if (valueAt(doc, m[1].replace(/\//g, ".")) === undefined) out.push(`dangling $ref ${m[1]}`);
  }
  return out;
}

test("the OpenAPI document: 3.1.0, every route with its security and errors, a bearerAuth scheme, no dangling $ref", () => {
  const doc = buildOpenApi(API_ROUTES, { serverUrl: "https://usequad.app/" });
  assert.deepEqual(openApiProblems(doc, API_ROUTES), []);
  assert.deepEqual(doc.servers, [{ url: "https://usequad.app" }]);
  assert.deepEqual(doc.security, [{ bearerAuth: [] }]);
  // A path parameter (as the routes build adds) is required and typed.
  const withParam = [...API_ROUTES, { id: "schools.probe", method: "GET" as const, path: "/api/v1/schools/{id}/probe", summary: "s", description: "d", keyed: true, params: [{ name: "id", in: "path" as const, type: "string" as const, description: "IPEDS unit id" }] }];
  assert.deepEqual(openApiProblems(buildOpenApi(withParam, { serverUrl: "https://usequad.app" }), withParam), []);
});

test("guard: a document missing a route, or with the scheme dropped, is caught", () => {
  const doc = buildOpenApi(API_ROUTES.filter((r) => r.id !== "fields"), { serverUrl: "https://usequad.app" });
  assert.deepEqual(openApiProblems(doc, API_ROUTES), ["missing /api/v1/fields"]);
  const noScheme = buildOpenApi(API_ROUTES, { serverUrl: "https://usequad.app" });
  delete noScheme.components.securitySchemes.bearerAuth;
  assert.deepEqual(openApiProblems(noScheme, API_ROUTES), ["bearerAuth"]);
});

/* ------------------------------------------------------------------ */
/* Telemetry and imports                                               */
/* ------------------------------------------------------------------ */

test("api_request is a registered server event with endpoint, status, transport, key_id", () => {
  assert.deepEqual(EVENTS.api_request, { properties: ["endpoint", "status", "transport", "key_id"], side: "server", why: "Data API: requests by endpoint, status, and transport" });
  assert.match(read("specs/product/telemetry.md"), /\| `api_request` \(server\) \| `endpoint`/);
});

/** The API's files: everything under lib/api/ and the API's routes and pages, as they exist on this branch. */
const API_SCOPE = (f: string) =>
  f.startsWith("lib/api/") || f.startsWith("app/api/v1/") || f.startsWith("app/api/mcp/") || f.startsWith("app/developers/") || f.startsWith("app/account/api-keys/") || f === "lib/api-keys-store.ts";

/** Direct imports from the API's files of the method, the chances modules (but the plain token bucket), or the console. */
function forbiddenImports(files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [f, text] of files) {
    if (!API_SCOPE(f)) continue;
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (/(^|\/)selectivity(\.ts)?$/.test(spec) || /(^|\/)admin\//.test(spec) || (/(^|\/)chances\//.test(spec) && !/chances\/rate-limit(\.ts)?$/.test(spec))) out.push(`${f}: ${spec}`);
    }
  }
  return out;
}

/**
 * The method's modules an API file reaches through any chain of imports: the list tests/admin-hidden.test.mts keeps
 * out of browser bundles, plus the model and the estimate endpoint's request module. (lib/dataset.ts reaches
 * lib/chances/baseline.ts for Explore's score filter, as every page does, so the plain catalogs aren't listed.)
 */
const METHOD = [
  "lib/selectivity.ts",
  "lib/chances/estimate.ts",
  "lib/chances/snapshot.ts",
  "lib/chances/model.ts",
  "lib/chances/estimate-request.ts",
  "lib/admin/hidden.ts",
  "lib/admin/standing.ts",
  "lib/admin/college.ts",
  "lib/admin/selectivity-history.ts",
  "lib/admin/selectivity-history-view.ts",
];
const { reachedFromClient } = await import("./helpers/client-reach.mts");
function reachesMethod(files: Map<string, string>): string[] {
  // client-reach.mts walks from "use client" files: make the API's files the only entry points.
  const marked = new Map([...files].map(([f, t]) => [f, API_SCOPE(f) ? `"use client";\n${t}` : t.replace(/^\s*["']use client["'];?/, "")]));
  return reachedFromClient(marked, METHOD);
}

test("nothing in the API imports or reaches the method, the estimate, or the console", () => {
  const files = new Map([...walk("app"), ...walk("lib")]);
  assert.deepEqual(forbiddenImports(files), []);
  assert.deepEqual(reachesMethod(files), []);
});

test("guard: an API file importing the method, directly or through a helper, is caught", () => {
  const files = new Map([...walk("app"), ...walk("lib")]);
  files.set("lib/api/leak.ts", 'import { selectivityScore } from "../selectivity.ts";\nimport { take } from "@/lib/chances/rate-limit";');
  files.set("lib/api/indirect.ts", 'import { x } from "./helper";');
  files.set("lib/api/helper.ts", 'import { estimate } from "@/lib/chances/estimate";\nexport const x = 1;');
  assert.deepEqual(forbiddenImports(files), ["lib/api/leak.ts: ../selectivity.ts", "lib/api/helper.ts: @/lib/chances/estimate"]);
  const reached = reachesMethod(files);
  assert.ok(reached.some((c) => c.startsWith("lib/api/indirect.ts -> lib/api/helper.ts -> lib/chances/estimate.ts")), reached.join("\n"));
});
