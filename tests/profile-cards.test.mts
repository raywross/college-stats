/**
 * The overview's topic cards (lib/profile-cards.ts): titles and footers for every topic, the campus chips, the
 * middle income band, and the ten-year lines. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_FOOTERS, CARD_TITLES, MIDDLE_INCOME_BAND, admissionsTitle, campusChips, diversityValues, middleBand, sinceLabel, tenYear, type TenYearFiles } from "../lib/profile-cards.ts";
import { TOPIC_KEYS } from "../lib/profile-topics.ts";
import type { SchoolHistory } from "../lib/history.ts";
import type { School } from "../lib/types";

test("every topic has a footer link text, and every topic but admissions a fixed title", () => {
  for (const k of TOPIC_KEYS) assert.ok(CARD_FOOTERS[k].length > 0, k);
  assert.deepEqual(Object.keys(CARD_TITLES).sort(), TOPIC_KEYS.filter((k) => k !== "admissions").sort());
  assert.equal(admissionsTitle("1 in 27"), "1 in 27 applicants admitted");
  assert.equal(admissionsTitle("6 in 10"), "6 in 10 applicants admitted");
  assert.equal(admissionsTitle(null), "Getting in");
});

test("campus chips: setting, the live-on rule, athletics, and programs, each naming the field it reads", () => {
  const campus: School["campus"] = {
    setting: { locale: 12, label: "City: Midsize", group: "city" },
    housing: { offered: true, capacity: 7000, first_years_required: true, meal_plan: true, meals_per_week: 21 },
    athletics: { associations: ["ncaa"], division: "I-FCS", conference: { code: 1, name: "Ivy Group" }, football_conference: null, sports: ["football"] },
    programs: { rotc: ["army"], study_abroad: true, undergrad_research: true, intellectual_disability_program: false },
  };
  assert.deepEqual(
    campusChips({ campus }).map((c) => [c.label, c.field]),
    [
      ["Midsize city", "campus.setting"],
      ["First-years live on campus", "campus.housing"],
      ["NCAA D-I FCS · Ivy Group", "campus.athletics"],
      ["ROTC", "campus.programs"],
      ["Study abroad", "campus.programs"],
      ["Undergrad research", "campus.programs"],
    ]
  );
  // Nothing reported, nothing claimed: a college that doesn't answer gets no chips, and an unticked box isn't "no".
  assert.deepEqual(campusChips({ campus: undefined }), []);
  assert.deepEqual(
    campusChips({ campus: { housing: { offered: false, capacity: null, first_years_required: null, meal_plan: null, meals_per_week: null }, programs: { rotc: [], study_abroad: false, undergrad_research: false, intellectual_disability_program: false } } }).map((c) => c.label),
    ["No college housing"]
  );
  // NAIA without an NCAA division; a conference alone.
  assert.equal(campusChips({ campus: { athletics: { associations: ["naia"], division: null, conference: null, football_conference: null, sports: [] } } })[0].label, "NAIA");
  assert.equal(campusChips({ campus: { athletics: { associations: [], division: null, conference: { code: 2, name: "Big Ten Conference" }, football_conference: null, sports: [] } } })[0].label, "Big Ten Conference");
});

test("the cost card's third bar is the $48–75K band, and never a null read as 0", () => {
  assert.equal(MIDDLE_INCOME_BAND, 2);
  assert.equal(middleBand([8697, 2991, 2091, 9941, 53337]), 2091);
  assert.equal(middleBand([null, 29015, null, null, 33874]), null);
  assert.equal(middleBand(null), null);
});

test("since labels read in a sentence for every year kind", () => {
  assert.equal(sinceLabel(2014, "fall"), "since fall 2014");
  assert.equal(sinceLabel(2013, "academic"), "since 2013–14");
  assert.equal(sinceLabel(2014, "cohort"), "since the class that entered fall 2014");
});

const files = {
  meta: { latest: { fall: 2024, academic: 2023, cohort: 2017 } },
  // The CPI table's citation fields aren't read here.
  cpi: { start: 2013, values: [233, 237, 237, 240, 245, 251, 256, 259, 271, 293, 305, 314] },
} as unknown as TenYearFiles;

test("a ten-year line: the change in words and the window's values for the sparkline", () => {
  const history: SchoolHistory = {
    unit_id: "1",
    series: {
      applicants: { start: 2014, values: [34295, 39041, 39506, 42749, 43330, 43330, 57435, 61220, 56937, 54008, 54008] },
      acceptance_rate: { start: 2014, values: [0.0596, 0.054, 0.052, 0.05, 0.046, 0.047, 0.04, 0.032, 0.034, 0.036, 0.037] },
      avg_paid_all: { start: 2013, values: [46122, 46500, 47000, 47500, 48000, 48200, 48300, 48300, 48300, 48312, 48312] },
    },
  };
  const apps = tenYear("applicants", history, files)!;
  assert.equal(apps.text, "+57% since fall 2014");
  assert.equal(apps.fromTo, "34.3K → 54K");
  assert.equal(apps.start, 2014);
  assert.equal(apps.values.length, 11);
  assert.equal(apps.values[0], 34295);
  // Shares read "from → to"; money is compared after inflation (the sparkline is in end-year dollars).
  assert.equal(tenYear("acceptance_rate", history, files)!.text, "6.0% → 3.7% since fall 2014");
  const cost = tenYear("avg_paid_all", history, files)!;
  assert.match(cost.text, /^−\d+% after inflation since 2013–14$/);
  assert.ok(cost.values[0]! > 46122, "the first value is in end-year dollars");
  assert.equal(cost.values[10], 48312);
  // No series, no line.
  assert.equal(tenYear("undergrads", history, files), null);
  assert.equal(diversityValues(history, files), null);
});
