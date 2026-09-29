/**
 * Housing and policies (specs/data-expansion/housing-and-policies.md): the IPEDS code rules, beds per 100 undergrads,
 * the Explore filters, and the stored values in data/schools.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { applicationFeeFrom, housingFrom, promiseProgramFrom, tuitionPlansFrom } from "../lib/derive.ts";
import { HOUSING_FILTERS, bedsPer100 } from "../lib/housing.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));

test("housing follows the COST1_2024 dictionary codes", () => {
  assert.deepEqual(housingFrom({ ROOM: "1", ROOMCAP: "6009", ALLONCAM: "1", BOARD: "1", MEALSWK: "21" }), {
    offered: true, capacity: 6009, first_years_required: true, meal_plan: true, meals_per_week: 21,
  });
  assert.deepEqual(housingFrom({ ROOM: "2", ROOMCAP: "", ALLONCAM: "-2", BOARD: "3", MEALSWK: "" }), {
    offered: false, capacity: null, first_years_required: null, meal_plan: false, meals_per_week: null,
  });
  assert.equal(housingFrom({ ROOM: "1", BOARD: "2", MEALSWK: "19" })!.meals_per_week, null, "meals vary: no count");
  assert.equal(housingFrom({ ROOM: "1", BOARD: "1", MEALSWK: "99" })!.meals_per_week, null, "99 isn't a count");
  assert.equal(housingFrom({ ROOM: "-1" }), null, "unreported housing is null");
  assert.equal(housingFrom(undefined), null);
});

test("fees, tuition plans, and Promise read their codes; unreported is null", () => {
  assert.equal(applicationFeeFrom({ APPLFEEU: "0" }), 0, "0 means no fee");
  assert.equal(applicationFeeFrom({ APPLFEEU: "85" }), 85);
  assert.equal(applicationFeeFrom({ APPLFEEU: "-1" }), null);
  assert.deepEqual(tuitionPlansFrom({ TUITPL: "2" }), []);
  assert.deepEqual(tuitionPlansFrom({ TUITPL: "1", TUITPL1: "1", TUITPL2: "0", TUITPL3: "1", TUITPL4: "0" }), ["guarantee", "payment_plan"]);
  assert.equal(tuitionPlansFrom({ TUITPL: "-1" }), null);
  assert.equal(promiseProgramFrom({ PRMPGM: "1" }), true);
  assert.equal(promiseProgramFrom({ PRMPGM: "2" }), false);
  assert.equal(promiseProgramFrom({}), null);
});

test("beds per 100 undergrads, and the Explore filters", () => {
  const s = (cap: number | null, ug: number) => ({ campus: { housing: { capacity: cap } }, demographics: { undergrad_enrollment: ug } }) as unknown as School;
  assert.equal(bedsPer100(s(600, 1000)), 60);
  assert.equal(bedsPer100(s(null, 1000)), null);
  const f = parseFilters({ liveOn: "1", noFee: "1", guarantee: "1" });
  assert.deepEqual([f.liveOn, f.noFee, f.guarantee], [true, true, true]);
  assert.equal(countActiveFilters({ liveOn: "1", noFee: "1", guarantee: "1" }), 3);
  const counts = Object.fromEntries(HOUSING_FILTERS.map((h) => [h.param, schools.filter(h.test).length]));
  assert.ok(counts.liveOn > 20 && counts.liveOn < 200, `strict live-on rule is rare (${counts.liveOn})`);
  assert.ok(counts.noFee > 300, `many colleges charge no fee (${counts.noFee})`);
});

test("Vanderbilt matches its IC2023 row", () => {
  const vu = schools.find((s) => s.unit_id === "221999")!;
  assert.deepEqual(vu.campus?.housing, { offered: true, capacity: 6009, first_years_required: true, meal_plan: true, meals_per_week: 21 });
  assert.equal(vu.admissions.application_fee, 50);
  assert.equal(vu.cost?.promise_program, false);
});

test("stored housing is consistent", () => {
  const bad: string[] = [];
  for (const s of schools) {
    const h = s.campus?.housing;
    if (!h) continue;
    if (!h.offered && (h.capacity !== null || h.first_years_required !== null)) bad.push(`${s.unit_id} no housing but capacity or rule`);
    if (h.meals_per_week !== null && (h.meals_per_week < 1 || h.meals_per_week > 28 || !h.meal_plan)) bad.push(`${s.unit_id} meals`);
    if (s.admissions.application_fee != null && s.admissions.application_fee < 0) bad.push(`${s.unit_id} fee`);
  }
  assert.deepEqual(bad, []);
});
