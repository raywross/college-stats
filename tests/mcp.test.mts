/**
 * Quad's MCP server (lib/api/mcp.ts, app/api/mcp/route.ts; specs/product/assistants.md) over the real dataset:
 * initialize negotiates a known protocol version, every tool is read-only and documented, each tool answers, the
 * ChatGPT `search`/`fetch` pair has the shapes deep research expects, notifications get no reply, unknown methods and
 * tools are JSON-RPC errors, the route answers JSON with CORS and the dataset stamp, and nothing in the API imports
 * the estimate. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const mcp = await import("../lib/api/mcp.ts");
const { getData } = await import("../lib/data.ts");
const route = await import("../app/api/mcp/route.ts");

const data = await getData();
const ctx = { data, origin: "https://quad.test" };
const call = (name: string, args: Record<string, unknown> = {}, id: number | string = 1) =>
  mcp.handleMcpMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, ctx)!;
const structured = (r: ReturnType<typeof call>) => (r.result as { structuredContent: Record<string, unknown>; isError?: boolean }).structuredContent;

test("initialize: a known protocol version is echoed, an unknown one gets the newest; capabilities and instructions", () => {
  const known = mcp.handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } }, ctx)!;
  const r = known.result as { protocolVersion: string; capabilities: unknown; serverInfo: { name: string }; instructions: string };
  assert.equal(r.protocolVersion, "2025-03-26");
  assert.deepEqual(r.capabilities, { tools: { listChanged: false } });
  assert.equal(r.serverInfo.name, "quad");
  assert.match(r.instructions, /never gives admission odds/);
  const future = mcp.handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } }, ctx)!;
  assert.equal((future.result as { protocolVersion: string }).protocolVersion, mcp.MCP_LATEST_PROTOCOL);
});

test("tools/list: seven tools, every one read-only, non-destructive, with a title, a description, and an object schema", () => {
  const { tools } = mcp.toolList() as { tools: { name: string; title: string; description: string; inputSchema: { type: string }; annotations: Record<string, unknown> }[] };
  assert.deepEqual(
    tools.map((t) => t.name),
    ["search", "fetch", "find_colleges", "college_facts", "compare_colleges", "explore_colleges", "glossary"],
  );
  for (const t of tools) {
    assert.ok(t.title && t.description.length > 20, `${t.name} documented`);
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} read-only`);
    assert.equal(t.annotations.destructiveHint, false);
    assert.equal(t.annotations.openWorldHint, false);
  }
});

test("search and fetch: ChatGPT's deep-research shapes, ids round-trip, text carries sources and years", () => {
  const s = structured(call("search", { query: "Emory"})) as { results: { id: string; title: string; url: string }[] };
  assert.ok(s.results.length >= 1);
  const first = s.results[0];
  assert.match(first.id, /^\d+$/);
  assert.match(first.title, /Emory/);
  assert.equal(first.url, `https://quad.test/schools/${first.id}`);
  const f = structured(call("fetch", { id: first.id })) as { id: string; title: string; text: string; url: string; metadata: Record<string, unknown> };
  assert.equal(f.id, first.id);
  assert.equal(f.url, first.url);
  assert.match(f.text, /Acceptance rate: \d/);
  assert.match(f.text, /\((IPEDS|CDS|College Scorecard|Common Data Set|Scorecard)[^)]*\)/, "a parenthesised source after a value");
  assert.match(f.text, /Data: Quad/);
  assert.ok("selectivity" in f.metadata);
  const missing = call("fetch", { id: "0" }).result as { isError?: boolean; content: { text: string }[] };
  assert.equal(missing.isError, true);
});

test("find_colleges: nicknames first, the state filter holds, limit is clamped", () => {
  const r = structured(call("find_colleges", { query: "UVA", limit: 3 })) as { colleges: { name: string; state: string; selectivity: string | null; acceptance_rate: number | null }[] };
  assert.ok(r.colleges.length >= 1 && r.colleges.length <= 3);
  assert.match(r.colleges[0].name, /Virginia/);
  const ga = structured(call("find_colleges", { query: "state", state: "ga", limit: 100 })) as { colleges: { state: string }[] };
  assert.ok(ga.colleges.length <= 25);
  assert.ok(ga.colleges.every((c) => c.state === "GA"));
});

test("college_facts: sections match the Compare table's groups, every fact has a cited source, and no hidden field appears", async () => {
  const { HIDDEN_FIELDS } = await import("../lib/fields.ts");
  const { SECTION_TITLES } = await import("../lib/api/public.ts");
  const r = structured(call("college_facts", { college: "Georgia Institute of Technology" })) as {
    college: { name: string; selectivity: string | null; url: string };
    sections: { title: string; facts: { field: string; label: string; value: string; term: string; source: { label: string; publisher: string; year: string | null; url: string } }[] }[];
    attribution: string;
  };
  assert.match(r.college.name, /Georgia Institute of Technology/);
  assert.ok(r.sections.length >= 3);
  for (const section of r.sections) {
    assert.ok(SECTION_TITLES.includes(section.title), `${section.title} is a Compare group`);
    for (const f of section.facts) {
      assert.ok(f.value.length > 0 && f.label && f.term, `${f.field} has a value, label, term`);
      assert.ok(f.source.label && f.source.publisher && f.source.url, `${f.field} is cited`);
      for (const h of HIDDEN_FIELDS) assert.notEqual(f.field, h, "a hidden field never leaves the server");
    }
  }
  const admissions = structured(call("college_facts", { college: "139755", sections: ["admissions"] })) as { sections: { title: string }[] };
  assert.equal(admissions.sections.length, 1, "one section when one is asked for");
  assert.equal(admissions.sections[0].title, SECTION_TITLES[0], "the topic key picks the admissions group");
  // The raw record never leaves: no selectivity band or score key anywhere in the serialized output.
  const text = JSON.stringify(r);
  assert.ok(!/"band"|selectivity_score/.test(text));
});

test("compare_colleges: two to four ids, one row per metric with a year per cell; fewer than two is an error", () => {
  const ids = (structured(call("search", { query: "Emory" })) as { results: { id: string }[] }).results.slice(0, 1).map((x) => x.id);
  ids.push((structured(call("search", { query: "Georgia Tech" })) as { results: { id: string }[] }).results[0].id);
  const r = structured(call("compare_colleges", { unit_ids: ids })) as { colleges: { unit_id: string }[]; rows: { group: string; label: string; values: { unit_id: string; value: string | null; year: string | null }[] }[] };
  assert.equal(r.colleges.length, 2);
  assert.ok(r.rows.length >= 10);
  for (const row of r.rows) {
    assert.equal(row.values.length, 2);
    assert.ok(row.values.some((v) => v.value !== null), `${row.label} has a value for someone`);
  }
  const one = call("compare_colleges", { unit_ids: [ids[0]] }).result as { isError?: boolean };
  assert.equal(one.isError, true);
});

test("explore_colleges: Explore's own filters apply (the same set as getSchools) and paging is clamped", async () => {
  const { parseFilters } = await import("../lib/params.ts");
  const filters = { states: "GA", maxAR: "40", sortBy: "acceptance_rate" };
  const r = structured(call("explore_colleges", { filters, limit: 500, page: 1 })) as { total: number; page: number; pages: number; items: { state: string; acceptance_rate: number | null }[] };
  const expected = data.getSchools(parseFilters(filters));
  assert.equal(r.total, expected.length);
  assert.ok(r.items.length <= 50);
  assert.ok(r.items.every((c) => c.state === "GA" && c.acceptance_rate !== null && c.acceptance_rate <= 0.4));
  assert.equal(r.items[0].acceptance_rate, expected[0].admissions.acceptance_rate);
  // forMe (the signed-in estimate) is ignored rather than applied.
  const same = structured(call("explore_colleges", { filters: { ...filters, forMe: "1" } })) as { total: number };
  assert.equal(same.total, r.total);
});

test("glossary: account terms are left out; a key or a word narrows it", () => {
  const all = structured(call("glossary")) as { terms: { key: string; category: string; short: string }[] };
  assert.ok(all.terms.length > 50);
  assert.ok(all.terms.every((t) => t.category !== "Your account"));
  const one = structured(call("glossary", { term: "acceptance-rate" })) as { terms: { key: string }[] };
  assert.deepEqual(one.terms.map((t) => t.key), ["acceptance-rate"]);
  const word = structured(call("glossary", { term: "early decision" })) as { terms: { term: string }[] };
  assert.ok(word.terms.length >= 1 && word.terms.every((t) => /early decision/i.test(t.term)));
});

test("protocol: notifications get no reply, unknown methods and tools are errors, batches answer per request", () => {
  assert.equal(mcp.handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx), null);
  assert.equal(mcp.handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "nope" }, ctx)!.error!.code, mcp.RPC.methodNotFound);
  assert.equal(call("not_a_tool").error!.code, mcp.RPC.invalidParams);
  assert.equal(mcp.handleMcpMessage({ hello: 1 }, ctx)!.error!.code, mcp.RPC.invalidRequest);
  assert.deepEqual(mcp.handleMcpMessage({ jsonrpc: "2.0", id: "p", method: "ping" }, ctx), { jsonrpc: "2.0", id: "p", result: {} });
  const batch = mcp.handleMcpBody([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }], ctx) as unknown[];
  assert.equal(batch.length, 1);
  assert.equal(mcp.handleMcpBody([{ jsonrpc: "2.0", method: "notifications/initialized" }], ctx), null);
});

test("the route: JSON in, JSON out with CORS, the protocol header, and the dataset stamp; 202 for a notification; 400 for bad JSON; GET is 405", async () => {
  const post = (body: unknown) => route.POST(new Request("https://quad.test/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }));
  const res = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Mcp-Protocol-Version"), "2025-06-18");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(res.headers.get("X-Dataset-Publish") ?? "", /^\d{4}-\d{2}-\d{2}/);
  const body = (await res.json()) as { result: { serverInfo: { name: string } } };
  assert.equal(body.result.serverInfo.name, "quad");
  assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const bad = await route.POST(new Request("https://quad.test/mcp", { method: "POST", body: "{nope" }));
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: { code: number } }).error.code, mcp.RPC.parse);
  assert.equal((await route.GET()).status, 405);
  assert.equal((await route.OPTIONS()).status, 204);
  assert.equal((await route.DELETE()).status, 200);
  // Links in tool results use the request's own origin.
  const facts = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search", arguments: { query: "Emory" } } });
  const url = ((await facts.json()) as { result: { structuredContent: { results: { url: string }[] } } }).result.structuredContent.results[0].url;
  assert.ok(url.startsWith("https://quad.test/schools/"));
});

test("guard: the public API never imports the estimate, the selectivity index, or the planner", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
    });
  const banned = /lib\/chances\/(estimate|model|snapshot)|lib\/selectivity(-facts)?["']|lib\/planner\/|lib\/admin\//;
  for (const f of [...files(join(ROOT, "lib/api")), ...files(join(ROOT, "app/api/mcp")), ...files(join(ROOT, "app/api/v1")), ...files(join(ROOT, "app/mcp"))]) {
    const src = readFileSync(f, "utf8");
    assert.ok(!banned.test(src), `${relative(ROOT, f)} stays away from the estimate and the planner`);
  }
});
