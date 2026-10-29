/**
 * The essay prompts route (specs/product/essays/prompts.md): the reader on four saved pages (a plain list, a table
 * with limits, program-specific prompts, a "no supplement" page) with a fake model client returning canned structured
 * output; the request's shape; every check on planted bad values; discovery's candidate ordering on a saved apply
 * page and the ladder over a fake site; the merge setting, replacing, and removing the block with its place kept; the
 * lineage check on a school with and without the block; the platform prompts file's shape; the workflow file.
 * `npm test`. No network, no model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { FIELDS, registeredPathFor } from "../lib/fields.ts";
import { lineageFor, validateSchool } from "../lib/lineage.ts";
import type { DatasetMeta, EssayPrompt, PlatformPromptsFile, School } from "../lib/types.ts";
import { findLinks } from "../scripts/lib/college-reported/documents.mts";
import type { ModelClient } from "../scripts/lib/college-reported/models.mts";
import { SpendCap, SpendCapReached } from "../scripts/lib/high-schools/profiles/budget.mts";
import { checkRecord, normalizeForMatch } from "../scripts/lib/essay-prompts/checks.mts";
import { normalizeCycle, openCycle } from "../scripts/lib/essay-prompts/cycle.mts";
import { applyLinkScore, buildPickerRequest, discoverEssayPage, essayLinkScore, isPlatformUrl, looksLikeEssayPage, rankApplyLinks, rankLinks, startPages, wellKnownUrls, type DiscoverHttp } from "../scripts/lib/essay-prompts/discover.mts";
import { promptProblems } from "../scripts/lib/essay-prompts/checks.mts";
import { applyEssays, lineageOf, placeEssaysLineage, platformProblems, stripEssays } from "../scripts/lib/essay-prompts/merge.mts";
import { READ_MAX_TOKENS, READ_MODEL, READ_SCHEMA, READ_SYSTEM, ReadFailed, buildReadRequest, pageText, parseReadResponse, readEssayPage, toRecord, type ReadAnswer } from "../scripts/lib/essay-prompts/read.mts";
import { prBody, releaseNote, type RunSummary } from "../scripts/lib/essay-prompts/report.mts";
import { runCollege } from "../scripts/lib/essay-prompts/run.mts";
import { READER_VERSION, serializeHeld, serializeRecord, type EssayRecord } from "../scripts/lib/essay-prompts/store.mts";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "tests", "fixtures", "essay-prompts");
const TODAY = "2026-10-28";
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIX, name)));

/* ------------------------------------------------------------------ */
/* A fake client                                                       */
/* ------------------------------------------------------------------ */

function message(body: unknown, stop: Anthropic.Message["stop_reason"] = "end_turn"): Anthropic.Message {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: READ_MODEL,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body), citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 4000, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

function fakeClient(answer: (params: Anthropic.MessageCreateParamsNonStreaming) => Anthropic.Message) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = {
    messages: {
      create: async (b) => {
        calls.push(b);
        return answer(b);
      },
      stream: () => {
        throw new Error("the essay reader never streams");
      },
    },
  };
  return { client, calls };
}

const all = (text: string, quote: string, o: Partial<ReadAnswer["prompts"][number]> = {}): ReadAnswer["prompts"][number] => ({
  text,
  kind: "essay",
  limit: null,
  required: true,
  applies_to: { kind: "all", program: null },
  quote,
  ...o,
});

/** The canned answers a careful reader gives for each saved page. */
const ANSWERS: Record<string, ReadAnswer> = {
  "plain-list.html": {
    cycle_quote: "2026–2027 Supplemental Essay Prompts",
    status: "published",
    status_quote: null,
    choose: null,
    prompts: [
      all("Why are you interested in attending Example University? Tell us about the parts of our community you hope to join.", "Each response should be no more than 250 words.", { kind: "why_us", limit: { kind: "words", max: 250, min: null } }),
      all("Describe a time you changed your mind about something important to you. What did you learn from it?", "Each response should be no more than 250 words.", { limit: { kind: "words", max: 250, min: null } }),
      all("If you wish, you may tell us about a hardship or circumstance that has affected your education in 150 words or fewer.", "Optional: If you wish, you may tell us about a hardship or circumstance that has affected your education in 150 words or fewer.", { kind: "optional", required: false, limit: { kind: "words", max: 150, min: null } }),
    ],
  },
  "table-limits.html": {
    cycle_quote: "These questions are for students applying for fall 2027 entry.",
    status: "published",
    status_quote: null,
    choose: null,
    prompts: [
      all("What is a problem you would like to help solve, and why does it matter to you?", "What is a problem you would like to help solve, and why does it matter to you? | Up to 1,500 characters | Required", { limit: { kind: "characters", max: 1500, min: null } }),
      all("List three books, films, or podcasts that have shaped your thinking.", "List three books, films, or podcasts that have shaped your thinking. | Up to 200 characters | Required", { kind: "short_answer", limit: { kind: "characters", max: 200, min: null } }),
      all("Is there anything else you would like us to know?", "Is there anything else you would like us to know? | Up to 300 words | Optional", { kind: "optional", required: false, limit: { kind: "words", max: 300, min: null } }),
    ],
  },
  "program-specific.html": {
    cycle_quote: "First-Year Essay Questions for 2026-27",
    status: "published",
    status_quote: null,
    choose: null,
    prompts: [
      all("Tell us about a community you belong to and the role you play in it.", "All applicants must answer this question in 300 words or fewer:", { limit: { kind: "words", max: 300, min: null } }),
      all("Describe something you built, fixed, or designed, and what you would change about it now.", "Applicants to the College of Engineering must also answer the following in 200 words or fewer.", { kind: "program", limit: { kind: "words", max: 200, min: null }, applies_to: { kind: "program", program: "College of Engineering" } }),
      all("What experiences have led you to choose nursing as a career?", "Applicants to the School of Nursing must also respond in 250 words or fewer.", { kind: "program", limit: { kind: "words", max: 250, min: null }, applies_to: { kind: "program", program: "School of Nursing" } }),
    ],
  },
  "no-supplement.html": {
    cycle_quote: "Application Essays, 2026–27",
    status: "none",
    status_quote: "Plainfield College does not require a supplemental essay.",
    choose: null,
    prompts: [],
  },
};

const SCHOOL = { unit_id: "999001", name: "Example University" };

async function readFixture(name: string) {
  const bytes = fixture(name);
  const text = await pageText(bytes, "html");
  const { client, calls } = fakeClient(() => message(ANSWERS[name]));
  const cap = new SpendCap(5);
  const url = `https://admissions.example.edu/${name.replace(".html", "")}`;
  const read = await readEssayPage(client, cap, { school: SCHOOL, url, text });
  const record = toRecord(read.answer, { school: SCHOOL, url, retrieved: TODAY, sha256: "a".repeat(64), via: "apply-page-link", model: read.model });
  return { record, text, calls, cap };
}

/* ------------------------------------------------------------------ */
/* The reader                                                          */
/* ------------------------------------------------------------------ */

test("the request: claude-opus-5, adaptive thinking at medium effort, the cached system block, a JSON schema, no prefill", () => {
  const { params } = buildReadRequest({ school: SCHOOL, url: "https://x.edu/essays", text: "Essay prompts" });
  assert.equal(params.model, "claude-opus-5");
  assert.equal(params.max_tokens, READ_MAX_TOKENS);
  assert.equal(READ_MAX_TOKENS, 8000);
  assert.deepEqual(params.thinking, { type: "adaptive" });
  const oc = params.output_config as { effort?: string; format?: { type: string; schema: unknown } };
  assert.equal(oc.effort, "medium");
  assert.equal(oc.format?.type, "json_schema");
  const system = params.system as Anthropic.TextBlockParam[];
  assert.equal(system.length, 1);
  assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
  assert.equal(params.messages.length, 1);
  assert.equal(params.messages[0].role, "user", "the last turn is the user's: no assistant prefill");
  assert.match(String(params.messages[0].content), /<page>\nEssay prompts\n<\/page>/);
});

test("reader: a plain list: three prompts verbatim, the why-us read, the optional one, the cycle from the heading", async () => {
  const { record, text, calls, cap } = await readFixture("plain-list.html");
  assert.equal(calls.length, 1, "one model read per page");
  assert.ok(cap.spent > 0, "the read's cost is recorded");
  assert.equal(record.cycle, "2026-27");
  assert.equal(record.status, "published");
  assert.deepEqual(record.prompts.map((p) => p.id), ["999001:2026-27:1", "999001:2026-27:2", "999001:2026-27:3"]);
  assert.deepEqual(record.prompts.map((p) => p.kind), ["why_us", "essay", "optional"]);
  assert.deepEqual(record.prompts.map((p) => p.required), [true, true, false]);
  assert.deepEqual(record.prompts[0].limit, { kind: "words", max: 250 }, "a null minimum is left out");
  assert.equal(record.prompts[0].applies_to, "all");
  assert.deepEqual(checkRecord(record, { today: TODAY, pageText: text }), []);
});

test("reader: a table with limits: characters and words, required and optional from the table's own column", async () => {
  const { record, text } = await readFixture("table-limits.html");
  assert.equal(record.cycle, "2026-27", "fall 2027 entry is the 2026-27 cycle");
  assert.deepEqual(record.prompts.map((p) => p.limit), [{ kind: "characters", max: 1500 }, { kind: "characters", max: 200 }, { kind: "words", max: 300 }]);
  assert.deepEqual(record.prompts.map((p) => p.required), [true, true, false]);
  assert.deepEqual(checkRecord(record, { today: TODAY, pageText: text }), []);
});

test("reader: program-specific prompts carry their program", async () => {
  const { record, text } = await readFixture("program-specific.html");
  assert.equal(record.prompts[0].applies_to, "all");
  assert.deepEqual(record.prompts[1].applies_to, { program: "College of Engineering" });
  assert.deepEqual(record.prompts[2].applies_to, { program: "School of Nursing" });
  assert.deepEqual(record.prompts.map((p) => p.kind), ["essay", "program", "program"]);
  assert.deepEqual(checkRecord(record, { today: TODAY, pageText: text }), []);
});

test("reader: a no-supplement page is status none, no prompts, and quotes the sentence", async () => {
  const { record, text } = await readFixture("no-supplement.html");
  assert.equal(record.status, "none");
  assert.deepEqual(record.prompts, []);
  assert.equal(record.status_quote, "Plainfield College does not require a supplemental essay.");
  assert.deepEqual(checkRecord(record, { today: TODAY, pageText: text }), []);
});

test("reader: a refusal, a cut answer, or malformed JSON is no record", () => {
  assert.throws(() => parseReadResponse(message("", "refusal")), (e: unknown) => e instanceof ReadFailed && e.reason === "refusal");
  assert.throws(() => parseReadResponse(message("{\"cycle_quote\":", "max_tokens")), (e: unknown) => e instanceof ReadFailed && e.reason === "max_tokens");
  assert.throws(() => parseReadResponse(message("not json")), (e: unknown) => e instanceof ReadFailed && e.reason === "malformed");
  assert.throws(() => parseReadResponse(message({ status: "maybe", prompts: [] })), (e: unknown) => e instanceof ReadFailed && e.reason === "malformed");
});

test("reader: the spend cap stops a read before it starts", async () => {
  const { client, calls } = fakeClient(() => message(ANSWERS["plain-list.html"]));
  await assert.rejects(readEssayPage(client, new SpendCap(0.001), { school: SCHOOL, url: "https://x.edu", text: "x".repeat(40_000) }), SpendCapReached);
  assert.equal(calls.length, 0);
});

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

const PAGE = "2026–2027 Essay Prompts. Please answer the following in 250 words or fewer. Why do you want to attend Example University? Tell us about a challenge you faced and what it taught you. Optional: if you wish, share anything else. Applicants to the School of Music: describe a piece you love.";

function good(): EssayRecord {
  return {
    unit_id: "999001",
    name: "Example University",
    cycle: "2026-27",
    status: "published",
    source_url: "https://admissions.example.edu/essays",
    retrieved: TODAY,
    sha256: "b".repeat(64),
    cycle_quote: "2026–2027 Essay Prompts",
    via: "well-known-path",
    model: READ_MODEL,
    reader: READER_VERSION,
    prompts: [
      { id: "999001:2026-27:1", text: "Why do you want to attend Example University?", kind: "why_us", limit: { kind: "words", max: 250 }, required: true, applies_to: "all", quote: "Please answer the following in 250 words or fewer." },
      { id: "999001:2026-27:2", text: "Tell us about a challenge you faced and what it taught you.", kind: "essay", limit: { kind: "words", max: 250 }, required: true, applies_to: "all", quote: "Please answer the following in 250 words or fewer." },
      { id: "999001:2026-27:3", text: "share anything else.", kind: "optional", limit: null, required: false, applies_to: "all", quote: "Optional: if you wish, share anything else." },
    ],
  };
}

test("checks: the good record passes", () => {
  assert.deepEqual(checkRecord(good(), { today: TODAY, pageText: PAGE }), []);
});

test("checks: every rule catches its planted bad value", () => {
  const plant = (change: (r: EssayRecord) => void, expect: RegExp, today = TODAY) => {
    const r = good();
    change(r);
    const problems = checkRecord(r, { today, pageText: PAGE });
    assert.ok(problems.some((p) => expect.test(p)), `expected ${expect} in ${JSON.stringify(problems)}`);
  };
  const p = (r: EssayRecord, i = 1) => r.prompts[i] as EssayPrompt & { limit: NonNullable<EssayPrompt["limit"]> };
  plant((r) => ((r.cycle = ""), (r.cycle_quote = "")), /names no cycle/);
  plant((r) => (r.cycle = "2025-26"), /older than the open cycle 2026-27/);
  plant((r) => (r.cycle = "2028-29"), /more than one cycle ahead/);
  plant((r) => (r.cycle_quote = "2026-2027 Prompts for Everyone"), /cycle's words aren't on the page/);
  plant((r) => (r.prompts[1].text = "Tell us."), /prompt is 8 characters/);
  plant((r) => (r.prompts[1].text = "x".repeat(1501)), /prompt is 1501 characters/);
  plant((r) => (r.prompts[1].text = "Tell us about a hardship you faced and what it taught you."), /prompt text isn't on the page verbatim/);
  plant((r) => (r.prompts[1].quote = "Answer in 300 words."), /quote isn't on the page verbatim/);
  plant((r) => (r.prompts[1].quote = ""), /no quote/);
  plant((r) => (p(r).limit = { kind: "words", max: 10 }), /limit 10 words is outside 25 to 2000/);
  plant((r) => (p(r).limit = { kind: "words", max: 3000 }), /limit 3000 words/);
  plant((r) => (p(r).limit = { kind: "characters", max: 50 }), /limit 50 characters is outside 100 to 10000/);
  plant((r) => (p(r).limit = { kind: "words", max: 250.5 }), /limit 250.5 words/);
  plant((r) => (p(r).limit = { kind: "words", max: 250, min: 300 }), /minimum 300 isn't a whole number below the maximum/);
  plant((r) => (r.prompts[1].required = false), /marked optional, but neither the prompt nor its quote says optional/);
  plant((r) => (r.prompts[2].required = true), /marked required, but the page's word is optional/);
  plant((r) => (r.prompts[1].kind = "why_us"), /kind why_us, but the prompt doesn't ask why this college/);
  plant((r) => (r.prompts[1].kind = "program"), /kind program, but applies_to names no program/);
  plant((r) => (r.prompts[1].applies_to = { program: "School of Dance" }), /program "School of Dance" isn't named on the page/);
  plant((r) => (r.prompts[1].applies_to = { program: " " }), /applies_to names an empty program/);
  plant((r) => (r.prompts[1].id = "999001:2026-27:7"), /id 999001:2026-27:7 isn't 999001:2026-27:2/);
  plant((r) => (r.prompts = []), /status published, but no prompts/);
  plant((r) => (r.status = "none"), /status none, but 3 prompt/);
  plant((r) => ((r.status = "refers_to_form"), (r.prompts = [])), /without the page's sentence/);
  plant((r) => (r.source_url = "admissions.example.edu"), /isn't a web address/);
  plant((r) => (r.retrieved = "October 28"), /isn't an ISO date/);
  plant((r) => (r.prompts[0].text = r.prompts[1].text), /the same prompt twice/);
});

test("checks: a program prompt named on the page passes; verbatim matching ignores curly quotes and spacing", () => {
  const r = good();
  r.prompts[1] = { ...r.prompts[1], text: "describe a piece you love.", kind: "program", applies_to: { program: "School of Music" }, quote: "Applicants to the School of Music: describe a piece you love." };
  assert.deepEqual(checkRecord(r, { today: TODAY, pageText: PAGE }), []);
  assert.equal(normalizeForMatch("you’re  “here” — now"), normalizeForMatch(`you're "here" - now`));
  assert.equal(normalizeForMatch("Tell <em>us</em> ."), normalizeForMatch("Tell <em>us</em>."));
});

test("cycles: the open cycle turns on 1 August; page words normalize", () => {
  assert.equal(openCycle("2026-07-31"), "2025-26");
  assert.equal(openCycle("2026-08-01"), "2026-27");
  assert.equal(openCycle("2027-01-15"), "2026-27");
  assert.equal(normalizeCycle("2026–2027 Supplemental Essays"), "2026-27");
  assert.equal(normalizeCycle("for the 2026/27 application"), "2026-27");
  assert.equal(normalizeCycle("Students applying for Fall 2027"), "2026-27");
  assert.equal(normalizeCycle("Updated 2020-2024"), null, "not consecutive years");
  assert.equal(normalizeCycle("© 2026 Example University"), null, "a lone year is not a cycle");
  assert.equal(normalizeCycle(null), null);
});

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

test("discovery: candidates on an apply page, best first; tips, blogs, and stories never", () => {
  const links = findLinks(readFileSync(join(FIX, "apply-page.html"), "utf8"), "https://admissions.example.edu/apply");
  assert.deepEqual(rankLinks(links).map((l) => new URL(l.url).pathname), [
    "/apply/first-year/supplemental-essay-prompts",
    "/apply/writing-supplement",
    "/apply/first-year/essays",
    "/about/essays-on-history",
  ]);
  assert.equal(essayLinkScore({ url: "https://x.edu/blog/how-to-write-a-great-college-essay", text: "Tips" }), 0);
  assert.equal(essayLinkScore({ url: "https://x.edu/news/essays-that-worked", text: "Essays that worked" }), 0);
});

test("discovery: the start pages and well-known paths come from the links the dataset holds", () => {
  const school = { unit_id: "1", name: "X", links: { website: "www.x.edu", price_calculator: null, apply: "https://apply.x.edu/portal", admissions: "https://admissions.x.edu/" } } as Pick<School, "unit_id" | "name" | "links">;
  assert.deepEqual(startPages(school), ["https://apply.x.edu/portal", "https://admissions.x.edu/", "https://www.x.edu"]);
  const urls = wellKnownUrls(startPages(school));
  assert.equal(urls[0], "https://apply.x.edu/apply/essays");
  assert.ok(urls.includes("https://admissions.x.edu/admission/essay-prompts"));
  assert.ok(urls.includes("https://www.x.edu/writing-supplement"));
});

test("looksLikeEssayPage: limits, questions, or a no-supplement sentence; a page that never says essay isn't one", () => {
  assert.ok(looksLikeEssayPage("Essay prompts. Answer in 250 words."));
  assert.ok(looksLikeEssayPage("Plainfield College does not require a supplemental essay."));
  assert.ok(!looksLikeEssayPage("Visit campus. Tours run daily? Ask us? Anything?"));
  assert.ok(!looksLikeEssayPage("Our essays on history are in the library."));
});

/** A fake site: path → [status, html]; everything else 404; requests recorded. */
function fakeSite(pages: Record<string, string>, opts: { sitemaps?: string[]; refuse?: string[] } = {}): DiscoverHttp & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async get(url: string) {
      requested.push(url);
      if (opts.refuse?.some((h) => url.includes(h))) return null;
      const body = pages[url];
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200, headers: { "content-type": url.endsWith(".xml") ? "application/xml" : "text/html" } });
    },
    async sitemaps() {
      return opts.sitemaps ?? [];
    },
  };
}

const SITE_SCHOOL = { unit_id: "999001", name: "Example University", links: { website: "https://www.example.edu", price_calculator: null, apply: "https://admissions.example.edu/apply", admissions: null } } as Pick<School, "unit_id" | "name" | "links">;

test("discovery: follows the apply page's best essay link and stops at the first page that reads like one", async () => {
  const http = fakeSite({
    "https://admissions.example.edu/apply": readFileSync(join(FIX, "apply-page.html"), "utf8"),
    "https://admissions.example.edu/apply/first-year/supplemental-essay-prompts": readFileSync(join(FIX, "plain-list.html"), "utf8"),
  });
  const r = await discoverEssayPage(SITE_SCHOOL, undefined, { http });
  assert.equal(r.found?.url, "https://admissions.example.edu/apply/first-year/supplemental-essay-prompts");
  assert.equal(r.found?.via, "apply-page-link");
  assert.ok(!http.requested.some((u) => u.includes("/blog/")), "a tips page is never fetched");
  assert.equal(r.cost, 0);
});

test("discovery: falls back to well-known paths, then the sitemap, then the picker", async () => {
  const wellKnown = fakeSite({ "https://admissions.example.edu/admission/essay-prompts": readFileSync(join(FIX, "table-limits.html"), "utf8") });
  const a = await discoverEssayPage(SITE_SCHOOL, undefined, { http: wellKnown });
  assert.equal(a.found?.via, "well-known-path");
  assert.equal(a.found?.url, "https://admissions.example.edu/admission/essay-prompts");

  const sitemap = fakeSite(
    {
      "https://admissions.example.edu/sitemap.xml": "<urlset><url><loc>https://admissions.example.edu/news/x</loc></url><url><loc>https://admissions.example.edu/first-year/supplemental-essays-2026</loc></url></urlset>",
      "https://admissions.example.edu/first-year/supplemental-essays-2026": readFileSync(join(FIX, "program-specific.html"), "utf8"),
    },
    { sitemaps: ["https://admissions.example.edu/sitemap.xml"] },
  );
  const b = await discoverEssayPage(SITE_SCHOOL, undefined, { http: sitemap });
  assert.equal(b.found?.via, "sitemap");

  const picked = fakeSite({
    "https://admissions.example.edu/apply": '<a href="/apply/deadlines">Deadlines</a><a href="/apply/qs">Member questions for applicants</a><a href="/apply/hidden">What we ask</a>',
    "https://admissions.example.edu/apply/hidden": readFileSync(join(FIX, "no-supplement.html"), "utf8"),
  });
  const { client, calls } = fakeClient((p) => {
    const rows = String(p.messages[0].content).split("\n").filter((l) => / \| /.test(l));
    const n = rows.findIndex((l) => l.includes("/apply/hidden")) + 1;
    return message({ page: n });
  });
  const c = await discoverEssayPage(SITE_SCHOOL, undefined, { http: picked, client, cap: new SpendCap(1) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "claude-haiku-4-5", "the picker is one cheap call");
  assert.equal(c.found?.via, "picker");
  assert.equal(c.found?.url, "https://admissions.example.edu/apply/hidden");
});

test("discovery: a refusing host is noted, and nothing found is a null find", async () => {
  const r = await discoverEssayPage(SITE_SCHOOL, undefined, { http: fakeSite({}, { refuse: ["admissions.example.edu"] }) });
  assert.equal(r.found, null);
  assert.equal(r.blocked, "admissions.example.edu");
});

/* ------------------------------------------------------------------ */
/* One college end to end                                              */
/* ------------------------------------------------------------------ */

test("runCollege: found, read, checked, passed; the same bytes again are unchanged; a bad read is held", async () => {
  const http = fakeSite({
    "https://admissions.example.edu/apply": readFileSync(join(FIX, "apply-page.html"), "utf8"),
    "https://admissions.example.edu/apply/first-year/supplemental-essay-prompts": readFileSync(join(FIX, "plain-list.html"), "utf8"),
  });
  const { client, calls } = fakeClient(() => message(ANSWERS["plain-list.html"]));
  const deps = { http, client, cap: new SpendCap(5), today: TODAY };
  const first = await runCollege(SITE_SCHOOL, undefined, null, deps);
  assert.equal(first.kind, "passed");
  if (first.kind !== "passed") return;
  assert.equal(first.record.source_url, "https://admissions.example.edu/apply/first-year/supplemental-essay-prompts");
  assert.equal(first.recipe.sha256, first.record.sha256);
  const again = await runCollege(SITE_SCHOOL, first.recipe, first.record, deps);
  assert.equal(again.kind, "unchanged");
  assert.equal(calls.length, 1, "an unchanged page is never read twice");

  // A page that names no cycle passes with the open cycle assumed, marked for the PR's list (most pages print no year).
  const unnamed = fakeClient(() => message({ ...ANSWERS["plain-list.html"], cycle_quote: null }));
  const assumed = await runCollege(SITE_SCHOOL, undefined, null, { ...deps, client: unnamed.client });
  assert.equal(assumed.kind, "passed");
  if (assumed.kind === "passed") {
    assert.equal(assumed.record.cycle, "2026-27");
    assert.equal(assumed.record.cycle_assumed, true);
    assert.equal(assumed.record.cycle_quote, "");
    assert.equal(assumed.record.prompts[0].id, "999001:2026-27:1");
  }

  const bad = fakeClient(() => message({ ...ANSWERS["plain-list.html"], prompts: ANSWERS["plain-list.html"].prompts.map((p, i) => (i === 1 ? { ...p, text: "Describe a time you changed your socks." } : p)) }));
  const held = await runCollege(SITE_SCHOOL, undefined, null, { ...deps, client: bad.client });
  assert.equal(held.kind, "held");
  if (held.kind === "held") assert.ok(held.problems.some((p) => /prompt 2: prompt text isn't on the page verbatim/.test(p)), JSON.stringify(held.problems));

  const refused = fakeClient(() => message("", "refusal"));
  const failed = await runCollege(SITE_SCHOOL, undefined, null, { ...deps, client: refused.client });
  assert.deepEqual([failed.kind, failed.kind === "failed" && failed.reason], ["failed", "refusal"]);
});

/* ------------------------------------------------------------------ */
/* The merge and the lineage check                                     */
/* ------------------------------------------------------------------ */

const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const meta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8")) as DatasetMeta;
const withLineage = schools.find((s) => s.lineage && !s.essays && validateSchool(s, meta).length === 0)!;
const withoutLineage = schools.find((s) => !s.lineage && !s.essays && validateSchool(s, meta).length === 0)!;

function recordFor(school: School, o: Partial<EssayRecord> = {}): EssayRecord {
  const r = good();
  return { ...r, unit_id: school.unit_id, name: school.name, prompts: r.prompts.map((p, i) => ({ ...p, id: `${school.unit_id}:2026-27:${i + 1}` })), ...o };
}

test("merge: sets the block before the later keys with one lineage record, replaces it in place, removes it", () => {
  const set = applyEssays([withLineage, withoutLineage], [recordFor(withLineage), recordFor(withoutLineage, { status: "none", status_quote: "None.", prompts: [] })], TODAY);
  assert.deepEqual(set.summary, { colleges: 2, published: 1, none: 1, refersToForm: 0, prompts: 3, removed: 0, stale: 0, unjoined: 0 });
  const [a, b] = set.schools;
  const keys = Object.keys(a);
  const later = keys.findIndex((k) => ["selectivity", "directories", "lineage", "trends", "reported"].includes(k));
  assert.equal(keys.indexOf("essays"), later - 1, "right before the first later key (selectivity included: the tiers rebuild re-places it before directories)");
  assert.deepEqual(Object.keys(a.essays!), ["cycle", "status", "source_url", "retrieved", "prompts"]);
  assert.deepEqual(a.lineage!.essays, { source: "college-site", method: "extracted", year: "2026-27", url: "https://admissions.example.edu/essays", retrieved: TODAY, quote: "2026–2027 Essay Prompts" });
  assert.deepEqual(Object.keys(a.lineage!).filter((k) => k !== "essays"), Object.keys(withLineage.lineage!), "other lineage records kept, in order");
  // The record sits before the college-reported records, where a re-merge of those leaves it (tests/merge-reported).
  const lk = Object.keys(a.lineage!);
  const firstReported = lk.findIndex((k) => k.startsWith("reported."));
  if (firstReported >= 0) assert.ok(lk.indexOf("essays") < firstReported, `essays at ${lk.indexOf("essays")}, first reported.* at ${firstReported}`);
  assert.deepEqual(Object.keys(placeEssaysLineage({ "links.visit": { source: "college-site" }, "reported.admissions.year": { source: "cds" }, "admissions.federal": { source: "ipeds-adm" } } as NonNullable<School["lineage"]>, lineageOf(recordFor(withLineage)))), ["links.visit", "essays", "reported.admissions.year", "admissions.federal"]);
  assert.deepEqual(Object.keys(placeEssaysLineage({ "links.visit": { source: "college-site" } } as NonNullable<School["lineage"]>, lineageOf(recordFor(withLineage)))), ["links.visit", "essays"], "no reported records: at the end");
  assert.deepEqual(b.essays!.prompts, []);
  assert.ok(b.lineage, "a college without lineage gets one for the block");

  const replaced = applyEssays(set.schools, [recordFor(withLineage, { cycle_quote: "2026–2027 Essay Prompts", retrieved: "2026-11-02" })], TODAY);
  assert.deepEqual(Object.keys(replaced.schools[0]), keys, "the block keeps its place");
  assert.equal(replaced.schools[0].essays!.retrieved, "2026-11-02");
  assert.equal(replaced.schools[1].essays, undefined, "no record now: removed");
  assert.equal(replaced.schools[1].lineage, undefined, "a lineage left empty is dropped");
  assert.equal(replaced.summary.removed, 1);
  assert.deepEqual(stripEssays(replaced.schools[0]), withLineage);
  assert.equal(JSON.stringify(stripEssays(replaced.schools[0])), JSON.stringify(withLineage), "byte for byte");
});

test("merge: a closed cycle's record and a record for no college are skipped", () => {
  const r = applyEssays([withLineage], [recordFor(withLineage, { cycle: "2025-26" }), recordFor(withLineage, { unit_id: "000000" })], TODAY);
  assert.equal(r.summary.stale, 1);
  assert.equal(r.summary.unjoined, 1);
  assert.equal(r.schools[0].essays, undefined);
});

test("lineage: a school passes with and without the block, and every essays.* path cites the page", () => {
  for (const s of [withLineage, withoutLineage]) {
    assert.deepEqual(validateSchool(s, meta), [], "without the block");
    const [merged] = applyEssays([s], [recordFor(s)], TODAY).schools;
    assert.deepEqual(validateSchool(merged, meta), [], "with the block");
    for (const path of ["essays.cycle", "essays.status", "essays.source_url", "essays.retrieved", "essays.prompts"] as const) {
      const cited = lineageFor(path, merged, meta);
      assert.equal(cited.key, "college-site");
      assert.equal(cited.url, "https://admissions.example.edu/essays");
      assert.equal(cited.year, "2026-27");
      assert.equal(cited.quote, "2026–2027 Essay Prompts");
      assert.equal(cited.sourceKind, undefined, "never the admissions document's kind");
    }
    assert.equal(registeredPathFor("essays.prompts"), "essays.prompts");
    // Without the block, nothing to cite.
    assert.equal(lineageFor("essays.prompts", s, meta).url === "https://admissions.example.edu/essays", false);
  }
});

test("lineage: the check catches a block without its record, a wrong year, and a record under the block", () => {
  const [merged] = applyEssays([withLineage], [recordFor(withLineage)], TODAY).schools;
  const plant = (change: (s: School) => void, expect: RegExp) => {
    const s = structuredClone(merged);
    change(s);
    const errors = validateSchool(s, meta);
    assert.ok(errors.some((e) => expect.test(e)), `expected ${expect} in ${JSON.stringify(errors)}`);
  };
  plant((s) => delete s.lineage!.essays, /essays is stored without a lineage record/);
  plant((s) => (s.lineage!.essays!.year = "2025-26"), /isn't the block's cycle/);
  plant((s) => (s.lineage!.essays!.method = "reported"), /method "extracted"/);
  plant((s) => delete s.lineage!.essays!.quote, /extracted but lacks quote/);
  plant((s) => (s.lineage!["essays.prompts"] = { ...s.lineage!.essays! }), /has its own lineage record/);
  plant((s) => (s.essays!.prompts[0].id = "x"), /essays.prompts\[0\] id x/);
  plant((s) => delete s.essays, /lineage for essays, which has no value/);
  plant((s) => ((s.essays as unknown as Record<string, unknown>).extra = 1), /"essays.extra" isn't a field of the essays block/);
});

test("registry: the block and its five paths are college-site, admissions, no vintage", () => {
  for (const p of ["essays", "essays.cycle", "essays.status", "essays.source_url", "essays.retrieved", "essays.prompts"] as const) {
    assert.equal(FIELDS[p].source, "college-site");
    assert.equal(FIELDS[p].topic, "admissions");
    assert.equal(FIELDS[p].vintage, null);
  }
});

test("merge-essay-prompts --dry-run runs on the committed data", () => {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "merge-essay-prompts.mts"), "--dry-run"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^essays: \d+ colleges/);
  assert.match(r.stdout, /--dry-run, nothing written/);
});

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

const platform = JSON.parse(readFileSync(join(ROOT, "data", "reference", "platform-prompts.json"), "utf8")) as PlatformPromptsFile;

test("platform prompts: the committed file's shape; Common App links only its homepage", () => {
  assert.deepEqual(platformProblems(platform), []);
  assert.equal(platform.common_app.prompts.length, 7, "Common App's seven personal-essay prompts");
  assert.equal(platform.common_app.source_url, "https://www.commonapp.org/");
  assert.match(platform.common_app.read_from, /^https:\/\/www\.commonapp\.org\//);
  assert.equal(platform.coalition.source_url, "https://www.coalitionforcollegeaccess.org/");
  assert.ok(platform.coalition.prompts.length >= 5);
  assert.equal(normalizeCycle(platform.common_app.cycle_quote), platform.common_app.cycle);
  const bad = structuredClone(platform);
  bad.common_app.source_url = "https://www.commonapp.org/apply/essay-prompts";
  bad.coalition.prompts[0].id = "platform:coalition:9";
  bad.coalition.limit_quote = null;
  const problems = platformProblems(bad);
  assert.ok(problems.some((p) => /common_app: source_url must be the organization's homepage/.test(p)));
  assert.ok(problems.some((p) => /prompt 1 id platform:coalition:9/.test(p)));
  assert.ok(problems.some((p) => /a limit without the sentence/.test(p)));
  assert.deepEqual(platformProblems(null), ["data/reference/platform-prompts.json is missing"]);
});

test("store: a record and a held record serialize one prompt per line and parse back", async () => {
  const { record } = await readFixture("plain-list.html");
  record.previous = { cycle: "2025-26", source_url: record.source_url, retrieved: "2025-09-01", prompts: record.prompts.slice(0, 1) };
  const text = serializeRecord(record);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(record)));
  assert.equal(text.split("\n").filter((l) => l.includes('"id":')).length, 4);
  const held = { unit_id: record.unit_id, name: record.name, held: TODAY, problems: ["the page names no cycle"], record };
  assert.deepEqual(JSON.parse(serializeHeld(held)), JSON.parse(JSON.stringify(held)));
});

test("report: the PR body lists held and blocked colleges; the release note names the PR", () => {
  const s: RunSummary = {
    run: "2026-10-29T12:00:00Z", started: "", finished: "", cycle: "2026-27", budget_usd: 40, spent_usd: 1.25, stopped: null, dry_run: false, colleges: 3,
    counts: { passed: 1, held: 1, unchanged: 0, not_found: 1, failed: 0, found: 0 },
    passed: [{ unit_id: "1", name: "A", status: "published", prompts: 2 }],
    held: [{ unit_id: "2", name: "B", problems: ["the page names no cycle"] }],
    not_found: [{ unit_id: "3", name: "C | D", blocked: "c.edu" }],
    failed: [],
  };
  const body = prBody(s);
  assert.match(body, /\| B \| 2 \| the page names no cycle \|/);
  assert.match(body, /\| C \\\| D \| 3 \| c\.edu \|/);
  const note = releaseNote(s, 321, "2026-10-29");
  assert.match(note, /^---\ntitle: "Essay prompts for 1 more college"\npr: 321\ndate: 2026-10-29\nkind: data\nsummary: /);
});

test("the workflow: dispatched by hand with units, top, and budget; opens a PR; never auto-merges", () => {
  const yml = readFileSync(join(ROOT, ".github", "workflows", "essay-prompts.yml"), "utf8");
  assert.match(yml, /^on:\n {2}workflow_dispatch:\n {4}inputs:\n/m);
  for (const input of ["units", "top", "budget"]) assert.match(yml, new RegExp(`^ {6}${input}:\\n`, "m"));
  assert.ok(!/^ {2}schedule:/m.test(yml), "no schedule: the owner runs it");
  assert.match(yml, /gh pr create --base main/);
  assert.ok(!/gh pr merge/.test(yml), "auto-merge off");
  assert.match(yml, /npm run merge-essay-prompts/);
  assert.match(yml, /npm run check:lineage/);
  assert.ok(!/\t/.test(yml), "YAML takes no tabs");
});

/* ------------------------------------------------------------------ */
/* The second reader: an assumed cycle, "choose N of M", platform hosts */
/* ------------------------------------------------------------------ */

const CHOOSE_PAGE =
  "Personal insight questions. You will have 8 questions to choose from. You must respond to only 4 of the 8 questions. Each response is limited to a maximum of 350 words. " +
  "1. Describe an example of your leadership experience. 2. Every person has a creative side. 3. What would you say is your greatest talent or skill? " +
  "4. Describe how you have taken advantage of a significant educational opportunity. 5. Describe the most significant challenge you have faced. " +
  "6. Think about an academic subject that inspires you. 7. What have you done to make your school or your community a better place? " +
  "8. Beyond what has already been shared in your application, what do you believe makes you a strong candidate?";
const CHOOSE_TEXTS = [
  "Describe an example of your leadership experience.",
  "Every person has a creative side.",
  "What would you say is your greatest talent or skill?",
  "Describe how you have taken advantage of a significant educational opportunity.",
  "Describe the most significant challenge you have faced.",
  "Think about an academic subject that inspires you.",
  "What have you done to make your school or your community a better place?",
  "Beyond what has already been shared in your application, what do you believe makes you a strong candidate?",
];

/** A page that names no cycle and says to answer four of its eight prompts (the UC's shape). */
function chooseRecord(): EssayRecord {
  return {
    ...good(),
    cycle_quote: "",
    cycle_assumed: true,
    choose: { n: 4, of: 8, quote: "You must respond to only 4 of the 8 questions." },
    prompts: CHOOSE_TEXTS.map((text, i) => ({ id: `999001:2026-27:${i + 1}`, text, kind: "essay" as const, limit: { kind: "words" as const, max: 350 }, required: false, applies_to: "all" as const, quote: "Each response is limited to a maximum of 350 words." })),
  };
}

test("checks: a page with no cycle passes with the open cycle assumed; a pick-some list passes with choose", () => {
  assert.deepEqual(checkRecord(chooseRecord(), { today: TODAY, pageText: CHOOSE_PAGE }), []);
  assert.deepEqual(checkRecord({ ...good(), cycle_quote: "", cycle_assumed: true }, { today: TODAY, pageText: PAGE }), []);
});

test("checks: the assumed-cycle and choose rules each catch their planted bad value", () => {
  const plant = (change: (r: EssayRecord) => void, expect: RegExp) => {
    const r = chooseRecord();
    change(r);
    const problems = checkRecord(r, { today: TODAY, pageText: CHOOSE_PAGE });
    assert.ok(problems.some((p) => expect.test(p)), `expected ${expect} in ${JSON.stringify(problems)}`);
  };
  plant((r) => (r.cycle_assumed = false), /the page names no cycle \(the reader marks such a record cycle_assumed\)/);
  plant((r) => (r.cycle_quote = "2026-27"), /cycle_assumed is set, but the page names a cycle/);
  plant((r) => ((r.cycle = "2027-28"), r.prompts.forEach((p, i) => (p.id = `999001:2027-28:${i + 1}`))), /an assumed cycle must be the open one, 2026-27, not 2027-28/);
  plant((r) => (r.choose!.of = 7), /choose says 7 prompts to pick from, but 8 are marked optional/);
  plant((r) => (r.choose!.n = 8), /isn't a choice/);
  plant((r) => (r.choose!.n = 0), /isn't a whole number of prompts to answer/);
  plant((r) => (r.choose!.quote = "You must respond to all of the questions."), /choose: the quote isn't on the page verbatim/);
  plant((r) => (r.choose!.quote = ""), /choose: no quote/);
  plant((r) => (r.prompts[2].required = true), /choose says 8 prompts to pick from, but 7 are marked optional/);
  plant((r) => ((r.status = "none"), (r.prompts = [])), /choose is set, but status is none/);
});

const DUKE_PAGE =
  "Essay prompts. All applicants must answer the following in 250 words or fewer: What is your sense of Duke as a university and a community, and why do you consider it a good match for you? " +
  "We also want to give you the opportunity to share more about yourself. Please respond to up to 2 of the following 5 prompts in 250 words or fewer each. " +
  "1. We believe a wide range of viewpoints strengthens our community. 2. Tell us about an experience in the past year or two that reflects your imagination. " +
  "3. We recognize that not fully expressing your sexual orientation or gender identity can be painful. 4. We seek a diverse student body. 5. Tell us about a time you took a risk.";

/** Duke's shape: one essay required of everyone beside a pick-some set; `of` counts the set, the required one stands outside it. */
function dukeRecord(): EssayRecord {
  const set = [
    "We believe a wide range of viewpoints strengthens our community.",
    "Tell us about an experience in the past year or two that reflects your imagination.",
    "We recognize that not fully expressing your sexual orientation or gender identity can be painful.",
    "We seek a diverse student body.",
    "Tell us about a time you took a risk.",
  ];
  return {
    ...good(),
    cycle_quote: "",
    cycle_assumed: true,
    choose: { n: 2, of: 5, quote: "Please respond to up to 2 of the following 5 prompts in 250 words or fewer each." },
    prompts: [
      { id: "999001:2026-27:1", text: "What is your sense of Duke as a university and a community, and why do you consider it a good match for you?", kind: "why_us", limit: { kind: "words", max: 250 }, required: true, applies_to: "all", quote: "All applicants must answer the following in 250 words or fewer:" },
      ...set.map((text, i) => ({ id: `999001:2026-27:${i + 2}`, text, kind: "essay" as const, limit: { kind: "words" as const, max: 250 }, required: false, applies_to: "all" as const, quote: "Please respond to up to 2 of the following 5 prompts in 250 words or fewer each." })),
    ],
  };
}

test("checks: a required essay beside a pick-some set passes; the set is the optional prompts", () => {
  assert.deepEqual(checkRecord(dukeRecord(), { today: TODAY, pageText: DUKE_PAGE }), []);
  const r = dukeRecord();
  r.choose!.of = 6;
  assert.ok(checkRecord(r, { today: TODAY, pageText: DUKE_PAGE }).some((p) => /choose says 6 prompts to pick from, but 5 are marked optional/.test(p)));
});

test("checks: a none quote must say there are no essays; a refers_to_form quote must name the essay and the application", () => {
  const base = { ...good(), prompts: [] as EssayPrompt[] };
  const page = (q: string) => `${PAGE} ${q}`;
  const check = (status: EssayRecord["status"], q: string) => checkRecord({ ...base, status, status_quote: q }, { today: TODAY, pageText: page(q) });
  assert.deepEqual(check("none", "Example University does not require a supplemental essay."), []);
  assert.deepEqual(check("none", "No supplemental essays or writing prompts are required other than the essay required by the Common App."), []);
  assert.ok(check("none", "Supplemental Instruction provides regularly scheduled review sessions open to all students.").some((p) => /status none, but the quoted sentence doesn't say there are no essays/.test(p)));
  assert.ok(check("none", "The Center for Italian Cultural Studies holds an essay contest each spring.").some((p) => /doesn't say there are no essays/.test(p)));
  assert.deepEqual(check("refers_to_form", "Complete the essay component of at least 250 words on the Common Application."), []);
  assert.deepEqual(check("refers_to_form", "As part of your Common Application, you'll be asked to fill out the Example University Questions."), []);
  assert.ok(check("refers_to_form", "Ready to apply? Example University is a member of The Common Application.").some((p) => /doesn't name the essay and the application/.test(p)));
  assert.ok(check("refers_to_form", "Upload your essay and resume.").some((p) => /doesn't name the essay and the application/.test(p)));
});

test("checks: a prompt that is the Common App's own is held, with the platform texts from the reference file", () => {
  const platform = JSON.parse(readFileSync(join(ROOT, "data", "reference", "platform-prompts.json"), "utf8")) as { common_app: { prompts: { text: string }[] } };
  const copied = platform.common_app.prompts[0].text;
  const r = { ...good(), prompts: [{ ...good().prompts[1], text: copied }] };
  const problems = checkRecord(r, { today: TODAY, platformTexts: platform.common_app.prompts.map((p) => p.text) });
  assert.ok(problems.some((p) => /prompt 1: this is one of the application platform's own prompts/.test(p)), JSON.stringify(problems));
  assert.ok(!checkRecord(good(), { today: TODAY, pageText: PAGE, platformTexts: platform.common_app.prompts.map((p) => p.text) }).length);
});

test("store: cycle_assumed and choose survive the round trip to disk", async () => {
  const r = dukeRecord();
  const back = JSON.parse(serializeRecord(r)) as EssayRecord;
  assert.equal(back.cycle_assumed, true);
  assert.deepEqual(back.choose, r.choose);
  assert.deepEqual(back, JSON.parse(JSON.stringify(r)));
  const keys = Object.keys(back);
  assert.ok(keys.indexOf("cycle_assumed") > keys.indexOf("cycle_quote") && keys.indexOf("choose") < keys.indexOf("prompts"));
});

test("discovery: a page that only says 'supplemental' (instruction, pay, funds) isn't an essay page", () => {
  assert.equal(looksLikeEssayPage("Supplemental Instruction (SI) provides review sessions. Who leads them? When do they meet? Up to 50 words of notes."), false);
  assert.equal(looksLikeEssayPage("Supplemental pay is the eForm used to pay stipends. Who approves it? When is it paid?"), false);
  assert.equal(looksLikeEssayPage("The Supplemental Application for Transfer is an online application. Who must file? When?"), false);
  assert.equal(looksLikeEssayPage("Supplemental essay questions for first-year applicants. Why us? What else? 250 words."), true);
  assert.equal(looksLikeEssayPage("Personal insight questions. You must respond to only 4 of the 8 questions. Each response is limited to a maximum of 350 words."), true);
  assert.equal(essayLinkScore({ url: "https://x.edu/tutoring/supplemental-instruction", text: "Supplemental Instruction" }), 0);
  assert.equal(essayLinkScore({ url: "https://x.edu/hr/supplemental-pay", text: "Supplemental pay essay form" }), 0);
});

test("runCollege: a record with no prompts starts discovery over next run; a published one is reused", async () => {
  const pages = {
    "https://admissions.example.edu/apply": readFileSync(join(FIX, "apply-page.html"), "utf8"),
    "https://admissions.example.edu/apply/first-year/supplemental-essay-prompts": readFileSync(join(FIX, "plain-list.html"), "utf8"),
  };
  const http = fakeSite(pages);
  const { client } = fakeClient(() => message(ANSWERS["plain-list.html"]));
  const deps = { http, client, cap: new SpendCap(5), today: TODAY };
  const first = await runCollege(SITE_SCHOOL, undefined, null, deps);
  assert.equal(first.kind, "passed");
  if (first.kind !== "passed") return;
  const before = http.requested.length;
  await runCollege(SITE_SCHOOL, first.recipe, first.record, deps);
  assert.equal(http.requested.length, before + 1, "a published record: only the recipe's page is fetched");
  const refers: EssayRecord = { ...first.record, status: "refers_to_form", status_quote: "x", prompts: [] };
  await runCollege(SITE_SCHOOL, first.recipe, refers, deps);
  assert.ok(http.requested.length > before + 2, "a refers_to_form record: the ladder runs again from the start pages");
  // Without `choose`, "choose two of the following" in a prompt's quote still counts as the page's optional word.
  assert.deepEqual(promptProblems({ id: "1:2026-27:1", text: "Describe a community you belong to.", kind: "essay", limit: null, required: false, applies_to: "all", quote: "Choose two of the following prompts and respond in 300 words." }, "p", null), []);
  assert.deepEqual(promptProblems({ id: "1:2026-27:1", text: "Describe a community you belong to.", kind: "essay", limit: null, required: false, applies_to: "all", quote: "Respond to the following in 300 words." }, "p", null), ["p: marked optional, but neither the prompt nor its quote says optional"]);
});

test("reader: a page with no cycle words gets the open cycle, marked assumed; choose comes through", () => {
  const answer: ReadAnswer = { ...ANSWERS["plain-list.html"], cycle_quote: null, choose: { n: 2, of: 3, quote: "Pick two." } };
  const r = toRecord(answer, { school: SCHOOL, url: "https://admissions.example.edu/x", retrieved: TODAY, sha256: "a".repeat(64), via: "picker", model: READ_MODEL });
  assert.equal(r.cycle, "2026-27");
  assert.equal(r.cycle_assumed, true);
  assert.equal(r.cycle_quote, "");
  assert.deepEqual(r.choose, { n: 2, of: 3, quote: "Pick two." });
  const named = toRecord({ ...answer, cycle_quote: "2026–2027 Supplemental Essay Prompts" }, { school: SCHOOL, url: "https://x.edu", retrieved: TODAY, sha256: "a".repeat(64), via: "picker", model: READ_MODEL });
  assert.equal(named.cycle_assumed, undefined);
  assert.ok(JSON.stringify(READ_SCHEMA).includes('"choose"'), "the schema asks for choose");
  assert.match(READ_SYSTEM, /choose: when the page says applicants answer a set number/);
});

test("discovery: a shared application platform is never the college's page", async () => {
  assert.ok(isPlatformUrl("https://www.commonapp.org/"));
  assert.ok(isPlatformUrl("https://apply.commonapp.org/login"));
  assert.ok(isPlatformUrl("https://www2.calstate.edu/apply"));
  assert.ok(isPlatformUrl("https://www.applytexas.org/"));
  assert.ok(!isPlatformUrl("https://admission.universityofcalifornia.edu/how-to-apply/personal-insight-questions.html"), "the UC's shared page is the campuses' own");
  assert.ok(!isPlatformUrl("https://admissions.example.edu/apply"));

  const member = { unit_id: "1", name: "X", links: { website: "www.x.edu", price_calculator: null, apply: "https://apply.commonapp.org/x", admissions: "https://admissions.x.edu/" } } as Pick<School, "unit_id" | "name" | "links">;
  assert.deepEqual(startPages(member), ["https://admissions.x.edu/", "https://www.x.edu"], "the Common App apply link is not a start page");

  // The apply page's best essay link points at the Common App: never fetched, never found.
  const http = fakeSite({
    "https://admissions.example.edu/apply": '<a href="https://www.commonapp.org/apply/essay-prompts">Essay prompts</a><a href="/apply/deadlines">Deadlines</a>',
  });
  const r = await discoverEssayPage(SITE_SCHOOL, undefined, { http });
  assert.equal(r.found, null);
  assert.ok(!http.requested.some((u) => u.includes("commonapp.org")), `requested ${JSON.stringify(http.requested)}`);

  const { links } = buildPickerRequest(SCHOOL, [{ url: "https://www.commonapp.org/apply/essay-prompts", text: "Essay prompts" }, { url: "https://admissions.example.edu/qs", text: "Questions" }]);
  assert.deepEqual(links.map((l) => l.url), ["https://admissions.example.edu/qs"], "the picker never sees a platform link");
});

test("merge and lineage: choose is kept on the block, an assumed cycle has no quote, and the college validates", () => {
  const r = recordFor(withLineage, { ...chooseRecord(), unit_id: withLineage.unit_id, name: withLineage.name });
  r.prompts = r.prompts.map((p, i) => ({ ...p, id: `${withLineage.unit_id}:2026-27:${i + 1}` }));
  const [merged] = applyEssays([withLineage], [r], TODAY).schools;
  assert.deepEqual(Object.keys(merged.essays!), ["cycle", "status", "source_url", "retrieved", "choose", "prompts"]);
  assert.deepEqual(merged.essays!.choose, { n: 4, of: 8, quote: "You must respond to only 4 of the 8 questions." });
  assert.deepEqual(merged.lineage!.essays, { source: "college-site", method: "extracted", year: "2026-27", url: "https://admissions.example.edu/essays", retrieved: TODAY, quote: "Each response is limited to a maximum of 350 words." }, "no cycle line: the record quotes the sentence the prompts were read from");
  assert.deepEqual(validateSchool(merged, meta), []);
  assert.deepEqual(stripEssays(merged), withLineage);
});

test("report: the PR body lists the colleges whose cycle was assumed", () => {
  const s: RunSummary = {
    run: "2026-10-29T12:00:00Z", started: "", finished: "", cycle: "2026-27", budget_usd: 40, spent_usd: 1.25, stopped: null, dry_run: false, colleges: 2,
    counts: { passed: 2, held: 0, unchanged: 0, not_found: 0, failed: 0, found: 0 },
    passed: [{ unit_id: "1", name: "A", status: "published", prompts: 8 }, { unit_id: "2", name: "B", status: "published", prompts: 2 }],
    assumed: [{ unit_id: "1", name: "A" }],
    held: [],
    not_found: [],
    failed: [],
  };
  const body = prBody(s);
  assert.match(body, /passed 2 \(1 with the cycle assumed\)/);
  assert.match(body, /### Cycle assumed[\s\S]*the open cycle \(2026-27\) was assumed[\s\S]*\| A \| 1 \|/);
  assert.ok(!/\| B \| 2 \|/.test(body));
});

/* ------------------------------------------------------------------ */
/* The fourth reader: one level deeper, a second look, one read per page */
/* ------------------------------------------------------------------ */

test("discovery: first-year 'how to apply' links are followed one level deeper for the essay link", async () => {
  assert.equal(applyLinkScore({ url: "https://admissions.example.edu/first-year/how-to-apply", text: "How to apply as a first-year student" }), 3);
  assert.equal(applyLinkScore({ url: "https://admissions.example.edu/freshman", text: "Freshman applicants" }), 2);
  assert.equal(applyLinkScore({ url: "https://admissions.example.edu/apply", text: "Apply" }), 0, "a bare Apply leads to the portal");
  assert.equal(applyLinkScore({ url: "https://admissions.example.edu/requirements", text: "Admission requirements" }), 1);
  assert.equal(applyLinkScore({ url: "https://admissions.example.edu/graduate/apply", text: "Graduate applicants" }), 0);
  assert.equal(applyLinkScore({ url: "https://admissions.example.edu/transfer/how-to-apply", text: "Transfer: how to apply" }), 0);
  assert.deepEqual(rankApplyLinks([{ url: "https://elsewhere.org/first-year/apply", text: "First-year apply" }, { url: "https://www.commonapp.org/apply", text: "First-year apply" }], ["https://admissions.example.edu"]), [], "other hosts and platforms never");

  // The start page links only to a first-year page; that page links to the prompts.
  const http = fakeSite({
    "https://admissions.example.edu/apply": '<a href="/first-year/how-to-apply">First-year applicants: how to apply</a><a href="/visit">Visit</a>',
    "https://admissions.example.edu/first-year/how-to-apply": '<p>Welcome, first-year applicants. Here is what to send.</p><a href="/first-year/essay-prompts">Essay prompts</a>',
    "https://admissions.example.edu/first-year/essay-prompts": readFileSync(join(FIX, "plain-list.html"), "utf8"),
  });
  const r = await discoverEssayPage(SITE_SCHOOL, undefined, { http });
  assert.equal(r.found?.url, "https://admissions.example.edu/first-year/essay-prompts");
  assert.ok(http.requested.includes("https://admissions.example.edu/first-year/how-to-apply"), "the first-year page was fetched for its links");
  assert.ok(!http.requested.includes("https://admissions.example.edu/visit"), "a visit page is never fetched");
  assert.equal(r.cost, 0, "no model call");
});

test("discovery: skip looks past a page already read", async () => {
  const http = fakeSite({
    "https://admissions.example.edu/apply": readFileSync(join(FIX, "apply-page.html"), "utf8"),
    "https://admissions.example.edu/apply/first-year/supplemental-essay-prompts": readFileSync(join(FIX, "plain-list.html"), "utf8"),
    "https://admissions.example.edu/apply/writing-supplement": readFileSync(join(FIX, "table-limits.html"), "utf8"),
  });
  const first = await discoverEssayPage(SITE_SCHOOL, undefined, { http });
  assert.equal(first.found?.url, "https://admissions.example.edu/apply/first-year/supplemental-essay-prompts");
  const second = await discoverEssayPage(SITE_SCHOOL, undefined, { http, skip: [first.found!.url, first.found!.final_url] });
  assert.equal(second.found?.url, "https://admissions.example.edu/apply/writing-supplement", "the next candidate");
});

test("runCollege: a general page that points to the form gets a second look, and the prompts page one link away wins", async () => {
  const HOW_TO = '<h1>How to apply</h1><p>Submit the essay with your Common Application. Our supplemental essay questions are listed on the writing supplement page.</p><p>What else? When?</p><a href="/apply/writing-supplement">Writing supplement</a>';
  const http = fakeSite({
    "https://admissions.example.edu/apply": HOW_TO,
    "https://admissions.example.edu/apply/writing-supplement": readFileSync(join(FIX, "table-limits.html"), "utf8"),
  });
  const { client, calls } = fakeClient((p) => {
    const body = JSON.stringify(p.messages);
    return body.includes("How to apply")
      ? message({ cycle_quote: null, status: "refers_to_form", status_quote: "Submit the essay with your Common Application.", choose: null, prompts: [] })
      : message(ANSWERS["table-limits.html"]);
  });
  const out = await runCollege(SITE_SCHOOL, undefined, null, { http, client, cap: new SpendCap(5), today: TODAY });
  assert.equal(out.kind, "passed", JSON.stringify(out));
  if (out.kind !== "passed") return;
  assert.equal(out.record.status, "published");
  assert.equal(out.record.source_url, "https://admissions.example.edu/apply/writing-supplement");
  assert.equal(out.recipe.url, "https://admissions.example.edu/apply/writing-supplement", "the recipe remembers the page that had the prompts");
  assert.equal(calls.length, 2, "two reads: the general page, then the prompts page");

  // When nothing better exists, the first answer stands (no second read).
  const alone = fakeSite({ "https://admissions.example.edu/apply": HOW_TO.replace('<a href="/apply/writing-supplement">Writing supplement</a>', "") });
  const only = fakeClient(() => message({ cycle_quote: null, status: "refers_to_form", status_quote: "Submit the essay with your Common Application.", choose: null, prompts: [] }));
  const kept = await runCollege(SITE_SCHOOL, undefined, null, { http: alone, client: only.client, cap: new SpendCap(5), today: TODAY });
  assert.equal(kept.kind, "passed");
  if (kept.kind === "passed") assert.equal(kept.record.status, "refers_to_form");
  assert.equal(only.calls.length, 1);
});

test("runCollege: two colleges on one shared page cost one read and agree", async () => {
  const shared = readFileSync(join(FIX, "plain-list.html"), "utf8");
  const http = fakeSite({
    "https://admissions.example.edu/apply": '<a href="/apply/first-year/supplemental-essay-prompts">Supplemental essay prompts</a>',
    "https://admissions.example.edu/apply/first-year/supplemental-essay-prompts": shared,
  });
  const { client, calls } = fakeClient(() => message(ANSWERS["plain-list.html"]));
  const readCache = new Map();
  const deps = { http, client, cap: new SpendCap(5), today: TODAY, readCache };
  const a = await runCollege(SITE_SCHOOL, undefined, null, deps);
  const b = await runCollege({ ...SITE_SCHOOL, unit_id: "999002", name: "Example University-Downtown" }, undefined, null, deps);
  assert.equal(a.kind, "passed");
  assert.equal(b.kind, "passed");
  assert.equal(calls.length, 1, "the second college is answered from the cache");
  if (a.kind === "passed" && b.kind === "passed") {
    assert.equal(b.record.unit_id, "999002");
    assert.equal(b.record.prompts[0].id, "999002:2026-27:1", "ids are the college's own");
    assert.deepEqual(b.record.prompts.map((p) => p.text), a.record.prompts.map((p) => p.text));
  }
});

test("checks: a 'none' quote about a test's essay section is not a none", () => {
  const q = "UNF does not require the essay section of the SAT, ACT or CLT.";
  const r: EssayRecord = { ...good(), status: "none", status_quote: q, prompts: [] };
  const problems = checkRecord(r, { today: TODAY, pageText: `${PAGE} ${q}` });
  assert.ok(problems.some((p) => /about a test's essay section/.test(p)), JSON.stringify(problems));
  const ok: EssayRecord = { ...good(), status: "none", status_quote: "Example University does not require a supplemental essay.", prompts: [] };
  assert.deepEqual(checkRecord(ok, { today: TODAY, pageText: `${PAGE} Example University does not require a supplemental essay.` }), []);
});
