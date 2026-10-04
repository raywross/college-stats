/**
 * Official links (specs/school-identity/links.md, implementation steps 1 and 3): normalizing the IPEDS directory's
 * messy URL columns, the website's HD-beats-Scorecard rule, and `applyLinks`'s idempotence. `npm test`. The visit
 * probe and liveness check (step 2) are the `probe` track's; see tests/site-probe.test.mts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { applyLinks, linkHost, normalizeUrl, urlsDiffer, websiteMismatch } from "../lib/links.ts";
import { parseCsv } from "../scripts/lib/ipeds.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const UGA = structuredClone(byId.get("139959")!);

/** Runs applyLinks and hands back the same (mutated) school, for a chained before/after read. */
function apply(school: School, hdRow?: Record<string, string>): School {
  applyLinks(school, hdRow);
  return school;
}

/* ------------------------------------------------------------------ */
/* normalizeUrl                                                        */
/* ------------------------------------------------------------------ */

test("normalizeUrl adds a scheme to a bare domain or scheme-less path", () => {
  assert.equal(normalizeUrl("www.uah.edu/admissions"), "https://www.uah.edu/admissions");
  assert.equal(normalizeUrl("uah.edu"), "https://uah.edu");
  assert.equal(normalizeUrl("HTTP://www.uah.edu"), "HTTP://www.uah.edu", "an existing scheme, any case, is left alone");
});

test("normalizeUrl encodes a literal space in the path", () => {
  assert.equal(
    normalizeUrl("tcc.ruffalonl.com/Alabama State University/Freshman-Students"),
    "https://tcc.ruffalonl.com/Alabama%20State%20University/Freshman-Students"
  );
});

test("normalizeUrl drops trailing sentence punctuation pasted in with the link", () => {
  assert.equal(normalizeUrl("https://www.example.edu/apply."), "https://www.example.edu/apply");
  assert.equal(normalizeUrl("example.edu/veterans,"), "https://example.edu/veterans");
  assert.equal(normalizeUrl("example.edu/aid;"), "https://example.edu/aid");
  assert.equal(normalizeUrl("example.edu/visit/"), "https://example.edu/visit/", "a real trailing slash is kept");
});

test("normalizeUrl treats blanks and IPEDS missing codes as null, never as empty data", () => {
  assert.equal(normalizeUrl(""), null);
  assert.equal(normalizeUrl("   "), null);
  assert.equal(normalizeUrl("-1"), null);
  assert.equal(normalizeUrl("-2"), null);
  assert.equal(normalizeUrl("-3"), null);
  assert.equal(normalizeUrl(undefined), null);
  assert.equal(normalizeUrl(null), null);
  assert.equal(normalizeUrl(42), null);
});

test("normalizeUrl is pure and rejects what still isn't a URL even with a scheme added", () => {
  assert.equal(normalizeUrl("https://"), null, "a scheme with no host");
  assert.equal(normalizeUrl("["), null);
});

test("linkHost drops a leading www.", () => {
  assert.equal(linkHost("https://www.uga.edu/apply"), "uga.edu");
  assert.equal(linkHost("https://osfa.uga.edu/npc"), "osfa.uga.edu");
});

/* ------------------------------------------------------------------ */
/* HD vs. Scorecard                                                    */
/* ------------------------------------------------------------------ */

test("urlsDiffer ignores scheme, www., and a trailing slash", () => {
  assert.equal(urlsDiffer("https://www.uga.edu", "http://uga.edu/"), false);
  assert.equal(urlsDiffer("https://uga.edu", "https://uga.edu/admissions"), true, "a real difference past the host");
  assert.equal(urlsDiffer("https://uga.edu", null), true);
  assert.equal(urlsDiffer(null, null), false);
});

test("websiteMismatch warns only on a real difference, and only when HD has a homepage", () => {
  assert.equal(websiteMismatch({ unit_id: "1", name: "A" }, "https://www.a.edu/", "https://a.edu"), null, "scheme/www/slash only");
  assert.equal(websiteMismatch({ unit_id: "1", name: "A" }, null, "https://a.edu"), null, "no HD value: nothing to warn about");
  const warning = websiteMismatch({ unit_id: "1", name: "A" }, "https://a.edu", "https://b.edu");
  assert.match(warning!, /^A \(1\): HD https:\/\/a\.edu, Scorecard https:\/\/b\.edu$/);
  assert.match(websiteMismatch({ unit_id: "1", name: "A" }, "https://a.edu", null)!, /Scorecard \(none\)$/);
});

test("applyLinks always uses HD's homepage when present, even over a differing Scorecard value", () => {
  const school = structuredClone(UGA);
  school.links = { website: "https://scorecard-value.edu", price_calculator: null };
  apply(school, { WEBADDR: "www.uga.edu" });
  assert.equal(school.links.website, "https://www.uga.edu");
  assert.equal(school.lineage?.["links.website"], undefined, "HD is links.website's default source now: no lineage override");
});

test("applyLinks falls back to Scorecard's homepage, cited, when HD has none", () => {
  const school = structuredClone(UGA);
  school.links = { website: "https://scorecard-value.edu", price_calculator: null };
  apply(school, { WEBADDR: "" });
  assert.equal(school.links.website, "https://scorecard-value.edu", "Scorecard's value, from toSchool, stays");
  assert.deepEqual(school.lineage?.["links.website"], { source: "scorecard" });
});

test("applyLinks leaves a website null when neither HD nor Scorecard has one", () => {
  const school = structuredClone(UGA);
  school.links = { website: null, price_calculator: null };
  apply(school, { WEBADDR: "" });
  assert.equal(school.links.website, null);
  assert.equal(school.lineage?.["links.website"], undefined, "nothing to cite a fallback to");
});

/* ------------------------------------------------------------------ */
/* price_calculator: Scorecard stays the default, HD only fills a gap  */
/* ------------------------------------------------------------------ */

test("applyLinks fills price_calculator from NPRICURL only when Scorecard has none", () => {
  const withScorecard = structuredClone(UGA);
  withScorecard.links = { website: null, price_calculator: "https://scorecard-npc.edu" };
  apply(withScorecard, { NPRICURL: "hd-npc.edu" });
  assert.equal(withScorecard.links.price_calculator, "https://scorecard-npc.edu", "Scorecard's own value wins");
  assert.equal(withScorecard.lineage?.["links.price_calculator"], undefined);

  const withoutScorecard = structuredClone(UGA);
  withoutScorecard.links = { website: null, price_calculator: null };
  apply(withoutScorecard, { NPRICURL: "hd-npc.edu" });
  assert.equal(withoutScorecard.links.price_calculator, "https://hd-npc.edu");
  assert.deepEqual(withoutScorecard.lineage?.["links.price_calculator"], { source: "ipeds-hd" });
});

/* ------------------------------------------------------------------ */
/* HD-only links: null when blank                                      */
/* ------------------------------------------------------------------ */

test("applyLinks sets admissions, apply, financial_aid, veterans, disability_services from HD, null when blank", () => {
  const school = structuredClone(UGA);
  const filled = apply(structuredClone(school), {
    ADMINURL: "admissions.uga.edu",
    APPLURL: "admissions.uga.edu/apply",
    FAIDURL: "osfa.uga.edu",
    VETURL: "veterans.uga.edu",
    DISAURL: "drc.uga.edu",
  });
  assert.equal(filled.links?.admissions, "https://admissions.uga.edu");
  assert.equal(filled.links?.apply, "https://admissions.uga.edu/apply");
  assert.equal(filled.links?.financial_aid, "https://osfa.uga.edu");
  assert.equal(filled.links?.veterans, "https://veterans.uga.edu");
  assert.equal(filled.links?.disability_services, "https://drc.uga.edu");
  // None of these carry a lineage record: HD is their one and only (registered) source.
  for (const path of ["links.admissions", "links.apply", "links.financial_aid", "links.veterans", "links.disability_services"] as const) {
    assert.equal(filled.lineage?.[path], undefined, path);
  }

  const blank = apply(structuredClone(school), { ADMINURL: "", APPLURL: "", FAIDURL: "", VETURL: "", DISAURL: "" });
  assert.equal(blank.links?.admissions, null);
  assert.equal(blank.links?.apply, null);
  assert.equal(blank.links?.financial_aid, null);
  assert.equal(blank.links?.veterans, null);
  assert.equal(blank.links?.disability_services, null);
});

/* ------------------------------------------------------------------ */
/* Idempotence and the no-row path                                     */
/* ------------------------------------------------------------------ */

test("applyLinks leaves the school's links and lineage unchanged without an hdRow (merge-identity)", () => {
  const before = structuredClone(UGA);
  const after = structuredClone(UGA);
  applyLinks(after);
  assert.deepEqual(after, before);
});

test("applyLinks is idempotent: applying twice with the same row matches applying once", () => {
  const hdRow = { WEBADDR: "www.uga.edu", ADMINURL: "admissions.uga.edu", APPLURL: "", FAIDURL: "osfa.uga.edu", NPRICURL: "osfa.uga.edu/npc", VETURL: "", DISAURL: "drc.uga.edu" };
  const fresh = structuredClone(UGA);
  fresh.links = { website: "https://scorecard-value.edu", price_calculator: null };
  const once = apply(structuredClone(fresh), hdRow);
  const twice = apply(structuredClone(once), hdRow);
  assert.deepEqual(twice, once);
});

test("applyLinks stays idempotent even when HD's homepage goes blank on a later pass", () => {
  // First pass: HD fills the website. Second pass (simulating a re-apply): HD now has none, so the applier must
  // fall back — but by now school.links.website is the HD value from pass one, not Scorecard's; the lineage this
  // applier set (or didn't) on pass one is what makes the fallback decision correct on pass two as well.
  const school = structuredClone(UGA);
  school.links = { website: "https://scorecard-value.edu", price_calculator: null };
  apply(school, { WEBADDR: "www.uga.edu" });
  assert.equal(school.links.website, "https://www.uga.edu");
  apply(school, { WEBADDR: "" });
  // Without a current HD value, applyLinks only ever keeps what's already there; it never knows pass one's value
  // was HD's rather than Scorecard's, so it (correctly, since this is exactly what "else Scorecard" means once HD's
  // own value is gone) cites it as Scorecard's from here on.
  assert.equal(school.links.website, "https://www.uga.edu");
  assert.deepEqual(school.lineage?.["links.website"], { source: "scorecard" });
});

/* ------------------------------------------------------------------ */
/* The fixture HD file: sync-data's own reader, no network              */
/* ------------------------------------------------------------------ */

/** UGA's record with `links`/`lineage` reset to a controlled, Scorecard-only baseline, so the fixture rows below
 * exercise the parser and normalizeUrl deterministically, independent of whatever the live dataset currently holds. */
function freshSchool(scorecardWebsite: string | null = "https://scorecard-placeholder.edu"): School {
  const school = structuredClone(UGA);
  school.links = { website: scorecardWebsite, price_calculator: null };
  school.lineage = {};
  return school;
}

test("the fixture HD file parses with its BOM stripped and the real messy values normalize", () => {
  const rows = parseCsv(readFileSync(join(ROOT, "tests/fixtures/identity/hd-links.csv"), "utf8"));
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => "UNITID" in r), "the BOM didn't swallow the first column's name");

  const byUnitId = new Map(rows.map((r) => [r.UNITID, r]));

  const clean = apply(freshSchool(), byUnitId.get("139959"));
  assert.deepEqual(clean.links, {
    website: "https://www.uga.edu",
    price_calculator: "https://osfa.uga.edu/net-price-calculator",
    admissions: "https://www.admissions.uga.edu",
    apply: "https://www.admissions.uga.edu/apply",
    financial_aid: "https://osfa.uga.edu",
    veterans: "https://veterans.uga.edu",
    disability_services: "https://drc.uga.edu",
  });
  assert.deepEqual(clean.lineage?.["links.price_calculator"], { source: "ipeds-hd" }, "Scorecard's price_calculator was null on this fixture school");
  assert.equal(clean.lineage?.["links.website"], undefined, "HD had a homepage, so no fallback citation");

  // Blank homepage, a space in the path, a scheme plus trailing punctuation, "-2", a quoted trailing comma, a bare domain.
  const messy = apply(freshSchool(), byUnitId.get("100001"));
  assert.equal(messy.links?.website, "https://scorecard-placeholder.edu", "blank WEBADDR: the Scorecard placeholder stays");
  assert.deepEqual(messy.lineage?.["links.website"], { source: "scorecard" });
  assert.equal(messy.links?.admissions, "https://tcc.ruffalonl.com/Alabama%20State%20University/Freshman-Students");
  assert.equal(messy.links?.apply, "https://www.example.edu/apply");
  assert.equal(messy.links?.financial_aid, null, "-2 is IPEDS's missing code");
  assert.equal(messy.links?.veterans, "https://example.edu/veterans");
  assert.equal(messy.links?.disability_services, "https://example.edu");

  // A bare-domain homepage, and a bare-domain net price calculator filling the gap Scorecard left on this fixture school.
  const bareDomains = apply(freshSchool(), byUnitId.get("100002"));
  assert.equal(bareDomains.links?.website, "https://howard.edu");
  assert.equal(bareDomains.links?.price_calculator, "https://howard.edu/npc");
  assert.deepEqual(bareDomains.lineage?.["links.price_calculator"], { source: "ipeds-hd" });
});
