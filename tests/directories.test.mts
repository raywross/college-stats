/**
 * National directories (specs/campus-directories.md): the matcher's hard cases, the polite crawl context (robots.txt,
 * pacing, cache, refusals) with a mocked fetch, the adapter registry, the lineage guards (a listing without its
 * source fails, each rule broken on purpose), the merge (idempotent, and the committed data is exactly a fresh
 * merge), the example adapter's parser, and tier A policy checks. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { validateLineage } from "../lib/lineage.ts";
import { detailMismatches, validateDetail, type SchoolDetail } from "../lib/detail.ts";
import {
  checkDirectoryRows,
  citeListing,
  groupListings,
  listingsFor,
  policyCheckProblems,
  sortListings,
  summarize,
  type DirectoryRows,
} from "../lib/directories.ts";
import { buildIndex, FLAGSHIPS, matchEntry, normKey, type MatchInput, type MatchResult } from "../scripts/lib/directories/matcher.mts";
import { collegesFrom } from "../scripts/lib/directories/colleges.mts";
import { createContext, DIRECTORY_USER_AGENT } from "../scripts/lib/directories/context.mts";
import { Blocked, HttpError, defineAdapter, type CrawlContext } from "../scripts/lib/directories/contract.mts";
import { adapterProblems, loadAdapters } from "../scripts/lib/directories/registry.mts";
import { buildFiles, runAdapter } from "../scripts/lib/directories/run.mts";
import { clearBlocks, readDirectoryFiles, recordBlock } from "../scripts/lib/directories/files.mts";
import { applyDirectories, directoryDetails, orphanSummaries } from "../scripts/lib/directories/merge.mts";
import { campusOf, entriesFrom } from "../scripts/lib/directories/adapters/ssa.mts";
import { readDetails } from "../scripts/lib/publish-details.mts";

const ROOT = join(import.meta.dirname, "..");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const allSchools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const index = buildIndex(collegesFrom(allSchools), new Map([["179867", ["WashU"]]]), { "Boston Area|MA": ["164988", "167358"] });

const ids = (r: MatchResult) => (r.status === "matched" ? r.matches.map((m) => m.unit_id).sort() : r.status);
const match = (campus: string, extra: Partial<MatchInput> = {}) => ids(matchEntry(index, { campus, ...extra }));

/* ------------------------------------------------------------------ */
/* Matcher                                                             */
/* ------------------------------------------------------------------ */

test("matcher: University of Texas spellings, with and without a state", () => {
  assert.deepEqual(match("University of Texas, Austin", { state: "TX" }), ["228778"]);
  assert.deepEqual(match("The University of Texas at Austin"), ["228778"]);
  assert.deepEqual(match("UT Austin", { state: "Texas" }), ["228778"]);
  assert.deepEqual(match("University of Texas at Dallas", { state: "TX" }), ["228787"]);
  // "University of Texas" alone names a system, not a campus: never guessed.
  assert.equal(match("University of Texas", { state: "TX" }), "unmatched");
});

test("matcher: Miami University is not the University of Miami", () => {
  assert.deepEqual(match("Miami University", { state: "OH" }), ["204024"]);
  assert.deepEqual(match("Miami University"), ["204024"]); // the Oxford flagship, not Hamilton or Middletown
  assert.deepEqual(match("Miami University (Ohio)"), ["204024"]);
  assert.deepEqual(match("Miami University", { city: "Hamilton", state: "OH" }), ["204006"]);
  assert.deepEqual(match("University of Miami", { state: "FL" }), ["135726"]);
  assert.deepEqual(match("University of Miami"), ["135726"]);
  assert.equal(match("Miami University", { state: "FL" }), "unmatched");
  assert.equal(normKey("Miami University") === normKey("University of Miami"), false);
});

test("matcher: Penn State means the main campus unless a branch or its city is named", () => {
  assert.deepEqual(match("Penn State", { state: "PA" }), ["214777"]);
  assert.deepEqual(match("Pennsylvania State University"), ["214777"]);
  assert.deepEqual(match("Penn State University Park", { state: "PA" }), ["214777"]);
  assert.deepEqual(match("Penn State Altoona", { state: "PA" }), ["214689"]);
  assert.deepEqual(match("Penn State", { city: "Altoona", state: "PA" }), ["214689"]);
  assert.deepEqual(match("Penn State Erie, The Behrend College", { state: "PA" }), ["214591"]);
});

test("matcher: Saint John's University is two colleges; the state decides, and without one nothing is guessed", () => {
  assert.deepEqual(match("Saint John's University", { state: "MN" }), ["174792"]);
  assert.deepEqual(match("St. John's University", { state: "NY" }), ["195809"]);
  const r = matchEntry(index, { campus: "Saint John's University" });
  assert.equal(r.status, "unmatched");
  assert.match(r.status === "unmatched" ? r.reason : "", /ambiguous/);
});

test("matcher: Washington University in St. Louis vs the University of Washington", () => {
  assert.deepEqual(match("Washington University in St. Louis", { state: "MO" }), ["179867"]);
  assert.deepEqual(match("Washington University in Saint Louis"), ["179867"]);
  assert.deepEqual(match("WashU", { state: "MO" }), ["179867"]); // IPEDS alias
  assert.deepEqual(match("University of Washington", { state: "WA" }), ["236948"]); // Seattle, the flagship
  assert.deepEqual(match("University of Washington", { city: "Tacoma", state: "WA" }), ["377564"]);
  assert.deepEqual(match("George Washington University"), ["131469"]);
});

test("matcher: Columbia College Chicago, Columbia University, and the two Columbia Colleges", () => {
  assert.deepEqual(match("Columbia College Chicago", { state: "IL" }), ["144281"]);
  assert.deepEqual(match("Columbia University", { state: "NY" }), ["190150"]);
  assert.deepEqual(match("Columbia College", { state: "MO" }), ["177065"]);
  assert.deepEqual(match("Columbia College", { state: "SC" }), ["217934"]);
  assert.equal(match("Columbia College"), "unmatched"); // MO or SC: never a coin toss
});

test("matcher: SUNY and CUNY names", () => {
  assert.deepEqual(match("SUNY Geneseo"), ["196167"]);
  assert.deepEqual(match("State University of New York at Geneseo"), ["196167"]);
  assert.deepEqual(match("SUNY Binghamton"), ["196079"]);
  assert.deepEqual(match("Hunter College", { state: "NY" }), ["190594"]);
  assert.deepEqual(match("CUNY Hunter College"), ["190594"]);
});

test("matcher: chapters serving several colleges map to each, flagged; an area alone goes to review", () => {
  const boston = matchEntry(index, { campus: "Boston Area (Boston University, Northeastern University)", state: "MA" });
  assert.equal(boston.status, "matched");
  assert.ok(boston.status === "matched" && boston.multi);
  assert.deepEqual(ids(boston), ["164988", "167358"]);
  const claremont = matchEntry(index, { campus: "The Claremont Colleges" });
  assert.equal(claremont.status === "matched" && claremont.matches.length, 5);
  assert.ok(claremont.status === "matched" && claremont.multi);
  const area = matchEntry(index, { campus: "Denver Area" });
  assert.equal(area.status, "unmatched");
  assert.match(area.status === "unmatched" ? area.reason : "", /area chapter/);
  // A hand-checked answer (data/directories/matches.json) wins, and can name several colleges.
  const reviewed = matchEntry(index, { campus: "Boston Area", state: "MA" });
  assert.deepEqual(ids(reviewed), ["164988", "167358"]);
  assert.ok(reviewed.status === "matched" && reviewed.multi && reviewed.matches.every((m) => m.method === "reviewed"));
});

test("matcher: the college's own domain decides or confirms; disagreement and weak names go to review", () => {
  const byUrl = matchEntry(index, { campus: "The Forty Acres Chapter", state: "TX", url: "https://www.utexas.edu/students/club" });
  assert.deepEqual(ids(byUrl), ["228778"]);
  assert.equal(byUrl.status === "matched" && byUrl.matches[0].method, "url");
  // A subdomain picks the campus that owns it, not the system's main domain.
  assert.deepEqual(ids(matchEntry(index, { campus: "IU chapter", url: "https://kokomo.iu.edu/clubs" })), ["151333"]);
  const disagree = matchEntry(index, { campus: "Rice University", state: "TX", url: "https://www.utexas.edu/" });
  assert.equal(disagree.status, "unmatched");
  // Never guessed: a name shaped differently from every college ("Notre Dame University").
  assert.equal(match("Notre Dame University"), "unmatched");
  assert.equal(match("Boston Area", { state: "NY" }), "unmatched");
  assert.equal(match("Sierra College"), "unmatched"); // a community college, not on the site
});

test("matcher: every flagship names exactly one college in data/schools.json", () => {
  for (const [key, name] of Object.entries(FLAGSHIPS)) {
    assert.equal(allSchools.filter((s) => s.name === name).length, 1, `${key} → ${name}`);
  }
});

/* ------------------------------------------------------------------ */
/* Crawl context: robots.txt, pacing, cache, refusals (mocked fetch)   */
/* ------------------------------------------------------------------ */

type Route = (url: string, init?: RequestInit) => Response;

function fakeNet(routes: Record<string, Route | string>) {
  const calls: { url: string; ua: string | null }[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ua: new Headers(init?.headers).get("User-Agent") });
    const r = routes[url];
    if (r === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return typeof r === "string" ? new Response(r, { status: 200, headers: { "content-type": url.endsWith(".txt") ? "text/plain" : "text/html" } }) : r(url, init);
  }) as typeof globalThis.fetch;
  return {
    calls,
    sleeps,
    advance: (ms: number) => (clock += ms),
    deps: {
      fetch,
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      log: () => {},
    },
  };
}

function ctxFor(net: ReturnType<typeof fakeNet>, extra: { maxAgeDays?: number } = {}): { ctx: CrawlContext; cache: string } {
  const cache = mkdtempSync(join(tmpdir(), "dir-cache-"));
  return { ctx: createContext("test", { ...net.deps, cacheDir: cache, today: "2026-10-04", ...extra }), cache };
}

test("context: robots.txt Disallow throws Blocked(robots) and the page is never requested", async () => {
  const net = fakeNet({ "https://a.org/robots.txt": "User-agent: *\nDisallow: /private/", "https://a.org/private/list": "<html>ok</html>" });
  const { ctx } = ctxFor(net);
  await assert.rejects(ctx.fetchText("https://a.org/private/list"), (e: unknown) => e instanceof Blocked && e.reason === "robots");
  assert.deepEqual(
    net.calls.map((c) => c.url),
    ["https://a.org/robots.txt"]
  );
});

test("context: our user agent, a group for our token, and ≥ 2 s per host (longer with Crawl-delay)", async () => {
  const net = fakeNet({
    "https://a.org/robots.txt": "User-agent: college-stats-research\nDisallow: /no/\n\nUser-agent: *\nDisallow: /",
    "https://a.org/one": "1",
    "https://a.org/two": "2",
    "https://b.org/robots.txt": "User-agent: *\nCrawl-delay: 10",
    "https://b.org/one": "1",
    "https://b.org/two": "2",
  });
  const { ctx } = ctxFor(net);
  assert.equal(await ctx.fetchText("https://a.org/one"), "1"); // our group allows it even though * disallows all
  assert.equal(await ctx.fetchText("https://a.org/two"), "2");
  await assert.rejects(ctx.fetchText("https://a.org/no/x"), Blocked);
  await ctx.fetchText("https://b.org/one");
  await ctx.fetchText("https://b.org/two");
  assert.ok(net.calls.every((c) => c.ua === DIRECTORY_USER_AGENT));
  assert.ok(net.sleeps.some((ms) => ms >= 1_999 && ms <= 2_000), "a 2 s gap on a.org");
  assert.ok(net.sleeps.some((ms) => ms >= 9_999), "a 10 s gap on b.org (Crawl-delay)");
});

test("context: bot challenges, 403/401/429, and login redirects throw Blocked; other errors throw HttpError", async () => {
  const withUrl = (res: Response, url: string) => {
    Object.defineProperty(res, "url", { value: url });
    return res;
  };
  const net = fakeNet({
    "https://c.org/robots.txt": "",
    "https://c.org/challenge": "<html><head><title>Just a moment...</title></head></html>",
    "https://c.org/cf503": () => new Response("x", { status: 503, headers: { "cf-mitigated": "challenge", "content-type": "text/html" } }),
    "https://c.org/forbidden": () => new Response("no", { status: 403, headers: { "content-type": "text/html" } }),
    "https://c.org/members": () => withUrl(new Response("sign in", { status: 200, headers: { "content-type": "text/html" } }), "https://c.org/login?next=/members"),
    "https://c.org/broken": () => new Response("oops", { status: 500, headers: { "content-type": "text/html" } }),
  });
  const { ctx } = ctxFor(net);
  const reason = (url: string) =>
    ctx.fetchText(url).then(
      () => "ok",
      (e) => (e instanceof Blocked ? e.reason : e instanceof HttpError ? `http ${e.status}` : String(e))
    );
  assert.equal(await reason("https://c.org/challenge"), "challenge");
  assert.equal(await reason("https://c.org/cf503"), "challenge");
  assert.equal(await reason("https://c.org/forbidden"), "forbidden");
  assert.equal(await reason("https://c.org/members"), "login");
  assert.equal(await reason("https://c.org/broken"), "http 500");
  assert.equal(await reason("https://c.org/missing"), "http 404");
});

test("context: the cache answers within its max age, then the page is fetched again", async () => {
  const net = fakeNet({ "https://d.org/robots.txt": "", "https://d.org/list": "v1" });
  const { ctx, cache } = ctxFor(net, { maxAgeDays: 1 });
  assert.equal(await ctx.fetchText("https://d.org/list"), "v1");
  const after = net.calls.length;
  assert.equal(await ctx.fetchText("https://d.org/list"), "v1");
  assert.equal(net.calls.length, after, "served from .cache/directories");
  assert.equal(readdirSync(join(cache, "test")).length, 1);
  net.advance(2 * 86_400_000);
  await ctx.fetchText("https://d.org/list");
  assert.equal(net.calls.length, after + 1, "stale copy refetched");
  rmSync(cache, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Registry, runner, blocked.json                                      */
/* ------------------------------------------------------------------ */

const fakeAdapter = (entries: unknown[], throws?: Error) =>
  defineAdapter({
    key: "fake",
    organization: "Fake Fellowship",
    publisher: "Fake Fellowship",
    listUrl: "https://fake.org/chapters",
    tier: "D",
    domain: "faith",
    tradition: "orthodox",
    async crawl() {
      if (throws) throw throws;
      return entries as never;
    },
  });

test("registry: every adapter file loads and is well formed; malformed declarations are named", async () => {
  const adapters = await loadAdapters();
  assert.ok(adapters.some((a) => a.key === "ssa"));
  for (const a of adapters) assert.deepEqual(adapterProblems(a), []);
  const bad = { ...fakeAdapter([]), key: "Bad Key", listUrl: "http://x", tier: "A", tradition: "pastafarian" } as never;
  const problems = adapterProblems(bad, "bad.mts").join("\n");
  for (const p of [/key must be/, /match the file name/, /https/, /tier/, /unknown tradition/]) assert.match(problems, p);
});

test("runner: cleans, de-duplicates, sorts, and splits matched from unmatched", async () => {
  const ctx = { org: "fake", today: "2026-10-04", fetchText: async () => "", fetchJson: async () => ({}), log: () => {} } as CrawlContext;
  const { file, unmatched } = await runAdapter(
    fakeAdapter([
      { campus: "  Vanderbilt University ", state: "Tennessee", name: "OCF at Vanderbilt" },
      { campus: "Vanderbilt University", state: "TN", name: "OCF at Vanderbilt" },
      { campus: "Columbia College" },
      { campus: "Boston Area (Boston University, Northeastern University)", state: "MA" },
      { campus: "" },
    ]),
    ctx,
    index
  );
  assert.deepEqual(file.counts, { entries: 3, matched: 2, multi: 1, unmatched: 1, colleges: 3 });
  assert.equal(file.entries[1].state, "TN");
  assert.deepEqual(file.classification, { domain: "faith", tradition: "orthodox" });
  assert.equal(unmatched.entries[0].campus, "Columbia College");
  assert.throws(() => buildFiles(fakeAdapter([]), [{ campus: "Vanderbilt University", quote: "x".repeat(161) }], index, "2026-10-04"), /160/);
  await assert.rejects(runAdapter(fakeAdapter([]), ctx, index), /no entries/);
});

test("blocked.json: a refusal is recorded once per org and URL with first and last seen; a good read clears it", () => {
  let f = recordBlock({ blocked: [] }, { org: "ocf", url: "https://ocf.net/chapters/", reason: "forbidden" }, "2026-10-01");
  f = recordBlock(f, { org: "ocf", url: "https://ocf.net/chapters/", reason: "challenge" }, "2026-10-04");
  f = recordBlock(f, { org: "hillel", url: "https://www.hillel.org/college-tools/", reason: "challenge" }, "2026-10-04");
  assert.deepEqual(f.blocked.map((b) => [b.org, b.reason, b.first_seen, b.last_seen]), [
    ["hillel", "challenge", "2026-10-04", "2026-10-04"],
    ["ocf", "challenge", "2026-10-01", "2026-10-04"],
  ]);
  assert.deepEqual(clearBlocks(f, "ocf").blocked.map((b) => b.org), ["hillel"]);
});

/* ------------------------------------------------------------------ */
/* Lineage guards: a listing without its source fails                  */
/* ------------------------------------------------------------------ */

const credit = { organization: "Fake Fellowship", publisher: "Fake Fellowship", list_url: "https://fake.org/chapters", read: "2026-10-04", tier: "D", domain: "faith", tradition: "orthodox" } as const;
const goodRows = (): DirectoryRows => ({ credits: { fake: { ...credit } }, listings: [{ org: "fake", name: "Fake at Vanderbilt" }] });

test("lineage: checkDirectoryRows refuses each kind of uncredited or malformed listing", () => {
  assert.equal(checkDirectoryRows(goodRows()), null);
  const broken: [string, (r: DirectoryRows) => void, RegExp][] = [
    ["listing without a credit", (r) => (r.listings[0].org = "ghost"), /names no credited organization/],
    ["credit without its list", (r) => (r.credits.fake.list_url = ""), /list_url/],
    ["credit without the date read", (r) => (r.credits.fake.read = "October"), /date the list was read/],
    ["credit without a publisher", (r) => (r.credits.fake.publisher = ""), /publisher/],
    ["unknown tier", (r) => ((r.credits.fake as { tier: string }).tier = "A"), /tier/],
    ["unknown tradition", (r) => ((r.credits.fake as { tradition: string }).tradition = "x"), /tradition/],
    ["estimate without fact and quote", (r) => (r.listings[0].tier = "C"), /tier C/],
    ["long quote", (r) => (r.listings[0].quote = "y".repeat(161)), /160/],
    ["unused credit", (r) => (r.credits.other = { ...credit }), /credits nothing lists/],
    ["no listings", (r) => (r.listings = []), /no listings/],
    [
      "out of order",
      (r) => {
        r.listings = [{ org: "fake", name: "Z" }, { org: "fake", name: "A" }];
      },
      /canonical order/,
    ],
  ];
  for (const [what, breakIt, re] of broken) {
    const r = goodRows();
    breakIt(r);
    assert.match(checkDirectoryRows(r) ?? "", re, what);
  }
});

test("lineage: the committed data fails the checks when a real listing loses its source (proved on a copy)", () => {
  const details = readDetails(ROOT) ?? [];
  const withTable = details.find((d) => d.tables.directories);
  assert.ok(withTable, "the example adapter's listings are in the detail files");
  const school = allSchools.find((s) => s.unit_id === withTable.unit_id)!;
  assert.deepEqual(validateDetail(withTable, meta), []);
  assert.deepEqual(detailMismatches(school, withTable), []);
  // 1. The listing's organization has no credit.
  const noCredit = structuredClone(withTable) as SchoolDetail;
  noCredit.tables.directories!.rows.credits = {};
  assert.match(validateDetail(noCredit, meta).join("\n"), /names no credited organization/);
  // 2. The table cites the wrong source.
  const wrongSource = structuredClone(withTable) as SchoolDetail;
  (wrongSource.tables.directories as { source: string }).source = "scorecard";
  assert.match(validateDetail(wrongSource, meta).join("\n"), /cites scorecard/);
  // 3. The summary in schools.json without its lineage record.
  const noLineage = structuredClone(school);
  delete noLineage.lineage!.directories;
  assert.match(validateLineage([noLineage], meta).join("\n"), /directories must cite source "directory"/);
  // 4. A summary the listings don't support, and a summary with no table at all.
  const wrongSummary = structuredClone(school);
  wrongSummary.directories = { faith: ["jewish"] };
  assert.match(detailMismatches(wrongSummary, withTable).join("\n"), /doesn't match the directories table/);
  assert.equal(orphanSummaries([school], []).length, 1);
});

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

test("merge: idempotent (deepEqual), and the committed data is exactly a fresh merge of data/directories/", () => {
  const files = readDirectoryFiles(ROOT);
  const known = new Set(allSchools.map((s) => s.unit_id));
  const built = directoryDetails(files, known);
  const once = applyDirectories(allSchools, built);
  const twice = applyDirectories(once, directoryDetails(files, known));
  assert.deepEqual(twice, once);
  assert.equal(JSON.stringify(twice), JSON.stringify(once), "byte-identical, key order included");
  assert.equal(JSON.stringify(once), JSON.stringify(allSchools), "run `npm run merge-directories`");
  const committed = new Map((readDetails(ROOT) ?? []).map((d) => [d.unit_id, d.tables.directories]));
  for (const d of built) assert.deepEqual(committed.get(d.unit_id), d.tables.directories, d.unit_id);
  assert.equal([...committed.values()].filter(Boolean).length, built.length);
  assert.deepEqual(validateLineage(once, meta), []);
});

test("merge CLI: a second run changes nothing (scratch copy)", () => {
  const dir = mkdtempSync(join(tmpdir(), "merge-directories-"));
  try {
    mkdirSync(join(dir, "data", "detail", "schools"), { recursive: true });
    const keep = allSchools.filter((s) => s.directories).slice(0, 3);
    writeFileSync(join(dir, "data", "schools.json"), `[\n${keep.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
    cpSync(join(ROOT, "data", "meta.json"), join(dir, "data", "meta.json"));
    for (const s of keep) cpSync(join(ROOT, "data", "detail", "schools", `${s.unit_id}.json`), join(dir, "data", "detail", "schools", `${s.unit_id}.json`));
    cpSync(join(ROOT, "data", "directories"), join(dir, "data", "directories"), { recursive: true });
    const run = () =>
      execFileSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "merge-directories.mts")], {
        env: { ...process.env, MERGE_DIRECTORIES_ROOT: dir },
        encoding: "utf8",
      });
    const snapshot = () => [readFileSync(join(dir, "data", "schools.json"), "utf8"), ...keep.map((s) => readFileSync(join(dir, "data", "detail", "schools", `${s.unit_id}.json`), "utf8"))];
    run();
    const first = snapshot();
    assert.match(run(), /0 detail files changed/);
    assert.deepEqual(snapshot(), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

test("display: listingsFor, groupListings, summarize, and the credited citation", () => {
  const rows: DirectoryRows = {
    credits: {
      fake: { ...credit },
      grl: { organization: "Gamma Rho Lambda", publisher: "Gamma Rho Lambda", list_url: "https://www.gammarholambda.org/chapters", read: "2026-10-03", tier: "D", domain: "greek", council: "lgbtq" },
      est: { organization: "Some Org", publisher: "Some Org", list_url: "https://some.org/x", read: "2026-09-01", tier: "C", domain: "faith", tradition: "jewish" },
    },
    listings: [],
  };
  rows.listings = sortListings(
    [
      { org: "grl", name: "Rho Chapter" },
      { org: "fake", name: "Fake at Vanderbilt", url: "https://fake.org/vu" },
      { org: "est", fact: "1,200 Jewish undergraduates", quote: "about 1,200 Jewish undergrads" },
    ],
    rows.credits
  );
  assert.equal(checkDirectoryRows(rows), null);
  assert.deepEqual(summarize(rows), { faith: ["jewish", "orthodox"], greek: ["lgbtq"] });
  const faith = listingsFor(rows, "faith");
  assert.deepEqual(groupListings(faith).map((g) => g.label), ["Jewish", "Orthodox Christian"]);
  const cited = citeListing(faith[0]);
  assert.equal(cited.key, "org-estimate");
  assert.equal(cited.url, "https://some.org/x");
  assert.equal(cited.retrieved, "2026-09-01");
  assert.equal(cited.year, "September 2026");
  assert.equal(cited.directory?.tier, "C");
  assert.equal(citeListing(faith[1]).key, "directory");
  assert.deepEqual(listingsFor(null, "faith"), []);
});

/* ------------------------------------------------------------------ */
/* Example adapter (Secular Student Alliance) and tier A policy checks */
/* ------------------------------------------------------------------ */

test("ssa adapter: campus names from marker titles; high schools and law schools left out", () => {
  assert.equal(campusOf("Secular Student Alliance at Fordham University"), "Fordham University");
  assert.equal(campusOf("Wichita State University Secular Shockers"), "Wichita State University");
  assert.equal(campusOf("Humanists of Boston University"), "Boston University");
  assert.equal(campusOf("University of Alabama at Huntsville Secular Student Alliance"), "University of Alabama at Huntsville");
  assert.equal(campusOf("SBU Skeptics and Secular Humanists at Suny-Stony Brook"), "Suny-Stony Brook");
  assert.equal(campusOf("Rock Hill High School Secular Student Alliance"), null);
  assert.equal(campusOf("Secular Legal Society at Wake Forest University School of Law"), null);
  const html =
    '<div title="Secular Student Alliance at Fordham University" aria-label="Secular Student Alliance at Fordham University" role="button" style="x"><img alt="" src="https://maps.gstatic.com/mapfiles/transparent.png"/></div>' +
    '<div title="Move down" aria-label="Move down" role="button"><span></span></div>';
  assert.deepEqual(entriesFrom(html), [{ campus: "Fordham University", name: "Secular Student Alliance at Fordham University" }]);
});

test("policy checks (tier A): page, date, quote; a 'no' or a conduct restriction needs the second model's check", () => {
  const ok = { key: "inclusive_housing", value: "yes", url: "https://x.edu/housing", checked: "2026-10-04", quote: "Gender-inclusive housing is available." } as const;
  assert.deepEqual(policyCheckProblems(ok), []);
  assert.match(policyCheckProblems({ ...ok, value: "no" }).join(), /verified_by/);
  assert.deepEqual(policyCheckProblems({ ...ok, value: "no", verified_by: "claude-sonnet-5" }), []);
  assert.match(policyCheckProblems({ ...ok, key: "conduct_restriction" }).join(), /verified_by/);
  assert.match(policyCheckProblems({ ...ok, quote: null }).join(), /quote/);
  assert.match(policyCheckProblems({ ...ok, url: "http://x.edu" }).join(), /https/);
});
