/**
 * Wikidata sync (specs/school-identity/social-accounts.md, Checks): fixture SPARQL JSON through the real join and
 * validation path, the handle-shape and duplicate-handle rules, the disagreement check against the homepage footer,
 * the profile URL per network, and the 1,500-match guard. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type SparqlResults,
  assertEnoughMatches,
  buildAccounts,
  buildWikidataEntries,
  logoFileFromCommonsUrl,
  pickWebsite,
  rawItemsFromResults,
  resolveUnitIdDuplicates,
  sameHost,
} from "../scripts/lib/wikidata.mts";
import type { SiteProbeEntry } from "../lib/identity-files";
import { collapseCaseInsensitiveDuplicates, handleFromUrl, normalizeHandle, socialUrl } from "../lib/social.ts";

/** A fixture SPARQL JSON result shaped like the real endpoint's: one row per (item, unitId), one "values" column. */
function sparql(rows: { item: string; unitId: string; value?: string }[]): SparqlResults {
  return {
    head: { vars: ["item", "unitId", "values"] },
    results: {
      bindings: rows.map((r) => ({
        item: { type: "uri", value: `http://www.wikidata.org/entity/${r.item}` },
        unitId: { type: "literal", value: r.unitId },
        ...(r.value !== undefined ? { values: { type: "literal", value: r.value } } : {}),
      })),
    },
  };
}

const probe = (unitId: string, social: SiteProbeEntry["social"], homepage = "https://www.example.edu/"): SiteProbeEntry => ({
  unit_id: unitId,
  retrieved: "2026-10-04",
  homepage: { url: homepage, final_url: homepage, status: 200 },
  admissions: null,
  visit: null,
  virtual_tour: null,
  social,
  icons: [],
});

/* ------------------------------------------------------------------ */
/* Duplicate resolution: two Wikidata items share one unit id          */
/* ------------------------------------------------------------------ */

test("duplicate resolution picks the item whose website matches the college's own homepage", () => {
  const results = {
    website: sparql([
      { item: "Q1", unitId: "999", value: "https://www.the-system.edu" },
      { item: "Q2", unitId: "999", value: "https://www.the-college.edu" },
    ]),
    statements: sparql([
      { item: "Q1", unitId: "999", value: "40" },
      { item: "Q2", unitId: "999", value: "12" },
    ]),
  };
  const items = rawItemsFromResults(results);
  assert.equal(items.length, 2);
  // Q1 has far more statements, but Q2's website is the one that matches the college's real homepage.
  const { kept, dropped } = resolveUnitIdDuplicates(items, "https://the-college.edu/admissions");
  assert.equal(kept.qid, "Q2");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].qid, "Q1");
});

test("without a website match, duplicate resolution falls back to the item with more statements", () => {
  const items = rawItemsFromResults({
    website: sparql([
      { item: "Q1", unitId: "999", value: "https://www.other-site.org" },
      { item: "Q2", unitId: "999" },
    ]),
    statements: sparql([
      { item: "Q1", unitId: "999", value: "12" },
      { item: "Q2", unitId: "999", value: "40" },
    ]),
  });
  const { kept } = resolveUnitIdDuplicates(items, "https://the-college.edu");
  assert.equal(kept.qid, "Q2");
});

test("sameHost and pickWebsite ignore scheme and a leading www.", () => {
  assert.ok(sameHost("http://www.uga.edu/", "https://uga.edu"));
  assert.ok(!sameHost("https://uga.edu", "https://gatech.edu"));
  assert.equal(pickWebsite(["https://a.edu", "https://b.edu"], "https://www.b.edu/"), "https://b.edu");
  assert.equal(pickWebsite(["https://a.edu", "https://b.edu"], null), "https://a.edu");
});

test("buildWikidataEntries skips a Wikidata item whose unit id isn't one of the dataset's colleges", () => {
  const items = rawItemsFromResults({ website: sparql([{ item: "Q1", unitId: "not-in-dataset" }]) });
  const { entries } = buildWikidataEntries(items, new Map([["999", null]]), new Map(), "2026-10-04");
  assert.deepEqual(entries, []);
});

/* ------------------------------------------------------------------ */
/* Handle validation: shape, case-only duplicates, ambiguity           */
/* ------------------------------------------------------------------ */

test("validation drops a handle with a space and keeps a numeric Facebook id", () => {
  const { accounts, issues } = buildAccounts({ facebook: ["bad id", "123456789"] });
  assert.equal(accounts.facebook, "123456789");
  assert.ok(issues.some((i) => i.network === "facebook" && i.reason.includes('"bad id"')));
});

test("Facebook also keeps the older Name-With-Hyphens-numericid page slug", () => {
  const { accounts, issues } = buildAccounts({ facebook: ["Grand-View-University-315068091675"] });
  assert.equal(accounts.facebook, "Grand-View-University-315068091675");
  assert.equal(issues.length, 0);
});

test("case-only duplicates collapse to one handle", () => {
  assert.deepEqual(collapseCaseInsensitiveDuplicates(["georgiatech", "GeorgiaTech"]), ["georgiatech"]);
  // No exact-lowercase candidate: alphabetically first, so the choice is still deterministic.
  assert.deepEqual(collapseCaseInsensitiveDuplicates(["GeorgiaTech", "GEORGIATECH"]), ["GEORGIATECH"]);
  const { accounts, issues } = buildAccounts({ x: ["georgiatech", "GeorgiaTech"] });
  assert.equal(accounts.x, "georgiatech");
  assert.equal(issues.length, 0);
});

test("two genuinely different handles for one network, with no preferred rank, are kept as ambiguous (neither wins)", () => {
  const { accounts, issues } = buildAccounts({ x: ["UGAAdmissions", "universityofga"] });
  assert.equal(accounts.x, undefined);
  assert.ok(issues.some((i) => i.network === "x" && i.reason.startsWith("ambiguous")));
});

test("an X handle over 15 characters is dropped (the real limit), even though it looks plausible", () => {
  const { accounts, issues } = buildAccounts({ x: ["moravianuniversity"] });
  assert.equal(accounts.x, undefined);
  assert.ok(issues.some((i) => i.reason.includes("moravianuniversity")));
});

test("a bare LinkedIn value carrying the 'school/' prefix (not a full URL) still resolves to its slug", () => {
  assert.equal(normalizeHandle("linkedin", "school/full-sail-university/"), "full-sail-university");
});

test("a YouTube value given as a full channel URL extracts the channel id; a vanity /@handle URL doesn't resolve", () => {
  const id = "UC1234567890123456789012";
  assert.equal(normalizeHandle("youtube", `https://www.youtube.com/channel/${id}`), id);
  const { accounts } = buildAccounts({ youtube: ["https://www.youtube.com/@CollegeName"] });
  assert.equal(accounts.youtube, undefined);
});

test("logoFileFromCommonsUrl decodes the Commons FilePath URL back to a plain file name", () => {
  assert.equal(logoFileFromCommonsUrl("http://commons.wikimedia.org/wiki/Special:FilePath/Rsu%20university%20wmark.png"), "Rsu university wmark.png");
  assert.equal(logoFileFromCommonsUrl("not-a-commons-url"), null);
});

/* ------------------------------------------------------------------ */
/* Disagreement with the homepage footer (data/site-probe.json)        */
/* ------------------------------------------------------------------ */

test("a Wikidata handle that disagrees with the homepage footer's own link goes to the issues file", () => {
  const items = rawItemsFromResults({
    x: sparql([{ item: "Q1", unitId: "999", value: "universityofga" }]),
  });
  const probeByUnitId = new Map([["999", probe("999", { x: "https://x.com/UGAAdmissions" })]]);
  const { entries, issues } = buildWikidataEntries(items, new Map([["999", null]]), probeByUnitId, "2026-10-04");
  assert.equal(entries[0].accounts.x, "universityofga"); // Wikidata still wins the stored value
  assert.ok(issues.some((i) => i.unit_id === "999" && i.network === "x" && i.reason.includes("UGAAdmissions")));
});

test("no disagreement is logged when the homepage footer agrees with Wikidata, or links to nothing for that network", () => {
  const items = rawItemsFromResults({ x: sparql([{ item: "Q1", unitId: "999", value: "universityofga" }]) });
  const agrees = new Map([["999", probe("999", { x: "https://x.com/UniversityOfGA" })]]); // case-only difference
  const { issues: noIssues } = buildWikidataEntries(items, new Map([["999", null]]), agrees, "2026-10-04");
  assert.equal(noIssues.length, 0);

  const nothingToCompare = new Map([["999", probe("999", {})]]);
  const { issues: noIssues2 } = buildWikidataEntries(items, new Map([["999", null]]), nothingToCompare, "2026-10-04");
  assert.equal(noIssues2.length, 0);
});

/* ------------------------------------------------------------------ */
/* The profile URL per network (lib/social.ts)                         */
/* ------------------------------------------------------------------ */

test("socialUrl builds each network's real profile URL from a stored handle", () => {
  assert.equal(socialUrl("instagram", "universityofga"), "https://www.instagram.com/universityofga");
  assert.equal(socialUrl("youtube", "UC123"), "https://www.youtube.com/channel/UC123");
  assert.equal(socialUrl("tiktok", "vanderbiltu"), "https://www.tiktok.com/@vanderbiltu");
  assert.equal(socialUrl("x", "UofAlabama"), "https://x.com/UofAlabama");
  assert.equal(socialUrl("facebook", "uga.edu"), "https://www.facebook.com/uga.edu");
  assert.equal(socialUrl("linkedin", "vanderbilt-university"), "https://www.linkedin.com/school/vanderbilt-university");
});

test("handleFromUrl rejects a URL on the wrong network's domain", () => {
  assert.equal(handleFromUrl("instagram", "https://facebook.com/UGA"), null);
  assert.equal(handleFromUrl("x", "https://x.com/UGA"), "UGA");
  assert.equal(handleFromUrl("x", "https://twitter.com/UGA"), "UGA");
});

/* ------------------------------------------------------------------ */
/* The 1,500-match guard                                               */
/* ------------------------------------------------------------------ */

test("the 1,500-match guard fails below the threshold and passes at or above it", () => {
  assert.throws(() => assertEnoughMatches(1499), /matched only 1499/);
  assert.doesNotThrow(() => assertEnoughMatches(1500));
});

test("the guard is load-bearing: a run that matched only 3 colleges throws instead of writing anything", () => {
  const items = rawItemsFromResults({ website: sparql([{ item: "Q1", unitId: "1" }, { item: "Q2", unitId: "2" }, { item: "Q3", unitId: "3" }]) });
  const homepages = new Map([["1", null], ["2", null], ["3", null]] as const);
  const { entries } = buildWikidataEntries(items, homepages, new Map(), "2026-10-04");
  assert.equal(entries.length, 3);
  assert.throws(() => assertEnoughMatches(entries.length), /matched only 3/);
});
