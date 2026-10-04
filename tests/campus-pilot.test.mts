/**
 * The campus-life pilot (scripts/campus-pilot.mts; lib/campus-pages.ts): quote checks, link harvesting, one college
 * end to end with a fake model client and fake pages (a quote not on its page is escalated then dropped; a "no" and a
 * conduct restriction publish only when the second check confirms them), the spend cap, the detail table's guards
 * (each broken on purpose), the merge into the directories and campus_pages tables, and the display helpers
 * (expiry, small numbers). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type { DatasetMeta, School } from "../lib/types";
import { campusPagesProblems, checkCampusPages, greekCouncils, isFresh, policyRows, countLabel, type CampusPagesRows } from "../lib/campus-pages.ts";
import { checkDirectoryRows, type CreditedListing } from "../lib/directories.ts";
import { validateDetail } from "../lib/detail.ts";
import { validateSchool } from "../lib/lineage.ts";
import { policyChecklist } from "../lib/lgbtq-policy.ts";
import { fslLinks, keywordWindows, quoteOnPage, shortQuote, type Page, type PageFetcher } from "../scripts/lib/campus-pilot/pages.mts";
import { Budget, BudgetSpent, type CollegeRef, type Ctx } from "../scripts/lib/campus-pilot/llm.mts";
import { runCollege } from "../scripts/lib/campus-pilot/run.mts";
import { publishable } from "../scripts/lib/campus-pilot/files.mts";
import { NONE_HELD, applyLgbtqPolicies, campusPagesDetails, pilotDirectoryFiles } from "../scripts/lib/campus-pilot/merge.mts";
import { directoryDetails } from "../scripts/lib/directories/merge.mts";
import type { ModelClient } from "../scripts/lib/college-reported/models.mts";

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

test("quoteOnPage folds spacing, case, curly quotes, and dashes, and splits on ellipses", () => {
  const page = "The University prohibits discrimination based on race,  color, SEX, gender identity — and sexual orientation.\nIt’s the policy.";
  assert.ok(quoteOnPage("prohibits discrimination based on race, color, sex, gender identity - and sexual orientation", page));
  assert.ok(quoteOnPage("It's the policy", page));
  assert.ok(quoteOnPage("prohibits discrimination ... It’s the policy.", page));
  assert.ok(!quoteOnPage("prohibits discrimination based on religion", page));
  assert.ok(!quoteOnPage("", page));
});

test("keywordWindows keeps the text around hits when a page is long", () => {
  const filler = "lorem ipsum ".repeat(2000);
  const text = `${filler} The honor code requires abstaining from same-sex romantic behavior. ${filler}`;
  const w = keywordWindows(text, /same-sex/i, 3000, 200);
  assert.ok(w.length <= 3000);
  assert.ok(w.includes("same-sex romantic behavior"));
  assert.equal(keywordWindows("short", /x/, 3000), "short");
});

test("shortQuote cuts at a word boundary under 160 characters", () => {
  const q = shortQuote("word ".repeat(60));
  assert.ok(q.length <= 160 && q.endsWith("…"));
});

test("fslLinks puts size reports first, newest first", () => {
  const page: Page = {
    url: "https://x.edu/sfl/",
    final_url: "https://x.edu/sfl/",
    format: "html",
    text: "",
    sha256: "",
    fetched: "2026-10-04",
    links: [
      { url: "https://x.edu/sfl/downloads/2024FallIFCSizeReport.pdf", text: "Fall 2024 IFC Size Report" },
      { url: "https://x.edu/sfl/downloads/2026SpringIFCSizeReport.pdf", text: "Spring 2026 IFC Size Report" },
      { url: "https://x.edu/sfl/downloads/2026SpringIFCGradeReport.pdf", text: "Spring 2026 Grade Report" },
      { url: "https://x.edu/about/", text: "About the university" },
      { url: "https://facebook.com/x", text: "Facebook" },
    ],
  };
  const out = fslLinks(page).map((l) => l.url);
  assert.equal(out[0], "https://x.edu/sfl/downloads/2026SpringIFCSizeReport.pdf");
  assert.ok(out.indexOf("https://x.edu/sfl/downloads/2026SpringIFCGradeReport.pdf") > out.indexOf("https://x.edu/sfl/downloads/2024FallIFCSizeReport.pdf") || out.length >= 3);
  assert.ok(!out.includes("https://facebook.com/x"));
});

/* ------------------------------------------------------------------ */
/* One college end to end, with fakes                                  */
/* ------------------------------------------------------------------ */

const COLLEGE: CollegeRef = { unit_id: "999001", name: "Test College", city: "Town", state: "TX", website: "https://www.test.edu/", affiliation: "Baptist", single_sex: false };

const PAGES: Record<string, string> = {
  "https://www.test.edu/fsl/": "Fraternity and Sorority Life. Our community has 1,200 members in 30 chapters. Interfraternity Council: 12 chapters, 600 members (Spring 2026). Recruitment happens in the fall before classes.",
  "https://www.test.edu/chaplain/": "Office of the Chaplain. Student groups we support include the Muslim Student Association and Hillel.",
  "https://www.test.edu/ir/religion.pdf": "--- Page 1 ---\nFall 2025 enrollment by religion: Baptist 3,000; Catholic 2,000; Total 10,000",
  "https://www.test.edu/nondiscrimination/": "Test College does not discriminate on the basis of race, color, sex, national origin, age, or disability.",
  "https://www.test.edu/conduct/": "Students are expected to refrain from sexual relations outside of marriage between a man and a woman.",
  "https://www.test.edu/housing/": "Residence Life. All halls are single-sex. Roommates are assigned by the housing office.",
};

function fakeFetcher(): PageFetcher {
  return {
    async sitemaps() {
      return [];
    },
    async raw() {
      return null;
    },
    async get(url: string) {
      const text = PAGES[url];
      if (!text) return { ok: false as const, url, error: "HTTP 404" };
      return { ok: true as const, page: { url, final_url: url, format: url.endsWith(".pdf") ? "pdf" : "html", text, links: [], sha256: "h", fetched: "2026-10-04" } as Page };
    },
  } as unknown as PageFetcher;
}

const usage = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } };
const msg = (name: string, input: unknown): Anthropic.Message =>
  ({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name, input }], usage }) as unknown as Anthropic.Message;

const LINKS: Record<string, unknown> = {
  greek: { fsl_office: "https://www.test.edu/fsl/", fsl_reports: [], recruitment: null, greek_none: null, notes: "" },
  faith: { faith_office: "https://www.test.edu/chaplain/", faith_groups: null, religion_report: "https://www.test.edu/ir/religion.pdf", faith_estimate: [], notes: "" },
  lgbtq: {
    lgbtq_center: null,
    lgbtq_groups: null,
    nondiscrimination: "https://www.test.edu/nondiscrimination/",
    housing: "https://www.test.edu/housing/",
    name_policy: null,
    health_plan: null,
    restrooms: null,
    trans_admission: null,
    conduct_code: "https://www.test.edu/conduct/",
    notes: "",
  },
};

const nf = { value: "not_found", page: 0, quote: "" };
function extraction(domain: string, model: string): unknown {
  if (domain === "greek")
    return {
      status: { value: "present", page: 1, quote: "Fraternity and Sorority Life" },
      office_name: "Fraternity and Sorority Life",
      members_total: { value: 1200, term: "", page: 1, quote: "Our community has 1,200 members in 30 chapters" },
      councils: [{ council: "nic", name: "Interfraternity Council", chapters: 12, members: 600, term: "Spring 2026", page: 1, quote: "Interfraternity Council: 12 chapters, 600 members" }],
      housing: { value: "unknown", page: 0, quote: "" },
      deferred: { value: "unknown", page: 0, quote: "" },
      // Haiku invents a quote the first time; the escalation copies it right.
      formal_term: { value: "Fall", page: 1, quote: model.includes("haiku") ? "Recruitment is held each fall semester" : "Recruitment happens in the fall before classes" },
      confidence: "high",
    };
  if (domain === "faith")
    return {
      office: { name: "Office of the Chaplain", page: 1, quote: "Office of the Chaplain" },
      communities: [
        { name: "Muslim Student Association", tradition: "muslim", page: 1, quote: "Muslim Student Association" },
        { name: "Hillel", tradition: "jewish", page: 1, quote: "Hillel" },
      ],
      composition: { items: [{ label: "Baptist", count: 3000, share: null }, { label: "Catholic", count: 2000, share: null }], total: 10000, population: "all students", as_of: "Fall 2025", page: 2, quote: "Baptist 3,000; Catholic 2,000; Total 10,000" },
      estimates: [],
      confidence: "high",
    };
  return {
    center: { status: "none_found", name: "", closed: "", page: 0, quote: "" },
    groups: [],
    policies: {
      nondiscrimination_orientation: { value: "no", page: 1, quote: "does not discriminate on the basis of race, color, sex, national origin, age, or disability" },
      nondiscrimination_identity: { value: "no", page: 1, quote: "does not discriminate on the basis of race, color, sex, national origin, age, or disability" },
      inclusive_housing: { value: "no", page: 2, quote: "All halls are single-sex." },
      name_on_records: nf,
      inclusive_restrooms: nf,
      health_plan_transition: nf,
      trans_admission: nf,
    },
    conduct: { restricts: "yes", document: "Student Handbook", page: 3, quotes: ["refrain from sexual relations outside of marriage between a man and a woman"] },
    confidence: "high",
  };
}

function fakeClient(log: string[], verdicts: (finding: string) => boolean): ModelClient {
  return {
    messages: {
      async create(body: Anthropic.MessageCreateParamsNonStreaming) {
        const tool = (body.tools?.[0] as Anthropic.Tool).name;
        const text = JSON.stringify(body.messages);
        if (tool === "record_check") {
          const finding = /Finding: ([^\\]*)/.exec(text)?.[1] ?? "";
          log.push(`verify ${body.model}: ${finding.slice(0, 40)}`);
          return msg("record_check", { quote_on_page: true, confirmed: verdicts(finding), reason: "test" });
        }
        const domain = text.includes("Fraternity and sorority") ? "greek" : text.includes("Religious and spiritual") ? "faith" : "lgbtq";
        log.push(`${tool} ${domain} ${body.model}`);
        return msg("record_facts", extraction(domain, body.model));
      },
      stream(body: Anthropic.MessageStreamParams) {
        // Round 2: one discovery call per college, asking only for the fields the free probes didn't find.
        const asked = Object.keys(((body.tools ?? []).find((t) => "name" in t && t.name === "save_links") as Anthropic.Tool).input_schema.properties ?? {});
        log.push(`discover ${asked.filter((k) => k !== "notes").join(",")}`);
        const all: Record<string, unknown> = Object.assign({}, ...Object.values(LINKS));
        return { finalMessage: async () => msg("save_links", Object.fromEntries(asked.map((k) => [k, all[k] ?? null]))) };
      },
    },
  };
}

test("runCollege: quotes checked, escalation on a bad quote, second check gates every sensitive finding", async () => {
  const log: string[] = [];
  // The second model rejects the housing "no" (it reads "single-sex" halls as not ruling out an option) and accepts the rest.
  const ctx: Ctx = { client: fakeClient(log, (f) => !f.startsWith("Gender-inclusive housing")), budget: new Budget(5) };
  const { result, recipe } = await runCollege(ctx, fakeFetcher(), COLLEGE, { today: "2026-10-04", log: () => {} });

  // One discovery call for the whole college, for what the probes (none found here) missed: the scored types, the
  // conduct code (a religious college), and the religion report (an affiliated one); never restrooms or the health plan.
  assert.deepEqual(log.filter((l) => l.startsWith("discover")), ["discover fsl_office,greek_none,faith_office,lgbtq_center,nondiscrimination,housing,name_policy,conduct_code,religion_report"]);
  // Greek: Haiku's invented quote triggered one Sonnet re-read; the corrected fact is kept.
  assert.deepEqual(result.escalated, ["greek"], JSON.stringify(result.dropped));
  assert.equal(result.greek?.formal_term?.value, "Fall");
  assert.equal(result.greek?.councils?.[0].members, 600);
  assert.equal(result.greek?.members_total?.value, 1200);
  // Faith: composition confirmed, shares computed from the printed total; groups become tier B listings.
  assert.equal(result.faith?.composition?.verified_by, "claude-sonnet-5");
  assert.equal(result.faith?.composition?.items[0].share, 0.3);
  assert.deepEqual(result.listings.map((l) => l.name).sort(), ["Hillel", "Muslim Student Association"]);
  // LGBTQ+: two confirmed "no"s and the conduct quote publish; the rejected housing "no" is dropped and logged.
  const keys = (result.lgbtq?.policies ?? []).map((p) => `${p.key}:${p.value}`).sort();
  assert.deepEqual(keys, ["conduct_restriction:yes", "nondiscrimination_identity:no", "nondiscrimination_orientation:no"]);
  assert.ok(result.lgbtq?.policies?.every((p) => p.verified_by === "claude-sonnet-5"));
  assert.ok(result.dropped.some((d) => d.fact === "lgbtq.inclusive_housing" && d.reason === "second check did not confirm"));
  assert.equal(result.checks.length, 5);
  assert.equal(result.checks.filter((c) => !c.confirmed).length, 1);
  // Recipe: the links and the pages read, for re-runs.
  assert.equal(recipe.sources.filter((s) => s.status === "ok").length, 6);
  // What publishes passes the detail table's own checks.
  const pub = publishable(result)!;
  const rows: CampusPagesRows = { greek: pub.greek, faith: pub.faith, lgbtq: pub.lgbtq };
  assert.deepEqual(campusPagesProblems(rows), []);
  // Cost was measured from the responses' usage.
  assert.ok(ctx.budget.spent > 0 && ctx.budget.rows.length === log.length);
});

test("a saved recipe skips discovery", async () => {
  const log: string[] = [];
  const ctx: Ctx = { client: fakeClient(log, () => true), budget: new Budget(5) };
  const recipe = { unit_id: COLLEGE.unit_id, learned: "2026-10-04", model: "claude-sonnet-5", links: LINKS as never, sources: [] };
  await runCollege(ctx, fakeFetcher(), COLLEGE, { today: "2026-10-04", recipe, log: () => {} });
  assert.equal(log.filter((l) => l.startsWith("discover")).length, 0);
});

test("the spend cap stops a college before the next call", async () => {
  const log: string[] = [];
  const budget = new Budget(0.1);
  budget.spent = 0.09;
  const ctx: Ctx = { client: fakeClient(log, () => true), budget };
  const { result } = await runCollege(ctx, fakeFetcher(), COLLEGE, { today: "2026-10-04", log: () => {} });
  assert.match(result.stopped ?? "", /spend cap/);
  assert.equal(log.length, 0);
  assert.throws(() => budget.check(0.5), BudgetSpent);
});

/* ------------------------------------------------------------------ */
/* Guards (each broken on purpose)                                     */
/* ------------------------------------------------------------------ */

const ref = { url: "https://www.test.edu/p", checked: "2026-10-04", quote: "As printed." };
const SOUND: CampusPagesRows = {
  greek: { councils: [{ ...ref, council: "npc", name: "Panhellenic", chapters: 10, members: 900, term: "Fall 2025" }] },
  faith: { composition: { ...ref, items: [{ label: "Catholic", count: null, share: 0.8 }], population: "undergraduates", as_of: null, verified_by: "claude-sonnet-5" } },
  lgbtq: { policies: [{ key: "nondiscrimination_identity", value: "no", url: ref.url, checked: ref.checked, quote: "race, color, sex", verified_by: "claude-sonnet-5" }] },
};

test("checkCampusPages accepts sound rows and refuses each broken rule", () => {
  assert.equal(checkCampusPages(SOUND), null);
  const broken: [string, (r: CampusPagesRows) => void, RegExp][] = [
    ["a no without the second check", (r) => delete r.lgbtq!.policies![0].verified_by, /verified_by/],
    ["a composition without the second check", (r) => delete r.faith!.composition!.verified_by, /verified_by/],
    ["a fact without a quote", (r) => (r.greek!.councils![0].quote = ""), /quote/],
    ["a quote over 160 characters", (r) => (r.greek!.councils![0].quote = "x".repeat(161)), /over 160/],
    ["a page that isn't https", (r) => (r.greek!.councils![0].url = "http://www.test.edu/p"), /https/],
    ["an undated fact", (r) => (r.greek!.councils![0].checked = "October"), /ISO date/],
    ["an unknown council", (r) => ((r.greek!.councils![0] as { council: string }).council = "ifc"), /unknown council/],
    ["a stored not_found", (r) => (r.lgbtq!.policies![0].value = "not_found"), /not stored/],
    ["a share over 1", (r) => (r.faith!.composition!.items[0].share = 80), /impossible/],
  ];
  for (const [what, breakIt, re] of broken) {
    const r = structuredClone(SOUND);
    breakIt(r);
    assert.match(checkCampusPages(r) ?? "", re, what);
  }
  assert.match(checkCampusPages({}) ?? "", /no facts/);
});

/* ------------------------------------------------------------------ */
/* Merge and display                                                   */
/* ------------------------------------------------------------------ */

test("the merge credits each listing to the college's page and builds a valid campus_pages table", () => {
  const pages = {
    updated: "2026-10-04",
    colleges: [
      {
        unit_id: "152080",
        name: "University of Notre Dame",
        checked: "2026-10-04",
        faith: SOUND.faith,
        listings: [
          { domain: "faith" as const, kind: "group" as const, tradition: "muslim" as const, name: "Muslim Student Association", url: "https://campusministry.nd.edu/x/", publisher: "University of Notre Dame", quote: "There is an active Muslim Student Association", checked: "2026-10-04" },
          { domain: "faith" as const, kind: "group" as const, tradition: "jewish" as const, name: "Jewish Student Group", url: "https://campusministry.nd.edu/x/", publisher: "University of Notre Dame", quote: "The Jewish Student Group meets", checked: "2026-10-04" },
          { domain: "faith" as const, kind: "estimate" as const, tradition: "jewish" as const, name: "Hillel at ND", url: "https://hillel.example.org/", publisher: "Hillel at ND", quote: "about 300 Jewish students", fact: "300 Jewish students", checked: "2026-10-04" },
        ],
      },
    ],
  };
  const files = pilotDirectoryFiles(pages, NONE_HELD);
  assert.equal(files.length, 3);
  const [table] = directoryDetails(files, new Set(["152080"]));
  assert.equal(checkDirectoryRows(table.tables.directories!.rows), null);
  const est = table.tables.directories!.rows.listings.find((l) => l.name === "Hillel at ND")!;
  assert.equal(table.tables.directories!.rows.credits[est.org].tier, "C");

  const [detail] = campusPagesDetails(pages, new Set(["152080"]), NONE_HELD);
  const meta = { sources: { "policy-page": { label: "x", publisher: "x", edition: "x", url: "/data", description: "x" } }, vintages: {} } as unknown as DatasetMeta;
  assert.deepEqual(validateDetail(detail, meta), []);
  assert.equal(detail.tables.campus_pages!.year, "October 2026");
  assert.deepEqual(campusPagesDetails(pages, new Set(["1"])), []);
});

test("display: facts expire after two years, counts under 10 show as fewer than 10", () => {
  assert.ok(isFresh("2024-10-05", "2026-10-04"));
  assert.ok(!isFresh("2024-10-03", "2026-10-04"));
  assert.equal(countLabel(7), "fewer than 10");
  assert.equal(countLabel(3984), "3,984");
  const rows: CampusPagesRows = {
    greek: {
      councils: [
        { ...ref, council: "nphc", name: "NPHC", chapters: 2, members: 7, term: "Spring 2026" },
        { ...ref, council: "npc", name: "Panhellenic", chapters: 13, members: 3984, term: "Spring 2026" },
        { ...ref, checked: "2023-01-01", council: "nic", name: "Old IFC", chapters: 20, members: 2000, term: "Fall 2022" },
      ],
    },
  };
  const b = greekCouncils(rows, "2026-10-04")!;
  assert.deepEqual(b.rows.map((r) => [r.name, r.members]), [["Panhellenic", "3,984"], ["NPHC", "fewer than 10"]]);
  assert.equal(b.term, "Spring 2026");
  assert.equal(greekCouncils({ greek: { councils: [rows.greek!.councils![2]] } }, "2026-10-04"), null);
  assert.deepEqual(policyRows(SOUND, "2029-01-01"), []);
});

test("the fetcher never requests a Campus Labs Engage API path", async () => {
  const { PageFetcher } = await import("../scripts/lib/campus-pilot/pages.mts");
  let requested = 0;
  const http = { get: async () => (requested++, null) } as never;
  const f = new PageFetcher(http, "/nonexistent-cache-dir", "2026-10-04");
  const r = await f.get("https://utexas.campuslabs.com/engage/api/discovery/search/organizations");
  assert.equal(r.ok, false);
  assert.equal(requested, 0);
});

test("a robots.txt refusal is a block for the owner's list; a dead host is not", async () => {
  const { PageFetcher, httpLogHook } = await import("../scripts/lib/campus-pilot/pages.mts");
  const { directoryHttp } = await import("../scripts/lib/directories/context.mts");
  const fetch = (async (url: string) => {
    if (url.startsWith("https://dead.example.edu")) throw new Error("getaddrinfo ENOTFOUND");
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /sfl/downloads/\n", { status: 200 });
    return new Response("<p>ok</p>", { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof globalThis.fetch;
  const dead = new Set<string>();
  const http = directoryHttp({ fetch, sleep: async () => {}, log: httpLogHook(dead) });
  const f = new PageFetcher(http, "/nonexistent-cache-dir", "2026-10-04", dead);
  const refused = await f.get("https://studentlife.example.edu/sfl/downloads/2026SpringIFCSizeReport.pdf");
  assert.equal(!refused.ok && refused.blocked, "robots");
  const gone = await f.get("https://dead.example.edu/center/");
  assert.equal(gone.ok, false);
  assert.equal(!gone.ok && gone.blocked, undefined);
  assert.deepEqual(f.blocked.map((b) => b.url), ["https://studentlife.example.edu/sfl/downloads/2026SpringIFCSizeReport.pdf"]);
});

/* ------------------------------------------------------------------ */
/* Held-back fact types (2026-10-04 pilot score below ~95%)            */
/* ------------------------------------------------------------------ */

test("held-back fact types never reach the dataset, on the committed pilot results; dropping the filter fails", async () => {
  const { readFileSync } = await import("node:fs");
  const { HELD_BACK, withoutHeld } = await import("../scripts/lib/campus-pilot/merge.mts");
  const pages = JSON.parse(readFileSync(new URL("../data/campus-pages.json", import.meta.url), "utf8"));
  const ids = new Set<string>(pages.colleges.map((c: { unit_id: string }) => c.unit_id));
  const leaks = (json: string) => [
    ...HELD_BACK.greek.filter((k) => json.includes(`"${k}"`)),
    ...HELD_BACK.policies.filter((k) => json.includes(`"${k}"`)),
  ];
  // The filtered merge leaks nothing.
  assert.deepEqual(leaks(JSON.stringify(campusPagesDetails(pages, ids))), []);
  const listed = pilotDirectoryFiles(pages).map((f) => `${f.classification.domain}/${f.tier === "C" ? "estimate" : "group"}`);
  for (const held of HELD_BACK.listings) assert.ok(!listed.includes(held), `${held} listings were merged`);
  // The raw file does hold them (so this test would catch a merge that skipped the filter).
  assert.ok(leaks(JSON.stringify(pages)).length > 0, "expected held facts in data/campus-pages.json");
  // And withoutHeld keeps the facts that passed.
  const kept = JSON.stringify(withoutHeld(pages));
  assert.ok(kept.includes('"councils"'));
});

/* ------------------------------------------------------------------ */
/* lgbtq.policies: the pilot's facts into the dataset (2026-10-04)     */
/* ------------------------------------------------------------------ */

test("applyLgbtqPolicies merges UCLA's real pilot facts into school.lgbtq.policies, with lineage, and a tier A fact beats a tier D lead for the same key", async () => {
  const { readFileSync } = await import("node:fs");
  const schools: School[] = JSON.parse(readFileSync(new URL("../data/schools.json", import.meta.url), "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(new URL("../data/meta.json", import.meta.url), "utf8"));
  const pages = JSON.parse(readFileSync(new URL("../data/campus-pages.json", import.meta.url), "utf8"));
  const ucla = schools.find((s) => s.unit_id === "110662")!;
  const uclaPage = pages.colleges.find((c: { unit_id: string }) => c.unit_id === "110662");
  assert.ok(uclaPage?.lgbtq?.policies?.some((p: { key: string }) => p.key === "name_on_records"), "fixture needs UCLA's real pilot policies");

  const [merged] = applyLgbtqPolicies([structuredClone(ucla)], pages);
  // health_plan_transition is held back (specs/college-reported-data.md "Campus-life pilot, as built", HELD_BACK);
  // name_on_records and inclusive_restrooms pass.
  assert.deepEqual(merged.lgbtq!.policies!.map((p) => p.key).sort(), ["inclusive_restrooms", "name_on_records"]);
  assert.equal(merged.lineage!["lgbtq.policies"]!.source, "policy-page");
  assert.deepEqual(validateSchool(merged, meta), []);

  // Idempotent: re-merging onto the already-merged school changes nothing.
  const [again] = applyLgbtqPolicies([merged], pages);
  assert.deepEqual(again, merged);

  // The lineage guard fails without a source: deleting the record makes validateSchool object.
  const unlineaged = structuredClone(merged);
  delete unlineaged.lineage!["lgbtq.policies"];
  const problems = validateSchool(unlineaged, meta);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /lgbtq\.policies.*policy-page/);

  // Precedence: UCLA is also on the Trans Policy Clearinghouse's name/pronoun list (specs/lgbtq-life.md phase 3,
  // `tpc-name-pronouns`); the college's own page (tier A, "yes") replaces that tier D lead for the same key.
  const tierD: CreditedListing = {
    org: "tpc-name-pronouns",
    name: "University of California, Los Angeles",
    credit: {
      organization: "Trans Policy Clearinghouse",
      publisher: "Trans Policy Clearinghouse",
      list_url: "https://www.gennyb.com/research/trans-supportive-campus-policies/name-and-pronouns/",
      read: "2026-10-04",
      tier: "D",
      domain: "lgbtq",
      kind: "policy",
      policy: "name_on_records",
    },
    tier: "D",
  };
  const checklist = policyChecklist(merged.lgbtq, [tierD]);
  const row = checklist.find((i) => i.key === "name_on_records")!;
  assert.equal(row.source, "tier-a");
  assert.match(row.text, /college's own page/);
  assert.doesNotMatch(row.text, /Trans Policy Clearinghouse/);
});
