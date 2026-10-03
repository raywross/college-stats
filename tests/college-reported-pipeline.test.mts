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
import { circuitBreaker, createPipeline, fatalApiError } from "../scripts/lib/college-reported/pipeline.mts";
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

type Body = Anthropic.MessageCreateParamsNonStreaming;
/**
 * A fake client: extraction calls (`create`) answer with `extraction(body)`; discovery calls (`stream` →
 * `finalMessage()`, as with the real SDK) save `recipe(model)`. `calls` records every request in order; `streamed`
 * the streamed ones.
 */
function fakeClient(opts: { extraction?: (body: Body) => Partial<Extraction>; recipe?: (model: string) => Omit<Recipe, "unit_id" | "learned" | "model"> }) {
  const calls: Body[] = [];
  const streamed: Body[] = [];
  const answer = (body: Body) => {
    if (body.tools?.some((t) => "name" in t && t.name === "save_recipe")) {
      const r = opts.recipe?.(body.model) ?? { sources: [], index_urls: [] };
      const input = { sources: r.sources.map((s) => ({ kind: s.kind, url: s.url, format: s.format })), index_urls: r.index_urls, none_found: !!r.none_found, notes: "" };
      return message(body.model, [{ type: "tool_use", id: "t1", name: "save_recipe", input }], "tool_use");
    }
    if (!opts.extraction) throw new Error("unexpected extraction call");
    return message(body.model, [{ type: "text", text: JSON.stringify(opts.extraction(body)), citations: null }]);
  };
  const client: ModelClient = {
    messages: {
      async create(body) {
        calls.push(body);
        return answer(body);
      },
      stream(body) {
        calls.push(body as Body);
        streamed.push(body as Body);
        return { finalMessage: async () => answer(body as Body) };
      },
    },
  };
  return { client, calls, streamed };
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

test("figures that fail a check are re-read once by the stronger model from the same document, then queued; no discovery", async () => {
  const url = "https://c166027.edu/class-profile";
  // The stated rate (8%) doesn't match admitted / applicants (4.1%).
  const bad = { ...FALL_2026, acceptance_rate: 0.08, quotes: { ...FALL_2026.quotes, acceptance_rate: "an admit rate of 8%" } };
  const { client, calls, streamed } = fakeClient({ extraction: () => bad, recipe: () => ({ sources: [{ kind: "class-profile", url, format: "html" }], index_urls: [] }) });
  const { fn, calls: requests } = fakeFetch({ [url]: "<p>Class of 2030: 48,000 applied, we admitted 1,950, an admit rate of 8%</p>" });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [recipe("166027", [{ kind: "class-profile", url, format: "html" }])] }, run: "r" });
  assert.deepEqual(calls.map((c) => c.model), ["claude-haiku-4-5", "claude-sonnet-5"], "Haiku, then one Sonnet re-read; Opus is never called");
  assert.equal(streamed.length, 0, "no discovery: better links can't fix a misread");
  assert.equal(textOf(calls[1]), textOf(calls[0]), "the same document text");
  assert.equal(requests.filter((r) => r.url === url).length, 1, "re-read from the cached copy, not fetched again");
  assert.equal(out.reported.entries.length, 0);
  assert.equal(out.queue.items.length, 1);
  const item = out.queue.items[0];
  assert.deepEqual(item.urls, [url]);
  assert.ok(item.failures.some((f) => f.check === "rate-matches"));
  assert.equal(item.run, "r");
  assert.equal(out.summary.failed, 1);
  assert.equal(out.summary.escalated, 1);
  assert.equal(out.summary.discovered, 0);
  assert.equal(out.summary.usage.extraction.calls, 1);
  assert.equal(out.summary.usage.escalation.calls, 1);
  assert.equal(out.summary.usage.escalation.cost_usd, (1000 * 2 + 100 * 10) / 1e6, "priced as Sonnet 5");
  assert.equal(out.summary.tripped !== null, true, "1 of 1 failed is past the 10% limit");
});

test("a document without its anchor gets one re-discovery (effort medium), then the new link is read", async () => {
  const old = "https://c166027.edu/news/old-story";
  const fresh = "https://c166027.edu/admissions/class-of-2030";
  const { client, calls, streamed } = fakeClient({ extraction: () => FALL_2026, recipe: () => ({ sources: [{ kind: "class-profile", url: fresh, format: "html" }], index_urls: [] }) });
  const { fn } = fakeFetch({ [old]: "<p>A story about campus dining</p>", [fresh]: "<h1>Class of 2030</h1><p>48,000 students applied</p>" });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [recipe("166027", [{ kind: "class-profile", url: old, format: "html" }])] }, run: "r" });
  assert.equal(streamed.length, 1);
  assert.deepEqual(streamed[0].output_config, { effort: "medium" });
  assert.deepEqual(calls.map((c) => c.model), ["claude-sonnet-5", "claude-haiku-4-5"], "no extraction of a page without the anchor");
  assert.equal(out.reported.entries[0].lineage["reported.admissions.applicants"]?.url, fresh);
  assert.equal(out.summary.escalated, 1);
  assert.equal(out.summary.discovered, 1);
});

test("a college none of whose sources can be fetched is queued as unreachable: no model call, not a failure", async () => {
  const cds = "https://c166027.edu/ir/CDS_2025-2026.pdf";
  const profile = "https://c166027.edu/admissions/profile";
  const { client, calls } = fakeClient({ extraction: () => FALL_2026, recipe: () => ({ sources: [], index_urls: [], none_found: true }) });
  const { fn } = fakeFetch({ [cds]: () => new Response("Forbidden", { status: 403 }), [profile]: () => new Response("Method Not Allowed", { status: 405 }) });
  const sources: SourcesFile = { updated: "", recipes: [recipe("166027", [{ kind: "cds", url: cds, format: "pdf" }, { kind: "class-profile", url: profile, format: "html" }])] };
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources, run: "r" });
  assert.equal(calls.length, 0, "no model can fix a blocked site");
  assert.equal(out.queue.items.length, 1);
  const item = out.queue.items[0];
  assert.deepEqual(item.failures.map((f) => f.check), ["unreachable", "unreachable"]);
  assert.match(item.failures[0].detail, /HTTP 403 at https:\/\/c166027\.edu\/ir\/CDS_2025-2026\.pdf/);
  assert.match(item.failures[1].detail, /HTTP 405/);
  assert.deepEqual(item.urls, [cds, profile]);
  assert.equal(out.summary.unreachable, 1);
  assert.equal(out.summary.failed, 0, "not a check failure");
  assert.equal(out.summary.escalated, 0);
  assert.equal(out.summary.attempted, 1);
  assert.equal(out.summary.tripped, null, "a blocked site can't trip the breaker");
});

test("a value without a quote containing it never publishes", async () => {
  const url = "https://c166027.edu/class-profile";
  const noQuote = { ...FALL_2026, quotes: { ...FALL_2026.quotes, applicants: "a record number applied" } };
  const { client } = fakeClient({ extraction: () => noQuote, recipe: () => ({ sources: [], index_urls: [], none_found: true }) });
  const { fn } = fakeFetch({ [url]: "<p>A record number applied</p>" });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [recipe("166027", [{ kind: "class-profile", url, format: "html" }])] }, run: "r" });
  assert.equal(out.reported.entries.length, 0);
  assert.ok(out.queue.items[0].failures.some((f) => f.check === "quote-present"));
});

test("figures no newer than the federal year are neither published nor queued", async () => {
  const url = "https://c166027.edu/class-profile";
  const { client, calls } = fakeClient({ extraction: () => ({ ...FALL_2026, entering_term: "Fall 2024" }) });
  const { fn } = fakeFetch({ [url]: "<p>54,008 applied</p>" });
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
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [recipe("166027", [{ kind: "class-profile", url, format: "html" }])] }, run: "r" });
  assert.equal(calls.length, 0);
  assert.ok(!requests.some((r) => r.url === url));
  assert.match(out.queue.items[0].failures[0].detail, /robots\.txt disallows/);
  assert.equal(out.summary.unreachable, 1);
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
  const { fn } = fakeFetch({ [xlsxUrl]: XLSX, [sameUrl]: () => new Response(null, { status: 304 }), [badUrl]: "<p>c applied</p>", [fixUrl]: "<p>d applied</p>" });
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
  assert.equal(s.documents_read, 4, "three documents, and c.edu's read again by the stronger model");
  assert.equal(s.published, 2);
  assert.equal(s.changed, 3);
  assert.equal(s.failed, 1);
  assert.equal(s.escalated, 1);
  assert.equal(s.discovered, 0, "a failed check is re-read, not re-discovered");
  assert.equal(s.unreachable, 0);
  assert.equal(s.guessed, 0);
  assert.match(s.tripped!, /1 of 3 attempted/);
  assert.match(s.tripped!, /3 of 4 published values changed/);
  // Haiku reads c.edu and d.edu ($1/$5 per MTok); the Excel file needs no model. c.edu fails a check, so Sonnet
  // ($2/$10) re-reads it once.
  assert.equal(s.usage.extraction.calls, 2);
  assert.equal(s.usage.escalation.calls, 1);
  assert.equal(s.usage.discovery.calls, 0);
  assert.equal(s.usage.extraction.cost_usd, 2 * (1000 * 1 + 100 * 5) / 1e6);
  assert.equal(s.usage.escalation.cost_usd, (1000 * 2 + 100 * 10) / 1e6);
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
  // The pilot's two real misreads (2026-10-03): an upload-date folder before the edition made these "Fall 2026".
  assert.equal(entryYearOf("https://irp.cornell.edu/wp-content/uploads/2026/09/CDS-Cornell-2025-2026-v2.xlsx"), 2025);
  assert.equal(entryYearOf("https://cdn.vanderbilt.edu/vu-wpfsx/wp-content/uploads/sites/70/2026/07/CDS_2025-2026.xlsx"), 2025);
  assert.equal(entryYearOf("https://ir.example.edu/files/2026-04/cds-pdf-2025-2026-final.pdf"), 2025);
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

/* ------------------------------------------------------------------ */
/* Written as it goes; stops cleanly when the API budget runs out      */
/* ------------------------------------------------------------------ */

const PROFILE_HTML = "<h1>Class of 2030</h1><p>48,000 students applied and we admitted 1,950; 1,660 enrolled, an admit rate of 4.1%.</p>";
/** Three colleges with stored class-profile recipes (no discovery), processed one at a time. */
function threeColleges() {
  const ids = ["1", "2", "3"];
  const routes = Object.fromEntries(ids.map((id) => [`https://c${id}.edu/class-profile`, PROFILE_HTML]));
  const recipes = ids.map((id) => recipe(id, [{ kind: "class-profile", url: `https://c${id}.edu/class-profile`, format: "html" }]));
  return { routes, sources: { updated: "", recipes } as SourcesFile, schools: ids.map((id) => school(id)) };
}
const progressDeps = (client: ModelClient, fetch: typeof globalThis.fetch, onProgress: Parameters<typeof createPipeline>[0]["onProgress"]) => ({
  client,
  fetch,
  now: () => new Date("2026-10-02T12:00:00Z"),
  sleep: async () => {},
  minDelayMs: 0,
  cacheDir: mkdtempSync(join(tmpdir(), "college-docs-")),
  log: () => {},
  concurrency: 1,
  onProgress,
});

test("a snapshot of the files is handed over after every college, marked running, so a run that dies keeps its work", async () => {
  const { routes, sources, schools } = threeColleges();
  const { client } = fakeClient({ extraction: () => FALL_2026 });
  const snaps: unknown[] = [];
  const p = createPipeline(progressDeps(client, fakeFetch(routes).fn, (s) => snaps.push([s.summary.done, s.summary.status, s.summary.finished, s.reported.entries.length])));
  const out = await p.run({ ...empty(), sources, schools, run: "r1" });
  assert.deepEqual(snaps, [
    [1, "running", null, 1],
    [2, "running", null, 2],
    [3, "running", null, 3],
  ]);
  assert.equal(out.summary.status, "finished");
  assert.equal(out.summary.done, 3);
  assert.equal(out.summary.total, 3);
  assert.ok(out.summary.finished);
});

test("a spend-limit error stops the run: finished colleges are kept, the one in flight records nothing, the rest never start", async () => {
  const { routes, sources, schools } = threeColleges();
  const fetch = fakeFetch(routes);
  let calls = 0;
  const client: ModelClient = {
    messages: {
      async create(body) {
        calls++;
        if (calls === 2) throw Object.assign(new Error("You have reached your specified API usage limits. You will regain access on 2026-11-01."), { status: 400 });
        return message(body.model, [{ type: "text", text: JSON.stringify(FALL_2026), citations: null }]);
      },
      stream() {
        throw new Error("unexpected discovery");
      },
    },
  };
  const snaps: unknown[] = [];
  const out = await createPipeline(progressDeps(client, fetch.fn, (s) => snaps.push(s.summary.done))).run({ ...empty(), sources, schools, run: "r1" });
  assert.equal(out.summary.status, "stopped");
  assert.match(out.summary.stopped_reason ?? "", /spend limit or credit balance/);
  assert.equal(out.summary.done, 1);
  assert.deepEqual(snaps, [1], "a snapshot after the first college only");
  assert.deepEqual(out.reported.entries.map((e) => e.unit_id), ["1"], "the first college is published");
  assert.deepEqual(out.queue.items, [], "the college cut off by the error is not sent to review");
  assert.equal(out.summary.failed, 0);
  const second = out.sources.recipes.find((r) => r.unit_id === "2")!;
  assert.equal(second.sources[0].sha256, undefined, "the interrupted college's document isn't marked read, so the next run reads it");
  assert.ok(!fetch.calls.some((c) => c.url.startsWith("https://c3.edu/")), "the third college never starts");
  assert.equal(calls, 2, "no model call after the stop");
});

test("only errors that would fail every later call stop a run", () => {
  assert.match(fatalApiError({ status: 401, message: "invalid x-api-key" }) ?? "", /key was refused/);
  assert.match(fatalApiError({ status: 403, message: "forbidden" }) ?? "", /key was refused/);
  assert.match(fatalApiError({ status: 400, message: "Your credit balance is too low to access the Anthropic API." }) ?? "", /credit balance/);
  assert.match(fatalApiError({ status: 429, message: "You have reached your specified API usage limits." }) ?? "", /spend limit/);
  assert.equal(fatalApiError({ status: 429, message: "Number of request tokens has exceeded your per-minute rate limit" }), null, "a rate limit is retried, not fatal");
  assert.equal(fatalApiError({ status: 400, message: "max_tokens: must be at most 64000" }), null);
  assert.equal(fatalApiError({ status: 529, message: "Overloaded" }), null);
  assert.equal(fatalApiError(new Error("fetch failed")), null);
});

/* ------------------------------------------------------------------ */
/* Round 2: links-only discovery, guessed URLs, the cost cap           */
/* ------------------------------------------------------------------ */

test("discovery streams, finds links only (capped web fetch, a few searches, no document), and its recipe is read", async () => {
  const url = "https://c166027.edu/admissions/class-of-2030";
  const { client, calls, streamed } = fakeClient({ extraction: () => FALL_2026, recipe: () => ({ sources: [{ kind: "class-profile", url, format: "html" }], index_urls: ["https://c166027.edu/admissions/profiles"] }) });
  const { fn } = fakeFetch({ [url]: PROFILE_HTML });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [school()], run: "r" });
  assert.equal(streamed.length, 1, "discovery goes through stream → finalMessage");
  assert.deepEqual(calls.map((c) => c.model), ["claude-sonnet-5", "claude-haiku-4-5"]);
  const d = streamed[0];
  const tool = (type: string) => d.tools?.find((t) => "type" in t && t.type === type) as Record<string, unknown> | undefined;
  assert.deepEqual(tool("web_search_20260209"), { type: "web_search_20260209", name: "web_search", max_uses: 4 });
  assert.deepEqual(tool("web_fetch_20260209"), { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, max_content_tokens: 6000 });
  assert.deepEqual(d.output_config, { effort: "low" });
  assert.match(String(d.system), /Never open a PDF or Excel file/);
  assert.doesNotMatch(JSON.stringify(d.messages), /"type":"document"/, "discovery is never sent a document");
  const recipeTool = d.tools?.find((t) => "name" in t && t.name === "save_recipe") as Anthropic.Tool;
  assert.deepEqual((recipeTool.input_schema.properties as { sources: { items: { required: string[] } } }).sources.items.required, ["kind", "url", "format"], "no pages or anchor");
  const last = d.messages[d.messages.length - 1].content as Anthropic.TextBlockParam[];
  assert.deepEqual(last[last.length - 1].cache_control, { type: "ephemeral" });
  const saved = out.sources.recipes[0];
  assert.equal(saved.model, "claude-sonnet-5");
  assert.deepEqual(Object.keys(saved.sources[0]).filter((k) => k === "pages" || k === "anchor"), []);
  assert.equal(out.reported.entries[0].lineage["reported.admissions.applicants"]?.url, url, "the default anchor finds the figures");
  assert.equal(out.summary.discovered, 1);
});

test("a paused discovery turn is resumed with the cache breakpoint moved to the newest block", async () => {
  const bodies: Body[] = [];
  const client: ModelClient = {
    messages: {
      async create() {
        throw new Error("unexpected extraction");
      },
      stream(body) {
        bodies.push(structuredClone(body) as Body);
        const done = bodies.length > 1;
        const content = done
          ? [{ type: "tool_use", id: "t1", name: "save_recipe", input: { sources: [], index_urls: [], none_found: true, notes: "" } }]
          : [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "common data set" } }];
        return { finalMessage: async () => message(body.model, content, done ? "tool_use" : "pause_turn") };
      },
    },
  };
  const out = await pipeline(client, fakeFetch({}).fn).run({ ...empty(), schools: [school()], run: "r" });
  assert.equal(bodies.length, 2);
  const [first, second] = bodies.map((b) => b.messages);
  assert.equal(second.length, 2, "the paused assistant turn is sent back, with no extra user message");
  assert.equal((first[0].content as Anthropic.TextBlockParam[])[0].cache_control?.type, "ephemeral");
  assert.equal((second[0].content as Anthropic.TextBlockParam[])[0].cache_control, undefined, "one breakpoint, on the last block only");
  assert.deepEqual((second[1].content as Anthropic.ServerToolUseBlockParam[])[0].cache_control, { type: "ephemeral" });
  assert.equal(out.sources.recipes[0].none_found, true);
});

test("a guessed next-edition CDS URL that exists becomes the recipe: no discovery, no model call", async () => {
  const known = "https://c166027.edu/ir/CDS_2024-2025.xlsx";
  const next = "https://c166027.edu/ir/CDS_2025-2026.xlsx";
  const s = school();
  s.cds = { edition: "2024-25", url: known };
  const { client, calls } = fakeClient({
    recipe: () => {
      throw new Error("no discovery expected");
    },
  });
  const { fn, calls: requests } = fakeFetch({ [next]: () => new Response(XLSX, { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }) });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [s], run: "r" });
  assert.equal(calls.length, 0);
  assert.equal(out.summary.guessed, 1);
  assert.equal(out.summary.discovered, 0);
  assert.ok(requests.some((r) => r.url === "https://c166027.edu/ir/CDS_2026-2027.xlsx"), "two editions ahead is tried first");
  assert.equal(requests.filter((r) => r.url === next).length, 1, "the guessed file is downloaded once");
  const r = out.sources.recipes[0];
  assert.equal(r.model, "guessed");
  assert.equal(r.learned, "2026-10-02");
  assert.deepEqual(r.sources.map((x) => [x.kind, x.url, x.format]), [["cds", next, "xlsx"]]);
  assert.equal(out.reported.entries[0].admissions.entering_term, "Fall 2025");
});

test("a guess that answers with an HTML page is not a document: discovery runs", async () => {
  const s = school();
  s.cds = { edition: "2024-25", url: "https://c166027.edu/ir/CDS_2024-2025.pdf" };
  const { client, streamed } = fakeClient({ recipe: () => ({ sources: [], index_urls: [], none_found: true }) });
  const { fn } = fakeFetch({ "https://c166027.edu/ir/CDS_2025-2026.pdf": "<html>Page not found</html>" });
  const out = await pipeline(client, fn).run({ ...empty(), schools: [s], run: "r" });
  assert.equal(out.summary.guessed, 0);
  assert.equal(streamed.length, 1);
});

test("the cost cap stops the run before the next college: finished colleges kept, status stopped", async () => {
  const { routes, sources, schools } = threeColleges();
  const { client, calls } = fakeClient({ extraction: () => FALL_2026 });
  const snaps: unknown[] = [];
  // One Haiku extraction is logged at $0.0015; the next college needs $0.0015 + the $0.50 allowance under the cap.
  const out = await createPipeline(progressDeps(client, fakeFetch(routes).fn, (s) => snaps.push(s.summary.done))).run({ ...empty(), sources, schools, run: "r1", maxCost: 0.501 });
  assert.equal(out.summary.status, "stopped");
  assert.equal(out.summary.stopped_reason, "the run's cost cap of $0.501 was reached");
  assert.equal(out.summary.done, 1);
  assert.deepEqual(snaps, [1]);
  assert.deepEqual(out.reported.entries.map((e) => e.unit_id), ["1"]);
  assert.equal(calls.length, 1);
  const again = threeColleges();
  const open = await createPipeline(progressDeps(fakeClient({ extraction: () => FALL_2026 }).client, fakeFetch(again.routes).fn, undefined)).run({ ...empty(), sources: again.sources, schools: again.schools, run: "r2", maxCost: 25 });
  assert.equal(open.summary.status, "finished", "a cap the run doesn't reach changes nothing");
  assert.equal(open.summary.done, 3);
});
