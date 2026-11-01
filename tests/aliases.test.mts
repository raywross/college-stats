/**
 * Short names and nicknames (lib/aliases.ts; specs/school-identity/aliases.md): splitting, normalizing, dropping,
 * weighting and deduping, the scorer search and Explore share, and the invariant the alias table must hold. Real
 * colleges, aliases and the curated list come from the mini fixture (tests/helpers/snapshot.mts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { School } from "../lib/types";
import { miniAliases, miniReference, miniSchools } from "./helpers/snapshot.mts";
import {
  aliasKey,
  aliasTableProblems,
  buildAliasRow,
  compareMatches,
  dedupeAliases,
  domainLabel,
  scoreSchool,
  shouldDropAlias,
  splitAliasField,
  type AliasRow,
  type CuratedAliasEntry,
} from "../lib/aliases.ts";

const schools: School[] = miniSchools();
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const byName = (name: string) => {
  const s = schools.find((x) => x.name === name);
  if (!s) throw new Error(`fixture school not found: ${name}`);
  return s;
};

/* ------------------------------------------------------------------ */
/* 1. Split                                                            */
/* ------------------------------------------------------------------ */

test("splits the real messy IPEDS IALIAS values (specs/school-identity/aliases.md)", () => {
  assert.deepEqual(splitAliasField("AAMU"), ["AAMU"]);
  assert.deepEqual(splitAliasField("AUM||Auburn University at Montgomery||Auburn Montgomery"), [
    "AUM",
    "Auburn University at Montgomery",
    "Auburn Montgomery",
  ]);
  assert.deepEqual(splitAliasField("The University of Arizona | UArizona | U of A | UofA | UA"), [
    "The University of Arizona",
    "UArizona",
    "U of A",
    "UofA",
    "UA",
  ]);
});

test("also splits on comma, semicolon, and runs of two or more bare spaces, but not a single space", () => {
  assert.deepEqual(splitAliasField("Foo, Bar; Baz"), ["Foo", "Bar", "Baz"]);
  assert.deepEqual(splitAliasField("AAMU  Alabama A&M"), ["AAMU", "Alabama A&M"]);
  assert.deepEqual(splitAliasField("Auburn University at Montgomery"), ["Auburn University at Montgomery"], "a single space inside a name is not a delimiter");
  assert.deepEqual(splitAliasField("A / B"), ["A", "B"], "space-slash-space splits");
  assert.deepEqual(splitAliasField("A/B"), ["A/B"], "a bare slash without spaces does not");
});

test("splitAliasField handles empty and missing input", () => {
  assert.deepEqual(splitAliasField(""), []);
  assert.deepEqual(splitAliasField(null), []);
  assert.deepEqual(splitAliasField(undefined), []);
  assert.deepEqual(splitAliasField("   "), []);
});

/* ------------------------------------------------------------------ */
/* 2. Normalize                                                        */
/* ------------------------------------------------------------------ */

test("aliasKey normalizes to a search key: lower case, accents stripped, punctuation and spaces removed", () => {
  assert.equal(aliasKey("U of A"), "uofa");
  assert.equal(aliasKey("A.U."), "au");
  assert.equal(aliasKey("UT-Austin"), "utaustin");
  assert.equal(aliasKey("UGA"), "uga");
  assert.equal(aliasKey("Café"), "cafe", "accents are stripped");
  assert.equal(aliasKey("Ole Miss"), "olemiss");
});

/* ------------------------------------------------------------------ */
/* 3. Drop                                                              */
/* ------------------------------------------------------------------ */

test("drops Unull, null, and a bare dash (case-insensitively)", () => {
  const name = "University of Georgia";
  assert.equal(shouldDropAlias("Unull", name), true);
  assert.equal(shouldDropAlias("unull", name), true);
  assert.equal(shouldDropAlias("null", name), true);
  assert.equal(shouldDropAlias("-", name), true);
  assert.equal(shouldDropAlias("NULL", name), true);
});

test("guard: a real alias is not dropped by the Unull/null/- rule", () => {
  assert.equal(shouldDropAlias("UGA", "University of Georgia"), false, "break: if this rule swallowed real aliases too, UGA would never be stored");
});

test("drops a bare domain", () => {
  assert.equal(shouldDropAlias("uga.edu", "University of Georgia"), true);
  assert.equal(shouldDropAlias("www.vanderbilt.edu", "Vanderbilt University"), true);
  assert.equal(shouldDropAlias("gatech.edu", "Georgia Institute of Technology-Main Campus"), true);
});

test("drops a single character and a stop word", () => {
  assert.equal(shouldDropAlias("A", "University of Georgia"), true);
  assert.equal(shouldDropAlias("University", "University of Georgia"), true);
  assert.equal(shouldDropAlias("The", "University of Georgia"), true);
  assert.equal(shouldDropAlias("State", "Arizona State University"), true);
});

test("drops an alias equal to the official name's key", () => {
  assert.equal(shouldDropAlias("University of Georgia", "University of Georgia"), true);
  assert.equal(shouldDropAlias("UNIVERSITY-OF-GEORGIA", "University of Georgia"), true, "the equality check uses the compressed key, so punctuation/case don't matter");
});

test("drops a plain substring of the official name, at the word level", () => {
  assert.equal(shouldDropAlias("Georgia", "University of Georgia"), true);
  assert.equal(shouldDropAlias("vanderbilt", "Vanderbilt University"), true);
  assert.equal(shouldDropAlias("Miami", "University of Miami"), true);
  assert.equal(shouldDropAlias("Miami", "Miami University-Oxford"), true);
});

test("guard: the substring rule checks whole words, not raw characters — Cal and Pitt survive", () => {
  // "Cal" is a fragment of the single word "California" (no word boundary right after it), not a whole word of the
  // name; same for "Pitt" inside "Pittsburgh". If the check were a plain character-substring test instead, both of
  // these curated aliases — explicitly required by the spec — would be wrongly dropped.
  assert.equal(shouldDropAlias("Cal", "University of California-Berkeley"), false);
  assert.equal(shouldDropAlias("Pitt", "University of Pittsburgh-Pittsburgh Campus"), false);
  // Sanity check that the rule isn't simply disabled: a genuine whole-word substring is still dropped.
  assert.equal(shouldDropAlias("California", "University of California-Berkeley"), true);
});

test("a curated alias may repeat a word of the college's name; every other drop rule still applies to it", () => {
  assert.equal(shouldDropAlias("Miami", "University of Miami", { curated: true }), false);
  assert.equal(shouldDropAlias("Miami", "Miami University-Oxford", { curated: true }), false);
  assert.equal(shouldDropAlias("University of Miami", "University of Miami", { curated: true }), true, "equal to the name");
  assert.equal(shouldDropAlias("miami.edu", "University of Miami", { curated: true }), true, "a bare domain");
  assert.equal(shouldDropAlias("M", "University of Miami", { curated: true }), true, "one character");
});

test('"miami" ranks the University of Miami first: both Miamis are curated, so applicants break the tie', () => {
  const curated = miniReference<CuratedAliasEntry[]>("aliases-curated");
  const florida = byName("University of Miami");
  const ohio = byName("Miami University-Oxford");
  const rowsFor = (s: School) =>
    curated.filter((c) => c.unit_id === s.unit_id && aliasKey(c.alias) === "miami").map((c) => buildAliasRow(c.unit_id, c.alias, "curated", c.weight));
  assert.equal(rowsFor(florida).length, 1, 'the curated aliases must give the University of Miami "Miami"');
  const ranked = [ohio, florida]
    .map((s) => ({ school: s, match: scoreSchool(s, "miami", rowsFor(s))! }))
    .sort(compareMatches);
  assert.equal(ranked[0].school.unit_id, florida.unit_id);
  // Without the curated rows, the name-prefix tier puts Ohio first: the reason the curated exception exists.
  const bare = [florida, ohio].map((s) => ({ school: s, match: scoreSchool(s, "miami", [])! })).sort(compareMatches);
  assert.equal(bare[0].school.unit_id, ohio.unit_id);
});

test("drops an alias over 60 characters", () => {
  assert.equal(shouldDropAlias("A".repeat(61), "University of Georgia"), true);
  assert.equal(shouldDropAlias("A".repeat(60), "University of Georgia"), false);
});

/* ------------------------------------------------------------------ */
/* 4. Weight, build, and dedupe                                        */
/* ------------------------------------------------------------------ */

test("buildAliasRow computes the key and defaults to the source's weight", () => {
  assert.deepEqual(buildAliasRow("139959", "UGA", "curated"), { unit_id: "139959", alias: "UGA", key: "uga", source: "curated", weight: 4 });
  assert.equal(buildAliasRow("1", "x", "ipeds").weight, 3);
  assert.equal(buildAliasRow("1", "x", "wikidata").weight, 2);
  assert.equal(buildAliasRow("1", "x", "domain").weight, 2);
  assert.equal(buildAliasRow("1", "x", "curated", 5).weight, 5, "a curated entry may override the default weight (USC)");
});

test("dedupeAliases keeps one row per (unit_id, key): the highest weight, ties to the higher-priority source", () => {
  const rows: AliasRow[] = [
    buildAliasRow("1", "uga", "domain"), // weight 2
    buildAliasRow("1", "UGA", "wikidata"), // weight 2, tie -> wikidata outranks domain
    buildAliasRow("1", "UGA", "curated"), // weight 4, wins outright
  ];
  const out = dedupeAliases(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "curated");
  assert.equal(out[0].weight, 4);
});

test("guard: dedupeAliases actually collapses — without it, three rows would stay three rows", () => {
  const rows: AliasRow[] = [buildAliasRow("1", "uga", "domain"), buildAliasRow("1", "UGA", "wikidata")];
  assert.equal(rows.length, 2, "break: the undeduped input has two rows for the same (unit_id, key)");
  assert.equal(dedupeAliases(rows).length, 1);
});

test("dedupeAliases sorts the result by (unit_id, key)", () => {
  const rows = [buildAliasRow("2", "b", "curated"), buildAliasRow("1", "b", "curated"), buildAliasRow("1", "a", "curated")];
  assert.deepEqual(
    dedupeAliases(rows).map((r) => `${r.unit_id}:${r.key}`),
    ["1:a", "1:b", "2:b"]
  );
});

test("domainLabel strips a leading www/web subdomain and the TLD", () => {
  assert.equal(domainLabel("https://uga.edu"), "uga");
  assert.equal(domainLabel("https://www.vanderbilt.edu/"), "vanderbilt");
  assert.equal(domainLabel("https://admissions.harvard.edu"), "harvard", "an unrecognized subdomain still gives the label before the TLD");
  assert.equal(domainLabel(null), null);
  assert.equal(domainLabel(undefined), null);
  assert.equal(domainLabel("not a url"), null);
  assert.equal(domainLabel("https://www.edu"), null, "a generic leftover label is skipped");
});

/* ------------------------------------------------------------------ */
/* 5. Search: the scorer searchSchools and Explore's q filter share     */
/* ------------------------------------------------------------------ */

test('"UGA" finds the University of Georgia (the question the spec answers)', () => {
  const uga = byId.get("139959")!; // University of Georgia (verified by name against the dataset)
  assert.equal(uga.name, "University of Georgia");
  assert.equal(scoreSchool(uga, "UGA", []), null, "without an alias, the official name doesn't contain \"UGA\" at all");
  const m = scoreSchool(uga, "UGA", [buildAliasRow(uga.unit_id, "UGA", "wikidata")]);
  assert.ok(m);
  assert.equal(m!.matched, "UGA");
  assert.equal(m!.score, 5 + 2);
});

test('"UA" lists Alabama A&M first among four colleges that share the alias, ties broken by applicants', () => {
  // The mini fixture's four Alabama colleges, each given the same alias (the real data's five "ASU"s aren't in it).
  const names = [
    "University of Alabama at Birmingham",
    "Alabama State University",
    "University of Alabama in Huntsville",
    "Alabama A & M University",
  ];
  const candidates = names.map(byName);
  const results = candidates
    .map((s) => ({ s, m: scoreSchool(s, "UA", [buildAliasRow(s.unit_id, "UA", "wikidata")]) }))
    .filter((x): x is { s: School; m: NonNullable<typeof x.m> } => x.m !== null)
    .sort((a, b) => compareMatches({ match: a.m, school: a.s }, { match: b.m, school: b.s }));
  assert.equal(results.length, 4, "all four colleges match");
  assert.equal(results[0].s.name, "Alabama A & M University", "Alabama A&M has the most applicants of the four");
  assert.deepEqual(
    results.map((r) => r.m.score),
    results.map(() => results[0].m.score),
    "every college scores the same (alias-exact, same weight); only applicants break the tie"
  );
});

test('"vand" finds Vanderbilt — here the plain name-prefix tier (score 3) already beats the alias-prefix tier (2.7), since "Vanderbilt" happens to start with "vand" too', () => {
  const vandy = byName("Vanderbilt University");
  const m = scoreSchool(vandy, "vand", [buildAliasRow(vandy.unit_id, "Vandy", "wikidata")]);
  assert.ok(m);
  assert.equal(m!.score, 3);
});

test('an alias-prefix match (not coinciding with the name) does carry the matched label: "gate" -> "GATech"', () => {
  const gt = byName("Georgia Institute of Technology-Main Campus");
  const m = scoreSchool(gt, "gate", [buildAliasRow(gt.unit_id, "GATech", "wikidata")]);
  assert.ok(m);
  assert.equal(m!.matched, "GATech");
  assert.equal(m!.score, 2.5 + 2 / 10);
});

test('"Georgia Tech" matches only once its alias exists — the official name does not contain that phrase', () => {
  const gt = byName("Georgia Institute of Technology-Main Campus");
  assert.equal(scoreSchool(gt, "Georgia Tech", []), null);
  const m = scoreSchool(gt, "Georgia Tech", [buildAliasRow(gt.unit_id, "Georgia Tech", "curated")]);
  assert.ok(m);
  assert.equal(m!.matched, "Georgia Tech");
  assert.equal(m!.score, 5 + 4);
});

test('"usc" ranks Southern California ahead of South Carolina, because the curated file weighs it higher', () => {
  // The mini fixture lacks Penn and Penn State (the real data's example); USC is the curated file's other shared
  // alias that decides a ranking, and both colleges are in it.
  const curated = miniReference<CuratedAliasEntry[]>("aliases-curated");
  const socal = byName("University of Southern California");
  const carolina = byName("University of South Carolina-Columbia");
  const entryFor = (s: School) => curated.find((c) => c.unit_id === s.unit_id && c.alias.toLowerCase() === "usc");
  assert.ok(entryFor(socal), 'the curated aliases must map "USC" to the University of Southern California');
  assert.ok(entryFor(carolina), 'the curated aliases also give South Carolina "USC"');
  const match = (s: School) => scoreSchool(s, "usc", [buildAliasRow(s.unit_id, entryFor(s)!.alias, "curated", entryFor(s)!.weight)]);
  const socalMatch = match(socal);
  const carolinaMatch = match(carolina);
  assert.ok(socalMatch && carolinaMatch);
  assert.ok(socalMatch!.score > carolinaMatch!.score, "the curated weight, not applicants, puts Southern California first");
});

test("the matched label is the alias' display form, not the normalized key, for both the exact and prefix tiers", () => {
  const gt = byName("Georgia Institute of Technology-Main Campus");
  assert.equal(scoreSchool(gt, "gatech", [buildAliasRow(gt.unit_id, "GATech", "wikidata")])!.matched, "GATech");
  assert.equal(scoreSchool(gt, "gate", [buildAliasRow(gt.unit_id, "GATech", "wikidata")])!.matched, "GATech");
});

test("a plain name/city/state match carries no matched label", () => {
  const uga = byId.get("139959")!;
  const m = scoreSchool(uga, "Athens", []); // the city
  assert.ok(m);
  assert.equal(m!.matched, undefined);
});

test("no match returns null", () => {
  const uga = byId.get("139959")!;
  assert.equal(scoreSchool(uga, "zzzznotreal", []), null);
  assert.equal(scoreSchool(uga, "", []), null);
  assert.equal(scoreSchool(uga, "   ", []), null);
});

test("guard: an alias-prefix match requires at least 2 query characters", () => {
  // A synthetic fixture whose name/city/state do not start with "x", so only the alias-prefix tier could possibly
  // fire here — isolating the length check from the plain name tiers (a real school's name can coincidentally
  // start with the same single letter as its alias, which would mask this guard).
  const fixture = { name: "Lincoln College", location: { city: "Springfield", state: "IL" }, admissions: { applicants: 1 } };
  const alias = buildAliasRow("1", "Xavier Thing", "wikidata");
  assert.equal(scoreSchool(fixture, "x", [alias]), null, "break: dropping the length >= 2 guard would alias-prefix-match a single letter against everything");
  assert.equal(scoreSchool(fixture, "xa", [alias])!.matched, "Xavier Thing", "two characters is enough");
});

/* ------------------------------------------------------------------ */
/* 6. File invariant: the alias table (aliases.json)                   */
/* ------------------------------------------------------------------ */

test("the alias table has one row per (unit_id, key), and every unit_id exists in the dataset", () => {
  const aliases: AliasRow[] = miniAliases();
  const schoolIds = new Set(schools.map((s) => s.unit_id));
  assert.deepEqual(aliasTableProblems(aliases, schoolIds), []);
  assert.ok(aliases.length > schools.length, "expected several rows per college from IPEDS, Wikidata, domain, and curated sources");
});

test("guard: aliasTableProblems catches a duplicate (unit_id, key)", () => {
  const rows = [buildAliasRow("1", "UGA", "curated"), { ...buildAliasRow("1", "uga!!", "wikidata"), key: "uga" }];
  const problems = aliasTableProblems(rows, new Set(["1"]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /duplicate/);
});

test("guard: aliasTableProblems catches a unit_id missing from schools.json", () => {
  const rows = [buildAliasRow("999999999", "Ghost", "curated")];
  const problems = aliasTableProblems(rows, new Set(["1"]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /999999999/);
});
