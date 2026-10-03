/**
 * Round-3 discovery (specs/college-reported-round-3.md Decisions 6–8, tests 12–15 and 22): free probes, share links,
 * blocked hosts, the owner's list, tier order and budgets, back-off, superseded editions, and the HTTP limits. A fake
 * fetch over a URL table (hosts not in the table don't resolve); no network, no model. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlockedHostsFile, CdsUrlEntry, Recipe } from "../lib/reported.ts";
import type { School } from "../lib/types";
import { HttpLimitError, PoliteHttp, parseRobots } from "../scripts/lib/college-reported/http.mts";
import { blockedStatusOf, onlyBlockedCandidates, recordBlocked } from "../scripts/lib/college-reported/blocked.mts";
import {
  collegeDomain,
  confirmDocument,
  freeSteps,
  knownStep,
  parseSitemap,
  probeStep,
  resolveShareLink,
  rewriteShareLink,
} from "../scripts/lib/college-reported/probe.mts";
import {
  discoverAll,
  documentsToReadAfterRediscovery,
  ladder,
  nextAttempt,
  orderColleges,
  retireSuperseded,
  shouldRetry,
  stepsFor,
  type LadderDeps,
  type LadderState,
  type PaidFind,
} from "../scripts/lib/college-reported/discovery.mts";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

const PDF = new TextEncoder().encode("%PDF-1.7\n% a CDS\n");
const XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
const TODAY = "2026-10-03";

type Route = Uint8Array | string | ((init?: RequestInit) => Response | Promise<Response>);
/**
 * fetch over a URL table. A host with no route at all doesn't resolve (throws, like DNS), so robots.txt there is
 * "unreachable" and nothing on it is requested; robots.txt on a known host is 404 unless routed.
 */
function fakeFetch(routes: Record<string, Route>) {
  const hosts = new Set(Object.keys(routes).map((u) => new URL(u).host));
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (!hosts.has(new URL(url).host)) throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${new URL(url).host}`);
    const r = routes[url];
    if (r === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    if (typeof r === "function") return r(init);
    const isText = typeof r === "string";
    return new Response(r as BodyInit, { status: 200, headers: { "content-type": isText ? (r.trimStart().startsWith("<?xml") ? "application/xml" : "text/html") : "application/octet-stream" } });
  }) as typeof globalThis.fetch;
  return { fn, calls, pages: () => calls.filter((u) => !u.endsWith("/robots.txt")) };
}

const politeHttp = (fetch: typeof globalThis.fetch, o: { timeoutMs?: number; maxBytes?: number } = {}) =>
  new PoliteHttp({ fetch, now: () => 0, sleep: async () => {}, minDelayMs: 0, log: () => {}, ...o });

function school(id: string, o: { rate?: number | null; size?: number; website?: string; year?: number; cds?: string } = {}): School {
  return {
    unit_id: id,
    name: `College ${id}`,
    admissions: { year: o.year ?? 2024, acceptance_rate: o.rate === undefined ? 0.3 : o.rate },
    demographics: { undergrad_enrollment: o.size ?? 5000 },
    links: { website: o.website ?? `https://www.c${id}.edu/`, price_calculator: null },
    ...(o.cds ? { cds: { edition: "2024-25", url: o.cds } } : {}),
  } as unknown as School;
}

const html = (...links: [string, string][]) => `<html><body><nav>x</nav>${links.map(([href, text]) => `<a href="${href}">${text}</a>`).join("\n")}</body></html>`;
const sitemap = (...locs: string[]) => `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const sitemapIndex = (...locs: string[]) => `<?xml version="1.0"?><sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("")}</sitemapindex>`;

/** Paid steps that record each call; `none` answers find nothing. */
function paid(cost: Partial<Record<"pick" | "search" | "full", number>> = {}, answer: (step: string, id: string) => PaidFind | null = () => null) {
  const calls: string[] = [];
  const mk = (step: "pick" | "search" | "full") => async (c: { school: School }): Promise<PaidFind> => {
    calls.push(`${step}:${c.school.unit_id}`);
    return answer(step, c.school.unit_id) ?? { path: "none", sources: [], index_urls: [], cost_usd: cost[step] ?? 0 };
  };
  const deps: Pick<LadderDeps, "pickLinks" | "searchOnly" | "discover"> = { pickLinks: (c) => mk("pick")(c), searchOnly: mk("search"), discover: mk("full") };
  return { deps, calls };
}
const nothing: Pick<LadderDeps, "known" | "probe"> = {
  known: async () => ({ path: "none", sources: [], index_urls: [] }),
  probe: async () => ({ path: "none", sources: [], index_urls: [] }),
};
const state = (budget = 10, blocked: BlockedHostsFile = { hosts: [] }): LadderState => ({ today: TODAY, budget: { remaining_usd: budget }, blocked });

/* ------------------------------------------------------------------ */
/* 12. Free probes                                                     */
/* ------------------------------------------------------------------ */

test("12: a sitemap entry (robots.txt → sitemap index → CDS page) becomes a recipe with no model call", async () => {
  const site = "https://www.alpha.edu";
  const f = fakeFetch({
    [`${site}/robots.txt`]: `User-agent: *\nDisallow: /private\nSitemap: ${site}/sitemap_index.xml\n`,
    [`${site}/sitemap_index.xml`]: sitemapIndex(`${site}/post-sitemap.xml`, `${site}/page-sitemap.xml`),
    [`${site}/page-sitemap.xml`]: sitemap(`${site}/`, `${site}/about/`, `${site}/institutional-research/common-data-set/`, `${site}/admissions/class-profile/`),
    [`${site}/institutional-research/common-data-set/`]: html(
      ["/files/CDS_2024-2025.pdf", "Common Data Set 2024-2025"],
      ["/files/CDS_2025-2026.pdf", "Common Data Set 2025-2026"]
    ),
  });
  const { deps: models, calls } = paid();
  const http = politeHttp(f.fn);
  const r = await ladder({ school: school("100001", { website: `${site}/` }) }, state(), { ...freeSteps(http), ...models });
  assert.equal(r.found, true);
  assert.equal(r.path, "probe-sitemap");
  assert.deepEqual(calls, [], "no model step ran");
  assert.equal(r.spent_usd, 0);
  const cds = r.recipe.sources.filter((s) => s.kind === "cds");
  assert.deepEqual(cds.map((s) => s.url), [`${site}/files/CDS_2025-2026.pdf`]);
  assert.ok(r.recipe.sources.some((s) => s.kind === "class-profile" && s.url === `${site}/admissions/class-profile/`));
  assert.deepEqual(r.recipe.index_urls, [`${site}/institutional-research/common-data-set/`]);
  assert.equal(r.recipe.discovery?.path, "probe-sitemap");
  assert.equal(r.recipe.discovery?.next_attempt, undefined);
  assert.ok(r.recipe.discovery!.tried.every((t) => t.cost_usd === 0));
  assert.ok(r.recipe.discovery!.tried.some((t) => t.step === 1 && t.via === "probe-sitemap" && t.result === "found"));
  assert.ok(!f.calls.includes(`${site}/post-sitemap.xml`) || f.calls.indexOf(`${site}/page-sitemap.xml`) < f.calls.indexOf(`${site}/post-sitemap.xml`), "page sitemaps before posts");
});

test("12: a CDS file listed directly in a sitemap is taken without fetching any page", async () => {
  const site = "https://www.alpha2.edu";
  const f = fakeFetch({
    [`${site}/robots.txt`]: "User-agent: *\nAllow: /\n",
    [`${site}/sitemap.xml`]: sitemap(`${site}/wp-content/uploads/2026/07/Common-Data-Set-2025-2026.xlsx`, `${site}/news/`),
  });
  const found = await probeStep(politeHttp(f.fn), school("100002", { website: site }));
  assert.equal(found.path, "probe-sitemap");
  assert.deepEqual(found.sources.map((s) => [s.kind, s.format]), [["cds", "xlsx"]]);
  assert.deepEqual(f.pages(), [`${site}/sitemap.xml`]);
});

test("12: an IR host pattern (oir.<domain>/cds) becomes a recipe; hosts that don't resolve cost no page request", async () => {
  const f = fakeFetch({
    "https://www.beta.edu/": html(["/about", "About"]),
    "https://oir.beta.edu/cds": html(["https://oir.beta.edu/wp-content/uploads/2026/08/CDS_2025-26.pdf", "CDS 2025-26"], ["/cds-2024-25.pdf", "CDS 2024-25"]),
  });
  const { deps: models, calls } = paid();
  const r = await ladder({ school: school("100003", { website: "https://www.beta.edu/" }) }, state(), { ...freeSteps(politeHttp(f.fn)), ...models });
  assert.equal(r.path, "probe-host");
  assert.deepEqual(calls, []);
  assert.deepEqual(r.recipe.sources.map((s) => s.url), ["https://oir.beta.edu/wp-content/uploads/2026/08/CDS_2025-26.pdf"]);
  assert.deepEqual(r.recipe.index_urls, ["https://oir.beta.edu/cds"]);
  // ir.beta.edu doesn't resolve: only its robots.txt was attempted, none of its four paths.
  assert.ok(!f.calls.some((u) => u.startsWith("https://ir.beta.edu/c")));
  // oir.beta.edu: /common-data-set (404), then /cds (found).
  assert.deepEqual(f.pages().filter((u) => u.includes("oir.beta.edu")), ["https://oir.beta.edu/common-data-set", "https://oir.beta.edu/cds"]);
});

test("12: a two-hop crawl from the Scorecard website (facts → institutional research → CDS) becomes a recipe", async () => {
  const site = "https://www.gamma.edu";
  const f = fakeFetch({
    [`${site}/`]: html(["/athletics", "Athletics"], ["/about/facts", "Facts & Data"], ["https://twitter.com/gamma", "Twitter data"]),
    [`${site}/about/facts`]: html(["/give", "Give"], ["/provost/ir/", "Office of Institutional Research"]),
    [`${site}/provost/ir/`]: html(["/files/ir/CDS_2025-26.pdf", "Common Data Set 2025-26"], ["/files/ir/CDS_2023-24.pdf", "Common Data Set 2023-24"]),
  });
  const { deps: models, calls } = paid();
  const r = await ladder({ school: school("100004", { website: `${site}/` }) }, state(), { ...freeSteps(politeHttp(f.fn)), ...models });
  assert.equal(r.path, "probe-crawl");
  assert.deepEqual(calls, []);
  assert.deepEqual(r.recipe.sources.map((s) => s.url), [`${site}/files/ir/CDS_2025-26.pdf`]);
  assert.deepEqual(r.recipe.index_urls, [`${site}/provost/ir/`]);
  assert.ok(!f.calls.includes(`${site}/athletics`), "links that don't name IR, facts, or data aren't followed");
  assert.ok(!f.calls.some((u) => u.includes("twitter.com")), "never off the college's domain");
  assert.ok(f.pages().length <= 40);
});

test("12: the probe stops at its request budget", async () => {
  const site = "https://www.wide.edu";
  // Every page links to ten more "data" pages: an endless site.
  const routes: Record<string, Route> = {};
  const page = (n: number) => html(...Array.from({ length: 10 }, (_, i) => [`/data/${n * 10 + i + 1}`, `Data ${n * 10 + i + 1}`] as [string, string]));
  routes[`${site}/`] = page(0);
  for (let n = 1; n <= 200; n++) routes[`${site}/data/${n}`] = page(n);
  const f = fakeFetch(routes);
  const found = await probeStep(politeHttp(f.fn), school("100005", { website: site }), { limit: 15 });
  assert.equal(found.path, "none");
  assert.ok(found.requests! <= 15);
  assert.ok(f.pages().length <= 15);
  assert.ok(found.pages!.length > 0, "fetched pages are kept for the picker");
});

test("12: share links are rewritten by rule", () => {
  assert.deepEqual(rewriteShareLink("https://docs.google.com/spreadsheets/d/1INsGFH6MhaO-x/edit#gid=0"), {
    service: "google-sheets",
    url: "https://docs.google.com/spreadsheets/d/1INsGFH6MhaO-x/export?format=xlsx",
  });
  assert.deepEqual(rewriteShareLink("https://drive.google.com/file/d/1I8RahoDnYry/view?usp=sharing"), {
    service: "google-drive-file",
    url: "https://drive.google.com/uc?export=download&id=1I8RahoDnYry",
  });
  assert.equal((rewriteShareLink("https://drive.google.com/open?id=abc") as { url: string }).url, "https://drive.google.com/uc?export=download&id=abc");
  assert.ok("manual" in rewriteShareLink("https://drive.google.com/drive/folders/1TsZYMnJhOYuNfNYsaziNrbm9uJIqLS_u")!);
  assert.deepEqual(rewriteShareLink("https://georgetown.box.com/s/0r8akn4cbm52zjkll6i7uttlb9k36px2"), {
    service: "box",
    url: "https://georgetown.box.com/shared/static/0r8akn4cbm52zjkll6i7uttlb9k36px2",
  });
  assert.equal((rewriteShareLink("https://uofi.box.com/shared/static/orx4.xlsx") as { url: string }).url, "https://uofi.box.com/shared/static/orx4.xlsx");
  assert.equal(
    (rewriteShareLink("https://college.sharepoint.com/:x:/s/ir/EaBc?e=xyz") as { url: string }).url,
    "https://college.sharepoint.com/:x:/s/ir/EaBc?e=xyz&download=1"
  );
  assert.equal(rewriteShareLink("https://www.college.edu/cds.pdf"), null);
});

test("12: a rewritten share link is accepted only on %PDF or PK; an HTML answer goes to the owner", async () => {
  const f = fakeFetch({
    "https://georgetown.box.com/shared/static/abc": XLSX,
    "https://drive.google.com/uc?export=download&id=pdf1": PDF,
    "https://drive.google.com/uc?export=download&id=big1": "<html><title>Google Drive - Virus scan warning</title></html>",
  });
  const get = (u: string) => politeHttp(f.fn).get(u);
  const box = await resolveShareLink(get, "https://georgetown.box.com/s/abc");
  assert.equal(box.ok, true);
  assert.equal(box.ok && box.format, "xlsx");
  assert.equal(box.url, "https://georgetown.box.com/shared/static/abc");
  const drive = await resolveShareLink(get, "https://drive.google.com/file/d/pdf1/view");
  assert.equal(drive.ok && drive.format, "pdf");
  const html = await resolveShareLink(get, "https://drive.google.com/file/d/big1/view");
  assert.equal(html.ok, false);
  assert.match(!html.ok ? html.reason : "", /HTML back/);
  const folder = await resolveShareLink(get, "https://drive.google.com/drive/folders/xyz");
  assert.equal(folder.ok, false);
  // The URL's extension proves nothing: an .xlsx URL answering HTML is refused.
  const ext = await confirmDocument(get, "https://drive.google.com/uc?export=download&id=big1");
  assert.equal(ext.ok, false);
});

test("12: a CDS share link on an IR page is resolved and becomes the source", async () => {
  const f = fakeFetch({
    "https://www.delta2.edu/": html(),
    "https://oads.delta2.edu/robots.txt": "User-agent: *\n",
    "https://ir.delta2.edu/common-data-set": html(["https://delta2.box.com/s/zz9", "Common Data Set 2025-2026 (Excel)"]),
    "https://delta2.box.com/shared/static/zz9": XLSX,
  });
  const found = await probeStep(politeHttp(f.fn), school("100006", { website: "https://www.delta2.edu/" }));
  assert.equal(found.path, "probe-host");
  assert.deepEqual(found.sources, [{ kind: "cds", url: "https://delta2.box.com/shared/static/zz9", format: "xlsx" }]);
  assert.ok(found.prefetched?.has("https://delta2.box.com/shared/static/zz9"), "the confirmed bytes are kept for the first read");
});

test("sitemaps: robots.txt Sitemap lines are kept; index and urlset parse", () => {
  const r = parseRobots("Sitemap: https://x.edu/a.xml\nUser-agent: *\nDisallow: /p\nSitemap: https://x.edu/b.xml\n");
  assert.deepEqual(r.sitemaps, ["https://x.edu/a.xml", "https://x.edu/b.xml"]);
  assert.equal(r.rules.length, 1);
  assert.deepEqual(parseSitemap(sitemapIndex("https://x.edu/1.xml")), { index: true, locs: ["https://x.edu/1.xml"] });
  assert.deepEqual(parseSitemap("<urlset><url><loc><![CDATA[https://x.edu/a?b=1&amp;c=2]]></loc></url></urlset>").locs, ["https://x.edu/a?b=1&c=2"]);
  assert.equal(collegeDomain("www.cmu.edu"), "cmu.edu");
  assert.equal(collegeDomain("ir.provost.duke.edu"), "duke.edu");
  assert.equal(collegeDomain("www.ox.ac.uk"), "ox.ac.uk");
});

/* ------------------------------------------------------------------ */
/* 13. Blocked hosts and the owner's list                              */
/* ------------------------------------------------------------------ */

test("13: a 403 host is recorded; a college whose candidates are all blocked spends nothing and is listed, this run and the next", async () => {
  const f = fakeFetch({ "https://www.epsilon.edu/": () => new Response("Forbidden", { status: 403 }), "https://www.epsilon.edu/sitemap.xml": () => new Response("Forbidden", { status: 403 }) });
  const http = politeHttp(f.fn);
  const { deps: models, calls } = paid();
  const run1 = state(10);
  const r1 = await ladder({ school: school("200001", { website: "https://www.epsilon.edu/" }) }, run1, { ...freeSteps(http), ...models });
  assert.deepEqual(calls, [], "no paid step");
  assert.equal(r1.path, "blocked");
  assert.deepEqual(r1.blockedHosts, ["www.epsilon.edu"]);
  assert.equal(run1.budget.remaining_usd, 10);
  assert.deepEqual(run1.blocked.hosts, [{ host: "www.epsilon.edu", status: 403, first_seen: TODAY, last_seen: TODAY, unit_ids: ["200001"] }]);
  assert.ok(http.blockedSeen().some((b) => b.host === "www.epsilon.edu" && b.status === 403));

  // The next run starts from the written file: still nothing spent, and the college is listed for the owner.
  const run2 = { ...state(10, run1.blocked), today: "2026-10-10" };
  const out = await discoverAll([{ school: school("200001", { website: "https://www.epsilon.edu/" }) }], run2, { ...freeSteps(politeHttp(f.fn)), ...models });
  assert.deepEqual(calls, []);
  assert.deepEqual(out.listed, [{ unit_id: "200001", name: "College 200001", hosts: ["www.epsilon.edu"] }]);
  assert.equal(out.spent_usd, 0);
  assert.equal(run2.blocked.hosts[0].first_seen, TODAY);
  assert.equal(run2.blocked.hosts[0].last_seen, "2026-10-10");
});

test("13: blocking is per host: a blocked admissions host doesn't stop paid steps when another host answers", async () => {
  const blocked = recordBlocked({ hosts: [] }, [{ host: "admissions.zeta.edu", url: "https://admissions.zeta.edu/", status: 403 }], TODAY);
  const recipe: Recipe = { unit_id: "200002", sources: [{ kind: "class-profile", url: "https://admissions.zeta.edu/profile", format: "html" }], index_urls: [], learned: TODAY, model: "x" };
  assert.deepEqual(onlyBlockedCandidates({ recipe }, blocked, TODAY), ["admissions.zeta.edu"]);
  assert.equal(onlyBlockedCandidates({ recipe, answered: ["opir.zeta.edu"] }, blocked, TODAY), null);
  assert.equal(onlyBlockedCandidates({}, blocked, TODAY), null, "no candidates is not blocked");
  // A stale entry (not seen for over a year) is tried again.
  assert.equal(onlyBlockedCandidates({ recipe }, blocked, "2028-01-01"), null);
});

test("13: challenge pages are detected from the body, whatever the status", () => {
  const h = new Headers();
  assert.equal(blockedStatusOf(200, h, "<html><head><title>Just a moment...</title>"), "challenge");
  assert.equal(blockedStatusOf(403, h, '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>'), "challenge");
  assert.equal(blockedStatusOf(503, new Headers({ "cf-mitigated": "challenge" })), "challenge");
  assert.equal(blockedStatusOf(405, h), 405);
  assert.equal(blockedStatusOf(429, h), 429);
  assert.equal(blockedStatusOf(404, h), null);
  assert.equal(blockedStatusOf(200, h, "<html>Common Data Set</html>"), null);
});

test("13: an entry in the owner's list (cds-urls.json) is step 0: used with no request and no probe", async () => {
  const f = fakeFetch({});
  const manual: CdsUrlEntry[] = [
    { unit_id: "200003", url: "https://eta.box.com/s/abc", kind: "cds", note: "found in a browser", added: "2026-10-01" },
    { unit_id: "999999", url: "https://other.edu/cds.pdf", kind: "cds", added: "2026-10-01" },
  ];
  let probed = 0;
  const free = freeSteps(politeHttp(f.fn), manual);
  const r = await ladder({ school: school("200003") }, state(), { known: free.known, probe: async (c) => (probed++, free.probe(c)) });
  assert.equal(r.path, "manual");
  assert.equal(probed, 0);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(r.recipe.sources, [{ kind: "cds", url: "https://eta.box.com/shared/static/abc", format: "pdf" }]);
  // A college with a working recipe still takes a new owner's link.
  const working: Recipe = { unit_id: "200003", sources: [{ kind: "cds", url: "https://eta.edu/old.pdf", format: "pdf" }], index_urls: [], learned: "2026-01-01", model: "x" };
  assert.equal(shouldRetry(working, TODAY), false);
  assert.equal(shouldRetry(working, TODAY, { manual }), true);
});

test("step 0: an index page with a newer edition, then a guessed next edition confirmed by its bytes", async () => {
  const idx = "https://oirds.theta.edu/ReportingCommonDataSet.html";
  const old = "https://oirds.theta.edu/CDS/2023/CDS_2023-2024_final.pdf";
  const recipe: Recipe = { unit_id: "200004", sources: [{ kind: "cds", url: old, format: "pdf" }], index_urls: [idx], learned: "2025-01-01", model: "x" };
  const f = fakeFetch({ [idx]: html(["CDS/2025/CDS_2025-2026_final.pdf", "CDS 2025-2026"], ["CDS/2023/CDS_2023-2024_final.pdf", "CDS 2023-2024"]) });
  const r = await ladder({ school: school("200004"), recipe: { ...recipe, none_found: true } }, state(), { ...freeSteps(politeHttp(f.fn)) });
  assert.equal(r.path, "known");
  assert.deepEqual(r.recipe.sources.map((s) => s.url), ["https://oirds.theta.edu/CDS/2025/CDS_2025-2026_final.pdf"]);
  assert.deepEqual(r.retired.map((s) => s.url), [old], "the superseded edition leaves the recipe and is returned for the manifest");
  assert.equal(r.recipe.none_found, undefined);

  const g = fakeFetch({ "https://www.iota.edu/ir/CDS_2025-2026.pdf": PDF, "https://www.iota.edu/ir/CDS_2026-2027.pdf": "<html>Page not found</html>" });
  const known = await knownStep(politeHttp(g.fn), { school: school("200005", { cds: "https://www.iota.edu/ir/CDS_2024-2025.pdf" }) });
  assert.equal(known.path, "guessed");
  assert.deepEqual(known.sources, [{ kind: "cds", url: "https://www.iota.edu/ir/CDS_2025-2026.pdf", format: "pdf" }]);
});

/* ------------------------------------------------------------------ */
/* 14. Order and budgets                                               */
/* ------------------------------------------------------------------ */

test("14: colleges go by tier, then enrollment, largest first", () => {
  const order = orderColleges([
    school("4", { rate: null, size: 90000 }),
    school("3", { rate: 0.6, size: 1000 }),
    school("2b", { rate: 0.3, size: 30000 }),
    school("2a", { rate: 0.3, size: 2000 }),
    school("1", { rate: 0.05, size: 1500 }),
    school("5", { rate: 0.95, size: 100 }),
  ]).map((s) => s.unit_id);
  assert.deepEqual(order, ["1", "2b", "2a", "3", "4", "5"]);
});

test("14: per-tier steps: open admission never reaches step 3 in the main pass, step 4 once a year", () => {
  assert.deepEqual(stepsFor("very selective"), [0, 1, 2, 3, 4]);
  assert.deepEqual(stepsFor("selective", { fullWithinYear: true }), [0, 1, 2, 3]);
  assert.deepEqual(stepsFor("less selective"), [0, 1, 2, 3]);
  assert.deepEqual(stepsFor("open admission"), [0, 1, 2]);
  assert.deepEqual(stepsFor("open admission", { pass: "leftover" }), [3]);
  assert.deepEqual(stepsFor("selective", { pass: "leftover" }), []);
});

test("14: with a small budget the paid steps go in tier order, and open admission gets no step 3", async () => {
  const colleges = [school("open", { rate: null, size: 80000 }), school("less", { rate: 0.7 }), school("sel", { rate: 0.3 }), school("very", { rate: 0.05 })].map((s) => ({ school: s }));
  const { deps: models, calls } = paid({ pick: 0, search: 0.08 });
  const st = state(0.26);
  const out = await discoverAll(colleges, st, { ...nothing, searchOnly: models.searchOnly, pickLinks: models.pickLinks });
  assert.deepEqual(calls, ["pick:very", "search:very", "pick:sel", "search:sel", "pick:less", "search:less", "pick:open"]);
  assert.ok(Math.abs(st.budget.remaining_usd - 0.02) < 1e-9);
  assert.ok(Math.abs(out.spent_usd - 0.24) < 1e-9);
  // Very selective could have climbed to step 4, but it isn't wired here: recorded as skipped.
  assert.ok(out.results.get("very")!.recipe.discovery!.tried.some((t) => t.step === 4 && t.result === "skipped"));
});

test("14: open admission reaches step 3 only with budget left after every other tier", async () => {
  const colleges = [school("open", { rate: null }), school("less", { rate: 0.7 })].map((s) => ({ school: s }));
  const rich = paid({ search: 0.08 });
  const st = state(1);
  await discoverAll(colleges, st, { ...nothing, ...rich.deps, discover: undefined });
  assert.deepEqual(rich.calls, ["pick:less", "search:less", "pick:open", "search:open"], "open's step 3 comes after every other tier");

  const poor = paid({ search: 0.08 });
  const st2 = state(0.1);
  await discoverAll(colleges, st2, { ...nothing, ...poor.deps, discover: undefined });
  assert.deepEqual(poor.calls, ["pick:less", "search:less", "pick:open"], "no money left: no step 3 for open admission");

  const off = paid({ search: 0.08 });
  await discoverAll(colleges, state(1), { ...nothing, ...off.deps }, { openAdmissionLeftover: false });
  assert.ok(!off.calls.includes("search:open"), "the owner's 0–2-only choice switches the leftover pass off");
});

test("14: a paid find stops the ladder and its cost is recorded", async () => {
  const found = paid({ pick: 0.004 }, (step) =>
    step === "pick" ? { path: "picker", sources: [{ kind: "cds", url: "https://kappa.edu/cds.pdf", format: "pdf" }], index_urls: ["https://kappa.edu/ir"], cost_usd: 0.004, model: "claude-haiku-4-5" } : null
  );
  const r = await ladder({ school: school("300001", { rate: 0.05 }) }, state(), { ...nothing, ...found.deps });
  assert.deepEqual(found.calls, ["pick:300001"]);
  assert.equal(r.path, "picker");
  assert.equal(r.recipe.model, "claude-haiku-4-5");
  assert.equal(r.spent_usd, 0.004);
  assert.ok(r.recipe.discovery!.tried.some((t) => t.step === 2 && t.result === "found" && t.cost_usd === 0.004));
});

/* ------------------------------------------------------------------ */
/* 15. Back-off                                                        */
/* ------------------------------------------------------------------ */

test("15: next_attempt is the next 1 February (a year on for open admission)", () => {
  assert.equal(nextAttempt("selective", "2026-10-03"), "2027-02-01");
  assert.equal(nextAttempt("less selective", "2027-01-15"), "2027-02-01");
  assert.equal(nextAttempt("very selective", "2027-02-01"), "2028-02-01");
  assert.equal(nextAttempt("open admission", "2026-10-03"), "2027-10-03");
});

test("15: a ladder that finds nothing or fails sets next_attempt, and no run retries before it; without the date it retries", async () => {
  const failing: LadderDeps = { ...nothing, pickLinks: async () => ({ path: "none", sources: [], index_urls: [], cost_usd: 0 }), searchOnly: async () => { throw new Error("request timed out"); } };
  const r = await ladder({ school: school("400001", { rate: 0.3 }) }, state(), failing);
  assert.equal(r.found, false);
  assert.equal(r.recipe.discovery?.next_attempt, "2027-02-01");
  assert.equal(r.recipe.none_found, true);
  assert.ok(r.recipe.discovery!.tried.some((t) => t.step === 3 && t.result === "failed" && /timed out/.test(t.detail ?? "")));
  assert.ok(!r.recipe.discovery!.tried.some((t) => t.step === 4), "a failed paid step backs off instead of climbing");

  assert.equal(shouldRetry(r.recipe, "2026-12-01"), false);
  assert.equal(shouldRetry(r.recipe, "2027-02-01"), true);

  let called = 0;
  const counting: LadderDeps = { known: async (c) => (called++, nothing.known(c)), probe: nothing.probe };
  await discoverAll([{ school: school("400001", { rate: 0.3 }), recipe: r.recipe }], { ...state(), today: "2026-11-01" }, counting);
  assert.equal(called, 0, "not before next_attempt");
  const undated = structuredClone(r.recipe);
  delete undated.discovery!.next_attempt;
  await discoverAll([{ school: school("400001", { rate: 0.3 }), recipe: undated }], { ...state(), today: "2026-11-01" }, counting);
  assert.equal(called, 1, "break the guard (remove the date) and it retries");
  // none_found alone (round 2's flag) used to wait for --rediscover; now it is retried by date.
  assert.equal(shouldRetry({ ...undated, discovery: undefined }, TODAY), true);
  assert.equal(shouldRetry({ unit_id: "x", sources: [{ kind: "cds", url: "u", format: "pdf" }], index_urls: [], learned: TODAY, model: "m" }, TODAY), false);
});

/* ------------------------------------------------------------------ */
/* 22 and superseded editions                                          */
/* ------------------------------------------------------------------ */

test("22: after a re-discovery only documents this run hasn't fetched are read", () => {
  const fresh: Recipe = {
    unit_id: "1",
    sources: [
      { kind: "cds", url: "https://a.edu/cds_2025-26.pdf", format: "pdf", sha256: "aa" },
      { kind: "class-profile", url: "https://a.edu/profile", format: "html" },
    ],
    index_urls: [],
    learned: TODAY,
    model: "m",
  };
  const fetched = new Set(["https://a.edu/cds_2025-26.pdf"]);
  assert.deepEqual(documentsToReadAfterRediscovery(fresh, fetched).map((s) => s.url), ["https://a.edu/profile"]);
  assert.deepEqual(documentsToReadAfterRediscovery(fresh, new Set()).length, 2, "break it (forget what was fetched) and both are read again");
});

test("superseded editions are retired by a newer index link; undated sources stay", () => {
  const recipe = {
    sources: [
      { kind: "cds" as const, url: "https://apb.ucla.edu/file/f8f5c864", format: "pdf" as const },
      { kind: "cds" as const, url: "https://apb.ucla.edu/portals/90/documents/campus-stats/cds_2019-20_section_h.pdf", format: "pdf" as const },
      { kind: "class-profile" as const, url: "https://x.ucla.edu/UndergradProfile2025-2026_final.pdf", format: "pdf" as const },
    ],
  };
  const { keep, retire } = retireSuperseded(recipe, [{ kind: "cds", url: "https://apb.ucla.edu/cds_2025-26.pdf", format: "pdf" }]);
  assert.deepEqual(retire.map((s) => s.url), ["https://apb.ucla.edu/portals/90/documents/campus-stats/cds_2019-20_section_h.pdf"]);
  assert.equal(keep.length, 2);
  assert.deepEqual(retireSuperseded(recipe, []).retire, []);
});

/* ------------------------------------------------------------------ */
/* HTTP limits                                                         */
/* ------------------------------------------------------------------ */

test("http: a request that doesn't answer in time is aborted with a timeout error", async () => {
  let aborted = false;
  const hang = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/robots.txt")) return new Response("", { status: 404 });
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }) as typeof globalThis.fetch;
  const http = politeHttp(hang, { timeoutMs: 30 });
  await assert.rejects(http.get("https://slow.edu/cds.pdf"), (err: unknown) => err instanceof HttpLimitError && err.limit === "timeout");
  assert.equal(aborted, true);
});

test("http: a body past the size cap is aborted, whether declared or streamed", async () => {
  const big = new Uint8Array(1000).fill(65);
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 10; i++) c.enqueue(big.subarray(i * 100, (i + 1) * 100));
        c.close();
      },
    });
  const f = fakeFetch({
    "https://huge.edu/declared.pdf": () => new Response(big, { headers: { "content-length": "1000" } }),
    "https://huge.edu/streamed.pdf": () => new Response(stream()),
    "https://huge.edu/small.pdf": PDF,
  });
  const http = politeHttp(f.fn, { maxBytes: 500 });
  await assert.rejects(http.get("https://huge.edu/declared.pdf"), (err: unknown) => err instanceof HttpLimitError && err.limit === "size");
  await assert.rejects(http.get("https://huge.edu/streamed.pdf"), (err: unknown) => err instanceof HttpLimitError && err.limit === "size");
  const ok = await http.get("https://huge.edu/small.pdf");
  assert.equal(ok?.status, 200);
  assert.equal(new Uint8Array(await ok!.arrayBuffer()).length, PDF.length);
});
