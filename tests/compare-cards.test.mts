/**
 * The compare overview's topic cards (lib/compare-cards.ts, specs/compare-redesign.md#overview-page): every topic has
 * its rows, title, footer, and eyebrow field; the overview cites every field a card shows; a card nobody reports is
 * hidden; the score row falls back to ACT; the score axis; and the Over time row. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACT_ROW,
  CARD_FOOTERS,
  CARD_ROWS,
  CARD_TITLES,
  NOT_REPORTED,
  SAT_ROW,
  applicationsRow,
  applicationsSince,
  cardFields,
  cardRows,
  cardYearField,
  rangeAxis,
  scoreFallback,
  type BarRow,
  type CardRow,
  type TextRow,
} from "../lib/compare-cards.ts";
import { COMPARE_OVERVIEW_FIELDS } from "../lib/compare-topics.ts";
import { TOPIC_KEYS } from "../lib/profile-topics.ts";
import { FIELDS } from "../lib/fields.ts";
import { GLOSSARY } from "../lib/glossary.ts";
import type { School } from "../lib/types";
import { ADLER, BLANK, HARVARD, OHIO_STATE, UCLA, school } from "./helpers/compare-schools.mts";

const labels = (rows: readonly CardRow[]) => rows.map((r) => r.label);

/* ---- Contract ---- */

test("every topic has its rows, a title, a footer, and a registered field for its eyebrow's year", () => {
  assert.deepEqual(Object.keys(CARD_ROWS).sort(), [...TOPIC_KEYS].sort());
  for (const k of TOPIC_KEYS) {
    assert.ok(CARD_ROWS[k].length >= 1, `${k} has no rows`);
    assert.ok(CARD_TITLES[k].length > 0, `${k} has no title`);
    assert.ok(CARD_FOOTERS[k].length > 0, `${k} has no footer`);
    assert.ok(cardYearField(k) in FIELDS, `${k}'s year field isn't registered`);
  }
  // Exactly the brief's rows, in order.
  assert.deepEqual(
    Object.fromEntries(TOPIC_KEYS.map((k) => [k, labels(CARD_ROWS[k])])),
    {
      admissions: ["Acceptance rate", "SAT middle 50%", "How they read a record"],
      students: ["Undergrads", "Pell Grant share"],
      academics: ["Students per faculty member", "Most popular major"],
      cost: ["Average cost, all students", "Aid generosity"],
      outcomes: ["Median earnings, 10 years", "Graduation rate"],
      history: ["Applications, 10-year change"],
    }
  );
  assert.deepEqual(
    Object.fromEntries(TOPIC_KEYS.map((k) => [k, cardYearField(k)])),
    {
      admissions: "admissions.acceptance_rate",
      students: "demographics.undergrad_enrollment",
      academics: "academics.student_faculty_ratio",
      cost: "cost.avg_paid_all",
      outcomes: "outcomes.median_earnings_10yr",
      history: "trends",
    }
  );
});

test("every row cites a registered field and explains its label with a glossary term", () => {
  for (const row of [...Object.values(CARD_ROWS).flat(), ACT_ROW]) {
    assert.ok(row.field in FIELDS, `${row.label}: ${row.field} isn't registered`);
    assert.ok(row.term in GLOSSARY, `${row.label}: ${row.term} isn't a glossary term`);
  }
});

test("the extremes are flagged neutrally where more isn't simply better, and shares run on a 0–100% scale", () => {
  const bars = Object.values(CARD_ROWS)
    .flat()
    .filter((r): r is BarRow => r.kind === "bar");
  assert.deepEqual(
    bars.map((r) => [r.label, r.flag?.which, r.flag?.text]),
    [
      ["Acceptance rate", "min", "Most selective"],
      ["Undergrads", "max", "Largest"],
      ["Pell Grant share", "max", "Highest"],
      ["Students per faculty member", "min", "Fewest"],
      ["Average cost, all students", "min", "Lowest"],
      ["Aid generosity", "max", "Most"],
      ["Median earnings, 10 years", "max", "Highest"],
      ["Graduation rate", "max", "Highest"],
    ]
  );
  for (const label of ["Pell Grant share", "Aid generosity", "Graduation rate"]) assert.equal(bars.find((r) => r.label === label)!.max, 1, label);
  // The figures read as the topic pages print them.
  const fmt = (label: string, s: School) => {
    const r = bars.find((b) => b.label === label)!;
    const v = r.get(s);
    return v === null ? null : r.format(v);
  };
  assert.equal(fmt("Acceptance rate", HARVARD), "4.2%");
  assert.equal(fmt("Acceptance rate", OHIO_STATE), "61%");
  assert.equal(fmt("Undergrads", OHIO_STATE), "45.6K");
  assert.equal(fmt("Students per faculty member", HARVARD), "7 to 1");
  assert.equal(fmt("Average cost, all students", HARVARD), "$48.3K");
  assert.equal(fmt("Aid generosity", HARVARD), "44%");
  assert.equal(fmt("Median earnings, 10 years", HARVARD), "$101.8K");
  // Missing is null (the row prints "Not reported"), never 0.
  for (const b of bars.filter((r) => r.label !== "Undergrads")) assert.equal(b.get(BLANK), null, b.label);
});

test("the overview cites every field a card shows", () => {
  const cited = new Set(COMPARE_OVERVIEW_FIELDS);
  for (const f of cardFields()) assert.ok(cited.has(f), `COMPARE_OVERVIEW_FIELDS lacks ${f}`);
  assert.ok(cardFields().includes("admissions.test_policy"), "the score row's Test-blind reads the test policy");
  assert.ok(cardFields().includes("derived.yield"), "the Getting in sentence names yield");
});

/* ---- Showing and hiding ---- */

test("a card no compared college has a figure for is hidden; one figure is enough to show it", () => {
  // Adler and a blank college: no admissions, scores, cost, or history; sizes, ratios, and majors, yes.
  const pair = [ADLER, BLANK];
  assert.deepEqual(labels(cardRows("admissions", pair)), []);
  assert.deepEqual(labels(cardRows("cost", pair)), []);
  assert.deepEqual(labels(cardRows("history", pair)), []);
  assert.deepEqual(labels(cardRows("outcomes", pair)), []);
  assert.deepEqual(labels(cardRows("students", pair)), ["Undergrads"], "a row no college reports drops out");
  assert.deepEqual(labels(cardRows("academics", pair)), ["Students per faculty member", "Most popular major"]);
  // One college with one figure shows the card, with every row someone reports.
  assert.deepEqual(labels(cardRows("outcomes", [ADLER, school({ id: "900002", name: "Earner College", earnings: 50000 })])), ["Median earnings, 10 years"]);
  assert.deepEqual(labels(cardRows("cost", [HARVARD, ADLER])), ["Average cost, all students", "Aid generosity"]);
});

test("the score row: SAT unless no college reports SAT and one reports ACT; kept while a college is test-blind", () => {
  assert.equal(cardRows("admissions", [HARVARD, UCLA])[1], SAT_ROW);
  const actOnly = school({ id: "900003", name: "ACT College", rate: 0.5, admitted: 500, enrolled: 100, act: [22, 28] });
  assert.equal(cardRows("admissions", [actOnly, UCLA])[1], ACT_ROW, "no SAT anywhere, ACT at one: the ACT row");
  assert.equal(cardRows("admissions", [actOnly, HARVARD])[1], SAT_ROW, "SAT at one: the SAT row");
  // Two test-blind colleges with no scores: the SAT row stays to say so; an open-admission college adds nothing.
  const blind = school({ id: "900004", name: "Blind College", rate: 0.2, admitted: 200, enrolled: 50, policy: "not-considered" });
  assert.deepEqual(labels(cardRows("admissions", [UCLA, blind])), ["Acceptance rate", "SAT middle 50%"]);
  assert.deepEqual(labels(cardRows("admissions", [OHIO_STATE, ADLER])), ["Acceptance rate", "SAT middle 50%"]);
  const open = school({ id: "900005", name: "Open College", rate: 0.95, admitted: 950, enrolled: 400 });
  assert.deepEqual(labels(cardRows("admissions", [open, ADLER])), ["Acceptance rate"], "nobody has scores or is test-blind: no score row");
  assert.equal(scoreFallback(UCLA), "Test-blind");
  assert.equal(scoreFallback(ADLER), NOT_REPORTED);
  assert.deepEqual(SAT_ROW.get(HARVARD), [1510, 1580]);
  assert.equal(SAT_ROW.get(UCLA), null);
});

test("score ranges share one axis: SAT from the hundred below the lowest 25th less 60, ACT from four below it", () => {
  assert.deepEqual(rangeAxis("sat", [[1510, 1580], [1310, 1480], null]), [1200, 1600]);
  assert.deepEqual(rangeAxis("sat", [[1460, 1560]]), [1400, 1600]);
  assert.deepEqual(rangeAxis("act", [[34, 36], [28, 32]]), [24, 36]);
  assert.deepEqual(rangeAxis("act", [[3, 9]]), [1, 36], "never below 1");
  assert.equal(rangeAxis("sat", [null, null]), null);
});

/* ---- Over time ---- */

test("the Over time row: the direction word and signed change, a later start named, and why a college has none", () => {
  const late = school({ id: "900006", name: "Late College", apps: { since: 2016, from: 1000, to: 900, change: -0.1 } });
  const tiny = school({ id: "900007", name: "Tiny College", apps: { since: 2014, from: 40, to: 90, change: 1.25 } });
  const set = [HARVARD, OHIO_STATE, late, tiny, ADLER];
  assert.equal(applicationsSince(set), 2014);
  assert.equal(applicationsSince([late, ADLER]), 2016);
  assert.equal(applicationsSince([tiny, ADLER]), null, "under 200 applicants at an end: no trend to show");
  const [row] = cardRows("history", set) as TextRow[];
  assert.deepEqual(
    set.map((s) => [row.get(s), row.value?.(s) ?? null, row.note?.(s) ?? null]),
    [
      ["Growing", "+57%", null],
      ["Growing", "+98%", null],
      ["Steady", "−10%", "since fall 2016"],
      [null, null, null],
      [null, null, null],
    ]
  );
  assert.equal(row.fallback?.(tiny), "Not enough data");
  assert.equal(row.fallback?.(ADLER), NOT_REPORTED);
  assert.equal(row.indicator, "applications");
  assert.equal(applicationsRow(null).note?.(late), null, "no start to compare with, no note");
  // No college with a usable trend: the card is hidden.
  assert.deepEqual(cardRows("history", [tiny, ADLER]), []);
});

test("the most popular major: its exact title and its share, or Not reported", () => {
  const [, major] = cardRows("academics", [OHIO_STATE, BLANK]) as [CardRow, TextRow];
  assert.equal(major.get(OHIO_STATE), "Finance, General");
  assert.equal(major.value?.(OHIO_STATE), "8%");
  assert.equal(major.get(BLANK), null);
  assert.equal(major.fallback, undefined, "falls back to Not reported");
});
