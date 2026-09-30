/**
 * Admission factors and policy events (specs/data-expansion/admission-factors.md): code mapping, the event rules, the
 * Explore filters, the legacy Home fact, and the stored values. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { SchoolHistory, TrendFacts } from "../lib/history.ts";
import { FACTOR_CODE, factorCode, factorUse, factorsFrom } from "../lib/derive.ts";
import { historyEvents } from "../lib/events.ts";
import { FACTOR_FILTERS } from "../lib/factors.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));

test("factor codes: 1 required, 5 considered, 3 not considered; 2 kept only as a code; 4, 9, negatives dropped", () => {
  assert.deepEqual(["1", "2", "3", "5", "4", "9", "-1", "", undefined].map(factorCode), [1, 2, 3, 5, null, null, null, null, null]);
  assert.deepEqual([1, 5, 3, 2, null].map(factorUse), ["required", "considered", "not_considered", null, null]);
  for (const [use, code] of Object.entries(FACTOR_CODE)) assert.equal(factorUse(code), use, "round trip");
  // Vanderbilt's ADM2024 row (ADMCON1–12 = 1 5 1 1 1 3 5 1 3 5 1 5).
  const row = Object.fromEntries("151113513515".split("").map((c, i) => [`ADMCON${i + 1}`, c]));
  assert.deepEqual(factorsFrom(row), {
    gpa: "required", class_rank: "considered", hs_record: "required", college_prep: "required", recommendations: "required",
    competencies: "not_considered", english_test: "required", other_test: "not_considered", work_experience: "considered",
    essay: "required", legacy: "considered",
  });
  assert.equal(factorsFrom({ ADMCON1: "-2" }), null);
});

const shard = (series: SchoolHistory["series"]): SchoolHistory => ({ unit_id: "1", series });
const texts = (h: SchoolHistory) => historyEvents(h).map((e) => `${e.year} ${e.text}`);

test("events: required ↔ not required in any era; considered ↔ not considered only from fall 2022", () => {
  // 2010: required → neither (3); 2015: neither → recommended (2) is not an event before 2022.
  assert.deepEqual(texts(shard({ factor_gpa: { start: 2009, values: [1, 3, 3, 3, 3, 3, 2] } })), ["2010 Stopped requiring high school GPA"]);
  // From 2022: considered → not considered is an event.
  assert.deepEqual(texts(shard({ factor_legacy: { start: 2022, values: [5, 5, 3] } })), ["2024 Stopped considering legacy status"]);
  assert.deepEqual(texts(shard({ factor_essay: { start: 2022, values: [1, 5, 5] } })), ["2023 Stopped requiring an essay (still considered)"]);
});

test("events: the fall 2022 re-coding and quick reversals are not events", () => {
  // Recommended (2) in 2021 → required in 2022 is the form redesign, not a decision.
  assert.deepEqual(texts(shard({ factor_recommendations: { start: 2020, values: [2, 2, 1, 1] } })), []);
  // Stopped in 2023, started again in 2024 (within two years): both dropped.
  assert.deepEqual(texts(shard({ factor_legacy: { start: 2022, values: [5, 3, 5] } })), []);
  // Reversed after three years: both kept.
  assert.equal(texts(shard({ factor_legacy: { start: 2022, values: [5, 3, 3, 3, 5] } })).length, 2);
});

test("policy events read 1 yes / 2 no, and each lands in its profile area", () => {
  const ev = historyEvents(shard({ live_on: { start: 2016, values: [2, 2, 1, 1] }, promise: { start: 2022, values: [2, 1] } }));
  assert.deepEqual(ev.map((e) => [e.year, e.text, e.area, e.kind]), [
    [2023, "Joined a Promise program", "cost", "academic"],
    [2018, "Began requiring first-years to live on campus", "campus", "academic"],
  ]);
});

test("Explore factor filters parse and count", () => {
  const f = parseFilters({ noLegacy: "1", noEssay: "1", gpaRequired: "1" });
  assert.deepEqual([f.noLegacy, f.noEssay, f.gpaRequired], [true, true, true]);
  assert.equal(countActiveFilters({ noLegacy: "1", noEssay: "1", gpaRequired: "1" }), 3);
  const counts = Object.fromEntries(FACTOR_FILTERS.map((x) => [x.param, schools.filter(x.test).length]));
  assert.equal(counts.noLegacy, schools.filter((s) => s.admissions.factors?.legacy === "not_considered").length);
  assert.ok(counts.gpaRequired > 1000 && counts.noLegacy > 1000 && counts.noEssay > 500, JSON.stringify(counts));
});

test("the legacy Home fact adds up", () => {
  const facts: TrendFacts = JSON.parse(readFileSync(join(ROOT, "data", "history", "facts.json"), "utf8"));
  const lg = facts.legacy!;
  assert.ok(lg, "facts.json has the legacy fact");
  assert.equal(lg.consideredTo, lg.consideredFrom - lg.stopped + lg.started, "stopped and started explain the change");
  assert.equal(lg.byYear.length, lg.to - lg.from + 1);
  assert.equal(lg.from, 2022);
});

test("stored factors: none required for legacy, and Vanderbilt matches its ADM2024 row", () => {
  assert.equal(schools.filter((s) => s.admissions.factors?.legacy === "required").length, 0, "no college requires legacy status");
  const vu = schools.find((s) => s.unit_id === "221999")!;
  assert.equal(vu.admissions.factors?.legacy, "considered");
  assert.equal(vu.admissions.factors?.gpa, "required");
});
