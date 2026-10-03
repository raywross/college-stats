/**
 * The college-reported pipeline (scripts/lib/college-reported/) against a fake Anthropic client and a fake fetch:
 * no network, no API key. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { Extraction, Recipe, ReportedEntry, ReportedFile, SourcesFile } from "../lib/reported.ts";
import type { DatasetMeta, School } from "../lib/types";
import { validateSchool } from "../lib/lineage.ts";
import { reportedToPatch } from "../lib/reported-checks.ts";
import { readC1, readWorkbook, workbookEdition } from "../scripts/lib/cds-xlsx.mts";
import { circuitBreaker, createPipeline } from "../scripts/lib/college-reported/pipeline.mts";
import { entryYearOf, htmlToText, newSourcesFromIndex } from "../scripts/lib/college-reported/documents.mts";
import { parseRobots, robotsAllows, sha256 } from "../scripts/lib/college-reported/http.mts";
import { linesJson } from "../scripts/lib/college-reported/files.mts";
import { pickPilot } from "../scripts/lib/college-reported/pilot.mts";
import type { ModelClient } from "../scripts/lib/college-reported/models.mts";

const ROOT = join(import.meta.dirname, "..");
const META: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const FIXTURES = join(import.meta.dirname, "fixtures");
const XLSX = readFileSync(join(FIXTURES, "cds-c1.xlsx"));
const PDF = readFileSync(join(FIXTURES, "cds-c1.pdf"));

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

function school(id = "166027", over: Partial<School["admissions"]> = {}): School {
  return {
    unit_id: id,
    name: `College ${id}`,
    location: { city: "Cambridge", state: "MA", zip: "02138", region: "New England" },
    type: "private-nonprofit",
    admissions: { year: 2024, applicants: 54008, admitted: 1970, enrolled: 1647, acceptance_rate: 0.0365, ...over },
    links: { website: `https://c${id}.edu`, price_calculator: null },
  } as unknown as School;
}

type Handler = (init: RequestInit | undefined) => Response;
/** fetch over a table of URL → handler; robots.txt is 404 unless given. Records every request. */
function fakeFetch(routes: Record<string, Handler | Uint8Array | string>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const r = routes[url];
    if (r === undefined) return new Response("not found", { status: 404 });
    if (typeof r === "function") return r(init);
    return new Response(r as BodyInit, { status: 200 });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

const usage = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null };
const message = (model: string, content: unknown[], stop_reason = "end_turn") =>
  ({ id: "msg", type: "message", role: "assistant", model, content, stop_reason, stop_sequence: null, usage }) as unknown as Anthropic.Message;

/** A fake client: extraction calls answer with `extraction(body)`; discovery calls save `recipe(model)`. */
function fakeClient(opts: { extraction?: (body: Anthropic.MessageCreateParamsNonStreaming) => Partial<Extraction>; recipe?: (model: string) => Omit<Recipe, "unit_id" | "learned" | "model"> }) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = {
    messages: {
      async create(body) {
        calls.push(body);
        if (body.tools?.some((t) => "name" in t && t.name === "save_recipe")) {
          const r = opts.recipe?.(body.model) ?? { sources: [], index_urls: [] };
          const input = { sources: r.sources.map((s) => ({ kind: s.kind, url: s.url, format: s.format, pages: s.pages ?? null, anchor: s.anchor ?? null })), index_urls: r.index_urls, none_found: !!r.none_found, notes: "" };
          return message(body.model, [{ type: "tool_use", id: "t1", name: "save_recipe", input }], "tool_use");
        }
        if (!opts.extraction) throw new Error("unexpected extraction call");
        return message(body.model, [{ type: "text", text: JSON.stringify(opts.extraction(body)), citations: null }]);
      },
    },
  };
  return { client, calls };
}

function pipeline(client: ModelClient, fetch: typeof globalThis.fetch) {
  return createPipeline({ client, fetch, now: () => new Date("2026-10-02T12:00:00Z"), sleep: async () => {}, minDelayMs: 0, cacheDir: mkdtempSync(join(tmpdir(), "college-docs-")), log: () => {} });
}

const empty = () => ({ sources: { updated: "", recipes: [] } as SourcesFile, reported: { updated: "", entries: [] } as ReportedFile, queue: { updated: "", items: [] } });
const recipe = (id: string, sources: Recipe["sources"], index_urls: string[] = []): Recipe => ({ unit_id: id, sources, index_urls, learned: "2026-09-01", model: "claude-sonnet-5" });
const textOf = (body: Anthropic.MessageCreateParamsNonStreaming) => JSON.stringify(body.messages);

const FALL_2026: Partial<Extraction> = {
  cohort: "first-year",
  scope: "all-rounds",
  entering_term: "Fall 2026",
  applicants: 48000,
  admitted: 1950,
  enrolled: 1660,
  acceptance_rate: 0.041,
  quotes: { applicants: "48,000 students applied", admitted: "we admitted 1,950", enrolled: "1,660 enrolled", acceptance_rate: "an admit rate of 4.1%" },
  page: null,
};

/* ------------------------------------------------------------------ */
/* Excel CDS: deterministic                                            */
/* ------------------------------------------------------------------ */

test("an Excel CDS is read deterministically: C1 totals, edition, and quotes, with no model call", async () => {
  const book = readWorkbook(join(FIXTURES, "cds-c1.xlsx"));
  assert.deepEqual(readC1(book), { applicants: 45409, admitted: 2045, enrolled: 1690, warnings: [] });
  assert.equal(workbookEdition(book), "2025-26");

  // The real Harvard record (federal fall 2024), so the published entry can be run through the lineage guard.
  const harvard = (JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[]).find((s) => s.unit_id === "166027")!;
  assert.equal(harvard.admissions.year, 2024);
  const url = "https://c166027.edu/ir/CDS_2025-26.xlsx";
  const { client, calls } = fakeClient({});
  const { fn } = fakeFetch({ [url]: XLSX });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [structuredClone(harvard)], sources: { updated: "", recipes: [recipe("166027", [{ kind: "cds", url, format: "xlsx" }])] }, run: "r1" });
  assert.equal(calls.length, 0);
  const entry = out.reported.entries[0];
  assert.deepEqual(entry.admissions, { entering_term: "Fall 2025", year: 2025, applicants: 45409, admitted: 2045, enrolled: 1690, acceptance_rate: 2045 / 45409, source_kind: "cds" });
  assert.equal(entry.lineage["reported.admissions.applicants"]?.quote, "C1 Total first-time, first-year students who applied: 45,409");
  assert.equal(entry.lineage["reported.admissions.applicants"]?.url, url);
  const merged = structuredClone(harvard);
  const { reported, lineage } = reportedToPatch(entry);
  merged.reported = reported;
  merged.lineage = { ...(merged.lineage ?? {}), ...lineage };
  assert.deepEqual(validateSchool(merged, META), [], "what the pipeline publishes passes the lineage guard once merged");
  const src = out.sources.recipes[0].sources[0];
  assert.equal(src.sha256, sha256(XLSX));
  assert.equal(src.processed, "2026-10-02");
  assert.equal(out.summary.documents_read, 1);
});

/* ------------------------------------------------------------------ */
/* Never re-read unchanged documents                                   */
/* ------------------------------------------------------------------ */

test("an unchanged hash skips the model and publishes nothing new", async () => {
  const url = "https://c166027.edu/class-profile";
  const html = "<h1>Class of 2030</h1><p>48,000 students applied</p>";
  const { client, calls } = fakeClient({ extraction: () => FALL_2026 });
  const { fn } = fakeFetch({ [url]: () => new Response(html, { status: 200, headers: { etag: '"v2"' } }) });
  const stored = recipe("166027", [{ kind: "class-profile", url, format: "html", sha256: sha256(new TextEncoder().encode(html)), etag: '"v1"', processed: "2026-09-01", extraction: FALL_2026 as Extraction }]);
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [stored] }, run: "r" });
  assert.equal(calls.length, 0);
  assert.equal(out.summary.documents_read, 0);
  assert.equal(out.summary.attempted, 0);
  assert.equal(out.reported.entries.length, 0);
  assert.equal(out.sources.recipes[0].sources[0].etag, '"v2"', "new validators are kept for the next conditional GET");
  assert.equal(out.sources.recipes[0].sources[0].processed, "2026-09-01", "processed date stays the last real read");
});

test("a 304 skips the model; the conditional headers are sent", async () => {
  const url = "https://c166027.edu/ir/CDS_2025-26.pdf";
  const { client, calls } = fakeClient({ extraction: () => FALL_2026 });
  const { fn, calls: requests } = fakeFetch({ [url]: (init) => new Response(null, { status: (init?.headers as Record<string, string>)["If-None-Match"] === '"abc"' ? 304 : 200 }) });
  const stored = recipe("166027", [{ kind: "cds", url, format: "pdf", sha256: "x", etag: '"abc"', last_modified: "Tue, 01 Sep 2026 00:00:00 GMT" }]);
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [stored] }, run: "r" });
  assert.equal(calls.length, 0);
  const req = requests.find((r) => r.url === url)!;
  assert.equal(req.headers["If-None-Match"], '"abc"');
  assert.equal(req.headers["If-Modified-Since"], "Tue, 01 Sep 2026 00:00:00 GMT");
  assert.equal(out.summary.documents_read, 0);
});

test("a new link on an index page becomes a source and only that file is read", async () => {
  const index = "https://c166027.edu/admissions/profiles";
  const old = "https://c166027.edu/admissions/class-of-2029";
  const fresh = "https://c166027.edu/admissions/class-of-2030";
  const oldHtml = "<p>Class of 2029</p>";
  const { client, calls } = fakeClient({ extraction: () => FALL_2026 });
  const { fn } = fakeFetch({
    [index]: `<ul><li><a href="/admissions/class-of-2029">Class of 2029 profile</a></li><li><a href="/admissions/class-of-2030">Class of 2030 profile</a></li><li><a href="/about">About</a></li></ul>`,
    [old]: oldHtml,
    [fresh]: "<h2>Class of 2030</h2><p>48,000 students applied and we admitted 1,950, an admit rate of 4.1%. 1,660 enrolled.</p>",
  });
  const stored = recipe("166027", [{ kind: "class-profile", url: old, format: "html", sha256: sha256(new TextEncoder().encode(oldHtml)), extraction: null }], [index]);
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [stored] }, run: "r" });
  assert.equal(calls.length, 1, "one extraction, for the new file");
  assert.equal(calls[0].model, "claude-haiku-4-5");
  assert.match(textOf(calls[0]), /class-of-2030/);
  assert.match(textOf(calls[0]), /admit rate of 4\.1%/);
  assert.deepEqual(out.sources.recipes[0].sources.map((s) => s.url), [old, fresh]);
  assert.equal(out.reported.entries[0].admissions.entering_term, "Fall 2026");
  assert.equal(out.reported.entries[0].lineage["reported.admissions.admitted"]?.url, fresh);
  // Structured outputs with the fixed schema, and the stable system prompt marked for caching.
  assert.equal((calls[0].output_config?.format as { type: string }).type, "json_schema");
  assert.deepEqual((calls[0].system as Anthropic.TextBlockParam[])[0].cache_control, { type: "ephemeral" });
});

test("a PDF sends its page text to the extraction model", async () => {
  const url = "https://c166027.edu/ir/CDS_2025-26.pdf";
  const { client, calls } = fakeClient({
    extraction: () => ({ ...FALL_2026, entering_term: "Fall 2025", applicants: 45409, admitted: 2045, enrolled: 1690, acceptance_rate: null, quotes: { applicants: "who applied 45,409", admitted: "who were admitted 2,045", enrolled: "who enrolled 1,690" }, page: 2 }),
  });
  const { fn } = fakeFetch({ [url]: PDF });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [recipe("166027", [{ kind: "cds", url, format: "pdf", anchor: "C1" }])] }, run: "r" });
  assert.equal(calls.length, 1);
  assert.match(textOf(calls[0]), /--- Page 2 ---\\nC1 First-time, first-year students/);
  assert.equal(out.reported.entries[0].lineage["reported.admissions.applicants"]?.page, 2);
});

/* ------------------------------------------------------------------ */
/* Checks, escalation, the review queue                                */
/* ------------------------------------------------------------------ */

test("failed checks escalate (Sonnet rediscovery, then one Opus try), then go to the review queue; nothing publishes", async () => {
  const url = "https://c166027.edu/class-profile";
  const bad = { ...FALL_2026, admitted: 60000, acceptance_rate: null, quotes: { ...FALL_2026.quotes, admitted: "we admitted 60,000" } };
  const { client, calls } = fakeClient({ extraction: () => bad, recipe: () => ({ sources: [{ kind: "class-profile", url, format: "html" }], index_urls: [] }) });
  const { fn } = fakeFetch({ [url]: "<p>Class of 2030</p>" });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [recipe("166027", [{ kind: "class-profile", url, format: "html" }])] }, run: "r" });
  assert.deepEqual(calls.map((c) => c.model), ["claude-haiku-4-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-opus-5", "claude-opus-5"]);
  assert.equal(out.reported.entries.length, 0);
  assert.equal(out.queue.items.length, 1);
  const item = out.queue.items[0];
  assert.equal(item.unit_id, "166027");
  assert.deepEqual(item.urls, [url]);
  assert.ok(item.failures.some((f) => f.check === "funnel-order"));
  assert.equal(item.run, "r");
  assert.equal(out.summary.failed, 1);
  assert.equal(out.summary.escalated, 1);
  assert.equal(out.summary.discovered, 1);
  assert.equal(out.summary.usage.extraction.calls, 2);
  assert.equal(out.summary.usage.discovery.calls, 1);
  assert.equal(out.summary.usage.escalation.calls, 2);
  // Discovery uses the server web tools and a strict recipe tool.
  const disc = calls[1];
  assert.deepEqual(disc.tools?.map((t) => ("type" in t && t.type ? t.type : (t as Anthropic.Tool).name)), ["web_search_20260209", "web_fetch_20260209", "save_recipe"]);
  assert.equal(out.summary.tripped !== null, true, "1 of 1 failed is past the 10% limit");
});

test("a value without a quote containing it never publishes", async () => {
  const url = "https://c166027.edu/class-profile";
  const noQuote = { ...FALL_2026, quotes: { ...FALL_2026.quotes, applicants: "a record number applied" } };
  const { client } = fakeClient({ extraction: () => noQuote, recipe: () => ({ sources: [], index_urls: [], none_found: true }) });
  const { fn } = fakeFetch({ [url]: "<p>x</p>" });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [recipe("166027", [{ kind: "class-profile", url, format: "html" }])] }, run: "r" });
  assert.equal(out.reported.entries.length, 0);
  assert.ok(out.queue.items[0].failures.some((f) => f.check === "quote-present"));
});

test("figures no newer than the federal year are neither published nor queued", async () => {
  const url = "https://c166027.edu/class-profile";
  const { client, calls } = fakeClient({ extraction: () => ({ ...FALL_2026, entering_term: "Fall 2024" }) });
  const { fn } = fakeFetch({ [url]: "<p>x</p>" });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [recipe("166027", [{ kind: "class-profile", url, format: "html" }])] }, run: "r" });
  assert.equal(calls.length, 1, "no escalation");
  assert.equal(out.reported.entries.length + out.queue.items.length, 0);
  assert.equal(out.summary.attempted, 1);
  assert.equal(out.summary.failed, 0);
});

test("robots.txt disallow is obeyed: the document is never requested", async () => {
  const url = "https://c166027.edu/private/class-profile";
  const { client, calls } = fakeClient({ extraction: () => FALL_2026 });
  const { fn, calls: requests } = fakeFetch({ "https://c166027.edu/robots.txt": "User-agent: *\nDisallow: /private/\n", [url]: "<p>x</p>" });
  await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [recipe("166027", [{ kind: "class-profile", url, format: "html" }])] }, run: "r" });
  assert.equal(calls.length, 0);
  assert.ok(!requests.some((r) => r.url === url));
});

/* ------------------------------------------------------------------ */
/* Circuit breaker and the run summary                                 */
/* ------------------------------------------------------------------ */

test("the circuit breaker trips just past its limits", () => {
  assert.equal(circuitBreaker({ attempted: 10, failed: 1, changed: 0, priorValues: 0 }), null, "10% is at the limit");
  assert.match(circuitBreaker({ attempted: 10, failed: 2, changed: 0, priorValues: 0 })!, /2 of 10 attempted/);
  assert.equal(circuitBreaker({ attempted: 0, failed: 0, changed: 25, priorValues: 100 }), null, "25% is at the limit");
  assert.match(circuitBreaker({ attempted: 0, failed: 0, changed: 26, priorValues: 100 })!, /26 of 100 published values/);
  assert.equal(circuitBreaker({ attempted: 0, failed: 0, changed: 0, priorValues: 0 }), null);
});

test("the run summary counts attempts, reads, publishes, changes, failures, and cost", async () => {
  const xlsxUrl = "https://a.edu/CDS_2025-26.xlsx";
  const sameUrl = "https://b.edu/profile";
  const badUrl = "https://c.edu/profile";
  const fixUrl = "https://d.edu/profile";
  const { client } = fakeClient({
    extraction: (body) => (textOf(body).includes("c.edu") ? { ...FALL_2026, enrolled: 9999, quotes: { ...FALL_2026.quotes, enrolled: "9,999 enrolled" } } : FALL_2026),
    recipe: () => ({ sources: [], index_urls: [], none_found: true }),
  });
  const { fn } = fakeFetch({ [xlsxUrl]: XLSX, [sameUrl]: () => new Response(null, { status: 304 }), [badUrl]: "<p>c</p>", [fixUrl]: "<p>d</p>" });
  // d.edu had Fall 2026 published with different numbers: a same-term change of 3 values.
  const prior: ReportedEntry = { unit_id: "4", admissions: { entering_term: "Fall 2026", year: 2026, applicants: 47000, admitted: 1900, enrolled: 1660, acceptance_rate: 0.04, source_kind: "class-profile" }, lineage: {}, run: "old" };
  const sources: SourcesFile = {
    updated: "",
    recipes: [
      recipe("1", [{ kind: "cds", url: xlsxUrl, format: "xlsx" }]),
      recipe("2", [{ kind: "class-profile", url: sameUrl, format: "html", sha256: "h", etag: '"e"' }]),
      recipe("3", [{ kind: "class-profile", url: badUrl, format: "html" }]),
      recipe("4", [{ kind: "class-profile", url: fixUrl, format: "html" }]),
    ],
  };
  const out = await pipeline(client, fn).run({ ...empty(), schools: ["1", "2", "3", "4"].map((id) => school(id)), sources, reported: { updated: "", entries: [prior] }, run: "sum" });
  const s = out.summary;
  assert.equal(s.attempted, 3, "the 304 college isn't an attempt");
  assert.equal(s.documents_read, 3);
  assert.equal(s.published, 2);
  assert.equal(s.changed, 3);
  assert.equal(s.failed, 1);
  assert.equal(s.escalated, 1);
  assert.equal(s.discovered, 1);
  assert.match(s.tripped!, /1 of 3 attempted/);
  assert.match(s.tripped!, /3 of 4 published values changed/);
  // Haiku reads c.edu and d.edu ($1/$5 per MTok); the Excel file needs no model. c.edu's rediscovery (Sonnet) and
  // Opus try both found nothing newer, so neither re-read it.
  assert.equal(s.usage.extraction.calls, 2);
  assert.equal(s.usage.escalation.calls, 1);
  assert.equal(s.usage.extraction.cost_usd, 2 * (1000 * 1 + 100 * 5) / 1e6);
  assert.equal(s.usage.discovery.cost_usd, (1000 * 2 + 100 * 10) / 1e6);
  assert.equal(s.run, "sum");
  assert.equal(s.started, "2026-10-02T12:00:00.000Z");
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

test("helpers: HTML text, years in links, robots rules, one-entry-per-line files, pilot pick", () => {
  assert.equal(htmlToText("<script>x()</script><h2>Class of 2030</h2><table><tr><td>Applied</td><td>48,000</td></tr></table>"), "## Class of 2030\nApplied | 48,000");
  assert.equal(entryYearOf("https://x.edu/CDS_2025-2026.pdf"), 2025);
  assert.equal(entryYearOf("Class of 2030 profile"), 2026);
  assert.equal(entryYearOf("https://x.edu/cds-2026-27.xlsx"), 2026);
  const found = newSourcesFromIndex('<a href="CDS_2024-25.pdf">2024-25</a><a href="CDS_2026-27.pdf">Common Data Set 2026-27</a>', "https://x.edu/ir/", [{ kind: "cds", url: "https://x.edu/ir/CDS_2025-26.pdf", format: "pdf", anchor: "C1" }]);
  assert.deepEqual(found, [{ kind: "cds", url: "https://x.edu/ir/CDS_2026-27.pdf", format: "pdf", anchor: "C1" }]);
  const robots = parseRobots("User-agent: *\nDisallow: /\nAllow: /admissions/\nCrawl-delay: 5\n\nUser-agent: OtherBot\nDisallow: /admissions/");
  assert.equal(robotsAllows(robots, "https://x.edu/admissions/profile"), true);
  assert.equal(robotsAllows(robots, "https://x.edu/ir/cds.pdf"), false);
  assert.equal(robots.crawlDelayMs, 5000);
  assert.equal(linesJson("2026-10-02", "items", [{ a: 1 }, { a: 2 }]), '{\n  "updated": "2026-10-02",\n  "items": [\n    {"a":1},\n    {"a":2}\n  ]\n}\n');
  const many = Array.from({ length: 300 }, (_, i) => school(String(100000 + i), { acceptance_rate: (i % 10) / 10 }));
  for (const [i, s] of many.entries()) (s as { type: string }).type = ["public", "private-nonprofit", "private-forprofit"][i % 3];
  const a = pickPilot(many);
  assert.equal(a.colleges.length, 50);
  assert.deepEqual(pickPilot(many), a, "deterministic");
  assert.equal(new Set(a.colleges.map((c) => `${c.tier}/${c.sector}`)).size, 12);
});
