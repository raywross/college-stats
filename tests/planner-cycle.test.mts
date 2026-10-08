/**
 * The application cycle (lib/planner/cycle.ts; specs/planner/model.md "The cycle year", timeline.md "The cycle
 * file"): cycle names, lookup, the grade on a given day, the `applies` rules, and the file's schema check that
 * scripts/check-cycle.mts runs in `npm run verify`. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  APPLIES,
  applies,
  currentCycle,
  cycleFor,
  cycleKey,
  cycleKeys,
  cycleStartFromEntering,
  cycleStartOf,
  gradeOf,
  inSeason,
  loadCycle,
  validateCycleFile,
  type AppliesFacts,
  type CycleFile,
} from "../lib/planner/cycle.ts";
import { emptyProfile } from "../lib/student-profile.ts";

const ROOT = join(import.meta.dirname, "..");
const FILE = JSON.parse(readFileSync(join(ROOT, "data", "application-cycle.json"), "utf8")) as CycleFile;

test("cycle names: the class of G applies in the cycle that starts in G - 1", () => {
  assert.equal(cycleFor(2028), "2027-28");
  assert.equal(cycleFor(2100), "2099-00");
  assert.equal(cycleKey(2026), "2026-27");
  assert.equal(cycleStartOf("2027-28"), 2027);
  assert.equal(cycleStartOf("2027-29"), null, "the years must be consecutive");
  assert.equal(cycleStartOf("27-28"), null);
  assert.equal(cycleStartFromEntering("Fall 2027"), 2026, "applying for fall 2027 happens in the cycle starting 2026");
  assert.equal(cycleStartFromEntering(null), null);
  assert.equal(currentCycle("2026-07-31"), "2025-26");
  assert.equal(currentCycle("2026-08-01"), "2026-27", "a cycle starts on August 1");
});

test("loadCycle: the file's entries for a cycle, and an empty cycle for one it doesn't have yet", () => {
  const c = loadCycle("2026-27");
  assert.equal(c.startYear, 2026);
  assert.ok(c.entries.some((e) => e.key === "fafsa_opens" && e.date === "2026-10-01"));
  assert.deepEqual(loadCycle("2040-41"), { cycle: "2040-41", startYear: 2040, entries: [] });
  assert.ok(cycleKeys().includes("2026-27") && cycleKeys().includes("2027-28"));
});

test("gradeOf at the turning points of a class of 2028 student", () => {
  const g = (d: string) => gradeOf(2028, d);
  assert.equal(g("2026-07-31"), "earlier", "the summer before junior year");
  assert.equal(g("2026-10-08"), "junior_fall");
  assert.equal(g("2027-03-01"), "junior_spring");
  assert.equal(g("2027-06-15"), "summer_before_senior");
  assert.equal(g("2027-09-01"), "senior_fall");
  assert.equal(g("2028-01-10"), "senior_winter");
  assert.equal(g("2028-04-15"), "senior_spring");
  assert.equal(g("2028-07-01"), "summer_after");
  assert.equal(g("2028-09-01"), "graduated");
  assert.equal(gradeOf(null, "2026-10-08"), "unknown");
  assert.equal(inSeason("junior_fall"), true);
  assert.equal(inSeason("earlier"), false);
  assert.equal(inSeason("graduated"), false);
});

const facts = (over: Partial<AppliesFacts> = {}): AppliesFacts => ({ items: [], schools: {}, profile: null, ...over });
const item = (unit_id: string, over: Partial<AppliesFacts["items"][number]> = {}): AppliesFacts["items"][number] => ({
  unit_id,
  round: null,
  enrolling: false,
  application_platform: null,
  ...over,
});

test("applies: each rule reads the list, its colleges, or the student's numbers", () => {
  const css = { aid: { forms: { css_profile: true, noncustodial_profile: false } }, logistics: { reply: { kind: "fixed_date" } } } as unknown as AppliesFacts["schools"][string];
  const plain = { aid: null, logistics: { reply: { kind: "may1_or_weeks" } } } as unknown as AppliesFacts["schools"][string];
  const withCss = facts({ items: [item("1"), item("2")], schools: { "1": css, "2": plain } });
  assert.equal(applies({ applies: "all" }, facts()), true);
  assert.equal(applies({ applies: "has_css_college" }, withCss), true);
  assert.equal(applies({ applies: "has_css_college" }, facts({ items: [item("2")], schools: { "2": plain } })), false);
  assert.equal(applies({ applies: "noncustodial" }, withCss), false);
  assert.equal(applies({ applies: "uses_may1" }, withCss), true);
  assert.equal(applies({ applies: "uses_may1" }, facts({ items: [item("1")], schools: { "1": css } })), false);
  assert.equal(applies({ applies: "uses_may1" }, facts()), false, "no colleges, no reply date");
  assert.equal(applies({ applies: "has_ed" }, facts({ items: [item("1", { round: "ed2" })] })), true);
  assert.equal(applies({ applies: "has_ed" }, facts({ items: [item("1", { round: "ea" })] })), false);
  assert.equal(applies({ applies: "committed" }, facts({ items: [item("1", { enrolling: true })] })), true);
  assert.equal(applies({ applies: "has_common_app" }, facts({ items: [item("1", { application_platform: "uc" })] })), false);
  assert.equal(applies({ applies: "has_common_app" }, facts({ items: [item("1")] })), true, "a platform not set yet leans toward showing it");
  const profile = emptyProfile();
  assert.equal(applies({ applies: "plans_tests" }, facts({ profile })), true);
  assert.equal(applies({ applies: "plans_tests" }, facts({ profile: { ...profile, tests: { ...profile.tests, plansTestOptional: true } } })), false);
  assert.equal(applies({ applies: "international" }, facts({ profile: { ...profile, basics: { ...profile.basics, stateOfResidence: "OUTSIDE_US" } } })), true);
  assert.equal(applies({ applies: "international" }, facts({ profile })), false);
});

test("the cycle file passes its own check, and every entry's applies is in the vocabulary", () => {
  assert.deepEqual(validateCycleFile(FILE), []);
  for (const c of FILE.cycles) for (const e of c.entries) assert.ok((APPLIES as readonly string[]).includes(e.applies));
});

test("check-cycle rejects an unknown applies, a bad date, both date and window, a non-https source, and a date outside the cycle", () => {
  const entry = { key: "fafsa_opens", label: "FAFSA opens", date: "2026-10-01", applies: "all", assignee: "guardian", source: "https://studentaid.gov/" };
  const one = (e: object, cycle = "2026-27") => validateCycleFile({ cycles: [{ cycle, entries: [e] }] });
  assert.deepEqual(one(entry), []);
  assert.match(one({ ...entry, applies: "everyone" }).join("\n"), /applies 'everyone' is not one of/);
  assert.match(one({ ...entry, date: "2026-02-30" }).join("\n"), /real yyyy-mm-dd/);
  assert.match(one({ ...entry, window: ["2026-09-01", "2026-10-01"] }).join("\n"), /exactly one of date or window/);
  assert.match(one({ ...entry, date: undefined, window: ["2026-10-01", "2026-09-01"] }).join("\n"), /ends before it starts/);
  assert.match(one({ ...entry, source: "http://studentaid.gov/" }).join("\n"), /https URL/);
  assert.match(one({ ...entry, date: "2030-10-01" }).join("\n"), /outside the cycle/);
  assert.match(one({ ...entry, register_by: "2026-10-02" }).join("\n"), /on or before it/);
  assert.match(one({ ...entry, assignee: "dog" }).join("\n"), /assignee 'dog'/);
  assert.match(one({ ...entry, colour: "red" }).join("\n"), /unknown field 'colour'/);
  assert.match(one(entry, "2026-28").join("\n"), /consecutive years/);
  assert.match(validateCycleFile({ cycles: [{ cycle: "2026-27", entries: [entry, entry] }] }).join("\n"), /key listed twice/);
  assert.deepEqual(validateCycleFile([]), ["the file must be an object with a `cycles` array"]);
});

test("npm run check:cycle exits 0 on the real file", () => {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "check-cycle.mts")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok/);
});
