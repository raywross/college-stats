/**
 * The site probe (specs/school-identity/links.md, "As built: the probe"; scripts/lib/site-probe.mts, lib/site-probe.ts):
 * the visit scorer, the liveness rule and data/link-issues.json, footer social links, icon candidates, head parsing,
 * the HTTP client's HEAD and skip reasons, the Haiku picker (a fake client), one college end to end, and a whole run
 * into a scratch directory. Fixture HTML and a fake fetch over a URL table: no network, no model. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { DatasetMeta, School } from "../lib/types";
import type { LinkCheck, LinkIssue, SiteProbeEntry } from "../lib/identity-files";
import { FAILURES_TO_NULL, applyProbeLinks, liveness, nextLinkIssues } from "../lib/site-probe.ts";
import { validateSchool } from "../lib/lineage.ts";
import { HttpLimitError, PoliteHttp, errorCode } from "../scripts/lib/college-reported/http.mts";
import type { ModelClient } from "../scripts/lib/college-reported/models.mts";
import {
  VisitPicker,
  buildVisitPickerRequest,
  checkLink,
  fetchPage,
  formatRows,
  iconCandidates,
  mergeProbeEntries,
  parsePage,
  parseVisitPickerResponse,
  pickVisit,
  probeCollege,
  probeContext,
  probeError,
  runSiteProbe,
  siteDomains,
  socialLinks,
  socialProfile,
  systemHostLookup,
  visitScore,
  type HostLookup,
  type PageAnchor,
} from "../scripts/lib/site-probe.mts";

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(import.meta.dirname, "fixtures", "site-probe");
const HOMEPAGE = readFileSync(join(FIXTURES, "homepage.html"), "utf8");
const ADMISSIONS = readFileSync(join(FIXTURES, "admissions.html"), "utf8");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
/** UGA without anything the probe sets (the committed dataset may already hold a previous run's visit page). */
const UGA = (() => {
  const s = structuredClone(schools.find((x) => x.unit_id === "139959")!);
  if (s.links) {
    delete s.links.visit;
    delete s.links.virtual_tour;
  }
  if (s.lineage) {
    delete s.lineage["links.visit"];
    delete s.lineage["links.virtual_tour"];
    if (!Object.keys(s.lineage).length) delete s.lineage;
  }
  return s;
})();
const TODAY = "2026-10-04";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

type Route = string | number | ((init?: RequestInit) => Response | Promise<Response>);
/**
 * fetch over a URL table: a string is a 200 HTML page, a number a bare status. A host with no route at all doesn't
 * resolve (throws ENOTFOUND, like DNS); an unrouted URL on a known host is 404 (robots.txt included, so all allowed).
 */
function fakeFetch(routes: Record<string, Route>) {
  const hosts = new Set(Object.keys(routes).map((u) => new URL(u).host));
  const calls: { method: string; url: string }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url });
    if (!hosts.has(new URL(url).host)) throw new TypeError("fetch failed", { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${new URL(url).host}`), { code: "ENOTFOUND" }) });
    const r = routes[url];
    if (r === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    if (typeof r === "function") return r(init);
    if (typeof r === "number") return new Response(r === 204 ? null : "", { status: r, headers: { "content-type": "text/html" } });
    return new Response(init?.method === "HEAD" ? null : r, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof globalThis.fetch;
  return { fn, calls, pages: () => calls.filter((c) => !c.url.endsWith("/robots.txt")) };
}

const politeHttp = (fetch: typeof globalThis.fetch, o: { timeoutMs?: number } = {}) => new PoliteHttp({ fetch, now: () => 0, sleep: async () => {}, minDelayMs: 0, log: () => {}, ...o });

/** A resolver over the same URL table: a routed host exists, any other doesn't. Keeps every test off the real DNS. */
const fakeHosts =
  (routes: Record<string, unknown>): HostLookup =>
  async (host) =>
    Object.keys(routes).some((u) => new URL(u).hostname === host) ? "yes" : "no";

const anchor = (url: string, text: string, o: Partial<Pick<PageAnchor, "nav" | "header" | "footer">> = {}): PageAnchor => ({ url, text, nav: false, header: false, footer: false, ...o });

/* ------------------------------------------------------------------ */
/* Head parsing and icon candidates                                    */
/* ------------------------------------------------------------------ */

test("head parsing resolves relative, root-relative, and protocol-relative icon URLs against the final URL", () => {
  const page = parsePage(HOMEPAGE, "https://www.example.edu/home/");
  const icons = page.head.filter((l) => l.rel.includes("icon"));
  assert.deepEqual(
    icons.map((l) => l.href),
    [
      "https://www.example.edu/assets/favicon-32.png",
      "https://www.example.edu/home/assets/touch-120.png",
      "https://www.example.edu/assets/pinned.svg",
      "https://www.example.edu/favicon.ico",
      "https://cdn.example.edu/brand/touch-180.png",
      "https://www.example.edu/assets/favicon-192.png",
    ],
  );
  assert.ok(!page.head.some((l) => l.href.includes("commented-out")), "a commented-out link is not a candidate");
});

test("a <base href> is what links resolve against", () => {
  const page = parsePage(ADMISSIONS, "https://www.example.edu/admissions");
  assert.equal(page.base, "https://admissions.example.edu/en/");
  assert.ok(page.anchors.some((a) => a.url === "https://admissions.example.edu/en/visit/"));
});

test("icons: touch icons largest first, then icons largest first, then the two fallbacks; mask-icon is not an icon", () => {
  const page = parsePage(HOMEPAGE, "https://www.example.edu/home/");
  const icons = iconCandidates(page.head, "https://www.example.edu/home/");
  assert.deepEqual(
    icons.map((i) => [i.rel, i.sizes, i.url]),
    [
      ["apple-touch-icon", "180x180", "https://cdn.example.edu/brand/touch-180.png"],
      ["apple-touch-icon", "120x120", "https://www.example.edu/home/assets/touch-120.png"],
      ["icon", "192x192", "https://www.example.edu/assets/favicon-192.png"],
      ["icon", "32x32", "https://www.example.edu/assets/favicon-32.png"],
      ["icon", null, "https://www.example.edu/favicon.ico"],
      ["fallback", null, "https://www.example.edu/apple-touch-icon.png"],
    ],
    "/favicon.ico was declared, so it isn't repeated as a fallback",
  );
  assert.equal(icons[2].type, "image/png");
});

test("icons: a scalable icon ranks first among icons; a page with no head gets only the fallbacks", () => {
  const head = parsePage(
    `<head><link rel="icon" sizes="16x16 48x48" href="/a.ico"><link rel="icon" href="/mark.svg" type="image/svg+xml"><link rel="apple-touch-icon-precomposed" href="/t.png"></head>`,
    "https://x.edu/",
  ).head;
  assert.deepEqual(
    iconCandidates(head, "https://x.edu/").map((i) => i.url),
    ["https://x.edu/t.png", "https://x.edu/mark.svg", "https://x.edu/a.ico", "https://x.edu/apple-touch-icon.png", "https://x.edu/favicon.ico"],
  );
  assert.deepEqual(
    iconCandidates([], "https://x.edu/deep/page").map((i) => [i.rel, i.url]),
    [
      ["fallback", "https://x.edu/apple-touch-icon.png"],
      ["fallback", "https://x.edu/favicon.ico"],
    ],
  );
});

/* ------------------------------------------------------------------ */
/* Landmarks and social links                                          */
/* ------------------------------------------------------------------ */

test("links know their landmark: <nav>, <header>, <footer>, and the ARIA roles; scripts are not read", () => {
  const page = parsePage(HOMEPAGE, "https://www.example.edu/");
  const at = (url: string) => page.anchors.find((a) => a.url === url)!;
  assert.deepEqual([at("https://www.example.edu/admissions/").nav, at("https://www.example.edu/admissions/").header], [true, true], "unclosed <li>s don't leak");
  assert.equal(at("https://www.instagram.com/esu_athletics/").footer, false);
  assert.equal(at("https://www.instagram.com/examplestate/").footer, true, 'role="contentinfo" is a footer');
  assert.equal(at("https://www.instagram.com/examplestate/").text, "Instagram", "an icon link's aria-label is its text");
  assert.ok(!page.anchors.some((a) => a.url.includes("fromscript")));
  const after = parsePage("<nav><a href='/a'>A</a></nav><a href='/b'>B</a></div></nav><footer><p><a href='/c'>C</a></footer><a href='/d'>D</a>", "https://x.edu/");
  assert.deepEqual(
    after.anchors.map((a) => [a.text, a.nav, a.footer]),
    [
      ["A", true, false],
      ["B", false, false],
      ["C", false, true],
      ["D", false, false],
    ],
    "stray closing tags are ignored; an unclosed <p> closes with its footer",
  );
});

test("footer social links win over earlier ones in the page body; share buttons, posts, and people are skipped", () => {
  const page = parsePage(HOMEPAGE, "https://www.example.edu/");
  assert.deepEqual(socialLinks(page.anchors), {
    instagram: "https://www.instagram.com/examplestate/",
    youtube: "https://www.youtube.com/@examplestate",
    tiktok: "https://www.tiktok.com/@examplestate",
    x: "https://twitter.com/ExampleState",
    facebook: "https://www.facebook.com/ExampleStateU",
    linkedin: "https://www.linkedin.com/school/example-state-university/",
  });
});

test("without a footer link, the first profile link on the page is used", () => {
  const links = socialLinks([anchor("https://www.facebook.com/sharer.php?u=x", "Share"), anchor("https://instagram.com/firstone", "IG"), anchor("https://instagram.com/second", "IG")]);
  assert.deepEqual(links, { instagram: "https://instagram.com/firstone" });
});

test("profile shapes per network", () => {
  const yes = [
    "https://x.com/uga",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    "https://www.youtube.com/user/stanford",
    "https://www.youtube.com/@mit/videos",
    "https://www.youtube.com/harvard",
    "https://www.facebook.com/profile.php?id=123",
    "https://www.facebook.com/pages/Some-College/123456",
    "https://ca.linkedin.com/company/some-college",
  ];
  const no = [
    "https://x.com/intent/tweet",
    "https://twitter.com/uga/status/1",
    "https://www.instagram.com/p/abc/",
    "https://www.youtube.com/watch?v=1",
    "https://youtu.be/abc",
    "https://www.facebook.com/profile.php",
    "https://www.facebook.com/events/1",
    "https://www.linkedin.com/in/someone",
    "https://www.tiktok.com/@uga/video/1",
    "https://www.example.edu/instagram",
  ];
  for (const u of yes) assert.ok(socialProfile(u), u);
  for (const u of no) assert.equal(socialProfile(u), null, u);
});

/* ------------------------------------------------------------------ */
/* The visit scorer                                                    */
/* ------------------------------------------------------------------ */

const ON_SITE = new Set(["example.edu"]);

test("the scorer picks 'Visit campus' over a higher-scoring 'Virtual tour', which is kept only when it is the only match", () => {
  const virtual = anchor("https://www.example.edu/virtual-tour", "Virtual Campus Tour Visit", { nav: true });
  const visit = anchor("https://www.example.edu/plan", "Visit campus");
  assert.ok(visitScore(virtual, ON_SITE) > visitScore(visit, ON_SITE), "the virtual tour scores higher");
  const both = pickVisit([virtual, visit], "https://www.example.edu/admissions", ON_SITE);
  assert.equal(both.visit?.url, "https://www.example.edu/plan");
  assert.equal(both.visit?.text, "Visit campus");
  assert.equal(both.virtual_tour, null);
  const only = pickVisit([virtual], "https://www.example.edu/admissions", ON_SITE);
  assert.equal(only.visit, null);
  assert.equal(only.virtual_tour?.url, "https://www.example.edu/virtual-tour");
});

test("the scorer rejects PDFs, social sites (even when the college's site is one), other domains, and front pages", () => {
  const page = "https://www.example.edu/admissions";
  assert.equal(pickVisit([anchor("https://www.example.edu/files/visit-campus-guide.pdf", "Visit campus guide", { nav: true })], page, ON_SITE).visit, null);
  assert.equal(pickVisit([anchor("https://othercollege.edu/visit/", "Visit campus", { nav: true })], page, ON_SITE).visit, null);
  assert.equal(pickVisit([anchor("https://www.example.edu/", "Visit our main site", { nav: true })], page, ON_SITE).visit, null);
  assert.equal(pickVisit([anchor("https://visit.example.edu/", "Plan your visit")], page, ON_SITE).visit?.url, "https://visit.example.edu/", "a host for visits may be a front page");
  // A tiny college whose "website" is its Facebook page: Facebook is its domain, but a post is never its visit page.
  const fb = siteDomains(["https://www.facebook.com/tinycollege"]);
  assert.equal(pickVisit([anchor("https://www.facebook.com/tinycollege/visit", "Visit campus", { nav: true })], "https://www.facebook.com/tinycollege", fb).visit, null);
});

test("scores follow links.md step 3, and a score under 3 is not a visit page", () => {
  assert.equal(visitScore(anchor("https://www.example.edu/x", "Visit"), ON_SITE), 3);
  assert.equal(visitScore(anchor("https://www.example.edu/tours", "Tours"), ON_SITE), 2);
  assert.equal(visitScore(anchor("https://www.example.edu/tours", "Tours", { nav: true }), ON_SITE), 3);
  assert.equal(visitScore(anchor("https://www.example.edu/open-house", "Open House"), ON_SITE), 1);
  assert.equal(visitScore(anchor("https://www.example.edu/visit/admitted-students", "Admitted Students", { header: true }), ON_SITE), 5);
  assert.equal(visitScore(anchor("https://www.example.edu/tournament", "Tournament results"), ON_SITE), 0, "tour is a word, not a prefix");
  assert.equal(pickVisit([anchor("https://www.example.edu/tours", "Tours")], "https://www.example.edu/a", ON_SITE).visit, null);
});

test("visitor information, a Board of Visitors, and visiting students are not visit pages", () => {
  const page = "https://www.example.edu/admissions";
  for (const a of [
    anchor("https://www.example.edu/visitors/", "Visitors", { nav: true }),
    anchor("https://www.example.edu/about/board-of-visitors", "Board of Visitors", { nav: true }),
    anchor("https://www.example.edu/registrar/visiting-students", "Visiting Students", { nav: true }),
    anchor("https://www.example.edu/about/visitors-campus/offices", "Contact us", { nav: true }),
  ])
    assert.equal(pickVisit([a], page, ON_SITE).visit, null, a.text);
  assert.equal(pickVisit([anchor("https://www.example.edu/about/visiting-bennett/", "Visiting Bennett")], page, ON_SITE).visit?.text, "Visiting Bennett");
});

test("other kinds of visit, 'visit' as a verb, graduate-only pages, and map pages are not the visit page", () => {
  const page = "https://www.example.edu/admissions";
  const none = [
    anchor("https://www.example.edu/admissions/visiting-undergraduate-students", "Visiting Undergraduate Students", { nav: true }),
    anchor("https://www.example.edu/registrar/visiting-medical-students", "Visiting Medical Students", { nav: true }),
    anchor("https://www.example.edu/about/newsroom/", "Visit the Newsroom", { nav: true }),
    anchor("https://www.example.edu/library/", "Visit the Library Page", { nav: true }),
    anchor("https://www.example.edu/research/core/", "Visit Site", { nav: true }),
    anchor("https://www.example.edu/education/patient-home-visits.html", "Patient Home Visits", { nav: true }),
    anchor("https://www.example.edu/upcoming-accreditation-review-visit/", "Upcoming Accreditation Review Visit", { nav: true }),
    anchor("https://grad.example.edu/admissions/visiting-campus", "Graduate Tours", { nav: true }),
    anchor("https://www.example.edu/graduate/visit/", "Visit", { nav: true }),
    anchor("https://www.example.edu/campus-map", "Visit Campus", { nav: true }),
  ];
  for (const a of none) assert.equal(pickVisit([a], page, ON_SITE).visit, null, a.text);
  const fine = [
    anchor("https://www.example.edu/admissions/undergraduate-and-graduate-visits/", "Undergraduate & Graduate Visits"),
    anchor("https://www.example.edu/visit/map", "Map", { nav: true }),
    anchor("https://www.example.edu/undergraduate/visit", "Visit"),
  ];
  for (const a of fine) assert.equal(pickVisit([a], page, ON_SITE).visit?.url, a.url, a.text);
});

test("a found link's tracking parameters and fragment are dropped", () => {
  const find = pickVisit([anchor("https://www.example.edu/visit?utm_source=web&utm_medium=menu&tab=tours#top", "Visit", { nav: true })], "https://www.example.edu/admissions", ON_SITE);
  assert.equal(find.visit?.url, "https://www.example.edu/visit?tab=tours");
});

test("the admissions fixture: the visit section's own page beats its subpages and the virtual tour", () => {
  const page = parsePage(ADMISSIONS, "https://admissions.example.edu/en/");
  const domains = siteDomains(["https://www.example.edu/", "https://admissions.example.edu/en/"]);
  const find = pickVisit(page.anchors, "https://admissions.example.edu/en/", domains);
  assert.deepEqual(find.visit, { url: "https://admissions.example.edu/en/visit/", found_on: "https://admissions.example.edu/en/", text: "Visit Campus", score: 4 });
  assert.equal(find.virtual_tour, null);
  const daily = page.anchors.find((a) => a.text === "Daily Campus Tours")!;
  assert.equal(visitScore(daily, domains), 6, "the subpage scores higher than its section page");
});

test("a tie goes to a link on the page's own host", () => {
  const domains = new Set(["pitt.edu"]);
  const find = pickVisit(
    [anchor("https://www.greensburg.pitt.edu/visit", "Greensburg visits", { nav: true }), anchor("https://admissions.pitt.edu/visit/", "Pittsburgh visits", { nav: true })],
    "https://admissions.pitt.edu/",
    domains,
  );
  assert.equal(find.visit?.url, "https://admissions.pitt.edu/visit/");
});

/* ------------------------------------------------------------------ */
/* The liveness rule and data/link-issues.json                         */
/* ------------------------------------------------------------------ */

test("liveness: 404, 410, and a missing host fail; 2xx answers; refusals, server errors, timeouts, and robots never count", () => {
  const c = (status: number | null, error?: string): LinkCheck => ({ url: "https://x.edu/a", status, final_url: null, ...(error ? { error } : {}) });
  assert.equal(liveness(c(200)), "ok");
  assert.equal(liveness(c(204)), "ok");
  for (const s of [404, 410]) assert.equal(liveness(c(s)), "failed", String(s));
  assert.equal(liveness(c(null, "dns")), "failed");
  for (const s of [401, 403, 405, 429, 400, 500, 503]) assert.equal(liveness(c(s)), "unknown", String(s));
  for (const e of ["timeout", "tls", "refused", "reset", "robots", "robots-error", "crawl-delay", "network", "size"]) assert.equal(liveness(c(null, e)), "unknown", e);
  assert.equal(liveness(c(200, "challenge")), "unknown", "a bot-protection page answers 200 for any URL");
});

const entry = (unit_id: string, checked: Record<string, LinkCheck>, o: Partial<SiteProbeEntry> = {}): SiteProbeEntry => ({
  unit_id,
  retrieved: TODAY,
  homepage: null,
  admissions: null,
  visit: null,
  virtual_tour: null,
  social: {},
  icons: [],
  checked,
  ...o,
});
const check = (url: string, status: number | null, error?: string): LinkCheck => ({ url, status, final_url: null, ...(error ? { error } : {}) });

/** Runs the issue rule over a sequence of (day, result) runs for one link, and returns the issues after each. */
function runs(url: string, results: [string, LinkCheck][]): LinkIssue[][] {
  let issues: LinkIssue[] = [];
  return results.map(([day, c]) => (issues = nextLinkIssues(issues, [entry("1", { apply: c })], day)));
}

test("a link is null only after two failed runs for the same URL, and the old value stays in the issues file", () => {
  const url = "https://www.example.edu/apply";
  const [first, second] = runs(url, [
    ["2026-10-04", check(url, 404)],
    ["2026-11-04", check(url, 410)],
  ]);
  assert.equal(first[0].failures, 1);
  assert.deepEqual(second, [{ unit_id: "1", field: "apply", url, failures: 2, last_status: 410, first_failed: "2026-10-04", last_failed: "2026-11-04" }]);
  const school = { ...structuredClone(UGA), unit_id: "1", links: { ...UGA.links!, apply: url } } as School;
  applyProbeLinks(school, undefined, first);
  assert.equal(school.links?.apply, url, "one failure keeps the link");
  applyProbeLinks(school, undefined, second);
  assert.equal(school.links?.apply, null, "two make it null");
  const moved = { ...structuredClone(UGA), links: { ...UGA.links!, apply: "https://www.example.edu/apply-now" } } as School;
  applyProbeLinks(moved, undefined, second.map((i) => ({ ...i, unit_id: UGA.unit_id })));
  assert.equal(moved.links?.apply, "https://www.example.edu/apply-now", "an issue for another URL nulls nothing");
});

test("403, 429, timeouts, and robots refusals never count: the streak neither grows nor resets", () => {
  const url = "https://www.example.edu/aid";
  const after = runs(url, [
    ["2026-10-01", check(url, 404)],
    ["2026-10-02", check(url, 403)],
    ["2026-10-03", check(url, 429)],
    ["2026-10-04", check(url, null, "timeout")],
    ["2026-10-05", check(url, null, "robots")],
  ]);
  for (const issues of after) assert.equal(issues[0]?.failures, 1);
  const school = { ...structuredClone(UGA), unit_id: "1", links: { ...UGA.links!, apply: url } } as School;
  applyProbeLinks(school, undefined, after.at(-1)!);
  assert.equal(school.links?.apply, url);
  const blockedFromTheStart = runs(url, [
    ["2026-10-01", check(url, 403)],
    ["2026-10-02", check(url, 429)],
    ["2026-10-03", check(url, null, "timeout")],
  ]);
  assert.deepEqual(blockedFromTheStart.at(-1), [], "a link that only ever refuses us never gets an issue");
});

test("an answer resets the count; a new URL starts again at one; a missing host counts; one failure a day at most", () => {
  const url = "https://www.example.edu/vets";
  const reset = runs(url, [
    ["2026-10-01", check(url, 404)],
    ["2026-10-02", check(url, 200)],
    ["2026-10-03", check(url, 404)],
  ]);
  assert.deepEqual(reset[1], []);
  assert.equal(reset[2][0].failures, 1);
  const moved = runs(url, [
    ["2026-10-01", check(url, 404)],
    ["2026-10-02", check(`${url}-new`, 404)],
  ]);
  assert.deepEqual([moved[1][0].url, moved[1][0].failures], [`${url}-new`, 1]);
  const dns = runs("https://gone.example.edu/", [
    ["2026-10-01", check("https://gone.example.edu/", null, "dns")],
    ["2026-10-02", check("https://gone.example.edu/", null, "dns")],
  ]);
  assert.deepEqual([dns[1][0].failures, dns[1][0].last_error], [2, "dns"]);
  const sameDay = runs(url, [
    ["2026-10-04", check(url, 404)],
    ["2026-10-04", check(url, 404)],
  ]);
  assert.equal(sameDay[1][0].failures, 1, "a second run the same day can't make it two");
});

test("issues of colleges not probed this run are kept; a field no longer checked drops its issue", () => {
  const kept: LinkIssue = { unit_id: "2", field: "apply", url: "https://b.edu/x", failures: 1, last_status: 404, first_failed: "2026-09-01", last_failed: "2026-09-01" };
  const gone: LinkIssue = { ...kept, unit_id: "1", field: "veterans" };
  const next = nextLinkIssues([gone, kept], [entry("1", { apply: check("https://a.edu/apply", 200) })], TODAY);
  assert.deepEqual(next, [kept]);
  assert.equal(FAILURES_TO_NULL, 2);
});

/* ------------------------------------------------------------------ */
/* applyProbeLinks                                                     */
/* ------------------------------------------------------------------ */

const visitEntry = entry(
  UGA.unit_id,
  {},
  {
    visit: { url: "https://visit.uga.edu/tours/", found_on: "https://admissions.uga.edu/", text: "Schedule a Campus Visit", score: 6 },
    virtual_tour: null,
  },
);

test("applyProbeLinks sets the visit page with a college-site lineage record that passes the lineage check", () => {
  const school = structuredClone(UGA);
  applyProbeLinks(school, visitEntry, []);
  assert.equal(school.links?.visit, "https://visit.uga.edu/tours/");
  assert.equal(school.links?.virtual_tour, null);
  assert.deepEqual(school.lineage?.["links.visit"], {
    source: "college-site",
    method: "extracted",
    url: "https://admissions.uga.edu/",
    retrieved: TODAY,
    year: "2026",
    quote: "Schedule a Campus Visit",
  });
  assert.equal(school.lineage?.["links.virtual_tour"], undefined, "null has no lineage");
  assert.deepEqual(validateSchool(school, meta), []);
});

test("applyProbeLinks is idempotent, replaces the previous run's values, and removes them without an entry", () => {
  const once = structuredClone(UGA);
  applyProbeLinks(once, visitEntry, []);
  const twice = structuredClone(once);
  applyProbeLinks(twice, visitEntry, []);
  assert.deepEqual(twice, once);
  assert.equal(JSON.stringify(twice), JSON.stringify(once), "same key order, same bytes");
  const virtualOnly = entry(UGA.unit_id, {}, { virtual_tour: { url: "https://www.uga.edu/virtual-tour", found_on: "https://admissions.uga.edu/", text: "", score: 1 } });
  applyProbeLinks(twice, virtualOnly, []);
  assert.equal(twice.links?.visit, null);
  assert.equal(twice.lineage?.["links.visit"], undefined);
  assert.equal(twice.lineage?.["links.virtual_tour"]?.quote, "https://www.uga.edu/virtual-tour", "a link without text is quoted by its URL");
  assert.deepEqual(validateSchool(twice, meta), []);
  applyProbeLinks(twice, undefined, []);
  assert.equal(JSON.stringify(twice), JSON.stringify(UGA), "without an entry the school is as before (no empty lineage left)");
});

test("a dead visit link is nulled with its lineage, and the nulling is idempotent", () => {
  const dead: LinkIssue = { unit_id: UGA.unit_id, field: "visit", url: "https://visit.uga.edu/tours/", failures: 2, last_status: 404, first_failed: "2026-09-04", last_failed: TODAY };
  const school = structuredClone(UGA);
  applyProbeLinks(school, visitEntry, [dead]);
  assert.equal(school.links?.visit, null);
  assert.equal(school.lineage?.["links.visit"], undefined);
  const again = structuredClone(school);
  applyProbeLinks(again, visitEntry, [dead]);
  assert.deepEqual(again, school);
});

/* ------------------------------------------------------------------ */
/* HTTP: HEAD, skip reasons, error codes, the liveness check           */
/* ------------------------------------------------------------------ */

test("errorCode reads Node's fetch causes, messages, and our own limits; probeError maps them", () => {
  assert.equal(errorCode(new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ECONNREFUSED" }) })), "ECONNREFUSED");
  assert.equal(errorCode(new TypeError("fetch failed: getaddrinfo ENOTFOUND nope.edu")), "ENOTFOUND");
  assert.equal(errorCode(new HttpLimitError("timeout", "https://x.edu", "slow")), "timeout");
  assert.deepEqual(["ENOTFOUND", "timeout", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN"].map(probeError), [
    "dns",
    "timeout",
    "timeout",
    "tls",
    "tls",
    "refused",
    "reset",
    "network",
  ]);
});

test("PoliteHttp.head honors robots.txt and paces like get; skipReason says why a URL is skipped", async () => {
  const f = fakeFetch({
    "https://a.edu/robots.txt": "User-agent: *\nDisallow: /private\nCrawl-delay: 2",
    "https://a.edu/page": "<p>ok</p>",
    "https://a.edu/headless": (init) => new Response(init?.method === "HEAD" ? null : "<p>ok</p>", { status: init?.method === "HEAD" ? 405 : 200 }),
  });
  const waits: number[] = [];
  const http = new PoliteHttp({ fetch: f.fn, now: () => 0, sleep: async (ms) => void waits.push(ms), minDelayMs: 1000, log: () => {} });
  assert.equal((await http.head("https://a.edu/page"))?.status, 200);
  assert.equal(await http.head("https://a.edu/private/x"), null);
  await http.get("https://a.edu/page");
  assert.deepEqual(
    f.pages().map((c) => c.method),
    ["HEAD", "GET"],
  );
  assert.ok(waits.includes(2000), "the GET after the HEAD waited the crawl delay");
  assert.equal(await http.crawlDelayMs("https://a.edu/x"), 2000);
  assert.deepEqual(await http.skipReason("https://a.edu/private/x"), { reason: "robots" });
  assert.equal(await http.skipReason("https://a.edu/page"), null);
  assert.deepEqual(await http.skipReason("https://nowhere.edu/x"), { reason: "no-response", cause: "ENOTFOUND" });
  assert.equal((await http.head("https://a.edu/headless"))?.status, 405);
  assert.deepEqual(http.blockedSeen(), [], "a 405 to HEAD alone is not a refusal");
  await http.get("https://a.edu/headless");
  assert.deepEqual(http.blockedSeen(), [], "and the GET that follows answered");
});

test("checkLink: HEAD first; GET on 405, a refusal, or a 404 to HEAD; DNS and robots are reported, not fetched", async () => {
  const f = fakeFetch({
    "https://a.edu/robots.txt": "User-agent: *\nDisallow: /blocked",
    "https://a.edu/ok": "<p>ok</p>",
    "https://a.edu/nohead": (init) => new Response(init?.method === "HEAD" ? null : "<p>ok</p>", { status: init?.method === "HEAD" ? 405 : 200 }),
    "https://a.edu/headlies": (init) => new Response(null, { status: init?.method === "HEAD" ? 404 : 200 }),
    "https://a.edu/gone": 410,
    "https://a.edu/forbidden": 403,
  });
  const http = politeHttp(f.fn);
  assert.deepEqual(await checkLink(http, "https://a.edu/ok"), { url: "https://a.edu/ok", status: 200, final_url: null });
  assert.deepEqual(await checkLink(http, "https://a.edu/nohead"), { url: "https://a.edu/nohead", status: 200, final_url: null });
  assert.equal((await checkLink(http, "https://a.edu/headlies")).status, 200);
  assert.equal((await checkLink(http, "https://a.edu/gone")).status, 410);
  assert.equal((await checkLink(http, "https://a.edu/missing")).status, 404);
  assert.equal((await checkLink(http, "https://a.edu/forbidden")).status, 403);
  assert.deepEqual(await checkLink(http, "https://a.edu/blocked/x"), { url: "https://a.edu/blocked/x", status: null, final_url: null, error: "robots" });
  assert.deepEqual(await checkLink(http, "https://gone-host.edu/x"), { url: "https://gone-host.edu/x", status: null, final_url: null, error: "dns" });
  const methods = (u: string) => f.calls.filter((c) => c.url === u).map((c) => c.method);
  assert.deepEqual(methods("https://a.edu/ok"), ["HEAD"]);
  assert.deepEqual(methods("https://a.edu/nohead"), ["HEAD", "GET"]);
  assert.deepEqual(methods("https://a.edu/blocked/x"), [], "robots.txt refused it: never requested");
});

test("a missing host is confirmed before it counts: a passing resolver failure is 'network', a confirmed one 'dns' with no request", async () => {
  // The fake fetch can't resolve flaky.edu (ENOTFOUND), but the resolver found it a moment ago: a passing failure.
  const f = fakeFetch({ "https://ok.edu/": "<p>ok</p>" });
  const flaky: HostLookup = async (host) => (host === "gone.edu" ? "no" : "yes");
  assert.deepEqual(await checkLink(politeHttp(f.fn), "https://flaky.edu/apply", flaky), { url: "https://flaky.edu/apply", status: null, final_url: null, error: "network" });
  assert.equal((await fetchPage(politeHttp(f.fn), "https://flaky.edu/", flaky)).page.error, "network");
  const before = f.calls.length;
  assert.deepEqual(await checkLink(politeHttp(f.fn), "https://gone.edu/apply", flaky), { url: "https://gone.edu/apply", status: null, final_url: null, error: "dns" });
  assert.equal(f.calls.length, before, "a host the resolver says is missing isn't requested, not even robots.txt");
  assert.equal((await checkLink(politeHttp(f.fn), "https://flaky.edu/apply")).error, "dns", "without a resolver, the request's own failure stands");
});

test("systemHostLookup: 'no' only after every try says the name doesn't exist; one answer per host per run", async () => {
  const asked: string[] = [];
  const answers: Record<string, string[]> = { "flaky.edu": ["ENOTFOUND", "ENOTFOUND", "ok"], "gone.edu": ["ENOTFOUND", "ENOTFOUND", "ENOTFOUND"], "slow.edu": ["EAI_AGAIN", "ENOTFOUND", "ENOTFOUND"] };
  const resolve = async (host: string) => {
    asked.push(host);
    const code = answers[host].shift();
    if (code !== "ok") throw Object.assign(new Error(code), { code });
  };
  const waits: number[] = [];
  const hosts = systemHostLookup(resolve, async (ms) => void waits.push(ms));
  assert.equal(await hosts("flaky.edu"), "yes");
  assert.equal(await hosts("gone.edu"), "no");
  assert.equal(await hosts("slow.edu"), "unknown");
  assert.equal(await hosts("gone.edu"), "no");
  assert.equal(asked.filter((h) => h === "gone.edu").length, 3, "asked three times, then remembered");
  assert.deepEqual(waits.slice(0, 2), [1000, 3000]);
});

test("a host asking for more than 30 s between requests is skipped, never requested faster; a shorter delay is honored", async () => {
  const f = fakeFetch({
    "https://slow.edu/robots.txt": "User-agent: *\nCrawl-delay: 600",
    "https://slow.edu/": HOMEPAGE,
    "https://patient.edu/robots.txt": "User-agent: *\nCrawl-delay: 20",
    "https://patient.edu/": HOMEPAGE,
  });
  const waits: number[] = [];
  let clock = 0;
  const http = new PoliteHttp({ fetch: f.fn, now: () => clock, sleep: async (ms) => void (waits.push(ms), (clock += ms)), minDelayMs: 1000, log: () => {} });
  const page = await fetchPage(http, "https://slow.edu/");
  assert.deepEqual(page.page, { url: "https://slow.edu/", final_url: null, status: null, error: "crawl-delay" });
  assert.deepEqual(await checkLink(http, "https://slow.edu/apply"), { url: "https://slow.edu/apply", status: null, final_url: null, error: "crawl-delay" });
  assert.deepEqual(f.pages().filter((c) => c.url.startsWith("https://slow.edu")), [], "only robots.txt was read");
  assert.equal(liveness({ status: null, error: "crawl-delay" }), "unknown");
  assert.equal((await fetchPage(http, "https://patient.edu/")).page.status, 200);
  assert.equal((await checkLink(http, "https://patient.edu/apply")).status, 404);
  assert.ok(waits.includes(20_000), "the 20 s delay was waited, not skipped");
});

test("checkLink records where a redirect ended; a timeout is reported as one", async () => {
  const redirected = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    if (url.startsWith("https://slow.edu/"))
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, "url", { value: "https://www.a.edu/final" });
    return res;
  }) as typeof globalThis.fetch;
  const http = politeHttp(redirected, { timeoutMs: 20 });
  assert.deepEqual(await checkLink(http, "https://a.edu/old"), { url: "https://a.edu/old", status: 200, final_url: "https://www.a.edu/final" });
  assert.deepEqual(await checkLink(http, "https://slow.edu/x"), { url: "https://slow.edu/x", status: null, final_url: null, error: "timeout" });
});

/* ------------------------------------------------------------------ */
/* The Haiku picker (a fake client)                                    */
/* ------------------------------------------------------------------ */

function fakeClient(answer: (body: Anthropic.MessageCreateParamsNonStreaming) => string | Error) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = {
    messages: {
      create: async (body) => {
        calls.push(body);
        const a = answer(body);
        if (a instanceof Error) throw a;
        return {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: a, citations: null }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1200, output_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        } as unknown as Anthropic.Message;
      },
      stream: () => {
        throw new Error("the picker doesn't stream");
      },
    },
  };
  return { client, calls };
}

const PICKER_LINKS = [
  { text: "Apply", url: "https://www.example.edu/apply" },
  { text: "Come see us", url: "https://www.example.edu/see-us" },
  { text: "Apply", url: "https://www.example.edu/apply" },
];

test("the picker's request: Haiku, the numbered links once each, a JSON schema, a small max_tokens", () => {
  const built = buildVisitPickerRequest({ college: { unit_id: "1", name: "Example State" }, links: PICKER_LINKS });
  assert.equal(built.params.model, "claude-haiku-4-5");
  assert.equal(built.links.length, 2, "duplicates are sent once");
  const user = built.params.messages[0].content as string;
  assert.match(user, /1 \| Apply \| https:\/\/www\.example\.edu\/apply\n2 \| Come see us \| https:\/\/www\.example\.edu\/see-us$/);
  assert.equal(built.params.max_tokens, 64);
  assert.equal((built.params.output_config as { format?: { type?: string } }).format?.type, "json_schema");
});

test("the picker's answer maps back to a listed link; 0, an unlisted number, bad JSON, or a refusal is none", () => {
  const links = PICKER_LINKS.slice(0, 2);
  const msg = (text: string, stop: Anthropic.Message["stop_reason"] = "end_turn") => ({ content: [{ type: "text", text }], stop_reason: stop }) as unknown as Anthropic.Message;
  assert.deepEqual(parseVisitPickerResponse(msg('{"visit": 2}'), links), links[1]);
  assert.equal(parseVisitPickerResponse(msg('{"visit": 0}'), links), null);
  assert.equal(parseVisitPickerResponse(msg('{"visit": 3}'), links), null);
  assert.equal(parseVisitPickerResponse(msg("two"), links), null);
  assert.equal(parseVisitPickerResponse(msg('{"visit": 2}', "refusal"), links), null);
});

test("the picker stops at its cost cap without calling, counts its spend, and survives an error", async () => {
  const { client, calls } = fakeClient(() => '{"visit": 2}');
  const picker = new VisitPicker(client, { capUsd: 1 });
  const input = { college: { unit_id: "1", name: "Example State" }, links: PICKER_LINKS };
  assert.deepEqual(await picker.pick(input), PICKER_LINKS[1]);
  assert.equal(calls.length, 1);
  assert.ok(Math.abs(picker.spent - (1200 * 1 + 8 * 5) / 1e6) < 1e-12, "Haiku 4.5 at $1/$5 per million");
  const capped = new VisitPicker(fakeClient(() => '{"visit": 2}').client, { capUsd: 0.0001 });
  assert.equal(await capped.pick(input), null);
  assert.deepEqual([capped.calls, capped.skipped], [0, 1], "a call that might pass the cap is never made");
  const broken = new VisitPicker(fakeClient(() => new Error("overloaded")).client, { capUsd: 1 });
  assert.equal(await broken.pick(input), null);
  assert.deepEqual([broken.errors, broken.spent], [1, 0]);
});

/* ------------------------------------------------------------------ */
/* One college, end to end                                             */
/* ------------------------------------------------------------------ */

const COLLEGE_ROUTES: Record<string, Route> = {
  "https://www.example.edu/": HOMEPAGE,
  "https://admissions.example.edu/en/": ADMISSIONS,
  "https://admissions.example.edu/en/visit/": "<p>Visit</p>",
  "https://apply.example.edu/": "<p>apply</p>",
  "https://npc.shared-calculators.com/example": "<p>npc</p>",
  "https://npc.shared-calculators.com/other": "<p>npc</p>",
};
const target = {
  unit_id: "900001",
  name: "Example State University",
  links: {
    website: "https://www.example.edu/",
    admissions: "https://admissions.example.edu/en/",
    apply: "https://apply.example.edu/",
    financial_aid: "https://www.example.edu/aid-moved",
    price_calculator: "https://npc.shared-calculators.com/example",
    veterans: "https://old-vets.example.edu/",
  },
};

test("probeCollege: the visit page, footer social links, icons, and every link's liveness, each page requested once", async () => {
  const f = fakeFetch(COLLEGE_ROUTES);
  const ctx = probeContext(politeHttp(f.fn), TODAY);
  const e = await probeCollege(ctx, target);
  assert.equal(e.retrieved, TODAY);
  assert.deepEqual(e.homepage, { url: "https://www.example.edu/", final_url: "https://www.example.edu/", status: 200 });
  assert.equal(e.visit?.url, "https://admissions.example.edu/en/visit/");
  assert.equal(e.visit?.found_on, "https://admissions.example.edu/en/");
  assert.equal(e.social.instagram, "https://www.instagram.com/examplestate/");
  assert.equal(e.icons[0].url, "https://cdn.example.edu/brand/touch-180.png");
  assert.deepEqual(
    Object.fromEntries(Object.entries(e.checked!).map(([k, c]) => [k, c.status ?? c.error])),
    { website: 200, admissions: 200, apply: 200, financial_aid: 404, price_calculator: 200, veterans: "dns", visit: 200 },
  );
  const homepageRequests = f.calls.filter((c) => c.url === "https://www.example.edu/");
  assert.deepEqual(homepageRequests.map((c) => c.method), ["GET"], "the website's liveness is read from the homepage fetch");
  // A second college sharing the price calculator host and the homepage reuses both answers.
  const before = f.calls.length;
  await probeCollege(ctx, { ...target, unit_id: "900002", links: { website: "https://www.example.edu/", price_calculator: "https://npc.shared-calculators.com/example" } });
  assert.deepEqual(f.calls.slice(before), [], "nothing is requested twice in a run");
});

test("a visit page found today that already answers 404 isn't kept: the next best link is tried", async () => {
  const routes = { ...COLLEGE_ROUTES, "https://admissions.example.edu/en/visit/": 404, "https://admissions.example.edu/en/visit/daily-tours/": "<p>Tours</p>" };
  const e = await probeCollege(probeContext(politeHttp(fakeFetch(routes).fn), TODAY), target);
  assert.equal(e.visit?.url, "https://admissions.example.edu/en/visit/daily-tours/", "with the section page dead, its best subpage is next");
  assert.equal(e.checked?.visit?.status, 200);
  const allDead = {
    ...routes,
    "https://admissions.example.edu/en/visit/daily-tours/": 404,
    "https://admissions.example.edu/en/visit/admitted/": 410,
    "https://admissions.example.edu/en/visit/virtual-tour/": "<p>Tour</p>",
  };
  const none = await probeCollege(probeContext(politeHttp(fakeFetch(allDead).fn), TODAY), target);
  assert.equal(none.visit, null, "every in-person visit page is dead");
  assert.equal(none.virtual_tour?.url, "https://admissions.example.edu/en/visit/virtual-tour/", "so the virtual tour, which answers, is the only match");
});

test("probeCollege falls back to the homepage's links when the admissions page refuses us, and asks the picker only on a miss", async () => {
  const routes = {
    ...COLLEGE_ROUTES,
    "https://admissions.example.edu/en/": 403,
    "https://www.example.edu/": `<nav><a href="/campus-life/">Campus life</a><a href="/see-us/">Come see us</a></nav>`,
    "https://www.example.edu/see-us/": "<p>Come see us</p>",
  };
  const { client, calls } = fakeClient((body) => {
    const user = body.messages[0].content as string;
    const n = user.split("\n").find((l) => l.includes("/see-us/"))!.split(" | ")[0];
    return JSON.stringify({ visit: Number(n) });
  });
  const picker = new VisitPicker(client, { capUsd: 1 });
  const e = await probeCollege(probeContext(politeHttp(fakeFetch(routes).fn), TODAY, picker), target);
  assert.deepEqual(e.admissions, { url: "https://admissions.example.edu/en/", final_url: "https://admissions.example.edu/en/", status: 403 });
  assert.deepEqual(e.visit, { url: "https://www.example.edu/see-us/", found_on: "https://www.example.edu/", text: "Come see us", score: 1, by: "picker" });
  assert.equal(calls.length, 1);
  const found = await probeCollege(probeContext(politeHttp(fakeFetch(COLLEGE_ROUTES).fn), TODAY, picker), target);
  assert.equal(found.visit?.by, undefined);
  assert.equal(calls.length, 1, "the scorer found it, so the picker wasn't asked");
});

/* ------------------------------------------------------------------ */
/* The committed files                                                 */
/* ------------------------------------------------------------------ */

test("the committed data/site-probe.json and data/link-issues.json are well formed and apply with sound lineage", () => {
  const probePath = join(ROOT, "data", "site-probe.json");
  const text = readFileSync(probePath, "utf8");
  const probed: SiteProbeEntry[] = JSON.parse(text);
  assert.equal(text, formatRows(mergeProbeEntries([], probed)), "sorted by unit id, one entry per line");
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  const problems: string[] = [];
  const web = (u: unknown) => typeof u === "string" && /^https?:\/\/[^/\s]+/.test(u);
  for (const e of probed) {
    const at = `site-probe ${e.unit_id}`;
    if (!byId.has(e.unit_id)) problems.push(`${at}: not a college in data/schools.json`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.retrieved)) problems.push(`${at}: retrieved "${e.retrieved}"`);
    for (const [kind, f] of [["visit", e.visit], ["virtual_tour", e.virtual_tour]] as const) {
      if (!f) continue;
      if (!web(f.url) || !web(f.found_on)) problems.push(`${at}: ${kind} needs absolute url and found_on`);
      if (kind === "visit" && f.by !== "picker" && f.score < 3) problems.push(`${at}: visit scored ${f.score}, under 3`);
    }
    if (e.visit && e.virtual_tour) problems.push(`${at}: a virtual tour is kept only when there is no visit page`);
    for (const [network, url] of Object.entries(e.social)) if (socialProfile(url) !== network) problems.push(`${at}: social.${network} "${url}" isn't a ${network} profile`);
    for (const i of e.icons) if (!web(i.url) || !["apple-touch-icon", "icon", "fallback"].includes(i.rel)) problems.push(`${at}: icon ${i.rel} ${i.url}`);
    for (const [field, c] of Object.entries(e.checked ?? {})) if (!web(c.url) || (c.status === null && !c.error)) problems.push(`${at}: checked.${field}`);
    const school = byId.get(e.unit_id);
    if (school) {
      const applied = structuredClone(school);
      applyProbeLinks(applied, e, []);
      problems.push(...validateSchool(applied, meta).filter((p) => p.includes("links.")));
    }
  }
  const issues: LinkIssue[] = JSON.parse(readFileSync(join(ROOT, "data", "link-issues.json"), "utf8"));
  for (const i of issues) if (!byId.has(i.unit_id) || !web(i.url) || i.failures < 1) problems.push(`link-issues ${i.unit_id} ${i.field}`);
  assert.deepEqual(problems.slice(0, 20), []);
});

/* ------------------------------------------------------------------ */
/* A run: the files and merge-identity                                 */
/* ------------------------------------------------------------------ */

test("runSiteProbe writes both files one row per line, keeps other colleges' entries, and applies the visit page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "site-probe-"));
  mkdirSync(join(dir, "data"));
  const a = { ...structuredClone(UGA), links: { website: "https://www.example.edu/", price_calculator: "https://npc.shared-calculators.com/example", admissions: "https://admissions.example.edu/en/" } } as School;
  const b = { ...structuredClone(schools.find((s) => s.unit_id === "221999")!), links: { website: "https://gone.example.org/", price_calculator: null } } as School;
  writeFileSync(join(dir, "data", "schools.json"), formatRows([a, b]));
  writeFileSync(join(dir, "data", "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  const other = entry("100000", {});
  writeFileSync(join(dir, "data", "site-probe.json"), formatRows([other]));
  const http = politeHttp(fakeFetch(COLLEGE_ROUTES).fn);
  const summary = await runSiteProbe(dir, { http, hosts: fakeHosts(COLLEGE_ROUTES), hdRows: null, today: TODAY, log: () => {}, concurrency: 2 });
  const written: SiteProbeEntry[] = JSON.parse(readFileSync(join(dir, "data", "site-probe.json"), "utf8"));
  assert.deepEqual(
    written.map((e) => e.unit_id),
    [UGA.unit_id, "221999"],
    "sorted by unit id; an entry for a college not in the dataset is dropped",
  );
  assert.equal(readFileSync(join(dir, "data", "site-probe.json"), "utf8").split("\n").length, 5, "one entry per line");
  const issues: LinkIssue[] = JSON.parse(readFileSync(join(dir, "data", "link-issues.json"), "utf8"));
  assert.deepEqual(
    issues.map((i) => [i.unit_id, i.field, i.failures, i.last_error ?? i.last_status]),
    [["221999", "website", 1, "dns"]],
  );
  const merged: School[] = JSON.parse(readFileSync(join(dir, "data", "schools.json"), "utf8"));
  assert.equal(merged[0].links?.visit, "https://admissions.example.edu/en/visit/");
  assert.equal(merged[0].lineage?.["links.visit"]?.quote, "Visit Campus");
  assert.equal(merged[1].links?.visit, null);
  assert.deepEqual([summary.colleges, summary.visit, summary.homepages, summary.checks.failed.dns], [2, 1, 1, 1]);

  // A partial run (one college) keeps the other's entry, and a second failure the next day nulls the dead homepage.
  const next = await runSiteProbe(dir, { http: politeHttp(fakeFetch(COLLEGE_ROUTES).fn), hosts: fakeHosts(COLLEGE_ROUTES), hdRows: null, ids: ["221999"], today: "2026-11-04", log: () => {} });
  assert.equal(next.colleges, 1);
  const again: SiteProbeEntry[] = JSON.parse(readFileSync(join(dir, "data", "site-probe.json"), "utf8"));
  assert.deepEqual(again.map((e) => [e.unit_id, e.retrieved]), [
    [UGA.unit_id, TODAY],
    ["221999", "2026-11-04"],
  ]);
  const final: School[] = JSON.parse(readFileSync(join(dir, "data", "schools.json"), "utf8"));
  assert.equal(final[1].links?.website, null, "two failed runs: the link is null");
  assert.equal(final[0].links?.visit, "https://admissions.example.edu/en/visit/", "the other college keeps its visit page");
  assert.deepEqual(mergeProbeEntries(again, [], new Set([UGA.unit_id])).map((e) => e.unit_id), [UGA.unit_id]);
});
