/**
 * Fixes from the second October 2026 run (GitHub run 38080003159, run id 20261010-192937-41): documents found but never
 * read. A CDS PDF whose body states no edition (Marquette's cover prints only "2025-2026", its "Common Data Set" is an
 * image) was archived and never sent to a model; class-profile PDFs were decoded as HTML; a model's mistyped CDS link
 * (Santa Clara) answered 404 every run; one malformed link ("{%=o.guid %}" on Western Carolina's home page) threw "URI
 * malformed" out of the whole probe step. Fakes only: no network, no model.
 */
import { answerJson } from "./helpers/answers.mts";
import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type { Extraction, Recipe } from "../lib/reported.ts";
import type { School } from "../lib/types";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { validateCdsRecords } from "../lib/cds-records.ts";
import { editionCurrentOn } from "../lib/cds-reads.ts";
import { createRound3, type Round3Options, type Round3State } from "../scripts/lib/college-reported/phases.mts";
import { emptySummaryV3, memoryCallLogWriter, type ModelClient } from "../scripts/lib/college-reported/models.mts";
import { parseCustomId } from "../scripts/lib/college-reported/batch.mts";
import { editionFromBody, editionFromUrl } from "../scripts/lib/college-reported/layout.mts";
import { entryYearOf, findLinks, linkKind } from "../scripts/lib/college-reported/documents.mts";
import { replaceUnlisted } from "../scripts/lib/college-reported/discovery.mts";
import { sha256 } from "../scripts/lib/college-reported/http.mts";
import { fakeBatchApi } from "./fixtures/fake-batch-api.mts";
import { memoryArchive } from "./fixtures/memory-archive.mts";
import { tinyPdf, type TinyPage } from "./helpers/tiny-pdf.mts";

const OCT = new Date("2026-10-10T12:00:00Z");

/* ------------------------------------------------------------------ */
/* Fakes (as in cds-pipeline.test.mts)                                 */
/* ------------------------------------------------------------------ */

function school(id: string): School {
  return {
    unit_id: id,
    name: `College ${id}`,
    location: { city: "Milwaukee", state: "WI", zip: "53233", region: "Great Lakes" },
    type: "private-nonprofit",
    admissions: { year: 2024, applicants: 54008, admitted: 1970, enrolled: 1647, acceptance_rate: 0.0365, sat_reading_25_75: null, sat_math_25_75: null, act_composite_25_75: null },
    demographics: { undergrad_enrollment: 7000 },
    links: { website: `https://c${id}.edu`, price_calculator: null },
  } as unknown as School;
}

/** fetch over a table of URL → body; anything else (robots.txt included) is 404. Records every request. */
function fakeFetch(routes: Record<string, Uint8Array | string>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (r === undefined) return new Response("not found", { status: 404 });
    return new Response(r as BodyInit, { status: 200 });
  }) as typeof globalThis.fetch;
  return { fn, docs: () => calls.filter((u) => !u.endsWith("/robots.txt")) };
}

/** An interactive client: class-profile extraction answers with `extraction` and records what it was sent. */
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
  const sent = () => calls.map((c) => JSON.stringify(c.messages));
  return { client, calls, sent };
}

type Plan = Record<string, [value: number | string, line: RegExp]>;
const C_PLAN: Plan = { "C.116": [48000, /who applied/], "C.117": [1950, /were admitted/], "C.118": [1660, /who enrolled/] };
const REST_PLAN: Plan = { "D.101": ["Yes", /enroll transfer students/], "I.201": [7, /Student to Faculty ratio/] };

/** The batch API: each code of the plan for the request's call, cited by the id of the line its regex finds. */
function batchApi(plans: { C?: Plan; rest?: Plan; pick?: Record<string, number> } = {}) {
  return fakeBatchApi({
    answer(params, id) {
      const p = parseCustomId(id)!;
      if (p.call === "pick") return { text: JSON.stringify(plans.pick ?? {}) };
      const user = params.messages[0].content as string;
      const lines = new Map([...user.matchAll(/^(\d+)\| (.*)$/gm)].map((m) => [Number(m[1]), m[2]]));
      const system = (params.system as { text: string }[]).map((b) => b.text).join("\n");
      const asked = new Set([...system.matchAll(/^([A-J]\.[0-9A-Z]{2,5}) \|/gm)].map((m) => m[1]));
      const out: Record<string, { v: unknown; lines: number[] }> = {};
      for (const [code, [v, re]] of Object.entries((p.call === "C" ? plans.C : plans.rest) ?? {})) {
        if (!asked.has(code)) continue;
        const line = [...lines].find(([, t]) => re.test(t))?.[0];
        if (line !== undefined) out[code] = { v, lines: [line] };
      }
      return { text: answerJson(out) };
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

function pipeline(o: { fetch: typeof globalThis.fetch; batches: ReturnType<typeof fakeBatchApi>; archive: ReturnType<typeof memoryArchive>; client?: ModelClient }) {
  return createRound3({
    client: o.client ?? fakeClient().client,
    batches: o.batches,
    fetch: o.fetch,
    now: () => OCT,
    sleep: async () => {},
    minDelayMs: 0,
    archive: o.archive,
    table: CDS_TEMPLATE,
    callLog: memoryCallLogWriter(),
    log: () => {},
    pollIntervalMs: 1,
  });
}

const runOpts = (schools: School[], over: Partial<Round3Options> = {}): Round3Options => ({ run: "r1", phase: "all", schools, maxCost: 25, pollUntil: null, ...over });

/**
 * A flattened CDS PDF that states its edition nowhere: a cover with the college's name only (Marquette's "Common Data
 * Set" is an image), section A filler (enough text to be worth a read), then C1 and D1, and with `confirm` an I2 line
 * whose own text names Fall 2025 (not one of the item phrases the layout takes an edition from).
 */
function noEditionPdf(o: { confirm?: boolean; cover?: string } = {}): Uint8Array {
  const pages: TinyPage[] = [{ text: [{ x: 84, y: 700, s: o.cover ?? "Marquette-like University" }] }];
  for (let p = 0; p < 4; p++) {
    const text = [];
    for (let i = 0; i < 50; i++) text.push({ x: 63, y: 760 - i * 14, s: `A${p}.${i} General information about the institution, its offices and contacts` });
    pages.push({ text });
  }
  pages.push({
    text: [
      { x: 40, y: 700, s: "C1 First-time, first-year students" },
      { x: 63, y: 680, s: "Total first-time, first-year who applied" },
      { x: 400, y: 680, s: "48,000" },
      { x: 63, y: 660, s: "Total first-time, first-year who were admitted" },
      { x: 400, y: 660, s: "1,950" },
      { x: 63, y: 640, s: "Total first-time, first-year who enrolled" },
      { x: 400, y: 640, s: "1,660" },
      { x: 40, y: 600, s: "D1 Transfer admission" },
      { x: 63, y: 580, s: "Does your institution enroll transfer students?" },
      { x: 400, y: 580, s: "Yes" },
      ...(o.confirm ? [{ x: 40, y: 540, s: "I2 Fall 2025 Student to Faculty ratio" }, { x: 400, y: 540, s: "7" }] : []),
    ],
  });
  return tinyPdf(pages);
}

/* ------------------------------------------------------------------ */
/* 1. A CDS with no detected edition                                   */
/* ------------------------------------------------------------------ */

test("the edition from a file name: cds-2025-2026, CDS_2024-25, CDS-25-26, cds2526, CDS_202526; never a folder date or a lone year", () => {
  const ed = (u: string) => editionFromUrl(u)?.edition ?? null;
  assert.equal(ed("https://www.marquette.edu/ir/documents/cds-2025-2026_final.pdf"), "2025-26");
  assert.equal(ed("https://x.edu/files/CDS_2024-25.pdf"), "2024-25");
  assert.equal(ed("https://x.edu/files/CDS-25-26.pdf"), "2025-26");
  assert.equal(ed("https://irsa.miami.edu/cds/cds2526.pdf"), "2025-26");
  assert.equal(ed("https://www.oit.edu/sites/default/files/2026/documents/CDS_202526.pdf"), "2025-26");
  assert.equal(ed("https://osai.uark.edu/datasets/cds/cds25-26v2.pdf"), "2025-26");
  assert.equal(ed("https://cdn.clarku.edu/wp-content/uploads/sites/95/CDS_-2025_26.pdf"), "2025-26");
  assert.equal(ed("https://www.bu.edu/asir/files/2026/05/2024-2025-Common-Data-Set.pdf"), "2024-25");
  assert.equal(ed("https://www.uml.edu/docs/CDS_2024-2025%20Final_tcm18-403507.pdf"), "2024-25");
  assert.equal(ed("https://x.edu/wp-content/uploads/2026/04/cds_22-23_enrollment.pdf"), "2022-23");
  assert.equal(ed("https://www.upike.edu/wp-content/uploads/2025/11/common-data-set-2025.pdf"), null, "a lone year names no edition");
  assert.equal(ed("https://www.luther.edu/wp-content/uploads/2025/10/Summary.CDS_2022-2026.pdf"), null, "years that aren't consecutive");
  assert.equal(ed("https://apb.ucla.edu/file/6671e572-dbd3-4e74-ba10-423ef8c749bc"), null);
  assert.equal(ed("https://www.iwu.edu/dataset/iwu-cds-2021-121720-complete.pdf"), null, "cds-2021 is a year, not 2020-21");
  assert.equal(ed("https://x.edu/2025-2026/cds.pdf"), null, "only the file name counts");
  assert.equal(ed("https://x.edu/files/CDS%E9_2025-26.pdf"), "2025-26", "a malformed escape is read as written");
});

test("the edition from the first page: a cover that prints only '2025-2026' (Marquette), but not a running header", () => {
  assert.deepEqual(editionFromBody(["@84 2025-2026", "@74 The CDS initiative is a collaborative effort"], [1, 2]), { edition: "2025-26", from: "cover" });
  assert.deepEqual(editionFromBody(["@84 Common Data Set 2025-2026"], [1]), { edition: "2025-26", from: "cover" });
  const header = ["@43 2024-2025", "x", "@43 2024-2025", "y", "@43 2024-2025", "z"];
  assert.equal(editionFromBody(header, [1, 1, 2, 2, 3, 3]), null, "printed on three pages: a header");
  assert.equal(editionFromBody(["@84 Fall 2025 admissions 2025-2026 cycle"], [1]), null, "a range inside a sentence isn't a cover");
});

test("a CDS whose file name states the edition is filed under it and read in the run that finds it", async () => {
  const ID = "239105";
  const url = `https://c${ID}.edu/ir/documents/cds-2025-2026_final.pdf`;
  const pdf = noEditionPdf();
  const api = batchApi({ C: C_PLAN, rest: REST_PLAN });
  const state = freshState([recipe(ID, [{ kind: "cds", url, format: "pdf" }])]);
  const out = await pipeline({ fetch: fakeFetch({ [url]: pdf }).fn, batches: api, archive: memoryArchive() }).run(state, runOpts([school(ID)]));
  assert.equal(out.exit, 0);
  const entry = state.manifest.documents[0];
  assert.deepEqual([entry.type, entry.edition, entry.edition_from], ["pdf-flat", "2025-26", "url"]);
  assert.deepEqual(api.created.flat().map((r) => parseCustomId(r.custom_id)!.call).sort(), ["C", "rest"]);
  assert.equal(state.records.get(ID)!.documents[0].items["C.116"].status, "passed");
  assert.equal(state.reported.entries[0].admissions.applicants, 48000);
  assert.deepEqual(validateCdsRecords([...state.records.values()], state.manifest, CDS_TEMPLATE), []);
});

test("a CDS that states no edition anywhere is read once under the current edition, held until its items confirm it, and not read again", async () => {
  const ID = "239106";
  const url = `https://c${ID}.edu/ir/documents/final.pdf`;
  const pdf = noEditionPdf();
  const archive = memoryArchive();
  const api = batchApi({ C: C_PLAN, rest: REST_PLAN });
  const state = freshState([recipe(ID, [{ kind: "cds", url, format: "pdf" }])]);
  await pipeline({ fetch: fakeFetch({ [url]: pdf }).fn, batches: api, archive }).run(state, runOpts([school(ID)]));
  const entry = state.manifest.documents[0];
  assert.deepEqual([entry.edition, entry.edition_from], [editionCurrentOn("2026-10-10"), "assumed"]);
  assert.equal(entry.edition, "2025-26");
  assert.equal(api.created.flat().length, 2, "read: both calls");
  const doc = state.records.get(ID)!.documents[0];
  assert.ok(doc.reads.C && doc.reads.rest, "the read is recorded");
  assert.equal(doc.items["C.116"].status, "failed", "nothing in it confirms 2025-26");
  assert.match(doc.items["C.116"].failures!.map((f) => `${f.check}: ${f.detail}`).join(), /edition-mismatch: the document states no edition/);
  assert.equal(state.reported.entries.length, 0, "nothing published");
  assert.ok(state.queue.items.some((q) => q.unit_id === ID && q.code === "C.116"), "held for review");

  // The next run: the same document is neither fetched nor sent again.
  const f2 = fakeFetch({ [url]: pdf });
  const api2 = batchApi({ C: C_PLAN, rest: REST_PLAN });
  state.summary = emptySummaryV3("r2", OCT.toISOString());
  await pipeline({ fetch: f2.fn, batches: api2, archive }).run(state, runOpts([school(ID)], { run: "r2" }));
  assert.equal(api2.created.length, 0, "not read again");
  assert.equal(f2.docs().length, 0, "not fetched again this month");
});

test("an assumed edition that an item's own text confirms (I2's 'Fall 2025') publishes", async () => {
  const ID = "239107";
  const url = `https://c${ID}.edu/ir/documents/final.pdf`;
  const state = freshState([recipe(ID, [{ kind: "cds", url, format: "pdf" }])]);
  await pipeline({ fetch: fakeFetch({ [url]: noEditionPdf({ confirm: true }) }).fn, batches: batchApi({ C: C_PLAN, rest: REST_PLAN }), archive: memoryArchive() }).run(state, runOpts([school(ID)]));
  assert.equal(state.manifest.documents[0].edition_from, "assumed");
  const doc = state.records.get(ID)!.documents[0];
  assert.equal(doc.items["I.201"].status, "passed");
  assert.equal(doc.items["C.116"].status, "passed");
  assert.equal(state.reported.entries[0].admissions.applicants, 48000);
});

test("a no-edition CDS archived before this fix (Marquette's entry: edition null, never read) is read from the archive the next run", async () => {
  const ID = "239108";
  const url = `https://c${ID}.edu/ir/documents/cds-2025-2026_final.pdf`;
  const pdf = noEditionPdf();
  const sha = sha256(pdf);
  const archive = memoryArchive();
  await archive.put(sha, pdf, "pdf");
  const state = freshState([recipe(ID, [{ kind: "cds", url, format: "pdf", sha256: sha, checked: "2026-10-05" }])]);
  state.manifest.documents.push({ sha256: sha, unit_id: ID, url, kind: "cds", type: "pdf-flat", edition: null, retrieved: "2026-10-05", bytes: pdf.length, archive: `mem:${sha}.pdf` });
  const f = fakeFetch({ [url]: pdf });
  const api = batchApi({ C: C_PLAN, rest: REST_PLAN });
  await pipeline({ fetch: f.fn, batches: api, archive }).run(state, runOpts([school(ID)]));
  assert.equal(f.docs().length, 0, "read from the archive, no request");
  assert.deepEqual([state.manifest.documents[0].edition, state.manifest.documents[0].edition_from], ["2025-26", "url"]);
  assert.equal(api.created.flat().length, 2);
  assert.equal(state.reported.entries[0].admissions.applicants, 48000);
});

test("a no-edition document with too little text is looked at once and left alone after", async () => {
  const ID = "239109";
  const url = `https://c${ID}.edu/ir/documents/part-a.pdf`;
  const tiny = tinyPdf([{ text: [{ x: 63, y: 700, s: "A1 Address information for the institution, enough text not to be a scan of a page" }, { x: 63, y: 680, s: "A2 Source of institutional control: private, nonprofit, independent of any church" }, { x: 63, y: 660, s: "A3 Classify your undergraduate institution: coeducational college" }] }]);
  const archive = memoryArchive();
  const api = batchApi();
  const state = freshState([recipe(ID, [{ kind: "cds", url, format: "pdf" }])]);
  await pipeline({ fetch: fakeFetch({ [url]: tiny }).fn, batches: api, archive }).run(state, runOpts([school(ID)]));
  assert.deepEqual([state.manifest.documents[0].edition, state.manifest.documents[0].edition_from], [null, "none"]);
  assert.equal(api.created.length, 0);
  archive.gets.length = 0;
  state.summary = emptySummaryV3("r2", OCT.toISOString());
  await pipeline({ fetch: fakeFetch({ [url]: tiny }).fn, batches: api, archive }).run(state, runOpts([school(ID)], { run: "r2" }));
  assert.equal(archive.gets.length, 0, "not looked at again");
});

/* ------------------------------------------------------------------ */
/* 2. Class profiles                                                   */
/* ------------------------------------------------------------------ */

const PROFILE_READ: Partial<Extraction> = { cohort: "first-year", scope: "all-rounds", entering_term: "Fall 2025", applicants: 48000, admitted: null, enrolled: null, acceptance_rate: null, quotes: { applicants: "48,000 students applied" }, page: 1 };

test("a class-profile PDF is read as a PDF (its page text), not decoded as HTML", async () => {
  const ID = "110662";
  const url = `https://c${ID}.edu/uploads/UndergradProfile2025-2026_final.pdf`;
  const pdf = tinyPdf([
    {
      text: [
        { x: 60, y: 700, s: "First-year class profile, Fall 2025: the students who joined us this fall" },
        { x: 60, y: 680, s: "48,000 students applied" },
        { x: 60, y: 660, s: "They come from every state and from more than eighty countries around the world" },
        { x: 60, y: 640, s: "Middle 50 percent unweighted grade point average and test scores of admitted students" },
      ],
    },
  ]);
  const { client, calls, sent } = fakeClient(PROFILE_READ);
  const state = freshState([recipe(ID, [{ kind: "class-profile", url, format: "pdf" }])]);
  await pipeline({ fetch: fakeFetch({ [url]: pdf }).fn, batches: batchApi(), archive: memoryArchive(), client }).run(state, runOpts([school(ID)]));
  assert.equal(calls.length, 1, "read in the run that found it");
  assert.match(sent()[0], /--- Page 1 ---/, "the PDF's page text");
  assert.doesNotMatch(sent()[0], /%PDF|endobj|BT \/F1/, "not the file's bytes");
  assert.equal((state.sources.recipes[0].sources[0].extraction as Extraction).applicants, 48000);
  assert.equal(state.sources.recipes[0].sources[0].read_as, "pdf");

  // A PDF profile "read" before the fix (decoded as HTML: no read_as) is read again from the archive, once.
  const src = state.sources.recipes[0].sources[0];
  delete src.read_as;
  src.extraction = null;
  const again = fakeClient(PROFILE_READ);
  const archive = memoryArchive();
  await archive.put(src.sha256!, pdf, "pdf");
  state.summary = emptySummaryV3("r2", OCT.toISOString());
  await pipeline({ fetch: fakeFetch({}).fn, batches: batchApi(), archive, client: again.client }).run(state, runOpts([school(ID)], { run: "r2" }));
  assert.equal(again.calls.length, 1, "read again");
  assert.equal(state.sources.recipes[0].sources[0].read_as, "pdf");
  const third = fakeClient(PROFILE_READ);
  state.summary = emptySummaryV3("r3", OCT.toISOString());
  await pipeline({ fetch: fakeFetch({}).fn, batches: batchApi(), archive, client: third.client }).run(state, runOpts([school(ID)], { run: "r3" }));
  assert.equal(third.calls.length, 0, "and not after");
});

test("a class profile the picker finds is read in the same run; a model-named profile page that 404s isn't kept", async () => {
  const run = async (pick: number) => {
    const ID = "230764";
    const site = `https://c${ID}.edu`;
    const live = `${site}/about/numbers`;
    const dead = `${site}/about/old-numbers`;
    // Neutral link text and paths, so the free steps don't take them: the paid picker names one.
    const home = `<a href="/about/numbers">Our numbers</a><a href="/about/old-numbers">Last year</a>`;
    const f = fakeFetch({ [`${site}/`]: home, [site]: home, [live]: "<h2>Class of 2029</h2><p>48,000 students applied</p>" });
    const { client, calls } = fakeClient(PROFILE_READ);
    const state = freshState([]);
    await pipeline({ fetch: f.fn, batches: batchApi({ pick: { class_profile: pick } }), archive: memoryArchive(), client }).run(state, runOpts([school(ID)]));
    return { r: state.sources.recipes.find((x) => x.unit_id === ID)!, f, calls, live, dead };
  };
  const ok = await run(1);
  const src = ok.r.sources.find((s) => s.url === ok.live);
  assert.ok(src, JSON.stringify(ok.r));
  assert.equal(ok.r.discovery?.path, "picker");
  assert.equal(ok.calls.filter((c) => c.messages && JSON.stringify(c.messages).includes("48,000")).length, 1, "read once, in this run");
  assert.equal((src.extraction as Extraction).applicants, 48000);
  assert.equal(ok.f.docs().filter((u) => u === ok.live).length, 1, "fetched once: the bytes the check got are the ones read");

  const gone = await run(2);
  assert.ok(!gone.r.sources.some((s) => s.url === gone.dead), "a page that 404s isn't a find");
  assert.notEqual(gone.r.discovery?.tried.find((t) => t.step === 2)?.result, "found");
});

/* ------------------------------------------------------------------ */
/* 3. A malformed link                                                 */
/* ------------------------------------------------------------------ */

test("a malformed link ('{%=o.guid %}', '%E9') is read as written: no 'URI malformed'", () => {
  const links = findLinks(`<a href="{%=o.guid %}">x</a><a href="/files/CDS%E9_2025-2026.pdf">Common Data Set</a>`, "https://www.wcu.edu/");
  assert.equal(links.length, 2);
  for (const l of links) assert.doesNotThrow(() => linkKind(l));
  assert.equal(linkKind(links[1]), "cds");
  assert.equal(entryYearOf(links[1].url), 2025);
});

test("a malformed link on a college's home page doesn't fail its discovery (Western Carolina)", async () => {
  const ID = "200004";
  const site = `https://c${ID}.edu`;
  const cds = `${site}/ir/CDS_2025-2026.pdf`;
  const home = `<a href="{%=o.guid %}">template</a><a href="/ir/">Institutional Research</a>`;
  const ir = `<a href="{%=o[i].guid %}">x</a><a href="/ir/CDS_2025-2026.pdf">Common Data Set 2025-2026</a>`;
  const f = fakeFetch({ [`${site}/`]: home, [site]: home, [`${site}/ir/`]: ir, [`${site}/ir`]: ir, [cds]: noEditionPdf() });
  const state = freshState([]);
  await pipeline({ fetch: f.fn, batches: batchApi({ C: C_PLAN, rest: REST_PLAN }), archive: memoryArchive() }).run(state, runOpts([school(ID)]));
  const r = state.sources.recipes.find((x) => x.unit_id === ID)!;
  assert.ok(!r.discovery!.tried.some((t) => t.result === "failed"), JSON.stringify(r.discovery!.tried));
  assert.ok(r.sources.some((s) => s.url === cds), JSON.stringify(r.sources));
  assert.equal(state.manifest.documents[0].edition, "2025-26");
});

/* ------------------------------------------------------------------ */
/* Santa Clara: a model's mistyped CDS link                            */
/* ------------------------------------------------------------------ */

test("a CDS link never fetched that its index page doesn't list is replaced by the page's link to the same edition (Santa Clara)", async () => {
  const typo = "https://www.scu.edu/media/offices/institutional-research/fampf/common-data-set/rba13-Common_Data_Set_2025-2026.pdf";
  const real = "https://www.scu.edu/media/offices/institutional-research/ff/common-data-set/rba13-Common_Data_Set_2025-2026.pdf";
  const html = `<a href="/media/offices/institutional-research/ff/common-data-set/rba13-Common_Data_Set_2025-2026.pdf">2025-2026</a><a href="/media/offices/institutional-research/ff/common-data-set/CDS-2024-2025---Final.pdf">2024-2025</a>`;
  const links = findLinks(html, "https://www.scu.edu/institutional-research/data/common-data-set-cds/");
  const out = replaceUnlisted([{ kind: "cds", url: typo, format: "pdf" }], links, () => false);
  assert.deepEqual(out.replaced, [[typo, real]]);
  assert.deepEqual(out.sources, [{ kind: "cds", url: real, format: "pdf" }]);
  assert.deepEqual(replaceUnlisted([{ kind: "cds", url: typo, format: "pdf" }], links, () => true).replaced, [], "a link fetched before is kept");

  // In a run: the recipe's index page is re-scanned, the real file fetched and read.
  const ID = "122931";
  const index = "https://www.scu.edu/institutional-research/data/common-data-set-cds/";
  const f = fakeFetch({ [index]: html, [real]: noEditionPdf() });
  const state = freshState([recipe(ID, [{ kind: "cds", url: typo, format: "pdf", checked: "2026-10-10" }], [index])]);
  await pipeline({ fetch: f.fn, batches: batchApi({ C: C_PLAN, rest: REST_PLAN }), archive: memoryArchive() }).run(state, runOpts([school(ID)]));
  assert.ok(!f.docs().includes(typo));
  assert.equal(state.manifest.documents[0].url, real);
  assert.equal(state.reported.entries[0].admissions.applicants, 48000);
});
