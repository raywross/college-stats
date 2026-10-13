/**
 * lib/chances/activity-catalog.ts and data/reference/{sports,clubs,activity-roles}.json
 * (specs/chances/inputs-beyond-academics.md, depth.md "What the student enters", Wave 4 U12): the loader's lookups,
 * the search ranking, the title → role mapping, and `validateActivityCatalogs`'s checks — including proving it fails
 * when a file is broken, since `scripts/check-activity-catalogs.mts` runs this in `npm run verify`. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPORTS,
  CLUBS,
  SPORTS_FILE,
  CLUBS_FILE,
  ACTIVITY_ROLES,
  activityByKey,
  searchActivities,
  titlesFor,
  roleForTitle,
  validateActivityCatalog,
  validateActivityRoles,
  validateActivityCatalogs,
  type CatalogActivity,
} from "../lib/chances/activity-catalog.ts";

test("the real catalogs are sound: no problems, counts in range, every key unique", () => {
  const problems = validateActivityCatalogs(SPORTS_FILE, CLUBS_FILE, ACTIVITY_ROLES);
  assert.deepEqual(problems, []);
  assert.ok(SPORTS.length >= 40, `expected about 50-70 sports, got ${SPORTS.length}`);
  assert.ok(CLUBS.length >= 100, `expected about 120-180 clubs, got ${CLUBS.length}`);
  const keys = new Set([...SPORTS, ...CLUBS].map((a) => a.key));
  assert.equal(keys.size, SPORTS.length + CLUBS.length, "every key is unique across both catalogs");
  for (const a of [...SPORTS, ...CLUBS]) {
    if (a.org !== null) assert.match(a.source_url ?? "", /^https:\/\//, `${a.key}: source_url should be https when org is set`);
    else assert.equal(a.source_url, null, `${a.key}: source_url should be null when org is null`);
  }
});

test("activityByKey: found in either catalog, null for an unknown key", () => {
  assert.equal(activityByKey(SPORTS[0].key)?.name, SPORTS[0].name);
  assert.equal(activityByKey(CLUBS[0].key)?.name, CLUBS[0].name);
  assert.equal(activityByKey("not_a_real_key"), null);
  assert.equal(activityByKey(null), null);
  assert.equal(activityByKey(undefined), null);
});

test("searchActivities: alias/name prefix ranked ahead of substring, \"work\" and \"other\" have no catalog", () => {
  const deca = searchActivities("club", "DE");
  assert.ok(deca.some((a) => a.key === "deca"), '"DE" should find DECA by name-prefix');
  assert.equal(deca[0].key, "deca", "DECA (name-prefix) should outrank a mere substring match");

  const xc = searchActivities("sport", "xc");
  assert.ok(xc.some((a) => a.key === "cross_country"), '"xc" should find Cross Country by alias-prefix');

  assert.deepEqual(searchActivities("work", "manager"), []);
  assert.deepEqual(searchActivities("other", "anything"), []);
  assert.deepEqual(searchActivities("sport", ""), [], "an empty query matches nothing");
  assert.deepEqual(searchActivities("sport", "   "), [], "a whitespace-only query matches nothing");
});

test("searchActivities respects limit and only searches its own catalog", () => {
  const limited = searchActivities("club", "club", 3);
  assert.ok(limited.length <= 3);
  // A sport-only key should never turn up from a "club" search.
  const sportKeys = new Set(SPORTS.map((s) => s.key));
  for (const r of searchActivities("club", "a", 100)) assert.ok(!sportKeys.has(r.key));
});

test("titlesFor / roleForTitle: every ActivityKind has titles, each mapping to a known role; unmapped title defaults to member", () => {
  for (const kind of ["sport", "club", "arts", "service", "work", "research", "family", "other"] as const) {
    const titles = titlesFor(kind);
    assert.ok(titles.length > 0, `kind ${kind} should have at least one title`);
  }
  assert.equal(roleForTitle("sport", "Captain"), "leader");
  assert.equal(roleForTitle("sport", "Varsity"), "member");
  assert.equal(roleForTitle("club", "President"), "leader");
  assert.equal(roleForTitle("club", "Secretary"), "officer");
  assert.equal(roleForTitle("work", "Manager"), "leader");
  assert.equal(roleForTitle("arts", "Principal or first chair"), "leader");
  assert.equal(roleForTitle("sport", "Not a real title"), "member", "an unmapped title defaults to member");
});

const GOOD_SPORT: CatalogActivity = { key: "cross_country", name: "Cross Country", aliases: ["XC"], kind: "sport", family: "athletics", org: "NFHS", source_url: "https://www.nfhs.org" };
const GOOD_CLUB: CatalogActivity = { key: "deca", name: "DECA", aliases: [], kind: "club", family: "business", org: "DECA Inc.", source_url: "https://www.deca.org" };

test("validateActivityCatalog: proves the check fails when a file is broken — not an object, a duplicate key, a bad kind, a bad family, a mismatched org/source_url pair, a non-https source, an invalid retrieved date", () => {
  assert.deepEqual(validateActivityCatalog(null, "sports.json", ["sport"], "sports"), ['sports.json: "sports" must be an array']);
  assert.deepEqual(validateActivityCatalog({ sports: "nope" }, "sports.json", ["sport"], "sports"), ['sports.json: "sports" must be an array']);

  const GOOD_FILE = { retrieved: "2026-10-12", editorial: "Reviewed.", sports: [GOOD_SPORT] };

  const dup = validateActivityCatalog({ ...GOOD_FILE, sports: [GOOD_SPORT, GOOD_SPORT] }, "sports.json", ["sport"], "sports");
  assert.ok(dup.some((p) => p.includes("key listed twice")));

  const badKind = validateActivityCatalog({ ...GOOD_FILE, sports: [{ ...GOOD_SPORT, kind: "club" }] }, "sports.json", ["sport"], "sports");
  assert.ok(badKind.some((p) => p.includes("kind must be one of")));

  const badFamily = validateActivityCatalog({ ...GOOD_FILE, sports: [{ ...GOOD_SPORT, family: "not_a_family" }] }, "sports.json", ["sport"], "sports");
  assert.ok(badFamily.some((p) => p.includes("family isn't a known ActivityFamily")));

  const mismatchedOrg = validateActivityCatalog({ ...GOOD_FILE, sports: [{ ...GOOD_SPORT, org: null, source_url: "https://x.example" }] }, "sports.json", ["sport"], "sports");
  assert.ok(mismatchedOrg.some((p) => p.includes("org and source_url must both be set or both be null")));

  const badUrl = validateActivityCatalog({ ...GOOD_FILE, sports: [{ ...GOOD_SPORT, source_url: "http://insecure.example" }] }, "sports.json", ["sport"], "sports");
  assert.ok(badUrl.some((p) => p.includes("source_url must be an https url or null")));

  const badDate = validateActivityCatalog({ ...GOOD_FILE, retrieved: "Oct 2026" }, "sports.json", ["sport"], "sports");
  assert.ok(badDate.some((p) => p.includes("retrieved must be yyyy-mm-dd")));

  const noEditorial = validateActivityCatalog({ ...GOOD_FILE, editorial: "" }, "sports.json", ["sport"], "sports");
  assert.ok(noEditorial.some((p) => p.includes('"editorial" must say')));

  assert.deepEqual(validateActivityCatalog({ retrieved: "2026-10-12", editorial: "Reviewed.", clubs: [GOOD_CLUB] }, "clubs.json", ["club"], "clubs"), []);
});

test("validateActivityRoles: proves the check fails when a kind is missing or a role is invalid", () => {
  const ALL_KINDS = ["sport", "club", "arts", "service", "work", "research", "family", "other"] as const;
  const GOOD_ROLES = { retrieved: "2026-10-12", editorial: "Reviewed.", roles: ALL_KINDS.map((kind) => ({ kind, title: "Member", role: "member" as const })) };

  assert.deepEqual(validateActivityRoles(GOOD_ROLES), []);
  assert.deepEqual(validateActivityRoles(null), ['activity-roles.json: "roles" must be an array']);

  const missingKind = { ...GOOD_ROLES, roles: GOOD_ROLES.roles.filter((r) => r.kind !== "work") };
  const missing = validateActivityRoles(missingKind);
  assert.ok(missing.some((p) => p.includes('no titles for kind "work"')));

  const badRole = { ...GOOD_ROLES, roles: [{ kind: "sport", title: "Captain", role: "manager" }, ...GOOD_ROLES.roles.slice(1)] };
  const bad = validateActivityRoles(badRole);
  assert.ok(bad.some((p) => p.includes("role must be member, officer, or leader")));

  const dupPair = { ...GOOD_ROLES, roles: [GOOD_ROLES.roles[0], GOOD_ROLES.roles[0], ...GOOD_ROLES.roles.slice(1)] };
  const dup = validateActivityRoles(dupPair);
  assert.ok(dup.some((p) => p.includes("listed twice")));
});
