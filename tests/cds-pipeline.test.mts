/**
 * The round-3 pipeline end to end (scripts/lib/college-reported/phases.mts; specs/college-reported-round-3.md tests 1,
 * 2, 11, 16, 22, plus the template and flattened-PDF paths, collect resuming, and exit codes) over a fake fetch table,
 * a fake interactive client, the fake Message Batches API, and an in-memory archive: no network, no API key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { Extraction, Recipe } from "../lib/reported.ts";
import type { School } from "../lib/types";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { SCHEMA_VERSIONS } from "../lib/cds-sections.ts";
import { validateCdsRecords } from "../lib/cds-records.ts";
import { createRound3, callLines, type Round3Options, type Round3State } from "../scripts/lib/college-reported/phases.mts";
import { emptySummaryV3, memoryCallLogWriter, type ModelClient } from "../scripts/lib/college-reported/models.mts";
import { parseCustomId } from "../scripts/lib/college-reported/batch.mts";
import { pagesFromLayoutText } from "../scripts/lib/college-reported/layout.mts";
import { sha256 } from "../scripts/lib/college-reported/http.mts";
import { fakeBatchApi, type FakeBatchOptions } from "./fixtures/fake-batch-api.mts";
import { memoryArchive } from "./fixtures/memory-archive.mts";
import { tinyPdf, type TinyText } from "./helpers/tiny-pdf.mts";
import { tinyXlsx, type TinySheet } from "./helpers/tiny-xlsx.mts";

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(import.meta.dirname, "fixtures", "cds");
const OCT = new Date("2026-10-02T12:00:00Z");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** A college shaped like data/schools.json, with only what the pipeline and checks read. */
function school(id: string, o: { rate?: number | null; enrollment?: number } = {}): School {
  const rate = o.rate === undefined ? 0.0365 : o.rate;
  return {
    unit_id: id,
    name: `College ${id}`,
    location: { city: "Cambridge", state: "MA", zip: "02138", region: "New England" },
    type: "private-nonprofit",
    admissions: { year: 2024, applicants: 54008, admitted: 1970, enrolled: 1647, acceptance_rate: rate, sat_reading_25_75: null, sat_math_25_75: null, act_composite_25_75: null },
    demographics: { undergrad_enrollment: o.enrollment ?? 7000 },
    links: { website: `https://c${id}.edu`, price_calculator: null },
  } as unknown as School;
}

/** A 2025–26 template workbook (sheets CDS-A … CDS-J and an ANSWER SHEET) with C1 totals in its code table. */
function templateWorkbook(c1: [number, number, number]): Uint8Array {
  const header = { AA: "Question Number", AB: "Question", AC: "Answer" };
  const sheets: Record<string, TinySheet> = {};
  for (const s of "ABCDEFGHIJ") sheets[`CDS-${s}`] = { 1: header };
  sheets["CDS-C"] = {
    1: header,
    17: { AA: "C.116", AB: "Total first-time, first-year students who applied", AC: c1[0] },
    18: { AA: "C.117", AB: "Total first-time, first-year students who were admitted", AC: c1[1] },
    19: { AA: "C.118", AB: "Total first-time, first-year students who enrolled", AC: c1[2] },
  };
  sheets["CDS-I"] = { 1: header, 32: { AA: "I.201", AB: "Fall 2025 Student to Faculty ratio", AC: 7 } };
  sheets["ANSWER SHEET"] = { 1: { B: "Question Number", E: "Question", F: "Answer" } };
  return tinyXlsx(sheets);
}

/**
 * A flattened CDS PDF: the cover and two running-header pages cut from the inventory's Loyola layout text (its pages
 * say "Common Data Set 2024-2025" while the cover says 2025-2026), then a page with C1 totals and D1.
 */
function flatPdf(o: { cover?: string; c1?: [string, string, string] } = {}): Uint8Array {
  const text = readFileSync(join(FIXTURES, "layout-loyola-c1.txt"), "utf8").split("\n").filter((l) => !l.startsWith("#"));
  const upTo = text.findIndex((l) => l.trim() === "=== Page 10 ===");
  const fixture = pagesFromLayoutText(text.slice(0, upTo).join("\n")).map((items) => ({ text: items.map((i): TinyText => ({ x: i.x, y: i.y, s: i.str })) }));
  if (o.cover) fixture[0].text[0] = { ...fixture[0].text[0], s: o.cover };
  const [a, b, c] = o.c1 ?? ["48,000", "1,950", "1,660"];
  const c1Page = {
    text: [
      { x: 43, y: 760, s: "Common Data Set 2024-2025" },
      { x: 40, y: 700, s: "C1 First-time, first-year students" },
      { x: 63, y: 680, s: "Total first-time, first-year who applied" },
      { x: 400, y: 680, s: a },
      { x: 63, y: 660, s: "Total first-time, first-year who were admitted" },
      { x: 400, y: 660, s: b },
      { x: 63, y: 640, s: "Total first-time, first-year who enrolled" },
      { x: 400, y: 640, s: c },
      { x: 40, y: 600, s: "D1 Transfer admission" },
      { x: 63, y: 580, s: "Does your institution enroll transfer students?" },
      { x: 400, y: 580, s: "Yes" },
    ],
  };
  return tinyPdf([...fixture, c1Page]);
}

type Handler = (init: RequestInit | undefined) => Response;
/** fetch over a table of URL → handler; anything else (robots.txt included) is 404. Records every request. */
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
  const docs = () => calls.filter((c) => !c.url.endsWith("/robots.txt"));
  return { fn, calls, docs };
}

/** An interactive client that records calls; class-profile extraction answers with `extraction`, anything else throws. */
function fakeClient(extraction?: Partial<Extraction>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const usage = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null };
  const client: ModelClient = {
    messages: {
      async create(body) {
        calls.push(body);
        if (!extraction) throw new Error("unexpected interactive call");
        return { id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(extraction), citations: null }], stop_reason: "end_turn", stop_sequence: null, usage } as unknown as Anthropic.Message;
      },
      stream(body) {
        calls.push(body as Anthropic.MessageCreateParamsNonStreaming);
        return {
          finalMessage: async () => {
            throw new Error("unexpected streamed call");
          },
        };
      },
    },
  };
  return { client, calls };
}

/** The rendered lines of a request ("412| text"), by id. */
function renderedLines(params: Anthropic.MessageCreateParamsNonStreaming): Map<number, string> {
  const user = params.messages[0].content as string;
  return new Map([...user.matchAll(/^(\d+)\| (.*)$/gm)].map((m) => [Number(m[1]), m[2]]));
}

type Plan = Record<string, [value: number | string, line: RegExp]>;
const C_PLAN: Plan = { "C.116": [48000, /who applied/], "C.117": [1950, /were admitted/], "C.118": [1660, /who enrolled/] };
const REST_PLAN: Plan = { "D.101": ["Yes", /enroll transfer students/] };

/**
 * The batch API's answers: each code of the plan for the request's call, cited by the id of the line its regex finds.
 * Escalations (Sonnet) answer the same way. A quote the model writes itself is included to show it is ignored.
 */
function batchApi(plans: { C?: Plan; rest?: Plan; pick?: Record<string, number> } = {}, opts: Omit<FakeBatchOptions, "answer"> = {}) {
  return fakeBatchApi({
    ...opts,
    answer(params, id) {
      const p = parseCustomId(id)!;
      if (p.call === "pick") return { text: JSON.stringify(plans.pick ?? {}) };
      const lines = renderedLines(params);
      const asked = new Set(Object.keys((params.output_config?.format as unknown as { schema: { properties: object } }).schema.properties));
      const out: Record<string, unknown> = {};
      for (const [code, [v, re]] of Object.entries((p.call === "C" ? plans.C : plans.rest) ?? {})) {
        if (!asked.has(code)) continue;
        const line = [...lines].find(([, t]) => re.test(t))?.[0];
        if (line !== undefined) out[code] = { v, lines: [line], quote: "a quote the model invented" };
      }
      return { text: JSON.stringify(out) };
    },
  });
}

function freshState(recipes: Recipe[] = []): Round3State {
  return {
    sources: { updated: "", recipes },
    reported: { updated: null, entries: [] },
    queue: { updated: "", items: [] },
    manifest: { updated: null, documents: [] },
    records: new Map(),
    batches: { updated: null, batches: [] },
    blocked: { hosts: [] },
    manual: [],
    summary: emptySummaryV3("r1", OCT.toISOString()),
    dirty: new Set(),
  };
}

const recipe = (id: string, sources: Recipe["sources"], index_urls: string[] = []): Recipe => ({ unit_id: id, sources, index_urls, learned: "2026-09-01", model: "claude-sonnet-5" });

function pipeline(o: { fetch: typeof globalThis.fetch; batches: ReturnType<typeof fakeBatchApi>; archive: ReturnType<typeof memoryArchive>; client?: ModelClient; now?: Date; writer?: ReturnType<typeof memoryCallLogWriter> }) {
  return createRound3({
    client: o.client ?? fakeClient().client,
    batches: o.batches,
    fetch: o.fetch,
    now: () => o.now ?? OCT,
    sleep: async () => {},
    minDelayMs: 0,
    archive: o.archive,
    table: CDS_TEMPLATE,
    callLog: o.writer ?? memoryCallLogWriter(),
    log: () => {},
    pollIntervalMs: 1,
  });
}

const runOpts = (schools: School[], over: Partial<Round3Options> = {}): Round3Options => ({ run: "r1", phase: "all", schools, maxCost: 25, pollUntil: null, ...over });

const XLSX_ID = "190001";
const PDF_ID = "190002";
const xlsxUrl = `https://c${XLSX_ID}.edu/ir/CDS_2025-26.xlsx`;
const pdfUrl = `https://c${PDF_ID}.edu/ir/CDS_2025-26.pdf`;
const pdfIndex = `https://c${PDF_ID}.edu/ir/cds`;
const PDF = flatPdf();
const XLSX = templateWorkbook([45409, 2045, 1690]);

/** The PDF served with an ETag; a conditional GET that matches it gets a 304. */
const pdfRoute: Handler = (init) => ((init?.headers as Record<string, string>)?.["If-None-Match"] === '"v1"' ? new Response(null, { status: 304 }) : new Response(PDF as BodyInit, { status: 200, headers: { etag: '"v1"' } }));
const indexHtml = `<a href="/ir/CDS_2025-26.pdf">Common Data Set 2025-2026</a>`;

/* ------------------------------------------------------------------ */
/* Deterministic: a template workbook never reaches a model            */
/* ------------------------------------------------------------------ */

test("a template workbook flows from fetch to archive to record to published C1 with no model call", async () => {
  const { fn, docs } = fakeFetch({ [xlsxUrl]: XLSX });
  const api = batchApi();
  const archive = memoryArchive();
  const { client, calls } = fakeClient();
  const state = freshState([recipe(XLSX_ID, [{ kind: "cds", url: xlsxUrl, format: "xlsx" }])]);
  const out = await pipeline({ fetch: fn, batches: api, archive, client }).run(state, runOpts([school(XLSX_ID)]));
  assert.equal(out.exit, 0);
  assert.equal(calls.length, 0, "no interactive call");
  assert.equal(api.created.length, 0, "no batch");
  assert.deepEqual(docs().map((c) => c.url), [xlsxUrl]);
  const sha = sha256(XLSX);
  assert.ok(archive.bytes.has(sha), "archived");
  const entry = state.manifest.documents[0];
  assert.deepEqual([entry.sha256, entry.type, entry.edition, entry.edition_from, entry.archive], [sha, "xlsx-template", "2025-26", "workbook", `mem:${sha}.xlsx`]);
  const doc = state.records.get(XLSX_ID)!.documents[0];
  assert.equal(doc.reads.deterministic?.read_by, "xlsx-template");
  assert.deepEqual(doc.items["C.116"], { status: "passed", v: 45409, cell: "CDS-C!AC17", quote: "Total first-time, first-year students who applied | 45409" });
  assert.deepEqual(validateCdsRecords([...state.records.values()], state.manifest, CDS_TEMPLATE), []);
  assert.ok(state.dirty.has(XLSX_ID), "the record is marked for writing");
  const e = state.reported.entries[0];
  assert.deepEqual(e.admissions, { entering_term: "Fall 2025", year: 2025, applicants: 45409, admitted: 2045, enrolled: 1690, acceptance_rate: 2045 / 45409, source_kind: "cds" });
  assert.equal(e.lineage["reported.admissions.applicants"]?.quote, "Total first-time, first-year students who applied | 45409");
  assert.equal(state.summary.documents["xlsx-template"].fetched, 1);
  assert.equal(state.summary.documents["xlsx-template"].model_calls, 0);
  assert.equal(state.summary.published, 1);
});

/* ------------------------------------------------------------------ */
/* A flattened PDF: layout → batch → collected → line-cited record     */
/* ------------------------------------------------------------------ */

async function pdfRun1() {
  const f = fakeFetch({ [pdfUrl]: pdfRoute, [pdfIndex]: indexHtml });
  const api = batchApi({ C: C_PLAN, rest: REST_PLAN });
  const archive = memoryArchive();
  const writer = memoryCallLogWriter();
  const state = freshState([recipe(PDF_ID, [{ kind: "cds", url: pdfUrl, format: "pdf" }], [pdfIndex])]);
  const out = await pipeline({ fetch: f.fn, batches: api, archive, writer }).run(state, runOpts([school(PDF_ID)]));
  return { f, api, archive, writer, state, out };
}

test("a flattened PDF goes through layout, one extraction batch, and collect into a record with line-cited quotes", async () => {
  const { f, api, archive, writer, state, out } = await pdfRun1();
  assert.equal(out.exit, 0);
  const sha = sha256(PDF);
  assert.ok(archive.lines.has(sha), "the numbered lines are archived beside the bytes");
  const entry = state.manifest.documents[0];
  assert.deepEqual([entry.type, entry.edition, entry.edition_from], ["pdf-flat", "2025-26", "cover"], "the cover's edition, not the 2024-2025 running headers");
  assert.equal(api.created.length, 1, "one batch");
  assert.deepEqual(api.created[0].map((r) => r.custom_id).sort(), [`u${PDF_ID}-${sha.slice(0, 8)}-C-v1`, `u${PDF_ID}-${sha.slice(0, 8)}-rest-v1`]);
  assert.equal(api.created[0].find((r) => r.custom_id.endsWith("-C-v1"))!.params.model, "claude-haiku-4-5");
  assert.deepEqual(f.docs().filter((c) => c.url === pdfUrl).length, 1);

  const doc = state.records.get(PDF_ID)!.documents[0];
  assert.equal(doc.reads.C?.mode, "batch");
  assert.equal(doc.reads.C?.schema_version, 1);
  assert.equal(doc.reads.C?.batch, api.created.length ? "msgbatch_001" : undefined);
  const c116 = doc.items["C.116"];
  assert.equal(c116.status, "passed");
  assert.equal(c116.v, 48000);
  assert.equal(c116.page, 4);
  const arch = archive.lines.get(sha) as { lines: string[] };
  assert.match(arch.lines[c116.line! - 1], /who applied/);
  assert.equal(c116.quote, "Total first-time, first-year who applied | 48,000", "the quote is built from the cited line; the model's own is ignored");
  assert.equal(doc.items["D.101"].v, true);
  assert.equal(doc.items["C.201"].status, "not-found", "a code the model left out");
  assert.equal(doc.items[CDS_TEMPLATE.items.find((i) => i.call === "store")!.code].status, "not-read", "store-only codes aren't in a model call");
  assert.deepEqual(validateCdsRecords([...state.records.values()], state.manifest, CDS_TEMPLATE), []);

  const e = state.reported.entries[0];
  assert.equal(e.admissions.applicants, 48000);
  assert.equal(e.admissions.entering_term, "Fall 2025");
  assert.equal(e.lineage["reported.admissions.applicants"]?.url, pdfUrl);

  // Measurement (test 21): per-job/model/mode/call rows, documents by type, items by code, tiers, batches, projection,
  // and one calls-file line per model call.
  const s = state.summary;
  assert.deepEqual(s.usage_rows.map((r) => [r.job, r.model, r.mode, r.call, r.calls]), [["extraction", "claude-haiku-4-5", "batch", "C", 1], ["extraction", "claude-haiku-4-5", "batch", "rest", 1]]);
  assert.equal(writer.rows.length, 2);
  assert.ok(writer.rows.every((r) => r.batch === "msgbatch_001" && r.document_type === "pdf-flat"));
  assert.deepEqual([s.documents["pdf-flat"].fetched, s.documents["pdf-flat"].archived, s.documents["pdf-flat"].model_calls], [1, 1, 2]);
  assert.equal(s.items["C.116"].passed, 1);
  assert.equal(s.items["C.201"].not_found, 1);
  assert.equal(s.tiers["very selective"].colleges, 1);
  assert.equal(s.tiers["very selective"].published_c1, 1);
  assert.equal(s.batches.length, 1);
  assert.ok(s.batches[0].ended, "the batch row is settled when collected");
  assert.equal(s.batches[0].succeeded, 2);
  assert.match(s.projection!.basis, /1 pdf-flat × \$0\.05/);
  assert.equal(s.discovery.known.colleges, 1);
  assert.equal(state.batches.batches.length, 0, "nothing left open");
  assert.equal(s.status, "finished");
});

/* ------------------------------------------------------------------ */
/* Test 1: read once                                                   */
/* ------------------------------------------------------------------ */

test("test 1: run 2 at the same schema version fetches only the index page and sends no model request; a month on, one conditional GET", async () => {
  const { archive, state } = await pdfRun1();
  // Run 2, same month: the index page is re-scanned, the document isn't requested, nothing reaches a model.
  const f2 = fakeFetch({ [pdfUrl]: pdfRoute, [pdfIndex]: indexHtml });
  const api2 = batchApi({ C: C_PLAN, rest: REST_PLAN });
  const c2 = fakeClient();
  state.summary = emptySummaryV3("r2", OCT.toISOString());
  await pipeline({ fetch: f2.fn, batches: api2, archive, client: c2.client }).run(state, runOpts([school(PDF_ID)], { run: "r2" }));
  assert.deepEqual(f2.docs().map((c) => c.url), [pdfIndex]);
  assert.equal(api2.created.length, 0);
  assert.equal(c2.calls.length, 0);

  // A month later: a conditional GET (its ETag sent), answered 304; still no model request.
  const f3 = fakeFetch({ [pdfUrl]: pdfRoute, [pdfIndex]: indexHtml });
  const api3 = batchApi();
  state.summary = emptySummaryV3("r3", OCT.toISOString());
  await pipeline({ fetch: f3.fn, batches: api3, archive, now: new Date("2026-11-03T12:00:00Z") }).run(state, runOpts([school(PDF_ID)], { run: "r3" }));
  const got = f3.docs().filter((c) => c.url === pdfUrl);
  assert.equal(got.length, 1);
  assert.equal(got[0].headers["If-None-Match"], '"v1"');
  assert.equal(api3.created.length, 0);
  assert.equal(state.summary.documents["pdf-flat"].unchanged, 1);

  // Break the version comparison (the stored read looks older than the schema): run 4 sends the model that call.
  const doc = state.records.get(PDF_ID)!.documents[0];
  doc.reads.C = { ...doc.reads.C!, schema_version: 0 };
  const api4 = batchApi({ C: C_PLAN });
  state.summary = emptySummaryV3("r4", OCT.toISOString());
  await pipeline({ fetch: fakeFetch({ [pdfIndex]: indexHtml }).fn, batches: api4, archive }).run(state, runOpts([school(PDF_ID)], { run: "r4" }));
  assert.deepEqual(api4.created.flat().map((r) => parseCustomId(r.custom_id)!.call), ["C"]);
});

/* ------------------------------------------------------------------ */
/* Test 2: a schema bump reads only the archive                        */
/* ------------------------------------------------------------------ */

test("test 2: a schema bump re-extracts that call from the archive alone; template workbooks are re-read with no model", async () => {
  const f1 = fakeFetch({ [pdfUrl]: pdfRoute, [xlsxUrl]: XLSX });
  const archive = memoryArchive();
  const state = freshState([recipe(PDF_ID, [{ kind: "cds", url: pdfUrl, format: "pdf" }]), recipe(XLSX_ID, [{ kind: "cds", url: xlsxUrl, format: "xlsx" }])]);
  const schools = [school(PDF_ID), school(XLSX_ID)];
  await pipeline({ fetch: f1.fn, batches: batchApi({ C: C_PLAN, rest: REST_PLAN }), archive }).run(state, runOpts(schools));
  assert.equal(state.records.size, 2);

  SCHEMA_VERSIONS.C = 2;
  try {
    const f2 = fakeFetch({});
    const api = batchApi({ C: C_PLAN });
    const { client, calls } = fakeClient();
    archive.gets.length = 0;
    state.summary = emptySummaryV3("r2", OCT.toISOString());
    const out = await pipeline({ fetch: f2.fn, batches: api, archive, client }).run(state, runOpts(schools, { run: "r2", reextract: "C" }));
    assert.equal(out.exit, 0);
    assert.equal(f2.calls.length, 0, "no fetch at all, not even robots.txt or an index page");
    assert.equal(calls.length, 0, "no discovery or other interactive call");
    assert.deepEqual(api.created.flat().map((r) => r.custom_id), [`u${PDF_ID}-${sha256(PDF).slice(0, 8)}-C-v2`], "one request: the bumped call of the one model-read document");
    assert.ok(archive.gets.includes(sha256(XLSX)), "the template workbook was re-read from the archive");
    assert.equal(state.records.get(XLSX_ID)!.documents[0].reads.C, undefined, "and never sent to a model");
    assert.equal(state.records.get(PDF_ID)!.documents[0].reads.C?.schema_version, 2);
    assert.equal(state.records.get(PDF_ID)!.documents[0].reads.rest?.schema_version, 1, "rest isn't re-read");
  } finally {
    SCHEMA_VERSIONS.C = 1;
  }
});

/* ------------------------------------------------------------------ */
/* Test 11: the cap trims in tier order; the projection guard          */
/* ------------------------------------------------------------------ */

test("test 11: a batch over the cap is trimmed in tier order; the trimmed document stays archived and goes next run with no refetch", async () => {
  const OPEN = "190003";
  const openUrl = `https://c${OPEN}.edu/ir/CDS_2025-26.pdf`;
  const openPdf = flatPdf({ c1: ["5,000", "4,900", "1,200"] });
  const f = fakeFetch({ [pdfUrl]: PDF, [openUrl]: openPdf });
  const api = batchApi({ C: C_PLAN, rest: REST_PLAN }, { pollsUntilEnded: 99 });
  const archive = memoryArchive();
  const state = freshState([recipe(OPEN, [{ kind: "cds", url: openUrl, format: "pdf" }]), recipe(PDF_ID, [{ kind: "cds", url: pdfUrl, format: "pdf" }])]);
  const schools = [school(OPEN, { rate: null, enrollment: 30000 }), school(PDF_ID, { rate: 0.04 })];
  const out = await pipeline({ fetch: f.fn, batches: api, archive }).run(state, runOpts(schools, { maxCost: 0.12 }));
  assert.equal(out.exit, 0);
  assert.deepEqual([...new Set(api.created.flat().map((r) => parseCustomId(r.custom_id)!.unit_id))], [PDF_ID], "the very selective college's document fits; the open-admission one is trimmed");
  assert.ok(archive.bytes.has(sha256(openPdf)), "the trimmed document stays archived");
  assert.equal(state.batches.batches.length, 1, "the batch is still open (the draft signal)");

  // Next run, cap raised, the same month: the trimmed document goes from the archive; its URL isn't requested.
  const f2 = fakeFetch({});
  const api2 = batchApi({ C: C_PLAN, rest: REST_PLAN });
  state.batches = { updated: null, batches: [] };
  state.summary = emptySummaryV3("r2", OCT.toISOString());
  await pipeline({ fetch: f2.fn, batches: api2, archive }).run(state, runOpts(schools, { run: "r2", maxCost: 5 }));
  assert.equal(f2.docs().filter((c) => c.url === openUrl).length, 0);
  assert.ok(api2.created.flat().some((r) => parseCustomId(r.custom_id)!.unit_id === OPEN));
});

test("test 11: the projection guard stops the run before any model call (exit 3)", async () => {
  const f = fakeFetch({ [pdfUrl]: PDF });
  const api = batchApi({ C: C_PLAN, rest: REST_PLAN });
  const { client, calls } = fakeClient();
  const state = freshState([recipe(PDF_ID, [{ kind: "cds", url: pdfUrl, format: "pdf" }])]);
  const out = await pipeline({ fetch: f.fn, batches: api, archive: memoryArchive(), client }).run(state, runOpts([school(PDF_ID)], { maxCost: 0.04 }));
  assert.equal(out.exit, 3);
  assert.match(out.message!, /^projection \$0\.05 exceeds the cap \$0\.04/);
  assert.equal(api.created.length, 0);
  assert.equal(calls.length, 0);
  assert.equal(state.summary.status, "stopped");
  assert.equal(state.manifest.documents.length, 1, "prepare's free work is kept");
});

/* ------------------------------------------------------------------ */
/* Test 16: per-item publishing and queue                              */
/* ------------------------------------------------------------------ */

test("test 16: a failing H2 code doesn't stop C1 from publishing; the queue holds it per item; it escalates once to Sonnet", async () => {
  const f = fakeFetch({ [pdfUrl]: PDF });
  // H.201 cited on the D1 line, where 999 isn't printed: number-on-line fails.
  const api = batchApi({ C: C_PLAN, rest: { ...REST_PLAN, "H.201": [999, /enroll transfer students/] } });
  const state = freshState([recipe(PDF_ID, [{ kind: "cds", url: pdfUrl, format: "pdf" }])]);
  // Last year's edition has its own queued item: replacing this edition's H.201 must leave it alone.
  const lastYear = { unit_id: PDF_ID, name: "x", urls: ["u"], entering_term: null, failures: [{ check: "order" as const, detail: "d" }], queued: "2026-01-01", run: "r0", code: "H.201", edition: "2024-25", sha256: "b".repeat(64) };
  state.queue.items = [lastYear];
  const out = await pipeline({ fetch: f.fn, batches: api, archive: memoryArchive() }).run(state, runOpts([school(PDF_ID)]));
  const doc = state.records.get(PDF_ID)!.documents[0];
  assert.equal(doc.items["H.201"].status, "failed");
  assert.ok(doc.items["H.201"].failures!.some((x) => x.check === "number-on-line"));
  assert.equal(doc.items["C.116"].status, "passed");
  assert.equal(state.reported.entries[0].admissions.applicants, 48000, "C1 published anyway");
  const mine = state.queue.items.filter((q) => q.unit_id === PDF_ID);
  assert.deepEqual(mine.map((q) => [q.code, q.edition, q.sha256]), [["H.201", "2024-25", "b".repeat(64)], ["H.201", "2025-26", sha256(PDF)]], "one entry per college + edition + code");
  // Escalation: one Sonnet request for the rest call, asking for H.201 alone; never repeated after Sonnet has read it.
  const esc = api.created.flat().filter((r) => r.custom_id.endsWith("-x"));
  assert.equal(esc.length, 1);
  assert.equal(esc[0].params.model, "claude-sonnet-5");
  assert.deepEqual(Object.keys((esc[0].params.output_config!.format as unknown as { schema: { properties: object } }).schema.properties), ["H.201"]);
  assert.equal(doc.reads.rest?.read_by, "claude-sonnet-5");
  assert.equal(state.summary.escalated, 1);
  assert.equal(out.exit, 0, "a failing H2 in one document doesn't trip the breaker");
});

/* ------------------------------------------------------------------ */
/* Test 22: no refetch after re-discovery                              */
/* ------------------------------------------------------------------ */

test("test 22: a source fetched earlier in the run isn't fetched again when the picker adds a CDS", async () => {
  const ID = "190004";
  const site = `https://c${ID}.edu`;
  const profile = `${site}/admissions/class-profile`;
  const newCds = `${site}/files/cds-current.pdf`;
  const f = fakeFetch({
    [`${site}/`]: `<a href="/publications">Publications</a>`,
    [site]: `<a href="/publications">Publications</a>`,
    [`${site}/publications`]: `<a href="/files/cds-current.pdf">Common Data Set 2025-2026</a>`,
    [newCds]: PDF,
    [profile]: "<h2>Class of 2029</h2><p>48,000 students applied</p>",
  });
  const api = batchApi({ C: C_PLAN, rest: REST_PLAN, pick: { cds_index: 1 } });
  const { client, calls } = fakeClient({ cohort: "first-year", scope: "all-rounds", entering_term: "Fall 2025", applicants: 48000, admitted: null, enrolled: null, acceptance_rate: null, quotes: { applicants: "48,000 students applied" }, page: null });
  // A known class-profile page and a CDS index that now 404s: the free steps run, miss, and the paid picker finds the CDS.
  const gone = `${site}/admissions/facts`;
  const state = freshState([recipe(ID, [{ kind: "class-profile", url: profile, format: "html" }, { kind: "class-profile", url: gone, format: "html" }], [`${site}/ir/cds-gone`])]);
  const out = await pipeline({ fetch: f.fn, batches: api, archive: memoryArchive(), client }).run(state, runOpts([school(ID)]));
  assert.equal(out.exit, 0);
  assert.equal(f.docs().filter((c) => c.url === profile).length, 1, "the class profile is fetched once");
  assert.equal(f.docs().filter((c) => c.url === gone).length, 1, "a source that failed earlier in the run isn't requested again either");
  assert.equal(f.docs().filter((c) => c.url === newCds).length, 1);
  assert.equal(calls.length, 1, "round 2's extractor reads the class profile once");
  const r = state.sources.recipes.find((x) => x.unit_id === ID)!;
  assert.equal(r.discovery?.path, "picker");
  assert.deepEqual(r.sources.map((s) => s.url).sort(), [newCds, gone, profile].sort());
  assert.ok(api.created[0].every((q) => parseCustomId(q.custom_id)!.call === "pick"), "the picker goes as a batch");
  assert.equal(state.summary.discovery.picker.colleges, 1);
  assert.ok(state.records.get(ID)!.documents[0].items["C.116"].status === "passed");
});

/* ------------------------------------------------------------------ */
/* Collect resumes; exit codes                                         */
/* ------------------------------------------------------------------ */

test("--phase collect picks up a batch the run left open and finishes it", async () => {
  const f = fakeFetch({ [pdfUrl]: PDF });
  const api = batchApi({ C: C_PLAN, rest: REST_PLAN }, { pollsUntilEnded: 1 });
  const archive = memoryArchive();
  const state = freshState([recipe(PDF_ID, [{ kind: "cds", url: pdfUrl, format: "pdf" }])]);
  const s = school(PDF_ID);
  const out = await pipeline({ fetch: f.fn, batches: api, archive }).run(state, runOpts([s]));
  assert.equal(out.exit, 0, "open batches are not an error");
  assert.equal(state.batches.batches.length, 1);
  assert.equal(state.summary.open_batches, 1);
  assert.equal(state.records.size, 0);

  // The collect job: a new process, no college selection, the same state files.
  const f2 = fakeFetch({});
  const out2 = await pipeline({ fetch: f2.fn, batches: api, archive }).run(state, runOpts([], { phase: "collect", allSchools: [s] }));
  assert.equal(out2.exit, 0);
  assert.equal(f2.calls.length, 0);
  assert.equal(state.batches.batches.length, 0);
  assert.equal(state.summary.open_batches, 0);
  assert.equal(state.records.get(PDF_ID)!.documents[0].items["C.116"].v, 48000);
  assert.equal(state.reported.entries[0].admissions.applicants, 48000);
});

test("exit 2: model-read C1 failures in more than 10% of attempted colleges trip the breaker", async () => {
  const f = fakeFetch({ [pdfUrl]: PDF });
  // C.116 cited on the wrong line: a check failure in a model read, the kind the breaker counts.
  const api = batchApi({ C: { ...C_PLAN, "C.116": [48000, /were admitted/] }, rest: REST_PLAN });
  const state = freshState([recipe(PDF_ID, [{ kind: "cds", url: pdfUrl, format: "pdf" }])]);
  const out = await pipeline({ fetch: f.fn, batches: api, archive: memoryArchive() }).run(state, runOpts([school(PDF_ID)]));
  assert.equal(out.exit, 2);
  assert.match(out.message!, /1 of 1 colleges failed C1 checks/);
  assert.equal(state.summary.tripped, out.message);
});

test("exit 2 never comes from deterministic-read failures (the college's file is wrong, not the pipeline)", async () => {
  const bad = templateWorkbook([1000, 2000, 500]); // admitted > applicants: fails, but in a deterministic read
  const f = fakeFetch({ [xlsxUrl]: bad });
  const state = freshState([recipe(XLSX_ID, [{ kind: "cds", url: xlsxUrl, format: "xlsx" }])]);
  const out = await pipeline({ fetch: f.fn, batches: batchApi(), archive: memoryArchive() }).run(state, runOpts([school(XLSX_ID)]));
  assert.equal(state.records.get(XLSX_ID)!.documents[0].items["C.117"].status, "failed");
  assert.equal(out.exit, 0);
});

test("exit 3: a refused API key stops the run; what prepare finished is kept", async () => {
  const f = fakeFetch({ [pdfUrl]: PDF });
  const api = batchApi();
  api.create = async () => {
    throw Object.assign(new Error("invalid x-api-key"), { status: 401 });
  };
  const state = freshState([recipe(PDF_ID, [{ kind: "cds", url: pdfUrl, format: "pdf" }])]);
  const out = await pipeline({ fetch: f.fn, batches: api, archive: memoryArchive() }).run(state, runOpts([school(PDF_ID)]));
  assert.equal(out.exit, 3);
  assert.match(out.message!, /API key was refused/);
  assert.equal(state.manifest.documents.length, 1);
});

test("the CLI exits 1 on bad arguments before anything runs", () => {
  const cli = join(ROOT, "scripts", "sync-college-reported.mts");
  const run = (...args: string[]) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", cli, ...args], { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  const bad = run("--pilot", "--phase", "sometimes");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--phase must be one of prepare, discover, submit, collect, all/);
  assert.equal(run("--all", "--reextract").status, 1);
  assert.match(run().stderr, /Pick which colleges/);
});

test("callLines: section C and the rest from the split, the whole body without one", () => {
  const arch = { lines: ["a", "C1 x", "y", "D1 z", "w"], pages: [1, 1, 2, 2, 3], split: { C: [2, 3] as [number, number], rest: [[1, 1], [4, 5]] as [number, number][], fallback: false } };
  assert.deepEqual(callLines(arch, "C").map((l) => [l.id, l.page]), [[2, 1], [3, 2]]);
  assert.deepEqual(callLines(arch, "rest").map((l) => l.id), [1, 4, 5]);
  assert.deepEqual(callLines({ ...arch, split: null }, "C").map((l) => l.id), [1, 2, 3, 4, 5]);
});
