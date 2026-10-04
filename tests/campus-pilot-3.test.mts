/**
 * Campus-life pilot, round 3 (specs/college-reported-data.md "Round 3 plan"): the round-3 college list; the paid
 * discovery call only for the paid types the probes missed (none → no call), with at most 2 searches; fraternity &
 * sorority report files followed from the office page (news, stories, other parts of the site, and script viewers
 * never taken; refusals not kept); council counts from a report line must name the council; HELD_BACK unchanged.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_COLLEGES_FILE, PILOT_IDS, readCollegeList, type PagesFile } from "../scripts/lib/campus-pilot/files.mts";
import { PAID_TYPES, fslReports, missingForPaid, probeCollege, reportConfirms } from "../scripts/lib/campus-pilot/probe.mts";
import { fslHubLinks, fslLinks, fslReportLinks, type FetchResult, type Page, type PageFetcher } from "../scripts/lib/campus-pilot/pages.mts";
import { Budget, DISCOVERY_MAX_TOKENS, SEARCHES_PER_COLLEGE, discoverCollege, searchCap, type CollegeRef } from "../scripts/lib/campus-pilot/llm.mts";
import { greekSupport } from "../scripts/lib/campus-pilot/support.mts";
import { HELD_BACK } from "../scripts/lib/campus-pilot/merge.mts";
import { textBefore } from "../scripts/lib/campus-pilot/run.mts";
import type { ModelClient } from "../scripts/lib/college-reported/models.mts";

const ROOT = join(import.meta.dirname, "..");
const TODAY = "2026-10-04";

test("the round-3 college list is the default: 25 colleges in the dataset, none from rounds 1 or 2", () => {
  assert.equal(DEFAULT_COLLEGES_FILE, "data/reference/campus-pilot-3-colleges.json");
  const ids = readCollegeList(join(ROOT, DEFAULT_COLLEGES_FILE));
  assert.equal(ids.length, 25);
  const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as { unit_id: string }[];
  const known = new Set(schools.map((s) => s.unit_id));
  for (const id of ids) assert.ok(known.has(id), id);
  const round2 = readCollegeList(join(ROOT, "data/reference/campus-pilot-2-colleges.json"));
  assert.deepEqual(ids.filter((id) => PILOT_IDS.includes(id) || round2.includes(id)), []);
  const workflow = readFileSync(join(ROOT, ".github/workflows/campus-pilot.yml"), "utf8");
  assert.match(workflow, /default: data\/reference\/campus-pilot-3-colleges\.json/);
});

test("HELD_BACK only grows: every type held after round 2 is still held (only a scored run can lift one)", () => {
  const afterRound2 = {
    greek: ["members_total", "housing", "deferred", "formal_term"],
    faith: ["office"],
    policies: ["health_plan_transition"],
    listings: ["faith/group", "lgbtq/group", "faith/estimate"],
  } as const;
  const held = HELD_BACK as unknown as Record<string, readonly string[]>;
  for (const [group, keys] of Object.entries(afterRound2)) for (const k of keys) assert.ok(held[group]?.includes(k), `${group}: ${k} was lifted`);
  // Round 3's score (2026-10-04) added these holds.
  assert.ok(held.councilFields.includes("members"));
  assert.ok(held.lgbtq.includes("center"));
  assert.ok(held.policies.includes("nondiscrimination_orientation") && held.policies.includes("nondiscrimination_identity"));
});

/* ------------------------------------------------------------------ */
/* The paid call: only for what the probes missed                      */
/* ------------------------------------------------------------------ */

const college = (o: Partial<CollegeRef> = {}): CollegeRef => ({ unit_id: "999001", name: "X University", city: "X", state: "XX", website: "https://www.x.edu/", affiliation: null, single_sex: false, ...o });

test("no paid call when every paid type has a probe page; otherwise only the paid types still missing", async () => {
  const all = { fsl_office: "a", lgbtq_center: "b", nondiscrimination: "c", conduct_code: "d" };
  assert.deepEqual(missingForPaid(college(), all), []);
  assert.deepEqual(missingForPaid(college({ affiliation: "Baptist" }), { ...all, conduct_code: undefined }), ["conduct_code"]);
  // Housing, chosen name, trans admission, the faith office, and the religion report never trigger the paid call
  // (round 2: no readable page from it, or held back).
  assert.deepEqual(missingForPaid(college({ single_sex: true, affiliation: "Baptist" }), all), []);
  for (const t of ["housing", "name_policy", "trans_admission", "faith_office", "religion_report"]) assert.ok(!(PAID_TYPES as readonly string[]).includes(t), t);
  // Nothing missing: no request, nothing charged.
  const client = { messages: { stream: () => assert.fail("no paid call when nothing is missing") } } as unknown as ModelClient;
  const budget = new Budget(15);
  const r = await discoverCollege({ client, budget }, college(), []);
  assert.deepEqual(r, { links: {}, searches: 0 });
  assert.equal(budget.rows.length, 0);
});

test("a paid call is cheaper: one search for up to two types, two at most, a smaller output cap", async () => {
  assert.equal(searchCap(["fsl_office"]), 1);
  assert.equal(searchCap(["fsl_office", "lgbtq_center"]), 1);
  assert.equal(searchCap(["fsl_office", "lgbtq_center", "nondiscrimination"]), 2);
  assert.equal(searchCap(["fsl_office", "lgbtq_center", "nondiscrimination", "conduct_code", "housing", "name_policy"]), 2);
  assert.equal(SEARCHES_PER_COLLEGE, 2);
  assert.ok(DISCOVERY_MAX_TOKENS < 4000);
  // The request itself: the search tool limited to the college's domain and to the cap; only the missing fields asked.
  let sent: Anthropic.MessageCreateParams | undefined;
  const reply = {
    id: "m",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t", name: "save_links", input: { lgbtq_center: "https://www.x.edu/lgbtq", notes: "" } }],
    usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 1 } },
  };
  const client = {
    messages: {
      stream: (p: Anthropic.MessageCreateParams) => {
        sent = p;
        return { finalMessage: async () => reply };
      },
    },
  } as unknown as ModelClient;
  const r = await discoverCollege({ client, budget: new Budget(15) }, college(), ["lgbtq_center"]);
  assert.equal(r.links.lgbtq?.lgbtq_center, "https://www.x.edu/lgbtq");
  const search = (sent!.tools as { type: string; max_uses?: number; allowed_domains?: string[] }[]).find((t) => t.type.startsWith("web_search"))!;
  assert.equal(search.max_uses, 1);
  assert.deepEqual(search.allowed_domains, ["x.edu"]);
  assert.equal(sent!.max_tokens, DISCOVERY_MAX_TOKENS);
  const save = (sent!.tools as { name: string; input_schema?: { properties: Record<string, unknown> } }[]).find((t) => t.name === "save_links")!;
  assert.deepEqual(Object.keys(save.input_schema!.properties), ["lgbtq_center", "notes"]);
});

/* ------------------------------------------------------------------ */
/* FSL report files                                                    */
/* ------------------------------------------------------------------ */

const page = (url: string, text: string, links: { url: string; text: string }[] = [], o: Partial<Page> = {}): Page => ({ url, final_url: url, format: "html", text, links, sha256: "h", fetched: TODAY, ...o });
const filler = " Lorem ipsum dolor sit amet.".repeat(10);

// Shaped on round 2's real offices: Morehouse's links to the college's strategic plan, Penn State's to recreation
// memberships, UGA's news posts, Texas A&M's Issuu report, Oregon's report on a CDN host, Northwestern's grade-report page.
const OFFICE = "https://www.x.edu/student-life/fraternity-sorority-life/";
const office = page(OFFICE, `Fraternity and Sorority Life: 40 chapters in four councils.${filler}`, [
  { url: "https://www.x.edu/about/leadership/strategic-plan/", text: "Strategic Plan" },
  { url: "https://www.x.edu/health-wellbeing/recreation/membership-access", text: "Membership" },
  { url: `${OFFICE}news/2026/05/greek-alumni-recognized`, text: "Greek alumni recognized" },
  { url: "https://issuu.com/xgreeks/docs/greek_report_spring_2026", text: "Greek Report Spring 2026" },
  { url: "https://cdn.example-wp.com/x/files/2026/09/Spring-2026-Chapter-Size-Report.pdf", text: "Spring 2026 Chapter Size Report" },
  { url: "https://cdn.example-wp.com/x/files/2024/01/Fall-2023-Grade-Report.pdf", text: "Fall 2023 Grade Report" },
  { url: `${OFFICE}councils/`, text: "Our Councils" },
  { url: `${OFFICE}parents-families/grade-reports.html`, text: "Grade Reports" },
  { url: `${OFFICE}staff/jane-doe`, text: "Jane Doe" },
]);

test("fslLinks: report files on any host the office links to, council pages in its own section; never the rest of the site", () => {
  const urls = fslLinks(office, 20).map((l) => l.url);
  assert.equal(urls[0], "https://cdn.example-wp.com/x/files/2026/09/Spring-2026-Chapter-Size-Report.pdf", "the newest size report first");
  assert.ok(urls.includes(`${OFFICE}councils/`));
  assert.ok(urls.includes(`${OFFICE}parents-families/grade-reports.html`));
  for (const bad of ["strategic-plan", "recreation", "/news/", "issuu.com", "/staff/"]) assert.ok(!urls.some((u) => u.includes(bad)), bad);
  const reports = fslReportLinks(office).map((l) => l.url);
  assert.ok(!reports.includes(`${OFFICE}councils/`), "a council page isn't a report");
  assert.ok(reports.includes(`${OFFICE}parents-families/grade-reports.html`));
});

function fetcherOf(site: Record<string, Page | { blocked: string }>, calls: { url: string; quiet?: boolean }[]): PageFetcher {
  return {
    async sitemaps() {
      return [];
    },
    async raw() {
      return null;
    },
    async get(url: string, o: { quiet?: boolean } = {}): Promise<FetchResult> {
      calls.push({ url, quiet: o.quiet });
      const v = site[url];
      if (!v) return { ok: false, url, error: "HTTP 404" };
      if ("blocked" in v) return { ok: false, url, blocked: v.blocked };
      return { ok: true, page: v };
    },
  } as unknown as PageFetcher;
}

test("probes follow the FSL office to its report files, one page down too; a refused or off-topic file isn't kept", async () => {
  const calls: { url: string; quiet?: boolean }[] = [];
  const pdf = (url: string, text: string): Page => page(url, text, [], { format: "pdf" });
  const site: Record<string, Page | { blocked: string }> = {
    "https://www.x.edu/": page("https://www.x.edu/", `X University.${filler}`, [{ url: OFFICE, text: "Fraternity & Sorority Life" }]),
    [OFFICE]: office,
    // robots.txt on the CDN host refuses the size report: a miss, never fetched another way.
    "https://cdn.example-wp.com/x/files/2026/09/Spring-2026-Chapter-Size-Report.pdf": { blocked: "robots" },
    "https://cdn.example-wp.com/x/files/2024/01/Fall-2023-Grade-Report.pdf": pdf("https://cdn.example-wp.com/x/files/2024/01/Fall-2023-Grade-Report.pdf", `Fall 2023 Fraternity and Sorority Grade Report. Panhellenic Council 3.41 average GPA, 12 chapters, 1,450 members.${filler}`),
    [`${OFFICE}parents-families/grade-reports.html`]: page(`${OFFICE}parents-families/grade-reports.html`, `Grade reports for fraternity and sorority chapters, each term.${filler}`, [
      { url: `${OFFICE}pdfs/spring-2026-community-report.pdf`, text: "Spring 2026 Community Report" },
    ]),
    [`${OFFICE}pdfs/spring-2026-community-report.pdf`]: pdf(`${OFFICE}pdfs/spring-2026-community-report.pdf`, `Spring 2026 Fraternity and Sorority Community Report. Interfraternity Council: 18 chapters, 1,210 members.${filler}`),
    [`${OFFICE}councils/`]: page(`${OFFICE}councils/`, `Our councils: Panhellenic, Interfraternity, NPHC, MGC. Each council's chapters.${filler}`),
  };
  const r = await probeCollege(fetcherOf(site, calls), { unit_id: "999001", website: "https://www.x.edu/", single_sex: false, affiliation: null });
  assert.equal(r.found.fsl_office, OFFICE);
  assert.ok(r.reports.includes(`${OFFICE}pdfs/spring-2026-community-report.pdf`), "a file one page down");
  assert.ok(r.reports.includes("https://cdn.example-wp.com/x/files/2024/01/Fall-2023-Grade-Report.pdf"), "a file on the office's CDN host");
  assert.ok(!r.reports.some((u) => u.includes("Chapter-Size")), "refused by robots.txt: not kept");
  assert.deepEqual(r.links.greek.fsl_reports, r.reports);
  assert.ok(calls.every((c) => c.quiet), "probe requests stay quiet");
  assert.ok(!calls.some((c) => c.url.includes("issuu.com") || c.url.includes("strategic-plan")));
});

test("a page of reports hands on its files, whatever they're named; a separate FSL site of the college counts as the office's", () => {
  // UNC's "Academic reports" page links "26-Public-Report1.pdf"; Oregon's office links its own FSL blog.
  const list = page("https://fsl.x.edu/about-us/academic-reports/", `Academic reports for fraternity and sorority chapters.${filler}`, [
    { url: "https://fsl.x.edu/wp-content/uploads/2026/07/26-Public-Report1.pdf", text: "Spring 2026" },
    { url: "https://fsl.x.edu/wp-content/uploads/2026/01/25-Public-Report2.pdf", text: "Fall 2025" },
    { url: "https://fsl.x.edu/secure/admin/", text: "Chapter Log In" },
  ]);
  assert.deepEqual(fslReportLinks(list).map((l) => l.url), [], "not on an ordinary page");
  assert.deepEqual(fslReportLinks(list, 6, true).map((l) => l.url), ["https://fsl.x.edu/wp-content/uploads/2026/07/26-Public-Report1.pdf", "https://fsl.x.edu/wp-content/uploads/2026/01/25-Public-Report2.pdf"]);
  const oregon = page("https://studentlife.x.edu/fsl", `Fraternity and Sorority Life.${filler}`, [
    { url: "https://blogs.x.edu/uofsl/", text: "FSL Blog" },
    { url: "https://blogs.x.edu/math/", text: "Math blog" },
    { url: "https://www.instagram.com/xfsl/", text: "Instagram" },
  ]);
  assert.deepEqual(fslHubLinks(oregon).map((l) => l.url), ["https://blogs.x.edu/uofsl/"]);
});

test("a report must read as one: fraternity or sorority words and sizes or grades", async () => {
  assert.ok(reportConfirms(page("https://x.edu/r.pdf", `Interfraternity Council chapter size report: 1,200 members.${filler}`)));
  assert.ok(!reportConfirms(page("https://x.edu/r.pdf", `Annual budget report of the university.${filler}`)));
  const calls: { url: string; quiet?: boolean }[] = [];
  const kept = await fslReports((u) => fetcherOf({}, calls).get(u, { quiet: true }), page(OFFICE, "x", []));
  assert.deepEqual(kept, []);
});

/* ------------------------------------------------------------------ */
/* Council counts from a report must name the council                  */
/* ------------------------------------------------------------------ */

test("a council's count must come from a line that names that council", () => {
  const o = { today: TODAY };
  assert.equal(greekSupport("council", 18, "Interfraternity Council 18 chapters 1,210 members", { ...o, council: "nic", name: "Interfraternity Council" }), null);
  assert.equal(greekSupport("council", 1210, "IFC 18 1,210 3.21", { ...o, council: "nic", name: "Interfraternity Council" }), null);
  // A grade report's table row for another council, or a bare total, can't carry this council's count.
  assert.match(greekSupport("council", 18, "Total 18 chapters 1,210 members", { ...o, council: "nphc", name: "National Pan-Hellenic Council" }) ?? "", /name the council/);
  assert.match(greekSupport("council", 12, "Multicultural Greek Council 12", { ...o, council: "npc", name: "Panhellenic Association" }) ?? "", /name the council/);
  // The council's own name as the extractor gave it also counts, and so does the council's own page (Wake Forest's
  // /ifc/ page: "The council currently oversees 11 recognized chapters"); a general FSL page's address doesn't.
  assert.equal(greekSupport("council", 7, "United Greek Council: 7 chapters", { ...o, council: "professional", name: "United Greek Council" }), null);
  assert.equal(greekSupport("council", 11, "The council currently oversees 11 recognized chapters.", { ...o, council: "nic", name: "Interfraternity Council", page: "https://fse.wfu.edu/membership/getting-involved/ifc/" }), null);
  assert.notEqual(greekSupport("council", 11, "The council currently oversees 11 recognized chapters.", { ...o, council: "nic", name: "Interfraternity Council", page: "https://www.x.edu/fraternity-sorority-life/" }), null);
  // An old report is not today's count (Texas A&M's office still links its 2020–2021 community reports).
  assert.match(greekSupport("council", 18, "Interfraternity Council 18 chapters", { ...o, council: "nic", file: "Community-Report-Spring-2021-Updated.pdf" }) ?? "", /2021/);
  assert.match(greekSupport("council", 18, "Interfraternity Council 18 chapters", { ...o, council: "nic", term: "Fall 2020" }) ?? "", /2020/);
  assert.equal(greekSupport("council", 18, "Interfraternity Council 18 chapters", { ...o, council: "nic", term: "Spring 2026", file: "spring-2026-community-report.pdf" }), null);
  // run.mts gives an HTML page's words just before the quote (never a PDF table's previous row).
  const text = "Interfraternity Council. The IFC governs men's fraternities. The council currently oversees 11 recognized chapters.";
  assert.equal(textBefore(text, "The council currently oversees 11 recognized chapters.", 240), "Interfraternity Council. The IFC governs men's fraternities. ");
  assert.equal(textBefore(text, "Not on the page", 240), "");
});

/** Page text just before a published quote, where the check needs it (copied from the page; run.mts reads it live). */
const BEFORE: Record<string, string> = {
  // studentlife.utexas.edu/sfl/our-community.php, read 2026-10-04.
  "Eight of these organizations are active registered student organizations at UT Austin.":
    'The National Pan-Hellenic Council at The University of Texas at Austin is the governing body for the nine historically African American Greek-letter organizations often referred to as the "Divine Nine." ',
};

test("every council count already published still passes the new check", () => {
  const pages = JSON.parse(readFileSync(join(ROOT, "data", "campus-pages.json"), "utf8")) as PagesFile;
  let n = 0;
  for (const c of pages.colleges)
    for (const k of c.greek?.councils ?? []) {
      for (const v of [k.chapters, k.members]) {
        if (v == null) continue;
        n++;
        assert.equal(greekSupport("council", v, k.quote, { today: TODAY, council: k.council, name: k.name, page: `${k.url} ${BEFORE[k.quote] ?? ""}` }), null, `${c.name}: ${k.name} ${v} — ${k.quote}`);
      }
    }
  assert.ok(n > 10, `published council counts checked: ${n}`);
});
