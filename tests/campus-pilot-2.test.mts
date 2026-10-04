/**
 * Campus-life pilot, round 2 (specs/college-reported-data.md "Round 2 plan"): a run on new colleges keeps round 1's
 * published facts and recipes byte for byte; the college list file; free discovery probes (sitemaps, hubs, paths,
 * text confirmation, quiet refusals); one paid discovery call for what's missing; the "does the quote state it" checks
 * on round 1's real mistakes; Message Batches with direct fallback; the budget holding calls in flight. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_COLLEGES_FILE, PILOT_IDS, formatPagesFile, formatSourcesFile, mergeRun, readCollegeList, type PagesFile, type SourcesFile } from "../scripts/lib/campus-pilot/files.mts";
import type { CampusRecipe, CollegeResult } from "../scripts/lib/campus-pilot/run.mts";
import { classifyLinks, missingForPaid, probeCollege, textConfirms, typesFor } from "../scripts/lib/campus-pilot/probe.mts";
import { quoteOnPage, shortQuote, type FetchResult, type Page, type PageFetcher } from "../scripts/lib/campus-pilot/pages.mts";
import { combinedDiscovery } from "../scripts/lib/campus-pilot/schema.mts";
import { conductSupport, faithGroupSupport, greekSupport, lgbtqGroupSupport, policySupport } from "../scripts/lib/campus-pilot/support.mts";
import { BatchCaller, type Caller, type PilotBatchApi } from "../scripts/lib/campus-pilot/batch.mts";
import { Budget, BudgetSpent } from "../scripts/lib/campus-pilot/llm.mts";

const ROOT = join(import.meta.dirname, "..");
const TODAY = "2026-10-04";

/* ------------------------------------------------------------------ */
/* Round 1's data is kept                                              */
/* ------------------------------------------------------------------ */

const pagesText = readFileSync(join(ROOT, "data", "campus-pages.json"), "utf8");
const sourcesText = readFileSync(join(ROOT, "data", "campus-sources.json"), "utf8");

function emptyResult(unit_id: string, name: string, extra: Partial<CollegeResult> = {}): CollegeResult {
  return { unit_id, name, checked: TODAY, greek: null, faith: null, lgbtq: null, listings: [], raw: {}, escalated: [], dropped: [], checks: [], errors: [], ...extra };
}
const recipeFor = (unit_id: string): CampusRecipe => ({ unit_id, learned: TODAY, model: "claude-sonnet-5", links: { greek: { fsl_office: `https://fsl.x${unit_id}.edu/` } }, sources: [] });

/** Set B: round 2's colleges, one with a fact, one with nothing found, one stopped by the cap. */
function runOnSetB(): { results: CollegeResult[]; recipes: CampusRecipe[] } {
  const [b1, b2, b3] = readCollegeList(join(ROOT, DEFAULT_COLLEGES_FILE));
  return {
    results: [
      emptyResult(b1, "B one", { faith: { office: { url: "https://x.edu/chaplain", checked: TODAY, quote: "Office of the Chaplain", name: "Office of the Chaplain" } } }),
      emptyResult(b2, "B two"),
      emptyResult(b3, "B three", { stopped: "spend cap reached" }),
    ],
    recipes: [recipeFor(b1), recipeFor(b2), { ...recipeFor(b3), links: {} }],
  };
}

test("the committed files are already in the merge's format (so carrying them over changes no byte)", () => {
  assert.equal(formatPagesFile(JSON.parse(pagesText) as PagesFile), pagesText);
  assert.equal(formatSourcesFile(JSON.parse(sourcesText) as SourcesFile), sourcesText);
});

test("a run on college set B leaves set A's published facts and recipes byte-identical", () => {
  const runB = runOnSetB();
  const idsB = new Set(runB.results.map((r) => r.unit_id));
  // Set A: the committed files without set B's colleges (round 2 has since been run and committed; this test keeps
  // asking what a run on new colleges does to everyone else).
  const pagesAll = JSON.parse(pagesText) as PagesFile;
  const sourcesAll = JSON.parse(sourcesText) as SourcesFile;
  const pagesA: PagesFile = { ...pagesAll, colleges: pagesAll.colleges.filter((c) => !idsB.has(c.unit_id)) };
  const sourcesA: SourcesFile = { ...sourcesAll, recipes: sourcesAll.recipes.filter((r) => !idsB.has(r.unit_id)) };
  assert.ok(pagesA.colleges.length > 0 && sourcesA.recipes.length > 0, "round 1's data is committed");
  const merged = mergeRun(structuredClone(pagesA), structuredClone(sourcesA), runB, "2026-10-20");
  const newPages = formatPagesFile(merged.pages);
  const newSources = formatSourcesFile(merged.sources);
  // Every entry outside set B (round 1's, and round 2's other colleges once committed), as its own formatted line
  // (pages) or block (recipes), is in the new files unchanged; set B's own entries are the run's to replace.
  const outsideB = (line: string) => !idsB.has(/"unit_id":"(\d+)"/.exec(line)?.[1] ?? "");
  for (const line of pagesText.split("\n").filter((l) => l.trim().startsWith('{"unit_id"') && outsideB(l))) assert.ok(newPages.includes(line.replace(/,$/, "")), line.slice(0, 60));
  for (const r of sourcesA.recipes.filter((x) => !idsB.has(x.unit_id))) {
    const block = JSON.stringify(r, null, 1).split("\n").map((l) => `  ${l}`).join("\n");
    assert.ok(newSources.includes(block), `recipe ${r.unit_id}`);
  }
  // And nothing of set A was dropped or reordered.
  const ids = (f: { colleges?: { unit_id: string }[]; recipes?: { unit_id: string }[] }) => (f.colleges ?? f.recipes ?? []).map((c) => c.unit_id);
  for (const id of ids(pagesA)) assert.ok(ids(merged.pages).includes(id));
  for (const id of ids(sourcesA)) assert.ok(ids(merged.sources).includes(id));
  // Set B: the college with a fact is added; nothing found or stopped adds no facts; the stopped one keeps no empty recipe.
  const [b1, b2, b3] = readCollegeList(join(ROOT, DEFAULT_COLLEGES_FILE));
  assert.ok(ids(merged.pages).includes(b1));
  assert.ok(!ids(merged.pages).includes(b2) && !ids(merged.pages).includes(b3));
  assert.ok(ids(merged.sources).includes(b1) && ids(merged.sources).includes(b2) && !ids(merged.sources).includes(b3));
});

test("the guard catches the old overwrite: replacing the files with the run's colleges alone would fail it", () => {
  const pagesA = JSON.parse(pagesText) as PagesFile;
  const run = runOnSetB();
  const naive = formatPagesFile({ updated: TODAY, colleges: run.results.flatMap((r) => (r.faith ? [{ unit_id: r.unit_id, name: r.name, checked: r.checked, faith: r.faith }] : [])) });
  const kept = pagesText.split("\n").filter((l) => l.trim().startsWith('{"unit_id"')).filter((l) => naive.includes(l.replace(/,$/, "")));
  assert.ok(pagesA.colleges.length > 0 && kept.length === 0);
});

test("re-running a set-A college replaces only its own entry; a failed re-run keeps it", () => {
  const pagesA = JSON.parse(pagesText) as PagesFile;
  const sourcesA = JSON.parse(sourcesText) as SourcesFile;
  const [a1, a2] = pagesA.colleges.map((c) => c.unit_id);
  const failed = mergeRun(structuredClone(pagesA), structuredClone(sourcesA), { results: [emptyResult(a1, "A", { errors: ["faith: HTTP 500"] })], recipes: [] }, TODAY);
  assert.deepEqual(failed.pages.colleges.find((c) => c.unit_id === a1), pagesA.colleges.find((c) => c.unit_id === a1));
  const clean = mergeRun(structuredClone(pagesA), structuredClone(sourcesA), { results: [emptyResult(a1, "A")], recipes: [] }, TODAY);
  assert.ok(!clean.pages.colleges.some((c) => c.unit_id === a1));
  assert.deepEqual(clean.pages.colleges.find((c) => c.unit_id === a2), pagesA.colleges.find((c) => c.unit_id === a2));
});

test("the round-2 college list: 25 colleges in the dataset, none from round 1", () => {
  const ids = readCollegeList(join(ROOT, DEFAULT_COLLEGES_FILE));
  assert.equal(ids.length, 25);
  const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as { unit_id: string }[];
  const known = new Set(schools.map((s) => s.unit_id));
  for (const id of ids) assert.ok(known.has(id), id);
  assert.deepEqual(ids.filter((id) => PILOT_IDS.includes(id)), []);
});

/* ------------------------------------------------------------------ */
/* Free probes                                                         */
/* ------------------------------------------------------------------ */

const page = (url: string, text: string, links: { url: string; text: string }[] = [], final_url = url): Page => ({ url, final_url, format: "html", text, links, sha256: "h", fetched: TODAY });
const filler = " Lorem ipsum dolor sit amet.".repeat(10);

function probeFetcher(site: Record<string, Page | { raw: string } | { blocked: string }>, calls: { url: string; quiet?: boolean }[]): PageFetcher {
  return {
    async sitemaps(origin: string) {
      return origin === "https://www.x.edu" ? ["https://www.x.edu/sitemap.xml"] : [];
    },
    async raw(url: string) {
      const v = site[url];
      return v && "raw" in v ? v.raw : null;
    },
    async get(url: string, o: { quiet?: boolean } = {}): Promise<FetchResult> {
      calls.push({ url, quiet: o.quiet });
      const v = site[url];
      if (!v || "raw" in v) return { ok: false, url, error: "HTTP 404" };
      if ("blocked" in v) return { ok: false, url, blocked: v.blocked };
      return { ok: true, page: v };
    },
  } as unknown as PageFetcher;
}

test("probes find office and policy pages from the sitemap, a hub subdomain, and well-known paths, confirmed by their text", async () => {
  const calls: { url: string; quiet?: boolean }[] = [];
  const site = {
    "https://www.x.edu/sitemap.xml": { raw: `<urlset><url><loc>https://www.x.edu/student-life/fraternity-sorority-life/</loc></url><url><loc>https://www.x.edu/news/2026/05/greek-life-award</loc></url><url><loc>https://www.x.edu/policies/nondiscrimination-statement</loc></url></urlset>` },
    "https://www.x.edu/": page("https://www.x.edu/", `X University home.${filler}`, [{ url: "https://www.x.edu/student-life/", text: "Student Life" }]),
    "https://www.x.edu/student-life/fraternity-sorority-life/": page("https://www.x.edu/student-life/fraternity-sorority-life/", `Fraternity and Sorority Life at X: 30 chapters.${filler}`),
    "https://www.x.edu/policies/nondiscrimination-statement": page("https://www.x.edu/policies/nondiscrimination-statement", `X does not discriminate on the basis of race, color, sexual orientation, or gender identity.${filler}`),
    "https://chaplain.x.edu/": page("https://chaplain.x.edu/", `Office of the Chaplain: religious and spiritual life for every faith.${filler}`),
    // A catch-all: /lgbtq redirects to the home page, which must not count as a center.
    "https://www.x.edu/lgbtq": page("https://www.x.edu/lgbtq", `X University home. LGBTQ students welcome.${filler}`, [], "https://www.x.edu/"),
    // robots.txt refuses the housing guess: a miss, not a block (the fetcher is asked quietly).
    "https://www.x.edu/housing/gender-inclusive": { blocked: "robots" },
  };
  const r = await probeCollege(probeFetcher(site, calls), { unit_id: "999001", website: "https://www.x.edu/", single_sex: false, affiliation: null });
  assert.equal(r.found.fsl_office, "https://www.x.edu/student-life/fraternity-sorority-life/");
  assert.equal(r.found.nondiscrimination, "https://www.x.edu/policies/nondiscrimination-statement");
  assert.equal(r.found.faith_office, "https://chaplain.x.edu/");
  assert.equal(r.found.lgbtq_center, undefined);
  assert.equal(r.links.greek.fsl_office, r.found.fsl_office);
  assert.equal(r.links.lgbtq.nondiscrimination, r.found.nondiscrimination);
  assert.ok(calls.every((c) => c.quiet), "every probe request is quiet");
  assert.ok(!calls.some((c) => c.url.includes("/news/")), "news pages are never candidates");
  // What's left for the paid call: the paid types the probes missed (no conduct code: not a religious college). Round
  // 3 no longer asks the paid call for housing or chosen name (tests/campus-pilot-3.test.mts).
  assert.deepEqual(missingForPaid({ unit_id: "999001", website: null, single_sex: false, affiliation: null }, r.found), ["lgbtq_center"]);
});

test("probe helpers: single-sex and religious items only where they apply; text must be about the type", () => {
  assert.ok(!typesFor({ single_sex: false, affiliation: null }).includes("trans_admission"));
  assert.ok(typesFor({ single_sex: true, affiliation: "Baptist" }).includes("trans_admission"));
  assert.ok(typesFor({ single_sex: false, affiliation: "Baptist" }).includes("conduct_code"));
  assert.ok(!textConfirms("nondiscrimination", page("https://x.edu/a", `Title IX office hours and contacts.${filler}`)));
  const c = classifyLinks([{ url: "https://other.edu/greek-life", text: "Greek Life" }, { url: "https://www.x.edu/greek-life", text: "Greek Life" }], "x.edu", ["fsl_office"], "home");
  assert.deepEqual(c.map((x) => x.url), ["https://www.x.edu/greek-life"]);
});

test("the paid call asks only for what's missing, all domains in one schema", () => {
  const { schema, prompt } = combinedDiscovery(["fsl_office", "nondiscrimination", "religion_report"]);
  const props = Object.keys((schema as { properties: Record<string, unknown> }).properties);
  assert.deepEqual(props, ["fsl_office", "greek_none", "nondiscrimination", "religion_report", "notes"]);
  assert.ok(!/health|restroom/i.test(prompt));
});

/* ------------------------------------------------------------------ */
/* Does the quote state it? (round 1's real mistakes)                  */
/* ------------------------------------------------------------------ */

test("greek: a housing rule is not a recruitment fact; stale totals and quotes without the number are dropped", () => {
  // Alabama, round 1: published as "no deferred recruitment".
  assert.match(greekSupport("deferred", "no", "Freshmen students are not allowed to live in a fraternity or sorority house as they are required to live in the residence halls.", { today: TODAY }) ?? "", /recruitment|joining/);
  // UT Austin, round 1 (right): first-semester joining is about recruitment.
  assert.equal(greekSupport("deferred", "no", "90% of the students who join a sorority or fraternity at UT Austin do so during their first semester.", { today: TODAY }), null);
  // UCLA, round 1: a recruitment week that never says who may join.
  assert.notEqual(greekSupport("deferred", "no", "Each fall quarter during True Bruin Welcome Week (zero week), the Interfraternity Council (IFC) coordinates a more formal recruitment week where students who", { today: TODAY }), null);
  // Ole Miss, round 1: the Panhellenic page's own total published as the whole community's.
  assert.match(greekSupport("members_total", 5113, "5,113 total active members in the Spring of 2024.", { today: TODAY }) ?? "", /all fraternity and sorority members/);
  assert.match(greekSupport("members_total", 4000, "4,000 fraternity and sorority members in Fall 2022", { today: TODAY }) ?? "", /2022/);
  // Counts written as words (W&L, UT Austin) are the quote's own.
  assert.equal(greekSupport("council", 9, "Washington and Lee has nine IFC fraternities: Chi Psi, Kappa Alpha Order", { today: TODAY }), null);
  assert.equal(greekSupport("council", 13, "The University Panhellenic Council (UPC) governs thirteen registered student organizations", { today: TODAY }), null);
  assert.equal(greekSupport("members_total", 7200, "7,200 + Sorority and Fraternity Members in five councils", { today: TODAY }), null);
  assert.notEqual(greekSupport("members_total", 1300, "Our community has 1,200 members", { today: TODAY }), null);
  assert.equal(greekSupport("housing", "yes", "Starting sophomore year, members of Panhellenic sororities and IFC fraternities have the opportunity to live in their chapter's house.", { today: TODAY }), null);
  assert.notEqual(greekSupport("formal_term", "Spring", "Formal Recruitment is a structured, week-long process held each fall", { today: TODAY }), null);
  assert.equal(greekSupport("formal_term", "Fall", "Formal Recruitment is a structured, week-long process held each fall", { today: TODAY }), null);
});

test("groups and policies: the quote must name the thing, not just mention it", () => {
  // UCLA, round 1: two groups named in a news paragraph about advocacy.
  const news = "This change follows years of discussion and advocacy on behalf of UCLA students, staff and faculty, including members of Transgender UCLA Pride, Queer Alliance";
  assert.notEqual(lgbtqGroupSupport("Queer Alliance", news, false), null);
  assert.equal(lgbtqGroupSupport("Queer Alliance", "Queer Alliance", true), null);
  assert.equal(lgbtqGroupSupport("Outlaw", "Outlaw is a registered student organization for LGBTQ+ law students.", false), null);
  // UCLA, round 1: a health center's care is not the insurance plan's coverage.
  assert.notEqual(policySupport("health_plan_transition", "yes", "UC SHIP Transgender Benefits at a Glance... If you are considering hormone therapy or any other gender affirming care, you can schedule an appointment with"), null);
  assert.equal(policySupport("health_plan_transition", "yes", "The plan covers gender-affirming hormone therapy and surgery."), null);
  assert.equal(policySupport("nondiscrimination_orientation", "yes", "on the basis of race, color, religion, sex, sexual orientation, or age"), null);
  assert.notEqual(policySupport("nondiscrimination_orientation", "no", "The College does not discriminate."), null);
  assert.notEqual(policySupport("inclusive_housing", "yes", "Housing assignments are made in the spring."), null);
  assert.equal(conductSupport("Students are expected to refrain from sexual relations outside of marriage between a man and a woman."), null);
  assert.notEqual(conductSupport("Students must follow the Student Handbook."), null);
  // Faith groups: the name or quote must show the tradition.
  assert.equal(faithGroupSupport("jewish", "Hillel", "Hillel at X welcomes Jewish students"), null);
  assert.notEqual(faithGroupSupport("latter_day_saint", "Interfaith Council", "The Interfaith Council meets weekly"), null);
});

test("a long policy quote keeps the words that state it when cut for storage, and still reads as the page's own", () => {
  const list = `The University will not tolerate discrimination or harassment against any person in employment matters, or in the provision of its education programs or activities, on the basis of race, color, religion, national origin, sex, age, disability, marital status, sexual orientation, gender identity, or veteran status.`;
  const q = shortQuote(list, 160, /sexual orientation/i);
  assert.ok(q.length <= 162 && q.includes("sexual orientation"), q);
  assert.ok(quoteOnPage(q, list));
  assert.equal(policySupport("nondiscrimination_orientation", "yes", q), null);
  assert.ok(!shortQuote(list).includes("sexual orientation"), "without the focus, the cut loses it (round 1's Howard quote)");
});

/* ------------------------------------------------------------------ */
/* Message Batches                                                     */
/* ------------------------------------------------------------------ */

const usage = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const message = (id: string) => ({ id, type: "message", role: "assistant", model: "claude-haiku-4-5", stop_reason: "tool_use", content: [], usage }) as unknown as Anthropic.Message;
const params = (n: number) => ({ model: "claude-haiku-4-5", max_tokens: 10, messages: [{ role: "user" as const, content: `call ${n}` }] });

function fakeBatches(o: { endAfter: number; errored?: string[] }) {
  const log: string[] = [];
  let polls = 0;
  let ids: string[] = [];
  const api: PilotBatchApi = {
    async create(body) {
      ids = body.requests.map((r) => r.custom_id);
      log.push(`create ${ids.length}`);
      return { id: "b1", processing_status: "in_progress" } as Anthropic.Messages.MessageBatch;
    },
    async retrieve() {
      polls++;
      return { id: "b1", processing_status: polls >= o.endAfter ? "ended" : "in_progress" } as Anthropic.Messages.MessageBatch;
    },
    async results() {
      return (async function* () {
        for (const id of ids)
          yield (o.errored?.includes(id) ? { custom_id: id, result: { type: "errored", error: { type: "error", error: { type: "api_error", message: "x" } } } } : { custom_id: id, result: { type: "succeeded", message: message(id) } }) as Anthropic.Messages.MessageBatchIndividualResponse;
      })();
    },
    async cancel() {
      log.push("cancel");
      return { id: "b1", processing_status: "canceling" } as Anthropic.Messages.MessageBatch;
    },
  };
  const direct: Caller = {
    async create() {
      log.push("direct");
      return { message: message("direct"), mode: "interactive" };
    },
  };
  return { api, direct, log };
}

test("batches: calls made together go as one batch; an errored one is made directly", async () => {
  const f = fakeBatches({ endAfter: 2, errored: ["c2"] });
  let clock = 0;
  const b = new BatchCaller(f.api, f.direct, { quietMs: 5, pollMs: 10, deadlineMs: 1000, sleep: async (ms) => void (clock += ms), now: () => clock });
  const out = await Promise.all([b.create(params(1)), b.create(params(2)), b.create(params(3))]);
  assert.deepEqual(f.log, ["create 3", "direct"]);
  assert.deepEqual(out.map((o) => o.mode), ["batch", "interactive", "batch"]);
  assert.equal(b.sent[0].fallback, 1);
});

test("batches: a batch past its deadline is cancelled and its calls made directly", async () => {
  const f = fakeBatches({ endAfter: 1e9 });
  let clock = 0;
  const b = new BatchCaller(f.api, f.direct, { quietMs: 5, pollMs: 10, deadlineMs: 50, sleep: async (ms) => void (clock += ms), now: () => clock });
  const out = await Promise.all([b.create(params(1)), b.create(params(2))]);
  assert.deepEqual(f.log, ["create 2", "cancel", "direct", "direct"]);
  assert.ok(out.every((o) => o.mode === "interactive"));
});

test("the budget counts calls waiting in a batch, and batch results are charged at batch prices", () => {
  const budget = new Budget(1);
  const release = budget.hold(0.6);
  assert.throws(() => budget.check(0.5), BudgetSpent);
  release();
  budget.check(0.5);
  budget.charge({ at: TODAY, college: "1", domain: "greek", job: "extraction", model: "claude-haiku-4-5" }, message("a"), "batch");
  budget.charge({ at: TODAY, college: "1", domain: "greek", job: "extraction", model: "claude-haiku-4-5" }, message("b"), "interactive");
  const [batched, direct] = budget.rows;
  assert.equal(batched.mode, "batch");
  assert.ok(Math.abs(batched.cost_usd * 2 - direct.cost_usd) < 1e-9);
});

test("scorer: a key that checked every policy item everywhere scores them at every college; round 1's key only at BACKFILLED", async () => {
  const { score, BACKFILLED } = await import("../scripts/lib/campus-pilot/score.mts");
  const id = "204796"; // Ohio State: not in round 1's BACKFILLED list
  assert.ok(!BACKFILLED.has(id));
  const result = {
    unit_id: id, name: "Ohio State", checked: "2026-10-04", greek: null, faith: null, listings: [], raw: {}, escalated: [], dropped: [], checks: [], errors: [],
    lgbtq: { policies: [{ key: "inclusive_housing", value: "yes", url: "https://example.edu/h", checked: "2026-10-04", quote: "gender-inclusive housing" }] },
  };
  const college = { lgbtq: { policies: { inclusive_housing: { value: "yes", url: "https://example.edu/h", quote: "gender-inclusive housing", checked: "2026-10-04" } } } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (key: any) => score({ results: [result as any], recipes: [], calls: [], key }).facts["policy.inclusive_housing"];
  assert.equal(run({ colleges: { [id]: college } })?.published ?? 0, 0, "round 1 style key: not scored outside BACKFILLED");
  const all = run({ _meta: { all_policy_items_checked: true }, colleges: { [id]: college } });
  assert.equal(all?.published, 1);
  assert.equal(all?.correct, 1);
});
