/**
 * The plain GET endpoints under /api/v1 and the skill download (specs/product/assistants.md): the same shapes as the
 * MCP tools, cached and stamped, with the OpenAPI document naming the request's own server; the skill zip holds
 * quad/SKILL.md with valid frontmatter and the deployment's addresses; the limiter answers 429 with Retry-After.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
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

const colleges = await import("../app/api/v1/colleges/route.ts");
const college = await import("../app/api/v1/colleges/[unit_id]/route.ts");
const compare = await import("../app/api/v1/compare/route.ts");
const glossaryRoute = await import("../app/api/v1/glossary/route.ts");
const openapi = await import("../app/api/v1/openapi.json/route.ts");
const skillRoute = await import("../app/connect/quad-skill.zip/route.ts");
const { zipNames, zipRead, zipStore } = await import("../lib/api/zip.ts");
const { skillMarkdown, SKILL_NAME } = await import("../lib/api/skill.ts");
const { PUBLIC_API_LIMITS } = await import("../lib/api/http.ts");

const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://quad.test${path}`, { headers });

test("GET /api/v1/colleges?q=: the name search, cached, stamped, CORS", async () => {
  const res = await colleges.GET(get("/api/v1/colleges?q=emory&limit=3"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Cache-Control") ?? "", /max-age=300/);
  assert.match(res.headers.get("X-Dataset-Publish") ?? "", /^\d{4}-\d{2}-\d{2}/);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = (await res.json()) as { total: number; items: { name: string; url: string; unit_id: string }[] };
  assert.ok(body.items.length >= 1 && body.items.length <= 3);
  assert.match(body.items[0].name, /Emory/);
  assert.equal(body.items[0].url, `https://quad.test/schools/${body.items[0].unit_id}`);
});

test("GET /api/v1/colleges with Explore filters: paged, the same set as the Explore page", async () => {
  const { getData } = await import("../lib/data.ts");
  const { parseFilters } = await import("../lib/params.ts");
  const data = await getData();
  const res = await colleges.GET(get("/api/v1/colleges?states=NC&types=public&sortBy=enrollment&limit=5&page=2"));
  const body = (await res.json()) as { total: number; page: number; pages: number; items: { state: string; type: string }[] };
  const expected = data.getSchools(parseFilters({ states: "NC", types: "public", sortBy: "enrollment" }));
  assert.equal(body.total, expected.length);
  assert.equal(body.page, 2);
  assert.ok(body.items.length <= 5);
  assert.ok(body.items.every((c) => c.state === "NC" && c.type === "public"));
});

test("GET /api/v1/colleges/{unit_id}: facts with sources; 400 for a non-id; 404 for an unknown one; sections narrow", async () => {
  const list = (await (await colleges.GET(get("/api/v1/colleges?q=georgia%20tech&limit=1"))).json()) as { items: { unit_id: string }[] };
  const id = list.items[0].unit_id;
  const res = await college.GET(get(`/api/v1/colleges/${id}?sections=Cost`), { params: Promise.resolve({ unit_id: id }) });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { college: { unit_id: string }; sections: { title: string; facts: { source: { year: string | null; label: string } }[] }[]; attribution: string };
  assert.equal(body.college.unit_id, id);
  assert.equal(body.sections.length, 1);
  assert.match(body.sections[0].title, /^Cost/);
  assert.ok(body.sections[0].facts.every((f) => f.source.label));
  assert.match(body.attribution, /Quad/);
  assert.equal((await college.GET(get("/api/v1/colleges/abc"), { params: Promise.resolve({ unit_id: "abc" }) })).status, 400);
  assert.equal((await college.GET(get("/api/v1/colleges/1"), { params: Promise.resolve({ unit_id: "1" }) })).status, 404);
});

test("GET /api/v1/compare: rows for two ids; 400 for one", async () => {
  const a = ((await (await colleges.GET(get("/api/v1/colleges?q=emory&limit=1"))).json()) as { items: { unit_id: string }[] }).items[0].unit_id;
  const b = ((await (await colleges.GET(get("/api/v1/colleges?q=duke&limit=1"))).json()) as { items: { unit_id: string }[] }).items[0].unit_id;
  const res = await compare.GET(get(`/api/v1/compare?ids=${a},${b}`));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { colleges: unknown[]; rows: { values: unknown[] }[] };
  assert.equal(body.colleges.length, 2);
  assert.ok(body.rows.length >= 10 && body.rows.every((r) => r.values.length === 2));
  assert.equal((await compare.GET(get(`/api/v1/compare?ids=${a}`))).status, 400);
});

test("GET /api/v1/glossary and /api/v1/openapi.json", async () => {
  const g = (await (await glossaryRoute.GET(get("/api/v1/glossary?term=acceptance-rate"))).json()) as { terms: { key: string }[] };
  assert.deepEqual(g.terms.map((t) => t.key), ["acceptance-rate"]);
  const doc = (await (await openapi.GET(get("/api/v1/openapi.json"))).json()) as { openapi: string; servers: { url: string }[]; paths: Record<string, { get: { operationId: string } }> };
  assert.equal(doc.openapi, "3.1.0");
  assert.deepEqual(doc.servers, [{ url: "https://quad.test" }]);
  const ops = Object.values(doc.paths).map((p) => p.get.operationId);
  assert.deepEqual(ops, ["listColleges", "getCollege", "compareColleges", "getGlossary"]);
  assert.equal(new Set(ops).size, ops.length, "operationIds unique (a GPT action needs that)");
});

test("the skill zip: a folder named after the skill holding SKILL.md with frontmatter, the deployment's addresses, and the rules", async () => {
  const res = await skillRoute.GET(get("/connect/quad-skill.zip"));
  assert.equal(res.headers.get("Content-Type"), "application/zip");
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual(zipNames(bytes), [`${SKILL_NAME}/SKILL.md`]);
  const md = new TextDecoder().decode(zipRead(bytes, `${SKILL_NAME}/SKILL.md`)!);
  assert.equal(md, skillMarkdown("https://quad.test"));
  assert.match(md, /^---\nname: quad\ndescription: .{20,1024}\n/);
  assert.match(md, /https:\/\/quad\.test\/mcp/);
  assert.match(md, /Never give odds/);
  assert.ok(!/\b20\d\d[–-]\d\d\b|\bFall 20\d\d\b/.test(md), "no hard-coded data year");
  // The zip writer round-trips any set of files.
  const z = zipStore([{ name: "a/b.txt", data: "hello" }, { name: "c.txt", data: new TextEncoder().encode("x") }]);
  assert.deepEqual(zipNames(z), ["a/b.txt", "c.txt"]);
  assert.equal(new TextDecoder().decode(zipRead(z, "a/b.txt")!), "hello");
  // Deterministic: the same input gives the same bytes.
  assert.deepEqual(zipStore([{ name: "a", data: "1" }]), zipStore([{ name: "a", data: "1" }]));
});

test("the limiter: a burst past the per-address capacity answers 429 with Retry-After, and another address is unaffected", async () => {
  const ip = { "x-forwarded-for": "203.0.113.9" };
  let last: Response | null = null;
  for (let i = 0; i <= PUBLIC_API_LIMITS.ip.capacity; i++) last = await glossaryRoute.GET(get("/api/v1/glossary")); // the static route isn't limited
  assert.equal(last!.status, 200);
  for (let i = 0; i < PUBLIC_API_LIMITS.ip.capacity; i++) await compare.GET(get("/api/v1/compare?ids=1", ip));
  const limited = await compare.GET(get("/api/v1/compare?ids=1", ip));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) >= 1);
  assert.equal((await compare.GET(get("/api/v1/compare?ids=1", { "x-forwarded-for": "203.0.113.10" }))).status, 400);
});
