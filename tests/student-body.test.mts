/**
 * Student body (specs/data-expansion/student-body.md): the gender-balance buckets, the "mostly full-time" rule, the
 * Explore URL parameters, and the stored shares in data/schools.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { FULL_TIME_MAX_PART_TIME, GENDER_BALANCE, genderBalanceOf, isMostlyFullTime } from "../lib/student-body.ts";
import { FILTER_KEYS, countActiveFilters, parseFilters } from "../lib/params.ts";

const ROOT = join(import.meta.dirname, "..");
const withShares = (men: number | null, partTime: number | null = null) =>
  ({ demographics: { men_share: men, part_time_share: partTime } }) as unknown as School;

test("gender-balance buckets cover every share exactly once, splitting at 40% and 60% men", () => {
  for (let i = 0; i <= 1000; i++) {
    const m = i / 1000;
    assert.equal(GENDER_BALANCE.filter((b) => b.test(m)).length, 1, `men share ${m}`);
  }
  assert.equal(genderBalanceOf(withShares(0.3999)), "women");
  assert.equal(genderBalanceOf(withShares(0.4)), "balanced");
  assert.equal(genderBalanceOf(withShares(0.6)), "balanced");
  assert.equal(genderBalanceOf(withShares(0.6001)), "men");
  assert.equal(genderBalanceOf(withShares(null)), null, "not reported is never a bucket");
});

test("mostly full-time means at most 10% part-time, and never when part-time isn't reported", () => {
  assert.equal(FULL_TIME_MAX_PART_TIME, 0.1);
  assert.equal(isMostlyFullTime(withShares(0.5, 0.1)), true);
  assert.equal(isMostlyFullTime(withShares(0.5, 0.1001)), false);
  assert.equal(isMostlyFullTime(withShares(0.5, null)), false);
});

test("Explore parses the student-body filters and counts them as active", () => {
  const f = parseFilters({ balance: "women,bogus,women,men", fullTime: "1" });
  assert.deepEqual(f.balance, ["women", "men"], "unknown buckets dropped, duplicates removed");
  assert.equal(f.fullTime, true);
  assert.equal(parseFilters({ fullTime: "0" }).fullTime, undefined);
  assert.equal(parseFilters({ balance: "bogus" }).balance, undefined);
  assert.ok(FILTER_KEYS.includes("balance") && FILTER_KEYS.includes("fullTime"));
  assert.equal(countActiveFilters({ balance: "women", fullTime: "1" }), 2);
});

test("stored shares are fractions, and men and women add to 100%", () => {
  const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
  const bad: string[] = [];
  for (const s of schools) {
    const d = s.demographics;
    for (const [k, v] of Object.entries({ men: d.men_share, women: d.women_share, partTime: d.part_time_share, adults: d.age_25_plus_share })) {
      if (v != null && (v < 0 || v > 1)) bad.push(`${s.unit_id} ${k} ${v}`);
    }
    if (d.men_share != null && d.women_share != null && Math.abs(d.men_share + d.women_share - 1) > 0.001) bad.push(`${s.unit_id} men+women ${d.men_share + d.women_share}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(schools.filter((s) => s.demographics.men_share != null).length > schools.length * 0.95, "men's share for nearly every college");
});
