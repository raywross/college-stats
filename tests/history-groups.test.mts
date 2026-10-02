/**
 * The profile's "Over time" group switcher (lib/history-groups.ts): `?group=` parsing, which groups a college gets,
 * and the fallback when the URL names a group the college has no data for. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_HISTORY_GROUP,
  HISTORY_GROUP_KEYS,
  HISTORY_GROUP_LABELS,
  availableHistoryGroups,
  isHistoryGroup,
  parseHistoryGroup,
  pickHistoryGroup,
} from "../lib/history-groups.ts";
import type { SchoolHistory } from "../lib/history.ts";

const s = (start = 2014) => ({ start, values: [1, 2, 3] });
const series = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, s()])) as SchoolHistory["series"];

test("group keys: display order, labels, and the default", () => {
  assert.deepEqual([...HISTORY_GROUP_KEYS], ["cost", "aid", "admissions", "scores", "students", "academics", "outcomes", "changes"]);
  assert.deepEqual(
    HISTORY_GROUP_KEYS.map((k) => HISTORY_GROUP_LABELS[k]),
    ["Cost", "Aid", "Admissions", "Test scores", "Students", "Academics", "Outcomes", "Policy changes"]
  );
  assert.equal(DEFAULT_HISTORY_GROUP, "cost");
});

test("isHistoryGroup / parseHistoryGroup accept only known keys", () => {
  for (const k of HISTORY_GROUP_KEYS) assert.ok(isHistoryGroup(k));
  for (const bad of ["", "Cost", "test-scores", "toString", "constructor", null, undefined, 3]) assert.equal(isHistoryGroup(bad), false);
  assert.equal(parseHistoryGroup("outcomes"), "outcomes");
  assert.equal(parseHistoryGroup(["scores", "aid"]), "scores", "a repeated param uses the first value");
  assert.equal(parseHistoryGroup(["nope", "aid"]), null);
  assert.equal(parseHistoryGroup("OUTCOMES"), null);
  assert.equal(parseHistoryGroup(null), null);
  assert.equal(parseHistoryGroup(undefined), null);
  assert.equal(parseHistoryGroup([]), null);
});

test("availableHistoryGroups lists only groups with data, in order", () => {
  const all = series(
    "avg_paid_all",
    "grant_pct",
    "applicants",
    "sat_25",
    "sat_75",
    "undergrads",
    "student_faculty_ratio",
    "grad_rate"
  );
  assert.deepEqual(availableHistoryGroups(all, 2), [...HISTORY_GROUP_KEYS]);
  assert.deepEqual(availableHistoryGroups(all, 0), HISTORY_GROUP_KEYS.filter((k) => k !== "changes"), "Policy changes need a change");

  // A college with cost and admissions history but no scores, students, academics, or outcomes series.
  assert.deepEqual(availableHistoryGroups(series("full_price", "acceptance_rate"), 0), ["cost", "admissions"]);
  // Scores need the 25th percentile (the range's low end); a 75th alone draws nothing.
  assert.deepEqual(availableHistoryGroups(series("sat_75", "act_75", "grant_avg"), 0), ["aid"]);
  assert.deepEqual(availableHistoryGroups(series("act_25"), 0), ["scores"]);
  // Any one series is enough for the groups whose panels each render on their own.
  assert.deepEqual(availableHistoryGroups(series("net_price_income_3"), 0), ["cost"]);
  assert.deepEqual(availableHistoryGroups(series("transfer_in_share"), 0), ["students"]);
  assert.deepEqual(availableHistoryGroups(series("instruction_per_student"), 0), ["academics"]);
  assert.deepEqual(availableHistoryGroups(series("om_award"), 0), ["outcomes"]);
  assert.deepEqual(availableHistoryGroups(series("federal_loan_rate"), 0), ["aid"]);
  // Nothing charts (e.g. only policy codes): fall back to Cost rather than an empty switcher.
  assert.deepEqual(availableHistoryGroups(series("test_policy"), 0), ["cost"]);
  assert.deepEqual(availableHistoryGroups(series("test_policy"), 1), ["changes"]);
});

test("pickHistoryGroup honors the URL only for a group the college has", () => {
  const groups = availableHistoryGroups(series("avg_paid_all", "applicants", "grad_rate"), 0);
  assert.equal(pickHistoryGroup("outcomes", groups), "outcomes");
  assert.equal(pickHistoryGroup("scores", groups), "cost", "no scores history: first available group");
  assert.equal(pickHistoryGroup(null, groups), "cost");
  assert.equal(pickHistoryGroup(undefined, ["admissions", "outcomes"]), "admissions");
  assert.equal(pickHistoryGroup("cost", []), "cost");
});

test("OverTime renders one group at a time and has no phone collapse", () => {
  const src = readFileSync(new URL("../components/history/OverTime.tsx", import.meta.url), "utf8");
  // Every group is gated on the active key, so the others aren't in the HTML at all.
  for (const k of HISTORY_GROUP_KEYS) assert.match(src, new RegExp(`\\{active === "${k}" && \\(`), `group ${k} renders only when selected`);
  assert.doesNotMatch(src, /onToggle|aria-expanded|ChevronDown/, "the accordion is gone");
  assert.match(src, /initialGroup\?: HistoryGroupKey/);
});
