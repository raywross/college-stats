/**
 * The Data API's MCP server (specs/product/data-api.md "MCP server"; lib/api/mcp.ts, lib/api/mcp-route.ts,
 * app/api/mcp/route.ts):
 * - the tools: the registered names equal lib/api/routes.ts MCP_TOOLS and the spec's table, and each row's inputs
 *   equal its zod schema's keys (required where the schema requires);
 * - parity: for several colleges each tool's JSON equals the serializer's output for the same input (get_college ≡
 *   publicSchool, get_lineage ≡ schoolLineage, compare_colleges ≡ compareTable, list_fields ≡ fieldRegistry,
 *   get_dataset_info ≡ datasetMeta, search_colleges ≡ schoolSummary over getSchools, get_history ≡ the shard);
 * - names: an exact name or short name resolves, an ambiguous one answers candidates, an unknown one a 404 error;
 * - errors are tool results (`isError`) with a plain sentence; nothing hidden appears in any tool's output (shown
 *   failing when a hidden value is slipped in);
 * - telemetry: each tool call records api_request with transport "mcp", endpoint "mcp.<tool>", the status, and the
 *   key id from ctx.http.authInfo; a recorder that throws doesn't fail the call;
 * - the HTTP route with an injected key lookup: no key or a rejected key → 401 with WWW-Authenticate naming the
 *   protected-resource metadata; over the day → 429; the check failing → 503; a valid key → initialize, tools/list,
 *   tools/call over Streamable HTTP; the real app/api/mcp/route.ts without Supabase → 401 / 503.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import type { DatasetMeta, School } from "../lib/types";
import type { ReleaseCalendar } from "../lib/releases";
import { miniAliases, miniHistory, miniHistoryFiles, miniMeta, miniReleaseCalendar, miniSchools } from "./helpers/snapshot.mts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ */
/* Next.js stand-ins (as in tests/api-v1.test.mts)                     */
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
const g = globalThis as unknown as { __rpc?: Rpc; __events?: { event: string; properties: Record<string, unknown> }[] };

const { HIDDEN_FIELDS, registeredPathFor } = await import("../lib/fields.ts");
const { createDataset } = await import("../lib/dataset.ts");
const { parseFilters } = await import("../lib/params.ts");
const { SERIES } = await import("../lib/history.ts");
const serialize = await import("../lib/api/serialize.ts");
const mcp = await import("../lib/api/mcp.ts");
const { MCP_TOOLS } = await import("../lib/api/routes.ts");
const { createMcpRoute, MCP_RESOURCE_METADATA_PATH } = await import("../lib/api/mcp-route.ts");
const { generateApiKey, hashApiKey } = await import("../lib/api/keys.ts");
const { TokenBuckets } = await import("../lib/chances/rate-limit.ts");

type KeyUseRow = import("../lib/api/auth.ts").KeyUseRow;
type McpToolContext = import("../lib/api/mcp.ts").McpToolContext;
type ToolOutcome = import("../lib/api/mcp.ts").ToolOutcome;
type SchoolHistory = import("../lib/history.ts").SchoolHistory;
type HistoryMeta = import("../lib/history.ts").HistoryMeta;

// The mini fixture (tests/helpers/snapshot.mts): 38 real colleges, their history shards, and the shared history files.
const schools: School[] = miniSchools();
const meta: DatasetMeta = miniMeta();
const calendar: ReleaseCalendar = miniReleaseCalendar();
const aliases = miniAliases();
const data = createDataset({ schools, meta, releaseCalendar: calendar, aliases });
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const HIDDEN = new Set<string>(HIDDEN_FIELDS);

const ctx: McpToolContext = {
  data,
  getHistory: async (id) => miniHistory(id) as SchoolHistory | null,
  getHistoryMeta: async () => miniHistoryFiles().meta as HistoryMeta,
};

const HARVARD = "166027";
const BERKELEY = "110635";
const MIT = "166683";
const banded = schools.filter((s) => s.selectivity && "band" in s.selectivity);
const SAMPLE = [HARVARD, BERKELEY, MIT, ...banded.slice(0, 3).map((s) => s.unit_id), ...schools.filter((_, i) => i % 10 === 0).map((s) => s.unit_id)];

/** The JSON a tool answered (its text), after checking it isn't an error. */
function body(out: ToolOutcome): Record<string, unknown> {
  assert.notEqual(out.result.isError, true, JSON.stringify(out.result.content));
  assert.equal(out.status, 200);
  const first = out.result.content[0] as { type: string; text: string };
  assert.equal(first.type, "text");
  const parsed = JSON.parse(first.text) as Record<string, unknown>;
  if (out.result.structuredContent !== undefined) assert.deepEqual(JSON.parse(JSON.stringify(out.result.structuredContent)), parsed, "structuredContent is the text's JSON");
  return parsed;
}
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

/** A result's grouped `cited` back to one lineage map per college (what schoolLineage gives each). */
function ungroup(grouped: unknown): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [field, list] of Object.entries(grouped as Record<string, ({ unit_ids: string[] } & Record<string, unknown>)[]>)) {
    for (const { unit_ids, ...cited } of list) for (const id of unit_ids) (out[id] ??= {})[field] = cited;
  }
  return out;
}
const run = (name: string, args: unknown) => mcp.runTool(name, args, ctx);

/* ------------------------------------------------------------------ */
/* The tool table                                                      */
/* ------------------------------------------------------------------ */

/** The tool names in the spec's "MCP server" table. */
function specToolNames(): string[] {
  const spec = read("specs/product/data-api.md");
  const section = spec.slice(spec.indexOf("## MCP server"), spec.indexOf("\n## ", spec.indexOf("## MCP server") + 3));
  return [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
}

/** A stand-in McpServer that keeps what registerTool receives. */
function captureServer() {
  const tools = new Map<string, { config: Record<string, unknown>; cb: (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }>();
  const server = { registerTool: (name: string, config: Record<string, unknown>, cb: never) => void tools.set(name, { config, cb }) };
  return { server: server as unknown as Parameters<typeof mcp.registerQuadTools>[0], tools };
}

test("the registered tools are MCP_TOOLS and the spec's table, in that order, each with a title, description, and schema", () => {
  const { server, tools } = captureServer();
  mcp.registerQuadTools(server, { context: async () => ctx });
  const names = [...tools.keys()];
  assert.deepEqual(names, MCP_TOOLS.map((t) => t.name));
  assert.deepEqual(names, [...mcp.MCP_TOOL_NAMES]);
  assert.deepEqual(names, specToolNames());
  assert.equal(names.length, 10);
  for (const [name, { config }] of tools) {
    assert.ok(typeof config.title === "string" && config.title, `${name} has a title`);
    assert.ok(typeof config.description === "string" && config.description.length > 40, `${name} has a description`);
    assert.ok(config.inputSchema, `${name} has an input schema`);
    assert.deepEqual(config.annotations, { readOnlyHint: true, openWorldHint: false });
  }
});

test("guard: a tool missing from MCP_TOOLS or the spec is caught", () => {
  const names = [...mcp.MCP_TOOL_NAMES];
  assert.notDeepEqual(names.slice(1), MCP_TOOLS.map((t) => t.name));
  assert.notDeepEqual([...names, "extra_tool"], specToolNames());
});

test("every description carries the attribution terms; no data year is written into one", () => {
  for (const name of mcp.MCP_TOOL_NAMES) {
    const d = mcp.MCP_TOOL_DEFS[name].description;
    assert.ok(d.includes(mcp.MCP_ATTRIBUTION), `${name}: attribution`);
    assert.doesNotMatch(d, /\b(19|20)\d{2}\b/, `${name}: a year`);
  }
  assert.ok(mcp.MCP_INSTRUCTIONS.includes(mcp.MCP_ATTRIBUTION));
});

test("each MCP_TOOLS row lists exactly its schema's inputs, required where the schema requires", () => {
  for (const row of MCP_TOOLS) {
    const schema = mcp.MCP_TOOL_DEFS[row.name as keyof typeof mcp.MCP_TOOL_DEFS].inputSchema;
    const shape = schema.shape as Record<string, { safeParse(v: unknown): { success: boolean } }>;
    assert.deepEqual(row.inputs.map((i) => i.name), Object.keys(shape), row.name);
    for (const i of row.inputs) assert.equal(i.required === true, !shape[i.name].safeParse(undefined).success, `${row.name}.${i.name} required`);
  }
});

/* ------------------------------------------------------------------ */
/* Parity with the serializers                                         */
/* ------------------------------------------------------------------ */

test("get_college by unit_id ≡ publicSchool, with and without fields=", async () => {
  for (const id of SAMPLE) {
    const s = byId.get(id)!;
    assert.deepEqual(body(await run("get_college", { unit_id: id })), json(serialize.publicSchool(s)), id);
  }
  const s = byId.get(HARVARD)!;
  const picked = body(await run("get_college", { unit_id: HARVARD, fields: ["admissions", "cost"] }));
  assert.deepEqual(picked, json(serialize.publicSchool(s, ["admissions", "cost"])));
  assert.deepEqual(Object.keys(picked).sort(), ["admissions", "cost", "name", "unit_id"]);
});

test("get_lineage ≡ schoolLineage, with and without fields=", async () => {
  for (const id of SAMPLE) {
    const s = byId.get(id)!;
    assert.deepEqual(body(await run("get_lineage", { unit_id: id })), json({ unit_id: id, fields: serialize.schoolLineage(s, meta) }), id);
  }
  const narrowed = body(await run("get_lineage", { unit_id: HARVARD, fields: ["admissions"] }));
  assert.deepEqual(narrowed, json({ unit_id: HARVARD, fields: serialize.schoolLineage(byId.get(HARVARD)!, meta, ["admissions"]) }));
});

test("compare_colleges ≡ compareTable, with each college's summary and each value's lineage", async () => {
  const ids = [HARVARD, BERKELEY, MIT];
  const picked = data.getSchoolsByIds(ids);
  const all = body(await run("compare_colleges", { unit_ids: ids }));
  assert.deepEqual(all.metrics, json(serialize.compareTable(picked, data)));
  assert.deepEqual(all.colleges, json(picked.map(serialize.schoolSummary)));
  const fields = [...new Set(serialize.compareTable(picked, data).map((r) => r.field))];
  const expected = Object.fromEntries(picked.map((s) => [s.unit_id, serialize.schoolLineage(s, meta, fields)] as const).filter(([, c]) => Object.keys(c).length));
  const back = ungroup(all.cited);
  assert.deepEqual(Object.keys(back).sort(), Object.keys(expected).sort());
  for (const id of Object.keys(expected)) assert.deepEqual(back[id], json(expected[id]), id);
  // Grouped: a record shared by several colleges is listed once.
  const groups = Object.values(all.cited as Record<string, { unit_ids: string[] }[]>).flat();
  assert.ok(groups.some((gr) => gr.unit_ids.length > 1), "the three share some default citations");

  const two = body(await run("compare_colleges", { unit_ids: [HARVARD, BERKELEY], metrics: ["acceptance", "sat"] }));
  assert.deepEqual(two.metrics, json(serialize.compareTable(data.getSchoolsByIds([HARVARD, BERKELEY]), data, ["acceptance", "sat"])));
  // Every value Harvard reports in the table has its citation beside it.
  const harvardCited = ungroup(two.cited)[HARVARD];
  for (const r of two.metrics as { field: string; values: { unit_id: string; value: number | null }[] }[]) {
    if (r.values.find((v) => v.unit_id === HARVARD)?.value !== null) assert.ok(r.field in harvardCited, `${r.field} is cited`);
  }
});

test("list_fields ≡ fieldRegistry; topic narrows it", async () => {
  assert.deepEqual(body(await run("list_fields", {})), json({ fields: serialize.fieldRegistry(meta) }));
  const adm = body(await run("list_fields", { topic: "admissions" }));
  assert.deepEqual(adm, json({ fields: serialize.fieldRegistry(meta).filter((f) => f.topic === "admissions") }));
  assert.ok((adm.fields as unknown[]).length > 5);
});

test("get_dataset_info ≡ datasetMeta", async () => {
  assert.deepEqual(body(await run("get_dataset_info", {})), json(serialize.datasetMeta({ meta, calendar, summary: data.getDatasetSummary() })));
});

test("search_colleges ≡ schoolSummary over getSchools with the same Explore filters, each admit rate cited", async () => {
  const cases: [Record<string, unknown>, Record<string, string>][] = [
    [{ query: "university of california" }, { q: "university of california" }],
    [{ states: ["ma"], types: ["private-nonprofit"], max_admit_rate: 20 }, { states: "MA", types: "private-nonprofit", maxAR: "20" }],
    [{ sizes: ["large", "xl"], min_sat: 1400, limit: 50 }, { sizes: "large,xl", minSAT: "1400" }],
    [{ min_admit_rate: 50, max_act: 24, states: ["TX", "ok"] }, { minAR: "50", maxACT: "24", states: "TX,OK" }],
  ];
  for (const [args, params] of cases) {
    const out = body(await run("search_colleges", args));
    const expected = data.getSchools(parseFilters(params));
    const limit = (args.limit as number | undefined) ?? 10;
    assert.equal(out.total, expected.length, JSON.stringify(args));
    assert.deepEqual(out.items, json(expected.slice(0, limit).map(serialize.schoolSummary)), JSON.stringify(args));
    assert.deepEqual(Object.keys(out.cited as object), expected.slice(0, limit).some((s) => s.admissions.acceptance_rate !== null) ? ["admissions.acceptance_rate"] : []);
    const cited = ungroup(out.cited);
    for (const s of expected.slice(0, limit)) {
      const own = serialize.schoolLineage(s, meta, ["admissions.acceptance_rate"]);
      assert.deepEqual(cited[s.unit_id] ?? {}, json(own), s.unit_id);
      assert.equal(s.admissions.acceptance_rate === null, !("admissions.acceptance_rate" in own));
    }
  }
  assert.ok(((body(await run("search_colleges", { query: "uga" })).items as { unit_id: string }[])[0].unit_id).length > 0);
});

test("get_history: the shard's series (all, or the ones asked for), their definitions, and the sources", async () => {
  const shard = (await ctx.getHistory(HARVARD))!;
  assert.ok(shard, "Harvard has a history shard");
  const all = body(await run("get_history", { unit_id: HARVARD }));
  assert.deepEqual(all.series, json(shard.series));
  assert.deepEqual(Object.keys(all.definitions as object), Object.keys(shard.series));
  const def = (all.definitions as Record<string, { label: string; field: string }>).acceptance_rate;
  assert.equal(def.label, SERIES.acceptance_rate.label);
  assert.equal(def.field, SERIES.acceptance_rate.field);
  assert.ok((all.sources as unknown[]).length > 0, "the federal files are cited");
  const two = body(await run("get_history", { unit_id: HARVARD, series: ["applicants", "acceptance_rate"] }));
  assert.deepEqual(Object.keys(two.series as object).sort(), ["acceptance_rate", "applicants"]);
  assert.deepEqual((two.series as Record<string, unknown>).applicants, json(shard.series.applicants));
});

/* ------------------------------------------------------------------ */
/* Names and errors                                                    */
/* ------------------------------------------------------------------ */

test("get_college by name: an exact name or short name resolves; an ambiguous one answers candidates", async () => {
  assert.equal(body(await run("get_college", { name: "Harvard University" })).unit_id, HARVARD);
  assert.equal(body(await run("get_college", { name: "harvard" })).unit_id, HARVARD, "a lone candidate");
  assert.equal(body(await run("get_college", { name: "MIT" })).unit_id, MIT, "an exact short name");
  assert.deepEqual(body(await run("get_college", { name: "MIT", fields: ["admissions"] })), json(serialize.publicSchool(byId.get(MIT)!, ["admissions"])));

  // The mini fixture's four Alabama colleges (the real data's example was "Columbia").
  const alabama = body(await run("get_college", { name: "Alabama" }));
  assert.equal(alabama.ambiguous, true);
  const candidates = alabama.candidates as { unit_id: string; name: string }[];
  assert.ok(candidates.length > 1 && candidates.length <= mcp.NAME_CANDIDATES);
  assert.deepEqual(candidates, json(data.searchSchools("Alabama", mcp.NAME_CANDIDATES).map((h) => serialize.schoolSummary(byId.get(h.id)!))));

  // Several colleges with exactly this name: the candidates are those colleges.
  const twins = Object.entries(Object.groupBy(schools, (s) => s.name)).find(([, list]) => (list?.length ?? 0) > 1);
  if (twins) {
    const out = body(await run("get_college", { name: twins[0] }));
    assert.equal(out.ambiguous, true);
    assert.ok((out.candidates as { name: string }[]).every((c) => c.name === twins[0]));
  }
});

test("errors are tool results with isError and a plain sentence", async () => {
  const cases: [string, unknown, number, RegExp][] = [
    ["get_college", { unit_id: "999999" }, 404, /No college with unit_id 999999/],
    ["get_college", { name: "zzqxj university of nowhere" }, 404, /No college matches/],
    ["get_college", {}, 400, /Give unit_id or name/],
    ["get_college", { unit_id: "abc" }, 400, /unit_id/],
    ["compare_colleges", { unit_ids: [HARVARD] }, 400, /unit_ids/],
    ["compare_colleges", { unit_ids: [HARVARD, HARVARD] }, 400, /at least 2 different/],
    ["compare_colleges", { unit_ids: [HARVARD, "999999"] }, 404, /999999/],
    ["compare_colleges", { unit_ids: [HARVARD, BERKELEY], metrics: ["nonsense"] }, 400, /metrics/],
    ["get_history", { unit_id: "999999" }, 404, /No college/],
    ["get_lineage", { unit_id: "999999" }, 404, /No college/],
    ["list_fields", { topic: "nonsense" }, 400, /topic/],
    ["search_colleges", { limit: 51 }, 400, /limit/],
    ["no_such_tool", {}, 400, /No tool named no_such_tool/],
  ];
  for (const [name, args, status, message] of cases) {
    const out = await run(name, args);
    assert.equal(out.result.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.equal(out.status, status, `${name} ${JSON.stringify(args)}`);
    assert.match((out.result.content[0] as { text: string }).text, message);
  }
  // A college without a history shard.
  const noShard = schools.find((s) => miniHistory(s.unit_id) === null);
  if (noShard) assert.equal((await run("get_history", { unit_id: noShard.unit_id })).status, 404);
});

/* ------------------------------------------------------------------ */
/* Nothing hidden                                                      */
/* ------------------------------------------------------------------ */

const isHidden = (path: string) => {
  const reg = registeredPathFor(path);
  return HIDDEN.has(path) || (reg !== null && HIDDEN.has(reg));
};

/** Hidden things in a tool's output: a hidden field's value at its path (from any record root), a hidden path as a key or a value, a selectivity band. */
function hiddenProblems(value: unknown, path: string[] = []): string[] {
  if (typeof value === "string") return HIDDEN.has(value) ? [`${path.join(".")}: names hidden ${value}`] : [];
  if (value === null || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const here = [...path, k];
    if (HIDDEN.has(k)) out.push(`${here.join(".")}: hidden key`);
    // A record can sit anywhere (a result's root, under "fields", per college): test every suffix of the path.
    for (let i = 0; i < here.length; i++) if (isHidden(here.slice(i).join("."))) out.push(`${here.join(".")}: hidden value`);
    if (k === "band" && path[path.length - 1] === "selectivity") out.push(`${here.join(".")}: selectivity band`);
    out.push(...hiddenProblems(v, here));
  }
  return [...new Set(out)];
}

test("no tool's output names or carries a hidden field, for colleges that have them", async () => {
  assert.ok(banded.length > 0, "some college has a band to hide");
  const ids = banded.slice(0, 5).map((s) => s.unit_id);
  const outputs: [string, unknown][] = [
    ["list_fields", await run("list_fields", {})],
    ["get_dataset_info", await run("get_dataset_info", {})],
    ["search_colleges", await run("search_colleges", { limit: 50 })],
    ["compare_colleges", await run("compare_colleges", { unit_ids: ids })],
  ];
  for (const id of ids) {
    outputs.push(["get_college", await run("get_college", { unit_id: id })]);
    outputs.push(["get_college fields", await run("get_college", { unit_id: id, fields: ["selectivity", "derived"] })]);
    outputs.push(["get_lineage", await run("get_lineage", { unit_id: id })]);
    outputs.push(["get_lineage fields", await run("get_lineage", { unit_id: id, fields: [...HIDDEN_FIELDS, "selectivity"] })]);
    outputs.push(["get_history", await run("get_history", { unit_id: id })]);
  }
  for (const [name, out] of outputs) {
    const o = out as ToolOutcome;
    const text = (o.result.content[0] as { text: string }).text;
    const parsed = o.result.isError ? text : JSON.parse(text);
    assert.deepEqual(hiddenProblems(parsed), [], name);
    assert.deepEqual(hiddenProblems(o.result.structuredContent ?? {}), [], `${name} structured`);
  }
  // compare_colleges can't be asked for a hidden metric's key either.
  const hiddenMetric = Object.entries((await import("../lib/metrics.ts")).METRICS).find(([, m]) => HIDDEN.has(m.field));
  if (hiddenMetric) assert.equal((await run("compare_colleges", { unit_ids: [HARVARD, BERKELEY], metrics: [hiddenMetric[0]] })).status, 400);
});

test("guard: the hidden walk catches a band, a hidden lineage key, and a hidden field named in a registry", () => {
  const s = banded[0];
  assert.ok(hiddenProblems(json(s)).some((p) => p.endsWith("selectivity band")), "the raw record has a band");
  assert.ok(hiddenProblems({ unit_id: "1", fields: { "derived.selectivity_score": { path: "derived.selectivity_score" } } }).length >= 2);
  assert.ok(hiddenProblems({ fields: [{ path: HIDDEN_FIELDS[0] }] }).length === 1);
  assert.deepEqual(hiddenProblems(json(serialize.publicSchool(s))), []);
});

/* ------------------------------------------------------------------ */
/* Telemetry                                                           */
/* ------------------------------------------------------------------ */

test("each tool call records api_request: mcp.<tool>, its status, the key id from authInfo; telemetry never fails a call", async () => {
  const recorded: Record<string, unknown>[] = [];
  const { server, tools } = captureServer();
  mcp.registerQuadTools(server, { context: async () => ctx, record: async (a) => void recorded.push(a) });
  const authed = { http: { authInfo: { token: "t", clientId: "key-7", scopes: [], extra: { userId: "u" } } } };
  const ok = await tools.get("get_college")!.cb({ unit_id: HARVARD }, authed);
  assert.deepEqual(JSON.parse(ok.content[0].text), json(serialize.publicSchool(byId.get(HARVARD)!)));
  await tools.get("get_lineage")!.cb({ unit_id: "999999" }, authed);
  await tools.get("get_dataset_info")!.cb({}, {});
  assert.deepEqual(recorded, [
    { endpoint: "mcp.get_college", status: 200, transport: "mcp", keyId: "key-7" },
    { endpoint: "mcp.get_lineage", status: 404, transport: "mcp", keyId: "key-7" },
    { endpoint: "mcp.get_dataset_info", status: 200, transport: "mcp", keyId: null },
  ]);

  const broken = captureServer();
  mcp.registerQuadTools(broken.server, { context: async () => ctx, record: async () => { throw new Error("telemetry down"); } });
  const still = await broken.tools.get("get_college")!.cb({ unit_id: HARVARD }, authed);
  assert.equal(still.isError, undefined);

  const noData = captureServer();
  const seen: Record<string, unknown>[] = [];
  mcp.registerQuadTools(noData.server, { context: async () => { throw new Error("disk gone"); }, record: async (a) => void seen.push(a) });
  const failed = await noData.tools.get("get_college")!.cb({ unit_id: HARVARD }, authed);
  assert.equal(failed.isError, true);
  assert.doesNotMatch(failed.content[0].text, /disk gone/);
  assert.equal(seen[0].status, 500);
});

/* ------------------------------------------------------------------ */
/* The HTTP route                                                      */
/* ------------------------------------------------------------------ */

const row = (over: Partial<KeyUseRow> = {}): KeyUseRow => ({ key_id: "key-1", user_id: "user-1", tier: "account", allowed: true, used_today: 1, limit_per_day: 5000, ...over });
const fresh = () => new TokenBuckets({ capacity: 60, refillPerSecond: 1 });
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } };

function mcpRequest(token: string | null, message: unknown, method = "POST"): Request {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request("https://quad.test/api/mcp", { method, headers, ...(method === "POST" ? { body: JSON.stringify(message) } : {}) });
}

/** The JSON-RPC message in a Streamable HTTP answer (JSON, or the first SSE `data:` line). */
async function rpcResult(res: Response): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    assert.ok(line, text);
    return JSON.parse(line.slice(6));
  }
  return JSON.parse(text);
}

test("the route: no key, a malformed key, or one the lookup rejects → 401 with a WWW-Authenticate challenge; recorded without a key", async () => {
  const recorded: Record<string, unknown>[] = [];
  const lookups: [string, string][] = [];
  const handler = createMcpRoute({ auth: { lookup: async (h, e) => (lookups.push([h, e]), null), buckets: fresh() }, record: async (a) => void recorded.push(a), context: async () => ctx });
  const rejected = generateApiKey();
  for (const [token, code] of [[null, "missing_key"], ["x", "invalid_key"], [rejected, "invalid_key"]] as const) {
    const res = await handler(mcpRequest(token, INIT));
    assert.equal(res.status, 401, String(token));
    const challenge = res.headers.get("WWW-Authenticate")!;
    assert.match(challenge, /^Bearer /);
    assert.ok(challenge.includes(`resource_metadata="https://quad.test${MCP_RESOURCE_METADATA_PATH}"`), challenge);
    const err = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(err.error.code, code);
    assert.match(err.error.message, /\/account\/api-keys/);
  }
  assert.deepEqual(lookups, [[hashApiKey(rejected), "mcp"]], "only the well-formed key reaches the lookup, with endpoint mcp");
  assert.deepEqual(recorded, [401, 401, 401].map((status) => ({ endpoint: "mcp", status, transport: "mcp", keyId: null })));
  // GET and DELETE are behind the same check.
  assert.equal((await handler(mcpRequest(null, null, "GET"))).status, 401);
  assert.equal((await handler(mcpRequest(null, null, "DELETE"))).status, 401);
});

test("the route: over the day → 429 with Retry-After; the key check failing → 503 unavailable", async () => {
  const over = createMcpRoute({ auth: { lookup: async () => row({ allowed: false }), buckets: fresh() }, record: async () => {}, context: async () => ctx });
  const r429 = await over(mcpRequest(generateApiKey(), INIT));
  assert.equal(r429.status, 429);
  assert.ok(Number(r429.headers.get("Retry-After")) > 0);
  assert.equal(((await r429.json()) as { error: { code: string } }).error.code, "rate_limited");

  const down = createMcpRoute({ auth: { lookup: async () => { throw new Error("db down"); }, buckets: fresh() }, record: async () => {}, context: async () => ctx });
  const r503 = await down(mcpRequest(generateApiKey(), INIT));
  assert.equal(r503.status, 503);
  assert.equal(r503.headers.get("Retry-After"), "60");
  const text = await r503.text();
  assert.equal((JSON.parse(text) as { error: { code: string } }).error.code, "unavailable");
  assert.doesNotMatch(text, /db down/);
});

test("the route with a valid key: initialize, tools/list (the ten tools), and tools/call over Streamable HTTP, recorded with the key id", async () => {
  const recorded: Record<string, unknown>[] = [];
  const handler = createMcpRoute({ auth: { lookup: async () => row({ key_id: "key-42" }), buckets: fresh() }, record: async (a) => void recorded.push(a), context: async () => ctx });
  const key = generateApiKey();

  const init = await handler(mcpRequest(key, INIT));
  assert.equal(init.status, 200);
  const initResult = (await rpcResult(init)).result!;
  assert.equal((initResult.serverInfo as { name: string }).name, "quad");
  assert.ok(String(initResult.instructions).includes(mcp.MCP_ATTRIBUTION));

  const list = (await rpcResult(await handler(mcpRequest(key, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })))).result!;
  const listed = list.tools as { name: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } }[];
  assert.deepEqual(listed.map((t) => t.name), MCP_TOOLS.map((t) => t.name));
  for (const t of listed) {
    const doc = MCP_TOOLS.find((d) => d.name === t.name)!;
    assert.deepEqual(Object.keys(t.inputSchema.properties ?? {}), doc.inputs.map((i) => i.name), t.name);
    assert.deepEqual([...(t.inputSchema.required ?? [])].sort(), doc.inputs.filter((i) => i.required).map((i) => i.name).sort(), t.name);
  }

  const call = (await rpcResult(await handler(mcpRequest(key, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_college", arguments: { unit_id: HARVARD } } })))).result!;
  assert.deepEqual(JSON.parse((call.content as { text: string }[])[0].text), json(serialize.publicSchool(byId.get(HARVARD)!)));

  const bad = (await rpcResult(await handler(mcpRequest(key, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_lineage", arguments: { unit_id: "999999" } } })))).result!;
  assert.equal(bad.isError, true);

  assert.deepEqual(recorded, [
    { endpoint: "mcp.get_college", status: 200, transport: "mcp", keyId: "key-42" },
    { endpoint: "mcp.get_lineage", status: 404, transport: "mcp", keyId: "key-42" },
  ]);
});

test("app/api/mcp/route.ts without Supabase: GET, POST, DELETE; no key → 401, a key-shaped one → 503; api_request recorded", async () => {
  delete g.__rpc;
  g.__events = [];
  const route = await import("../app/api/mcp/route.ts");
  assert.equal(typeof route.GET, "function");
  assert.equal(typeof route.POST, "function");
  assert.equal(typeof route.DELETE, "function");
  const none = await route.POST(mcpRequest(null, INIT));
  assert.equal(none.status, 401);
  assert.ok(none.headers.get("WWW-Authenticate"));
  const res = await route.POST(mcpRequest(generateApiKey(), INIT));
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "unavailable");
  assert.deepEqual(
    g.__events.map((e) => e.properties),
    [
      { endpoint: "mcp", status: 401, transport: "mcp", key_id: "" },
      { endpoint: "mcp", status: 503, transport: "mcp", key_id: "" },
    ],
  );
});

test("the protected-resource metadata the challenge names: the MCP endpoint as the resource, no authorization servers", async () => {
  const wellKnown = await import("../app/.well-known/oauth-protected-resource/api/mcp/route.ts");
  const res = wellKnown.GET(new Request(`https://quad.test${MCP_RESOURCE_METADATA_PATH}`));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { resource: "https://quad.test/api/mcp", authorization_servers: [] });
  assert.equal(MCP_RESOURCE_METADATA_PATH, "/.well-known/oauth-protected-resource/api/mcp");
});

test("lib/api/mcp.ts is pure: no server-only, no Next import, no Supabase", () => {
  const src = read("lib/api/mcp.ts");
  assert.doesNotMatch(src, /import\s+["']server-only["']/);
  assert.doesNotMatch(src, /^import\s(?!type\b)[^;]*from\s+["'](next\/|mcp-handler|@\/lib\/supabase|@\/lib\/data|\.\.\/data|\.\.\/supabase|\.\/auth)(\.ts)?["']/m);
});
