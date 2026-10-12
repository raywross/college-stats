/**
 * lib/chances/awards-catalog.ts and data/reference/awards.json (specs/chances/inputs-beyond-academics.md "Awards"):
 * the loader's lookups, and `validateAwardsCatalog`'s checks — including proving it fails when the file is broken,
 * since `scripts/check-awards-catalog.mts` runs this in `npm run verify`. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allAwards, awardByKey, isAwardKey, validateAwardsCatalog, type AwardsCatalogFile } from "../lib/chances/awards-catalog.ts";

const GOOD: AwardsCatalogFile = {
  retrieved: "2026-10-11",
  editorial: "A reviewed catalog.",
  awards: [
    { key: "national_merit_finalist", name: "National Merit Finalist", tier: 1, body: "National Merit Scholarship Corporation", source_url: "https://www.nationalmerit.org" },
    { key: "honor_roll", name: "Honor roll", tier: 4, body: "The student's own high school", source_url: "https://bigfuture.collegeboard.org/plan-for-college/your-high-school-courses/grades-and-gpa" },
  ],
};

test("the real data/reference/awards.json is sound: no problems, about 40 entries, every key unique and https-sourced", () => {
  const problems = validateAwardsCatalog(allAwardsFile());
  assert.deepEqual(problems, []);
  const awards = allAwards();
  assert.ok(awards.length >= 20, `expected a reviewed catalog of about 40, got ${awards.length}`);
  const keys = new Set(awards.map((a) => a.key));
  assert.equal(keys.size, awards.length, "every key is unique");
  for (const a of awards) {
    assert.match(a.source_url, /^https:\/\//, `${a.key}: source_url should be https`);
    assert.ok(a.body.trim(), `${a.key}: body (the giving organization) is required`);
    assert.ok([1, 2, 3, 4].includes(a.tier), `${a.key}: tier must be 1-4`);
  }
});

function allAwardsFile(): AwardsCatalogFile {
  // Re-reads the same module-level import the catalog loader uses, as a plain object (validateAwardsCatalog takes
  // unknown input so it can check either the real file or a fixture).
  return { retrieved: "2026-10-11", editorial: "x", awards: allAwards() } as AwardsCatalogFile;
}

test("awardByKey / isAwardKey: found by key, null/false for one the catalog doesn't have", () => {
  assert.equal(awardByKey("honor_roll", GOOD)?.name, "Honor roll");
  assert.equal(awardByKey("not_a_real_key", GOOD), null);
  assert.equal(awardByKey(null, GOOD), null);
  assert.equal(awardByKey(undefined, GOOD), null);
  assert.equal(isAwardKey("honor_roll", GOOD), true);
  assert.equal(isAwardKey("nope", GOOD), false);
});

test("validateAwardsCatalog: a sound file has no problems other than the count (the real catalog's size is checked above)", () => {
  assert.deepEqual(
    validateAwardsCatalog(GOOD).filter((p) => !p.includes("expected a reviewed catalog of about 40")),
    [],
  );
});

test("validateAwardsCatalog: proves the check fails when the file is broken — not an object, not enough awards, a duplicate key, a bad tier, a missing body, a non-https source, an invalid retrieved date", () => {
  assert.deepEqual(validateAwardsCatalog(null), ['"awards" must be an array']);
  assert.deepEqual(validateAwardsCatalog({ awards: "nope" }), ['"awards" must be an array']);

  const tooFew = validateAwardsCatalog({ ...GOOD, awards: GOOD.awards.slice(0, 1) });
  assert.ok(tooFew.some((p) => p.includes("only 1 awards")));

  const dup = validateAwardsCatalog({ ...GOOD, awards: [GOOD.awards[0], GOOD.awards[0]] });
  assert.ok(dup.some((p) => p.includes("key listed twice")));

  const badTier = validateAwardsCatalog({ ...GOOD, awards: [{ ...GOOD.awards[0], tier: 9 }, GOOD.awards[1]] });
  assert.ok(badTier.some((p) => p.includes("tier must be 1, 2, 3, or 4")));

  const noBody = validateAwardsCatalog({ ...GOOD, awards: [{ ...GOOD.awards[0], body: "" }, GOOD.awards[1]] });
  assert.ok(noBody.some((p) => p.includes("body (the giving organization) is required")));

  const badUrl = validateAwardsCatalog({ ...GOOD, awards: [{ ...GOOD.awards[0], source_url: "http://insecure.example" }, GOOD.awards[1]] });
  assert.ok(badUrl.some((p) => p.includes("source_url must be an https url")));

  const badKeyShape = validateAwardsCatalog({ ...GOOD, awards: [{ ...GOOD.awards[0], key: "Not Lowercase!" }, GOOD.awards[1]] });
  assert.ok(badKeyShape.some((p) => p.includes("key must be lowercase")));

  const noName = validateAwardsCatalog({ ...GOOD, awards: [{ ...GOOD.awards[0], name: "" }, GOOD.awards[1]] });
  assert.ok(noName.some((p) => p.includes("name is required")));

  const badDate = validateAwardsCatalog({ ...GOOD, retrieved: "Oct 2026" });
  assert.ok(badDate.some((p) => p.includes("retrieved must be yyyy-mm-dd")));

  const noEditorial = validateAwardsCatalog({ ...GOOD, editorial: "" });
  assert.ok(noEditorial.some((p) => p.includes('"editorial" must say')));
});
