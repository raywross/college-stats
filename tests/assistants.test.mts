/**
 * Quad in the assistants (specs/product/assistants.md): the same MCP server as /api/mcp with no key at /mcp, the
 * `search`, `fetch`, and `glossary` tools, the skill file, and the /connect page.
 * - the public route: no key → the protocol works (initialize, tools/list, tools/call), each call recorded with no key
 *   id; the 61st request from one address in a minute → 429 with Retry-After (recorded), another address unaffected;
 *   the real app/mcp/route.ts without Supabase answers (nothing to look up);
 * - search ≡ searchSchools as deep research's rows with the site's links; fetch is a cited document (one line per public
 *   value, a source and year each, no hidden field named); glossary leaves the account terms out;
 * - the skill zip: a folder named after the skill with SKILL.md, the deployment's addresses, the tool names, the rules;
 * - /connect: paths come from the route table, no data year, the footer links it; nothing here imports the method.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import type { DatasetMeta, School } from "../lib/types";
import type { ReleaseCalendar } from "../lib/releases";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* Next.js stand-ins (as in tests/api-mcp.test.mts). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  "@/lib/supabase": "export function supabaseClient(){ throw new Error('Supabase is not configured'); }",
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
const g = globalThis as unknown as { __events?: { event: string; properties: Record<string, unknown> }[] };

const { HIDDEN_FIELDS, FIELDS } = await import("../lib/fields.ts");
const { createDataset } = await import("../lib/dataset.ts");
const { GLOSSARY } = await import("../lib/glossary.ts");
const mcp = await import("../lib/api/mcp.ts");
const { MCP_TOOLS, MCP_PUBLIC_PATH, MCP_PATH, API_BASE } = await import("../lib/api/routes.ts");
const { createPublicMcpRoute, PUBLIC_MCP_LIMIT } = await import("../lib/api/mcp-route.ts");
const { TokenBuckets } = await import("../lib/chances/rate-limit.ts");
const { buildSkillZip, skillMarkdown, SKILL_NAME } = await import("../lib/api/skill.ts");
const { zipNames, zipRead } = await import("../lib/api/zip.ts");

type McpToolContext = import("../lib/api/mcp.ts").McpToolContext;
type ToolOutcome = import("../lib/api/mcp.ts").ToolOutcome;

const schools = JSON.parse(read("data/schools.json")) as School[];
const meta = JSON.parse(read("data/meta.json")) as DatasetMeta;
const calendar = JSON.parse(read("data/release-calendar.json")) as ReleaseCalendar;
const aliases = existsSync(join(ROOT, "data/aliases.json")) ? JSON.parse(read("data/aliases.json")) : [];
const data = createDataset({ schools, meta, releaseCalendar: calendar, aliases });
const ctx: McpToolContext = { data, getHistory: async () => null, origin: "https://quad.test" };
const run = (name: string, args: unknown) => mcp.runTool(name, args, ctx);

const HARVARD = "166027";

function body(out: ToolOutcome): Record<string, unknown> {
  assert.notEqual(out.result.isError, true, JSON.stringify(out.result.content));
  assert.equal(out.status, 200);
  const first = out.result.content[0] as { type: string; text: string };
  return JSON.parse(first.text) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* The three tools                                                     */
/* ------------------------------------------------------------------ */

test("the route table names the keyless address, and the three assistant tools are in the table after the seven", () => {
  assert.equal(MCP_PUBLIC_PATH, "/mcp");
  assert.notEqual(MCP_PUBLIC_PATH, MCP_PATH);
  assert.deepEqual(MCP_TOOLS.slice(-3).map((t) => t.name), ["search", "fetch", "glossary"]);
  assert.deepEqual([...mcp.MCP_TOOL_NAMES].slice(-3), ["search", "fetch", "glossary"]);
});

test("search: deep research's { results: [{ id, title, url }] } over the site's own search, linking the request's origin", async () => {
  const out = body(await run("search", { query: "harvard" }));
  const results = out.results as { id: string; title: string; url: string }[];
  assert.deepEqual(results.map((r) => r.id), data.searchSchools("harvard", 10).map((h) => h.id));
  assert.ok(results.some((r) => r.id === HARVARD));
  const h = results.find((r) => r.id === HARVARD)!;
  assert.match(h.title, /^Harvard University \(Cambridge, MA\)$/);
  assert.equal(h.url, `https://quad.test/schools/${HARVARD}`);
  // Without an origin in the context, the production address.
  const prod = body(await mcp.runTool("search", { query: "harvard" }, { data, getHistory: async () => null }));
  assert.match((prod.results as { url: string }[])[0].url, /^https:\/\/usequad\.app\/schools\/\d+$/);
  const nothing = body(await run("search", { query: "zzzzqqq" }));
  assert.deepEqual(nothing.results, []);
});

test("fetch: a cited document, one line per public value with its source and year; no hidden field; 404 for an unknown id", async () => {
  const out = body(await run("fetch", { id: HARVARD }));
  assert.equal(out.id, HARVARD);
  assert.equal(out.title, "Harvard University");
  assert.equal(out.url, `https://quad.test/schools/${HARVARD}`);
  const text = out.text as string;
  assert.match(text, /^Harvard University, Cambridge, MA\. https:\/\/quad\.test\/schools\/166027/);
  const all = text.split("\n");
  const cited = all.filter((l) => /^[^#].*: .+ \(.+, .+\)$/.test(l));
  assert.ok(cited.length > 40, `${cited.length} cited lines`);
  assert.ok(all.some((l) => /^Acceptance rate: 0\.\d+ \(.+\)$/.test(l)), "the admit rate is a line with its source");
  assert.ok(/\n## admissions\n/.test(text) && /\n## /.test(text), "topics head the groups");
  assert.ok(all[1].includes("fractions of 1"), "the units line");
  assert.ok(text.includes(mcp.MCP_ATTRIBUTION));
  for (const path of HIDDEN_FIELDS) {
    const label = FIELDS[path].label;
    assert.ok(!text.includes(`${label}:`), `${label} (hidden) is named`);
    assert.ok(!text.includes("selectivity band"), "the band is named");
  }
  const metadata = out.metadata as Record<string, unknown>;
  assert.equal(metadata.unit_id, HARVARD);
  assert.equal(metadata.attribution, mcp.MCP_ATTRIBUTION);
  assert.ok(!("band" in metadata) && !("selectivity" in metadata));

  const missing = await run("fetch", { id: "999999" });
  assert.equal(missing.result.isError, true);
  assert.equal(missing.status, 404);
  assert.equal((await run("fetch", { id: "abc" })).status, 400);
});

test("fetch, for a sample of colleges: every line's value is the dataset's own", async () => {
  for (const s of schools.filter((_, i) => i % 300 === 0)) {
    const out = body(await run("fetch", { id: s.unit_id }));
    const text = out.text as string;
    const rate = s.admissions.acceptance_rate;
    if (rate !== null && rate !== undefined) assert.ok(text.includes(`Acceptance rate: ${rate} (`), `${s.name}: admit rate line`);
    assert.ok(text.startsWith(`${s.name}, `));
  }
});

test("glossary: the page's categories less the account one; a term narrows it; an unknown term is a 404", async () => {
  const all = body(await run("glossary", {})).terms as { key: string; category: string; related: string[] }[];
  assert.ok(all.length > 50);
  assert.ok(all.every((t) => t.category !== "Your account"));
  assert.ok(Object.values(GLOSSARY).some((e) => e.category === "Your account"), "the glossary has account terms to leave out");
  for (const t of all) for (const r of t.related) assert.ok(r in GLOSSARY, `${t.key} relates to ${r}`);
  const one = body(await run("glossary", { term: "acceptance-rate" })).terms as { key: string }[];
  assert.deepEqual(one.map((t) => t.key), ["acceptance-rate"]);
  const some = body(await run("glossary", { term: "price" })).terms as { term: string }[];
  assert.ok(some.length >= 1 && some.every((t) => /price/i.test(t.term)));
  assert.equal((await run("glossary", { term: "zzzzqqq" })).status, 404);
});

/* ------------------------------------------------------------------ */
/* The public route                                                    */
/* ------------------------------------------------------------------ */

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } };

function publicRequest(message: unknown, ip = "203.0.113.7", method = "POST"): Request {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": ip };
  return new Request(`https://quad.test${MCP_PUBLIC_PATH}`, { method, headers, ...(method === "POST" ? { body: JSON.stringify(message) } : {}) });
}

async function rpcResult(res: Response): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    assert.ok(line, text);
    return JSON.parse(line.slice(6));
  }
  return JSON.parse(text);
}

test("/mcp without a key: initialize, tools/list (the ten tools), tools/call; each call recorded with no key id and the request's origin in links", async () => {
  const recorded: Record<string, unknown>[] = [];
  const handler = createPublicMcpRoute({ buckets: new TokenBuckets(PUBLIC_MCP_LIMIT), record: async (a) => void recorded.push(a), context: async () => ({ data, getHistory: async () => null }) });

  const init = await handler(publicRequest(INIT));
  assert.equal(init.status, 200);
  const initResult = (await rpcResult(init)).result!;
  assert.equal((initResult.serverInfo as { name: string }).name, "quad");
  assert.ok(String(initResult.instructions).includes(mcp.MCP_ATTRIBUTION));

  const list = (await rpcResult(await handler(publicRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })))).result!;
  assert.deepEqual((list.tools as { name: string }[]).map((t) => t.name), MCP_TOOLS.map((t) => t.name));

  const call = (await rpcResult(await handler(publicRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "harvard" } } })))).result!;
  const results = JSON.parse((call.content as { text: string }[])[0].text).results as { id: string; url: string }[];
  assert.ok(results.some((r) => r.id === HARVARD));
  assert.ok(results.every((r) => r.url.startsWith("https://quad.test/schools/")), "links use the request's origin");

  assert.deepEqual(recorded, [{ endpoint: "mcp.search", status: 200, transport: "mcp", keyId: null }]);
});

test("/mcp: the 61st request from one address within a minute → 429 with Retry-After, recorded; another address and the next second pass", async () => {
  const recorded: Record<string, unknown>[] = [];
  let now = 1_700_000_000_000;
  const handler = createPublicMcpRoute({ buckets: new TokenBuckets(PUBLIC_MCP_LIMIT), now: () => now, record: async (a) => void recorded.push(a), context: async () => ({ data, getHistory: async () => null }) });
  const ping = { jsonrpc: "2.0", id: 9, method: "ping", params: {} };
  for (let i = 0; i < PUBLIC_MCP_LIMIT.capacity; i++) assert.equal((await handler(publicRequest(ping))).status, 200, `request ${i + 1}`);
  const over = await handler(publicRequest(ping));
  assert.equal(over.status, 429);
  assert.ok(Number(over.headers.get("Retry-After")) >= 1);
  const err = (await over.json()) as { error: { code: string; message: string } };
  assert.equal(err.error.code, "rate_limited");
  assert.match(err.error.message, /\/account\/api-keys/);
  assert.deepEqual(recorded, [{ endpoint: "mcp", status: 429, transport: "mcp", keyId: null }]);
  assert.equal((await handler(publicRequest(ping, "198.51.100.1"))).status, 200, "another address");
  now += 1000;
  assert.equal((await handler(publicRequest(ping))).status, 200, "a second later one more passes");
});

test("app/mcp/route.ts: GET, POST, DELETE; a POST works without Supabase (nothing to look up) and is recorded without a key", async () => {
  g.__events = [];
  const route = await import("../app/mcp/route.ts");
  assert.equal(typeof route.GET, "function");
  assert.equal(typeof route.POST, "function");
  assert.equal(typeof route.DELETE, "function");
  const res = await route.POST(publicRequest({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "glossary", arguments: { term: "acceptance-rate" } } }, "192.0.2.44"));
  assert.equal(res.status, 200);
  const result = (await rpcResult(res)).result!;
  assert.equal(result.isError, undefined);
  assert.deepEqual(g.__events.map((e) => e.properties), [{ endpoint: "mcp.glossary", status: 200, transport: "mcp", key_id: "" }]);
  // GET and DELETE reach the server (no 401 at this address); the stateless transport refuses them itself.
  assert.notEqual((await route.GET(publicRequest(null, "192.0.2.44", "GET"))).status, 401);
  assert.notEqual((await route.DELETE(publicRequest(null, "192.0.2.44", "DELETE"))).status, 401);
});

/* ------------------------------------------------------------------ */
/* The skill                                                           */
/* ------------------------------------------------------------------ */

test("the skill zip: a folder named after the skill holding SKILL.md with frontmatter, the deployment's addresses, the tools, and the rules", () => {
  const origin = "https://preview.quad.test";
  const bytes = buildSkillZip(origin);
  assert.deepEqual(zipNames(bytes), [`${SKILL_NAME}/SKILL.md`]);
  const md = new TextDecoder().decode(zipRead(bytes, `${SKILL_NAME}/SKILL.md`)!);
  assert.equal(md, skillMarkdown(origin));
  assert.match(md, /^---\nname: quad\ndescription: .+\nlicense: .+\nmetadata:\n/);
  assert.ok(md.includes(`mcp: ${origin}${MCP_PUBLIC_PATH}\n`));
  assert.ok(md.includes(`mcp_with_key: ${origin}${MCP_PATH}\n`));
  assert.ok(md.includes(`api: ${origin}${API_BASE}/openapi.json\n`));
  for (const name of mcp.MCP_TOOL_NAMES) assert.ok(md.includes(name), `names ${name}`);
  for (const rule of ["Carry the citation", "Never give odds", "not reported", "Link the college's Quad page", "Ultra selective"]) assert.ok(md.includes(rule), rule);
  assert.doesNotMatch(md, /\b[Ff]all 20\d\d\b|\b20\d\d[–-]\d\d\b/, "no data year");
  assert.ok(!md.includes("/api/v1/colleges"), "the old keyless endpoints are gone");
});

/* ------------------------------------------------------------------ */
/* /connect and the guards                                             */
/* ------------------------------------------------------------------ */

const CONNECT_FILES = ["app/connect/page.tsx", "components/connect/ConnectAddresses.tsx", "app/connect/quad-skill.zip/route.ts", "app/mcp/route.ts"];

/** Code with comments removed, so a path named in a doc comment doesn't trip the guard. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("/connect: the paths come from the route table, no data year, the footer links it, the developers page points back", () => {
  for (const f of CONNECT_FILES) {
    assert.deepEqual([...code(read(f)).matchAll(/\/api\/(v\d|mcp)(?![\w-])|["'`]\/mcp["'`]/g)].map((m) => m[0]), [], `${f} types a path`);
    assert.doesNotMatch(read(f), /\b[Ff]all 20\d\d\b|\b20\d\d[–-]\d\d\b/, `${f} names a data year`);
  }
  assert.match(read("components/connect/ConnectAddresses.tsx"), /\bMCP_PUBLIC_PATH\b/);
  assert.match(read("components/layout/Footer.tsx"), /href="\/connect"/);
  assert.match(read("app/developers/page.tsx"), /href="\/connect"/);
  assert.match(read("app/developers/page.tsx"), /\bMCP_PUBLIC_PATH\b/);
  assert.match(read("app/connect/page.tsx"), /href="\/developers"/);
});

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) return walk(relative(ROOT, p));
    return /\.(tsx?|mts)$/.test(name) ? [relative(ROOT, p)] : [];
  });
}

test("nothing under app/mcp, app/connect, or components/connect imports the method, the estimate, or the console", () => {
  const banned = /from\s+["'](?:@\/|(?:\.\.?\/)+)(?:lib\/)?(?:selectivity|chances\/(?!rate-limit)|admin\/)/;
  const files = [...walk("app/mcp"), ...walk("app/connect"), ...walk("components/connect")];
  assert.ok(files.length >= 4, files.join(", "));
  for (const f of files) assert.doesNotMatch(read(f), banned, f);
  assert.match('import { x } from "@/lib/chances/estimate";', banned);
  assert.doesNotMatch('import { x } from "@/lib/chances/rate-limit";', banned);
});
