/**
 * The essay prompts reader's misses from the run of reader 2026.10.29.4 (specs/product/essays/prompts.md, "The sixth
 * reader"): colleges that publish their prompts came back refers_to_form. Discovery never takes a graduate or
 * professional school's page (Villanova's law school), looks one level past a page that only points to the
 * application (Cornell, Boston University, UW) or a hub that names the prompts page (Villanova), and takes a start page
 * that prints its prompts below the fold (Harvard); the checks hold a refers_to_form whose quote counts the questions
 * (Harvard) or describes the Common App's own essay (UW), and a page under a graduate path; the read's instructions
 * say a page that prints the prompts is published. Fixture pages, a fake site, no network, no model. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types.ts";
import { htmlToText } from "../scripts/lib/college-reported/documents.mts";
import { COUNTS_QUESTIONS, checkRecord, describesPlatformEssay } from "../scripts/lib/essay-prompts/checks.mts";
import { applyLinkScore, discoverEssayPage, essayLinkScore, graduateHeading, isGraduateUrl, printsPrompts, rankDeeperLinks, refersOnly, type DiscoverHttp } from "../scripts/lib/essay-prompts/discover.mts";
import { READ_MODEL, READ_SYSTEM, buildReadRequest } from "../scripts/lib/essay-prompts/read.mts";
import { prBody, type RunSummary } from "../scripts/lib/essay-prompts/report.mts";
import { READER_VERSION, type EssayRecord } from "../scripts/lib/essay-prompts/store.mts";

const FIX = join(import.meta.dirname, "fixtures", "essay-prompts");
const html = (name: string) => readFileSync(join(FIX, name), "utf8");
const TODAY = "2026-10-30";
const A = "https://admissions.example.edu";

/** A fake site: url → html; everything else 404; requests recorded. */
function fakeSite(pages: Record<string, string>): DiscoverHttp & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async get(url: string) {
      requested.push(url);
      const body = pages[url];
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    },
    async sitemaps() {
      return [];
    },
  };
}

const SCHOOL = { unit_id: "999001", name: "Example University", links: { website: "https://www.example.edu", price_calculator: null, apply: `${A}/apply`, admissions: null } } as Pick<School, "unit_id" | "name" | "links">;

/* ------------------------------------------------------------------ */
/* Graduate and professional schools (Villanova)                       */
/* ------------------------------------------------------------------ */

test("isGraduateUrl: law, medicine, business, nursing, graduate, MBA paths and hosts; never an undergraduate path", () => {
  for (const u of [
    "https://www.villanova.edu/university/law/admissions/how-to-apply.html",
    "https://x.edu/medicine/admissions/apply",
    "https://x.edu/school-of-business/apply",
    "https://x.edu/nursing/apply/essays",
    "https://x.edu/graduate/essays",
    "https://x.edu/admissions/mba/essays",
    "https://law.x.edu/admissions/apply",
    "https://mba.villanova.edu/university/undergraduate-admission/applying-to-villanova/application-essays.html",
    "https://admissions.dartmouth.edu/apply-dartmouth/dartmouth-transfer-application-essays",
  ]) assert.ok(isGraduateUrl(u), u);
  for (const u of [
    "https://www.villanova.edu/university/undergraduate-admission/applying-to-villanova/application-essays.html",
    "https://admissions.example.edu/first-year/essay-prompts",
    "https://x.edu/admissions/lawrence-scholars",
    "https://x.edu/apply/business-of-applying",
  ]) assert.ok(!isGraduateUrl(u), u);
});

test("graduateHeading: a page whose title or first headings name a graduate program; an undergraduate page's menu doesn't count", () => {
  assert.ok(graduateHeading(htmlToText(html("villanova-law.html"))));
  assert.ok(!graduateHeading(htmlToText(html("villanova-essays.html"))));
  assert.ok(!graduateHeading("Writing Supplement | Dartmouth Admissions\n## Admissions\n## Academics\n- Geisel School of Medicine\n- Tuck School of Business\n## Writing Supplement"));
});

test("discovery (Villanova): the law school's page is never fetched or taken; undergraduate links score; the hub's writing-supplement link is followed", async () => {
  assert.equal(applyLinkScore({ url: "https://www.villanova.edu/university/law/admissions/how-to-apply.html", text: "How to Apply" }), 0);
  assert.ok(applyLinkScore({ url: `${A}/university/undergraduate-admission/applying-to-villanova.html`, text: "Applying to Villanova" }) > 0, "'undergraduate' is not 'graduate'");
  assert.ok(essayLinkScore({ url: `${A}/university/undergraduate-admission/applying-to-villanova/application-essays.html`, text: "FIRST-YEAR WRITING SUPPLEMENT" }) >= 3);
  const http = fakeSite({
    [`${A}/apply`]: '<a href="/university/law/admissions/how-to-apply.html">How to Apply</a><a href="/university/undergraduate-admission/applying-to-villanova.html">Applying to Villanova</a>',
    [`${A}/university/law/admissions/how-to-apply.html`]: html("villanova-law.html"),
    [`${A}/university/undergraduate-admission/applying-to-villanova.html`]: html("villanova-hub.html"),
    [`${A}/university/undergraduate-admission/applying-to-villanova/application-essays.html`]: html("villanova-essays.html"),
  });
  const r = await discoverEssayPage(SCHOOL, undefined, { http });
  assert.equal(r.found?.url, `${A}/university/undergraduate-admission/applying-to-villanova/application-essays.html`);
  assert.ok(!http.requested.some((u) => u.includes("/law/")), `requested ${JSON.stringify(http.requested)}`);
});

test("discovery (Villanova): a recipe or a dataset link under a law path is never fetched, whatever pointed to it", async () => {
  const law = "https://admissions.example.edu/university/law/admissions/how-to-apply.html";
  const http = fakeSite({ [law]: html("villanova-law.html"), [`${A}/apply`]: html("villanova-hub.html"), [`${A}/university/undergraduate-admission/applying-to-villanova/application-essays.html`]: html("villanova-essays.html") });
  const r = await discoverEssayPage(SCHOOL, { url: law, via: "apply-page-link", checked: TODAY }, { http });
  assert.ok(!http.requested.includes(law), `requested ${JSON.stringify(http.requested)}`);
  assert.equal(r.found?.url, `${A}/university/undergraduate-admission/applying-to-villanova/application-essays.html`);
  const viaDataset = fakeSite({ [law]: html("villanova-law.html") });
  const d = await discoverEssayPage({ ...SCHOOL, links: { ...SCHOOL.links, apply: law } } as typeof SCHOOL, undefined, { http: viaDataset });
  assert.ok(!viaDataset.requested.includes(law));
  assert.equal(d.found, null);
});

test("discovery (Villanova): a law page at a path that doesn't say so is still refused by its heading", async () => {
  const http = fakeSite({
    [`${A}/apply`]: '<a href="/admissions/how-to-apply-jd.html">How to Apply</a>',
    [`${A}/admissions/how-to-apply-jd.html`]: html("villanova-law.html"),
  });
  const r = await discoverEssayPage(SCHOOL, undefined, { http });
  assert.ok(http.requested.includes(`${A}/admissions/how-to-apply-jd.html`), "fetched (the path says nothing)");
  assert.equal(r.found, null, "but never taken");
});

/* ------------------------------------------------------------------ */
/* One level past a page that points to the form                        */
/* ------------------------------------------------------------------ */

test("printsPrompts / refersOnly: FAQ questions and form instructions aren't prompts; printed questions are", () => {
  const text = (n: string) => htmlToText(html(n));
  assert.ok(printsPrompts(text("harvard-requirements.html")));
  assert.ok(printsPrompts(text("villanova-essays.html")));
  assert.ok(printsPrompts(text("uw-writing-section.html")));
  assert.ok(!printsPrompts(text("uw-how-to-apply.html")), "'Are you willing to study …?' is a form question");
  assert.ok(!printsPrompts(text("cornell-first-year.html")), "'select Yes when asked …?' is an instruction");
  assert.ok(!printsPrompts("Admissions FAQ\nHow do I monitor the status of my application materials online?\nCan I change my application to test-optional after I submit it?"));
  assert.ok(refersOnly(text("cornell-first-year.html")));
  assert.ok(refersOnly(text("bu-first-year.html")));
  assert.ok(refersOnly(text("uw-how-to-apply.html")));
  assert.ok(!refersOnly(text("harvard-requirements.html")), "it says 'with the Common Application' but prints the questions");
  assert.ok(!refersOnly(text("villanova-essays.html")));
});

test("rankDeeperLinks: essay, prompt, and writing-section links on the college's own hosts; never FAQs, transfer, other hosts", () => {
  const links = [
    { url: `${A}/faq`, text: "Frequently Asked Questions" },
    { url: `${A}/how-to-apply/transfer-applicants/writing-prompts`, text: "Transfer writing prompts" },
    { url: "https://blog.example.org/essay-prompts", text: "Essay prompts" },
    { url: `${A}/apply/writing-section/`, text: "Writing section" },
    { url: `${A}/apply/first-year/supplemental-essay/`, text: "Supplemental essay" },
  ];
  assert.deepEqual(rankDeeperLinks(links, [A]).map((l) => l.url), [`${A}/apply/first-year/supplemental-essay/`, `${A}/apply/writing-section/`]);
});

/** The start page links to a first-year page (2b); that page says the essays are in the application. */
async function oneLevelOn(firstYearUrl: string, firstYear: string, linkedUrl: string, linked: string) {
  const http = fakeSite({ [`${A}/apply`]: `<a href="${firstYearUrl.replace(A, "")}">First-year applicants</a>`, [firstYearUrl]: firstYear, [linkedUrl]: linked });
  return { http, r: await discoverEssayPage(SCHOOL, undefined, { http }) };
}

test("discovery (Cornell): 'as part of your Common Application … the Cornell University supplement' is looked past to the writing prompts link", async () => {
  const { r } = await oneLevelOn(`${A}/how-to-apply/first-year-applicants`, html("cornell-first-year.html"), `${A}/how-to-apply/first-year-applicants/writing-prompts`, html("plain-list.html"));
  assert.equal(r.found?.url, `${A}/how-to-apply/first-year-applicants/writing-prompts`);
  assert.equal(r.cost, 0);
});

test("discovery (Boston University): 'you must submit two essays: … and the Boston University supplemental essay' is looked past to that essay's page", async () => {
  const { r } = await oneLevelOn(`${A}/admissions/apply/first-year/`, html("bu-first-year.html"), `${A}/admissions/apply/first-year/supplemental-essay/`, html("plain-list.html"));
  assert.equal(r.found?.url, `${A}/admissions/apply/first-year/supplemental-essay/`);
});

test("discovery (UW): the how-to-apply page's essay link is followed to the writing section; the transfer and FAQ links never", async () => {
  const { http, r } = await oneLevelOn(`${A}/apply/first-year/how-to-apply/`, html("uw-how-to-apply.html"), `${A}/apply/first-year/how-to-apply/writing-section/`, html("uw-writing-section.html"));
  assert.equal(r.found?.url, `${A}/apply/first-year/how-to-apply/writing-section/`);
  assert.ok(!http.requested.some((u) => /transfer|faq/.test(u)), `requested ${JSON.stringify(http.requested)}`);
});

test("discovery: with nothing better one level on, the page that points to the form stands (and the look is capped)", async () => {
  const many = Array.from({ length: 6 }, (_, i) => `<a href="/apply/first-year/essay-${i}">Essay ${i}</a>`).join("");
  const page = html("cornell-first-year.html").replace("</body>", `${many}</body>`);
  const http = fakeSite({ [`${A}/apply`]: '<a href="/how-to-apply/first-year-applicants">First-year applicants</a>', [`${A}/how-to-apply/first-year-applicants`]: page });
  const r = await discoverEssayPage(SCHOOL, undefined, { http });
  assert.equal(r.found?.url, `${A}/how-to-apply/first-year-applicants`);
  assert.ok(http.requested.filter((u) => /essay-\d|writing-prompts/.test(u)).length <= 3, `requested ${JSON.stringify(http.requested)}`);
});

test("discovery (Harvard): a start page that prints its questions below the fold is taken", async () => {
  const text = htmlToText(html("harvard-requirements.html"));
  assert.ok(text.search(/supplement questions|short-answer questions/i) > 4000, "the essay words sit past the first 4,000 characters");
  const http = fakeSite({ [`${A}/apply`]: html("harvard-requirements.html") });
  const r = await discoverEssayPage(SCHOOL, undefined, { http });
  assert.equal(r.found?.url, `${A}/apply`);
  assert.equal(r.found?.via, "known-link");
});

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

function refers(quote: string, o: Partial<EssayRecord> = {}): EssayRecord {
  return {
    unit_id: "999001",
    name: "Example University",
    cycle: "2026-27",
    status: "refers_to_form",
    source_url: `${A}/apply/first-year`,
    retrieved: TODAY,
    sha256: "b".repeat(64),
    cycle_quote: "",
    cycle_assumed: true,
    status_quote: quote,
    via: "apply-page-link",
    model: READ_MODEL,
    reader: READER_VERSION,
    prompts: [],
    ...o,
  };
}
const check = (r: EssayRecord) => checkRecord(r, { today: TODAY, pageText: `Apply. ${r.status_quote}` });

test("checks (Harvard): a refers_to_form whose quote counts the questions is held, first in the list", () => {
  const p = check(refers("Harvard College Questions for the Common Application. There are five required short-answer questions with 150 word limits for each"));
  assert.match(p[0] ?? "", /counts the questions \("five required short-answer questions"\)/);
  assert.ok(COUNTS_QUESTIONS.test("Answer the 3 essay prompts in the application."));
  assert.ok(!COUNTS_QUESTIONS.test("you must submit two essays: the Common Application personal statement and the Boston University supplemental essay."), "essays, not questions");
});

test("checks (UW): a refers_to_form whose quote describes the Common App's own essay is held", () => {
  const p = check(refers("The Common App essay, often referred to as the personal essay, is a required and important part of your application. It has a 650-word maximum word limit, and there are seven prompts to choose from."));
  assert.ok(p.some((x) => /describes the application platform's own essay/.test(x)), JSON.stringify(p));
  assert.ok(describesPlatformEssay("Submit the Common Application personal essay with your application."));
  assert.ok(!describesPlatformEssay("Essays : If you are applying through the Common Application, you must submit two essays: the Common Application personal statement and the Boston University supplemental essay."), "it names the college's supplement");
});

test("checks: the colleges that are truly in the form still pass", () => {
  for (const q of [
    "Essays : If you are applying through the Common Application, you must submit two essays: the Common Application personal statement and the Boston University supplemental essay.",
    "As part of your Common Application, you'll be asked to fill out the Cornell University supplement, which includes the college- or school-specific essay(s) you'll need to answer.",
    "You may choose one of two specific prompts that best allows you to share your story with the Admissions Committee. Detailed instructions can be found on the application.",
  ]) assert.deepEqual(check(refers(q)), [], q);
});

test("checks (Villanova): a page under a graduate or professional path is held; so is one whose heading names a graduate program", () => {
  const q = "Personal Statement - please address the prompt in the application instructions, 11-point font or larger, double space, maximum 3 pages";
  const p = check(refers(q, { source_url: "https://www.villanova.edu/university/law/admissions/how-to-apply.html" }));
  assert.match(p[0] ?? "", /under a graduate, professional-school, or transfer path/);
  const h = checkRecord(refers(q), { today: TODAY, pageText: htmlToText(html("villanova-law.html")) });
  assert.ok(h.some((x) => /title or heading names a graduate or professional program/.test(x)), JSON.stringify(h));
});

test("report: the PR's held table names the new hold reasons", () => {
  const problems = check(refers("There are five required short-answer questions with 150 word limits for each", { source_url: "https://x.edu/law/apply" }));
  const s: RunSummary = {
    run: "2026-10-30T12:00:00Z", started: "", finished: "", cycle: "2026-27", budget_usd: 40, spent_usd: 1, stopped: null, dry_run: false, colleges: 1,
    counts: { passed: 0, held: 1, unchanged: 0, not_found: 0, failed: 0, found: 0 },
    passed: [], held: [{ unit_id: "166027", name: "Harvard University", problems }], not_found: [], failed: [],
  };
  const body = prBody(s);
  assert.match(body, /\| Harvard University \| 166027 \| the page is under a graduate[^|]*; status refers_to_form, but the quoted sentence counts the questions/);
});

/* ------------------------------------------------------------------ */
/* The read's instructions                                             */
/* ------------------------------------------------------------------ */

test("read: a page that prints the prompts is published even when it says the answers go in the application", () => {
  const rule = "Published vs refers_to_form: if the page prints the text of any of the college's own prompts, status is published, even when the page also says the answers are submitted in the application";
  assert.ok(READ_SYSTEM.includes(rule));
  assert.ok(READ_SYSTEM.includes("refers_to_form is only for a page that prints none of the college's own prompt text."));
  assert.ok(READ_SYSTEM.includes('A sentence that counts the questions ("There are five required short-answer questions")'));
  const { params } = buildReadRequest({ school: SCHOOL, url: `${A}/apply`, text: "x" });
  assert.ok(JSON.stringify(params.system).includes("Published vs refers_to_form"));
  assert.notEqual(READER_VERSION, "2026.10.29.4", "the bump re-reads every college on the next run");
});
