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
import { mergeReported, stripReported } from "../lib/reported-merge.ts";
import { readC1, readWorkbook, workbookEdition } from "../scripts/lib/cds-xlsx.mts";
import { circuitBreaker, createPipeline, fatalApiError, withNextEditions } from "../scripts/lib/college-reported/pipeline.mts";
import { entryYearOf, htmlToText, newSourcesFromIndex } from "../scripts/lib/college-reported/documents.mts";
import { parseRobots, robotsAllows, sha256 } from "../scripts/lib/college-reported/http.mts";
import { linesJson } from "../scripts/lib/college-reported/files.mts";
import { pickPilot } from "../scripts/lib/college-reported/pilot.mts";
import { emptySummaryV3, memoryCallLogWriter, type ModelClient } from "../scripts/lib/college-reported/models.mts";
import { createRound3, type Round3Options, type Round3State } from "../scripts/lib/college-reported/phases.mts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { manifestEntryFor } from "../lib/cds-reads.ts";
import type { ManifestEntry } from "../lib/cds-sections.ts";
import { fakeBatchApi } from "./fixtures/fake-batch-api.mts";
import { memoryArchive } from "./fixtures/memory-archive.mts";
import { miniMeta, miniSchools } from "./helpers/snapshot.mts";

const META: DatasetMeta = miniMeta();
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
  // stripReported: the federal baseline the pipeline compares against, without a previous run's newer values.
  const harvard = stripReported(miniSchools().find((s) => s.unit_id === "166027")!);
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
  const merged = mergeReported([structuredClone(harvard)], { updated: "", entries: [entry] }).schools[0];
  assert.equal(merged.admissions.applicants, 45409, "the merge puts the newer class into admissions.*");
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
  assert.equal(out.summary.tripped, null, "a check failure alone never trips the breaker (2026-10-03)");
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

test("the circuit breaker trips only when many already-published values change at once", () => {
  assert.equal(circuitBreaker({ changed: 25, priorValues: 100 }), null, "25% is at the limit");
  assert.match(circuitBreaker({ changed: 26, priorValues: 100 })!, /26 of 100 published values/);
  assert.equal(circuitBreaker({ changed: 0, priorValues: 0 }), null);
  assert.equal(circuitBreaker({ changed: 3, priorValues: 0 }), null, "nothing published before: nothing to compare");
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
  assert.match(s.tripped!, /3 of 4 published values changed/, "the change-share trigger, not a failure count");
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
  assert.deepEqual(tool("web_search_20260209"), { type: "web_search_20260209", name: "web_search", max_uses: 3 });
  assert.deepEqual(tool("web_fetch_20260209"), { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, max_content_tokens: 4000 });
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

/* ------------------------------------------------------------------ */
/* A stale CDS link from discovery gets next year's URLs tried too     */
/* ------------------------------------------------------------------ */

test("a CDS link for an edition no newer than the federal year gains guessed next-edition URLs (Northwestern, ten-college test)", () => {
  // Discovery returned last year's file (2024-25, 404 now); the 2025-26 and 2026-27 guesses go first.
  const stale = recipe("147767", [{ kind: "cds", url: "https://enrollment.northwestern.edu/pdf/common-data/2024-25.pdf", format: "pdf" }]);
  const out = withNextEditions(stale, 2024);
  assert.deepEqual(
    out.sources.map((s) => s.url),
    [
      "https://enrollment.northwestern.edu/pdf/common-data/2026-27.pdf",
      "https://enrollment.northwestern.edu/pdf/common-data/2025-26.pdf",
      "https://enrollment.northwestern.edu/pdf/common-data/2024-25.pdf",
    ].sort((a, b) => (out.sources.findIndex((s) => s.url === a) - out.sources.findIndex((s) => s.url === b))),
  );
  assert.ok(out.sources.slice(0, 2).every((s) => s.kind === "cds" && s.format === "pdf"));
  // A link that's already newer than the federal year, or has no year, is left alone.
  const fresh = recipe("1", [{ kind: "cds", url: "https://x.edu/CDS_2025-2026.pdf", format: "pdf" }, { kind: "class-profile", url: "https://x.edu/profile", format: "html" }]);
  assert.strictEqual(withNextEditions(fresh, 2024), fresh);
  assert.strictEqual(withNextEditions(stale, null), stale);
});

test("the run summary breaks input tokens into cache reads and counts web searches", async () => {
  const url = "https://c166027.edu/class-profile";
  const { client } = fakeClient({ extraction: () => FALL_2026 });
  const out = await pipeline(client, fakeFetch({ [url]: PROFILE_HTML }).fn).run({ ...empty(), schools: [school()], sources: { updated: "", recipes: [recipe("166027", [{ kind: "class-profile", url, format: "html" }])] }, run: "r1" });
  const u = out.summary.usage.extraction;
  assert.equal(u.calls, 1);
  assert.equal(u.cache_read_input_tokens, 0);
  assert.equal(u.web_searches, 0);
});

/* ------------------------------------------------------------------ */
/* Fall figures: seasons and notices (round 3; specs/college-reported-fall-figures.md)                          */
/* ------------------------------------------------------------------ */

const CENSUS = { key: "census" as const, term: "Fall 2026", cadence: "weekly" as const };
const OCT_5 = new Date("2026-10-05T12:00:00Z");

/** A college in a season's scope (selectivity tier, or none and an admit rate under 50%), on the federal fall 2024. */
function seasonSchool(id: string, tier: string | null = "very_selective"): School {
  return {
    ...school(id, { acceptance_rate: 0.3 }),
    ...(tier ? { selectivity: { tier } } : {}),
    demographics: { undergrad_enrollment: 40000 },
  } as unknown as School;
}

function round3State(recipes: Recipe[], manifest: ManifestEntry[] = []): Round3State {
  return {
    sources: { updated: "", recipes },
    reported: { updated: null, entries: [] },
    queue: { updated: "", items: [] },
    manifest: { updated: null, documents: manifest },
    records: new Map(),
    batches: { updated: null, batches: [] },
    blocked: { hosts: [] },
    manual: [],
    summary: emptySummaryV3("s1", OCT_5.toISOString()),
    dirty: new Set(),
  };
}

const bigUsage = { input_tokens: 10_000, output_tokens: 3000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null };

/**
 * The interactive client of a season run: a notice search (streamed, `save_notice_candidates`) answers with
 * `candidates(college)`; an extraction (`create`) answers with `extraction(body)`. Records both.
 */
function seasonClient(o: { candidates?: (user: string) => { kind: "notice" | "news-index"; url: string }[]; extraction?: (body: Body) => Partial<Extraction> }) {
  const searches: Body[] = [];
  const reads: Body[] = [];
  const client: ModelClient = {
    messages: {
      async create(body) {
        reads.push(body);
        if (!o.extraction) throw new Error("unexpected extraction");
        return message(body.model, [{ type: "text", text: JSON.stringify(o.extraction(body)), citations: null }]);
      },
      stream(body) {
        searches.push(body as Body);
        const user = String((body as Body).messages[0].content);
        const candidates = o.candidates?.(user) ?? [];
        const msg = { ...message(body.model, [{ type: "tool_use", id: "t1", name: "save_notice_candidates", input: { candidates, none_found: !candidates.length } }], "tool_use"), usage: bigUsage } as unknown as Anthropic.Message;
        return { finalMessage: async () => msg };
      },
    },
  };
  return { client, searches, reads };
}

function season3(client: ModelClient, fetch: typeof globalThis.fetch, archive = memoryArchive()) {
  return createRound3({ client, batches: fakeBatchApi(), fetch, now: () => OCT_5, sleep: async () => {}, minDelayMs: 0, archive, table: CDS_TEMPLATE, callLog: memoryCallLogWriter(), log: () => {}, gridLayout: () => null, pollIntervalMs: 1 });
}

const runSeason = (schools: School[], over: Partial<Round3Options> = {}): Round3Options => ({ run: "s1", phase: "all", schools, maxCost: 25, pollUntil: null, season: CENSUS, ...over });

const UT = "228778";
const UT_NEWS = `https://news.c${UT}.edu/topics/admissions/`;
const UT_2025 = `https://news.c${UT}.edu/2025/09/17/ut-enrolls-record-class-of-2029/`;
const UT_MARCH = `https://news.c${UT}.edu/2026/03/27/record-applications-for-fall-2026/`;
const UT_SEPT = `https://news.c${UT}.edu/2026/09/18/ut-welcomes-class-of-2030/`;
const OLD_HTML = "<h1>UT enrolls record Class of 2029</h1><p>9,200 first-year students enrolled this fall.</p>";
const UT_LISTING = `<ul>
  <li><a href="/2026/09/18/ut-welcomes-class-of-2030/">UT welcomes the Class of 2030</a></li>
  <li><a href="/2026/03/27/record-applications-for-fall-2026/">Record applications for fall 2026</a></li>
  <li><a href="/2025/09/17/ut-enrolls-record-class-of-2029/">UT enrolls record Class of 2029</a></li>
</ul>`;
const MARCH_HTML = "<h1>Record applications for fall 2026</h1><p>More than 82,000 students applied for the Fall 2026 first-year class.</p>";
const SEPT_HTML = "<h1>UT welcomes the Class of 2030</h1><p>This fall 9,487 first-year students enrolled, the Class of 2030.</p>";

/** The fixture college's stored recipe: last year's dated release as a class profile (read), and its news listing. */
function utRecipe(): { recipe: Recipe; manifest: ManifestEntry[] } {
  const sha = sha256(new TextEncoder().encode(OLD_HTML));
  const old: Extraction = { cohort: "first-year", scope: "all-rounds", entering_term: "Fall 2025", applicants: null, admitted: null, enrolled: 9200, acceptance_rate: null, qualifiers: {}, enrollment_target: null, deposits: null, quotes: { enrolled: "9,200 first-year students enrolled" }, page: null };
  const recipe: Recipe = { ...recipe3(UT, [{ kind: "class-profile", url: UT_2025, format: "html", sha256: sha, processed: "2025-09-20", checked: "2026-08-01", extraction: old }]), news_index_urls: [UT_NEWS] };
  const manifest = [manifestEntryFor({ sha256: sha, unit_id: UT, url: UT_2025, final_url: null, kind: "class-profile", type: "class-profile", edition: null, retrieved: "2025-09-20", bytes: OLD_HTML.length, archive: `mem:${sha}.html` })];
  return { recipe, manifest };
}
const recipe3 = (id: string, sources: Recipe["sources"], index_urls: string[] = []): Recipe => ({ unit_id: id, sources, index_urls, learned: "2026-09-01", model: "claude-sonnet-5" });

/** The fake extraction for each notice, by the URL in the user message. */
function utExtraction(body: Body): Partial<Extraction> {
  const text = textOf(body);
  const base = { cohort: "first-year" as const, scope: "all-rounds" as const, entering_term: "Fall 2026", applicants: null, admitted: null, enrolled: null, acceptance_rate: null, qualifiers: {}, enrollment_target: null, deposits: null, page: null };
  if (text.includes(UT_MARCH)) return { ...base, applicants: 82000, qualifiers: { applicants: "approx" }, quotes: { applicants: "More than 82,000 students applied" } };
  if (text.includes(UT_SEPT)) return { ...base, enrolled: 9487, quotes: { enrolled: "9,487 first-year students enrolled" } };
  throw new Error(`unexpected read: ${text.slice(0, 200)}`);
}

test("a census-season run: the dated class profile becomes a notice, the news index yields this fall's notices, each figure cites its own", async () => {
  const { recipe, manifest } = utRecipe();
  const state = round3State([recipe], manifest);
  const { client, searches, reads } = seasonClient({ extraction: utExtraction });
  const { fn, calls } = fakeFetch({ [UT_NEWS]: UT_LISTING, [UT_MARCH]: MARCH_HTML, [UT_SEPT]: SEPT_HTML });
  const out = await season3(client, fn).run(state, runSeason([seasonSchool(UT)]));
  assert.equal(out.exit, 0);

  const sources = state.sources.recipes[0].sources;
  const old = sources.find((s) => s.url === UT_2025)!;
  assert.equal(old.kind, "notice", "last year's dated release is reclassified");
  assert.equal(old.found_by, "reclassified");
  assert.equal(old.term, "Fall 2025");
  assert.ok(!calls.some((c) => c.url === UT_2025), "a notice read before is never requested again (checked over a month ago)");
  const march = sources.find((s) => s.url === UT_MARCH)!;
  assert.deepEqual([march.kind, march.found_by, march.term, march.published], ["notice", "index", "Fall 2026", "2026-03-27"]);
  assert.ok(sources.some((s) => s.url === UT_SEPT && s.kind === "notice"));

  assert.equal(searches.length, 0, "the free index scan found the term: no paid search");
  assert.equal(reads.length, 2, "both notices read");
  assert.match(textOf(reads[0]) + textOf(reads[1]), /Expected entering term: Fall 2026/);
  assert.match(String((reads[0].system as Anthropic.TextBlockParam[])[0].text), /qualifiers: for each of applicants/);

  const entry = state.reported.entries[0];
  assert.equal(entry.admissions.entering_term, "Fall 2026");
  assert.equal(entry.admissions.applicants, 82000);
  assert.deepEqual(entry.admissions.approx, { applicants: true });
  assert.equal(entry.admissions.enrolled, 9487);
  assert.equal(entry.admissions.acceptance_rate, null, "no rate from an approximate count");
  assert.equal(entry.admissions.source_kind, "notice");
  assert.equal(entry.lineage["reported.admissions.applicants"]?.url, UT_MARCH);
  assert.equal(entry.lineage["reported.admissions.enrolled"]?.url, UT_SEPT);
  assert.equal(entry.lineage["reported.admissions.acceptance_rate"], undefined);

  assert.deepEqual(state.summary.season, { key: "census", term: "Fall 2026", budget_usd: 0.1, spent_usd: 0, colleges: 1, searched: 0, found: 1 });
});

test("a later run in the same season doesn't search a college again; a search that found nothing is recorded", async () => {
  const ID = "100700";
  const state = round3State([recipe3(ID, [{ kind: "cds", url: `https://c${ID}.edu/cds-2025-26.pdf`, format: "pdf", sha256: "a".repeat(64), checked: "2026-10-01" }])], [
    manifestEntryFor({ sha256: "a".repeat(64), unit_id: ID, url: `https://c${ID}.edu/cds-2025-26.pdf`, final_url: null, kind: "cds", type: "pdf-flat", edition: "2025-26", retrieved: "2026-10-01", bytes: 100, archive: "mem:a.pdf" }),
  ]);
  const { client, searches } = seasonClient({ candidates: () => [{ kind: "notice", url: `https://c${ID}.edu/gone` }] });
  const { fn } = fakeFetch({});
  await season3(client, fn).run(state, runSeason([seasonSchool(ID)]));
  assert.equal(searches.length, 1, "one notice search");
  assert.match(String(searches[0].system), /announced figures about its Fall 2026 entering first-year class/);
  assert.deepEqual(state.sources.recipes[0].seasons, { census: { term: "Fall 2026", checked: "2026-10-05", found: false } });
  assert.ok(!state.sources.recipes[0].sources.some((s) => s.kind === "notice"), "the 404 the model named isn't kept");
  assert.equal(state.summary.season?.searched, 1);
  assert.ok((state.summary.season?.spent_usd ?? 0) > 0);
  assert.equal(state.summary.usage_rows.find((r) => r.job === "search")?.calls, 1, "counted in the search rows");

  // The next run, same season: nothing to search.
  state.summary = emptySummaryV3("s2", OCT_5.toISOString());
  await season3(client, fn).run(state, { ...runSeason([seasonSchool(ID)]), run: "s2" });
  assert.equal(searches.length, 1, "the season back-off: not searched again for Fall 2026 this season");
  assert.equal(state.summary.season?.searched, 0);
});

test("--season none changes nothing: no reclassification, no news index, no notice, no search", async () => {
  const { recipe, manifest } = utRecipe();
  const state = round3State([recipe], manifest);
  const { client, searches, reads } = seasonClient({ extraction: utExtraction });
  const { fn, calls } = fakeFetch({ [UT_NEWS]: UT_LISTING, [UT_MARCH]: MARCH_HTML, [UT_SEPT]: SEPT_HTML });
  await season3(client, fn).run(state, runSeason([seasonSchool(UT)], { season: null }));
  assert.deepEqual(state.sources.recipes[0].sources.map((s) => [s.kind, s.url]), [["class-profile", UT_2025]]);
  assert.ok(!calls.some((c) => c.url === UT_NEWS), "the news index isn't fetched");
  assert.equal(searches.length + reads.length, 0);
  assert.equal(state.summary.season, undefined);
});

test("a college outside the four tiers gets no season pass: no reclassification, no search", async () => {
  const { recipe, manifest } = utRecipe();
  delete recipe.news_index_urls;
  const state = round3State([recipe], manifest);
  const { client, searches } = seasonClient({ candidates: () => [] });
  const { fn } = fakeFetch({});
  // A budget of its own, so only the scope rule can keep it from a search.
  await season3(client, fn).run(state, runSeason([seasonSchool(UT, "accessible")], { seasonBudget: 1 }));
  assert.equal(state.sources.recipes[0].sources[0].kind, "class-profile");
  assert.equal(searches.length, 0);
  assert.equal(state.sources.recipes[0].seasons, undefined);
  assert.equal(state.summary.season?.colleges, 0);
});

test("the season budget stops the paid step: the rest wait for the next run", async () => {
  const ids = ["100801", "100802", "100803"];
  const state = round3State(ids.map((id) => recipe3(id, [{ kind: "class-profile", url: `https://c${id}.edu/admissions/profile`, format: "html", sha256: "b".repeat(64), checked: "2026-10-01", processed: "2026-10-01", extraction: null }])), ids.map((id) =>
    manifestEntryFor({ sha256: "b".repeat(64), unit_id: id, url: `https://c${id}.edu/admissions/profile`, final_url: null, kind: "class-profile", type: "class-profile", edition: null, retrieved: "2026-10-01", bytes: 100, archive: "mem:b.html" })
  ));
  const { client, searches } = seasonClient({ candidates: () => [] });
  const { fn } = fakeFetch({});
  // Each fake search costs $0.05 (10,000 in + 3,000 out on Sonnet 5): $0.13 buys two before less than a search is left.
  await season3(client, fn).run(state, runSeason(ids.map((id) => seasonSchool(id)), { seasonBudget: 0.13 }));
  assert.equal(searches.length, 2);
  assert.equal(state.summary.season?.searched, 2);
  assert.ok(state.summary.season!.spent_usd <= 0.13);
  assert.equal(state.sources.recipes.filter((r) => r.seasons?.census).length, 2, "the third college has no season record: it is searched next run");
});

test("a season search's candidates: a student paper is dropped, a news listing is scanned and remembered", async () => {
  const ID = "100900";
  const listing = `https://news.c${ID}.edu/topic/admission/`;
  const notice = `https://news.c${ID}.edu/2026/09/20/welcome-class-of-2030/`;
  const state = round3State([recipe3(ID, [{ kind: "class-profile", url: `https://c${ID}.edu/admissions/profile`, format: "html", sha256: "c".repeat(64), checked: "2026-10-01", processed: "2026-10-01", extraction: null }])], [
    manifestEntryFor({ sha256: "c".repeat(64), unit_id: ID, url: `https://c${ID}.edu/admissions/profile`, final_url: null, kind: "class-profile", type: "class-profile", edition: null, retrieved: "2026-10-01", bytes: 100, archive: "mem:c.html" }),
  ]);
  const { client, searches } = seasonClient({
    candidates: () => [
      { kind: "notice", url: "https://www.cavalierdaily.com/article/2026/09/class-of-2030" },
      { kind: "news-index", url: listing },
    ],
    extraction: () => ({ cohort: "first-year", scope: "all-rounds", entering_term: "Fall 2026", applicants: null, admitted: null, enrolled: 3988, acceptance_rate: null, qualifiers: {}, enrollment_target: null, deposits: null, quotes: { enrolled: "3,988 first-year students" }, page: null }),
  });
  const { fn, calls } = fakeFetch({ [listing]: `<a href="/2026/09/20/welcome-class-of-2030/">Welcome, Class of 2030</a>`, [notice]: "<p>The Class of 2030: 3,988 first-year students enrolled.</p>" });
  await season3(client, fn).run(state, runSeason([seasonSchool(ID)]));
  assert.equal(searches.length, 1);
  assert.ok(!calls.some((c) => c.url.includes("cavalierdaily")), "a student newspaper is never fetched");
  const r = state.sources.recipes[0];
  assert.deepEqual(r.news_index_urls, [listing], "the listing is kept for later seasons (Decision 7)");
  assert.deepEqual(r.seasons?.census, { term: "Fall 2026", checked: "2026-10-05", found: true });
  assert.equal(r.sources.find((s) => s.url === notice)?.found_by, "index");
  assert.equal(state.reported.entries[0].admissions.enrolled, 3988);
  assert.equal(state.summary.season?.found, 1);
});

test("a notice on the owner's list joins a known recipe at once (found_by manual), without re-running discovery", async () => {
  const { recipe, manifest } = utRecipe();
  delete recipe.news_index_urls;
  const state = round3State([recipe], manifest);
  const sheet = "https://www.universityofcalifornia.edu/fall-2026-admissions.pdf";
  state.manual = [{ unit_id: UT, url: sheet, kind: "notice", note: "UC system fact sheet, Fall 2026", added: "2026-11-11" }];
  const { client } = seasonClient({ candidates: () => [] });
  const { fn, calls } = fakeFetch({});
  await season3(client, fn).run(state, runSeason([seasonSchool(UT)], { season: null }));
  const src = state.sources.recipes[0].sources.find((s) => s.url === sheet)!;
  assert.deepEqual([src.kind, src.found_by, src.term, src.form], ["notice", "manual", "Fall 2026", "system-sheet"]);
  assert.ok(calls.some((c) => c.url === sheet), "fetched like a class profile");
  assert.ok(!calls.some((c) => c.url.endsWith("/sitemap.xml") || c.url === `https://c${UT}.edu/`), "no discovery probe ran");
});
