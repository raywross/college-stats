/**
 * The compare pages (specs/compare-redesign.md): every topic has a route, "All the numbers" keeps every row the single
 * page had (grouped by topic, labels unchanged), the routes and neighbors are right, and each page's fields list is
 * sound. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMPARE_OVERVIEW_FIELDS,
  COMPARE_TOPICS,
  COMPARE_TOPIC_FIELDS,
  COMPARE_TOPIC_KEYS,
  LOGISTICS_ROW_LABELS,
  TABLE_GROUPS,
  TOPIC_DIFF_METRICS,
  adjacentCompareTopics,
  compareHref,
  compareTopicOf,
  isCompareTopic,
  tableGroupFields,
} from "../lib/compare-topics.ts";
import { PROFILE_TOPICS } from "../lib/profile-topics.ts";
import { METRICS, type MetricKey } from "../lib/metrics.ts";
import { TEST_ROWS } from "../lib/compare-tests.ts";
import { ADMISSION_PROFILE_ROWS } from "../lib/cds/compare-rows.ts";

const ROOT = join(import.meta.dirname, "..");

/**
 * The single-page compare's TABLE_ROWS labels (app/compare/page.tsx before the split into topic pages, with
 * FACTOR_ROWS and ON_TIME_ROWS written out), in its order, frozen so that no row silently stops being shown. TEST_ROWS
 * and ADMISSION_PROFILE_ROWS come from their own modules, as the single page spread them. A new row goes into a
 * TABLE_GROUPS group and here, deliberately.
 */
const SINGLE_PAGE_LABELS: readonly string[] = Object.freeze([
  "Admissions data",
  "Acceptance rate",
  "Acceptance rate, men / women",
  "Acceptance rate, in-state / other states / international",
  "Yield, in-state / other states / international",
  "Applicants",
  "Admitted",
  "Enrolled",
  "Yield",
  "SAT middle 50%",
  "ACT middle 50%",
  ...TEST_ROWS.map((r) => r[0]),
  "Admission: High school GPA",
  "Admission: High school record",
  "Admission: Class rank",
  "Admission: College-prep program",
  "Admission: Recommendations",
  "Admission: Essay",
  "Admission: Legacy status",
  "Admission: Work experience",
  "Admission: Demonstration of competencies",
  "Admission: English proficiency test",
  "Admission: Other tests",
  ...ADMISSION_PROFILE_ROWS.map((r) => r[0]),
  "Test policy",
  "Application fee",
  "Deadlines & deposit",
  "Gap year allowed",
  "Setting",
  "Carnegie class",
  "Research activity",
  "Student access & earnings",
  "HBCU, tribal, land-grant",
  "Minority-serving, single-sex",
  "Religious affiliation",
  "Athletics",
  "Conference",
  "ROTC",
  "Study abroad",
  "Undergraduate research program",
  "Calendar",
  "Credit for AP exams",
  "Undergrads",
  "Students per faculty member",
  "Classes under 20 students",
  "Full-time faculty share",
  "Average faculty salary",
  "Bachelor's degrees awarded",
  "Most popular majors",
  "Instruction spending per student",
  "Endowment per student",
  "Tuition share of core revenue",
  "Beds in college housing",
  "First-years must live on campus",
  "Men in a fraternity",
  "Women in a sorority",
  "Fraternity/sorority housing",
  "Greek councils present",
  "Pell Grant",
  "First-gen",
  "Men / women",
  "Part-time students",
  "Students 25 and older",
  "First-years from in state",
  "First-years from other states",
  "First-years from abroad",
  "New transfer students this fall",
  "Transfers, share of new undergraduates",
  "Transfer acceptance rate",
  "Diversity index",
  "Average cost, all students (est.)",
  "Aid generosity (grants ÷ full price)",
  "Net price, students with grants",
  "Sticker price, in-state",
  "Sticker price, out-of-state",
  "Tuition guarantee",
  "Promise program",
  "Tuition & fees, in-state",
  "Tuition & fees, out-of-state",
  "First-years paying out-of-state rates",
  "Median earnings (10 yrs)",
  "Graduation rate",
  "Graduated in 6 years, Pell Grant recipients",
  "Graduated in 6 years, neither Pell nor subsidized loan",
  "Pell graduation gap",
  "Finished within 4 years: Pell recipients",
  "Finished within 4 years: neither Pell nor subsidized loan",
  "Finished within 4 years: all first-time full-time",
  "Finished within 5 years: Pell recipients",
  "Finished within 5 years: neither Pell nor subsidized loan",
  "Finished within 5 years: all first-time full-time",
  "Graduated in 6 years, White students",
  "Graduated in 6 years, Asian students",
  "Graduated in 6 years, Hispanic/Latino students",
  "Graduated in 6 years, Black students",
  "Graduated in 6 years, students of two or more races",
  "Graduated in 6 years, international students",
  "Retention rate",
  "Credential within 4 years, all students",
  "Credential within 8 years, all students",
  "Enrolled at another college, 8 years on",
  "Median debt",
  "Undergrads with a federal loan",
  "Median debt, Pell Grant recipients",
  "First-years with grants",
  "Average grant",
  "Aid from the college",
]);

const groupLabels = TABLE_GROUPS.map((g) => g.rows.map((r) => r[0]));
const allLabels = groupLabels.flat();

test("All the numbers keeps every row the single page had, and no others", () => {
  const now = new Set(allLabels);
  const before = new Set(SINGLE_PAGE_LABELS);
  assert.deepEqual([...before].filter((l) => !now.has(l)), [], "rows no group shows any more");
  assert.deepEqual([...now].filter((l) => !before.has(l)), [], "rows the single page didn't have (add them to SINGLE_PAGE_LABELS deliberately)");
});

test("no label appears twice, every group has rows, and each group keeps the single page's order", () => {
  assert.equal(new Set(allLabels).size, allLabels.length, "duplicate labels (they're the table's React keys)");
  assert.equal(new Set(SINGLE_PAGE_LABELS).size, SINGLE_PAGE_LABELS.length);
  for (const g of TABLE_GROUPS) {
    assert.ok(g.rows.length > 0, `${g.topic} has no rows`);
    const at = g.rows.map((r) => SINGLE_PAGE_LABELS.indexOf(r[0]));
    assert.deepEqual(at, [...at].sort((a, b) => a - b), `${g.topic}: rows out of the single page's order`);
  }
});

test("groups follow the topic pills, with the placements the redesign chose", () => {
  assert.deepEqual(
    TABLE_GROUPS.map((g) => g.topic),
    COMPARE_TOPIC_KEYS.filter((k) => k !== "history" && k !== "table"),
  );
  for (const g of TABLE_GROUPS) assert.equal(g.title, compareTopicOf(g.topic).label);
  const groupOf = (label: string) => TABLE_GROUPS.find((g) => g.rows.some((r) => r[0] === label))?.topic;
  // Owner assumption 7: debt and loans under Outcomes (the profile keeps them under Cost); grants under Cost.
  for (const l of ["Median debt", "Undergrads with a federal loan", "Median debt, Pell Grant recipients"]) assert.equal(groupOf(l), "outcomes", l);
  for (const l of ["First-years with grants", "Average grant", "Aid from the college"]) assert.equal(groupOf(l), "cost", l);
  for (const l of ["Credit for AP exams", "Transfer acceptance rate", ...TEST_ROWS.map((r) => r[0]), ...ADMISSION_PROFILE_ROWS.map((r) => r[0])]) {
    assert.equal(groupOf(l), "admissions", l);
  }
  for (const l of ["Religious affiliation", "Calendar", "Undergrads", "Greek councils present", "Diversity index"]) assert.equal(groupOf(l), "students", l);
  for (const l of LOGISTICS_ROW_LABELS) assert.equal(groupOf(l), "admissions", l);
});

test("the federal factor labels the CDS cell-year lookup mirrors are still rows (lib/cds/compare-rows.ts FEDERAL_LABEL)", () => {
  const src = readFileSync(join(ROOT, "lib/cds/compare-rows.ts"), "utf8");
  const block = src.slice(src.indexOf("const FEDERAL_LABEL"));
  const mirrored = [...block.slice(0, block.indexOf("};")).matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(mirrored.length, 6);
  for (const l of mirrored) assert.ok(groupLabels[0].includes(`Admission: ${l}`), `FEDERAL_LABEL "${l}" has no "Admission: ${l}" row`);
});

test("every compare topic has a route file; the overview is app/compare/page.tsx", () => {
  assert.ok(existsSync(join(ROOT, "app/compare/page.tsx")));
  for (const key of COMPARE_TOPIC_KEYS) assert.ok(existsSync(join(ROOT, "app/compare", key, "page.tsx")), `app/compare/${key}/page.tsx`);
  assert.equal(new Set(COMPARE_TOPIC_KEYS).size, COMPARE_TOPIC_KEYS.length);
});

test("the six topics are the profile's, then the table", () => {
  assert.deepEqual(COMPARE_TOPIC_KEYS, [...PROFILE_TOPICS.map((t) => t.key), "table"]);
  for (const p of PROFILE_TOPICS) {
    const c = compareTopicOf(p.key);
    assert.deepEqual([c.label, c.eyebrow, c.domain], [p.label, p.eyebrow, p.domain], p.key);
  }
  assert.deepEqual(compareTopicOf("table"), {
    key: "table",
    label: "All the numbers",
    eyebrow: "All the numbers",
    domain: null,
    description: "Every figure for these colleges in one table, with differences highlighted.",
  });
  for (const t of COMPARE_TOPICS) assert.ok(t.description.length > 0, t.key);
});

test("compareHref: ids first and comma-joined, then the query, then the hash", () => {
  assert.equal(compareHref(["166027", "204796"]), "/compare?ids=166027,204796");
  assert.equal(compareHref(["166027", "204796"], "overview"), "/compare?ids=166027,204796");
  assert.equal(compareHref(["166027", "204796"], "cost"), "/compare/cost?ids=166027,204796");
  assert.equal(compareHref(["166027", "204796"], "table", { hash: "cost" }), "/compare/table?ids=166027,204796#cost");
  assert.equal(compareHref(["166027", "204796"], "academics", { query: { major: "11" } }), "/compare/academics?ids=166027,204796&major=11");
  assert.equal(compareHref([]), "/compare");
  assert.equal(compareHref([], "cost"), "/compare/cost");
});

test("previous and next run through all seven topics; the overview comes before the first", () => {
  assert.deepEqual(adjacentCompareTopics("admissions"), { prev: null, next: compareTopicOf("students") });
  assert.deepEqual(adjacentCompareTopics("cost"), { prev: compareTopicOf("academics"), next: compareTopicOf("outcomes") });
  assert.deepEqual(adjacentCompareTopics("history"), { prev: compareTopicOf("outcomes"), next: compareTopicOf("table") });
  assert.deepEqual(adjacentCompareTopics("table"), { prev: compareTopicOf("history"), next: null });
});

test("isCompareTopic accepts the seven topics only", () => {
  for (const key of COMPARE_TOPIC_KEYS) assert.ok(isCompareTopic(key), key);
  for (const key of ["overview", "nothing", "", "Cost", "scores"]) assert.ok(!isCompareTopic(key), key);
});

test("fields: every page has a list, none lists a field twice, and the table cites every group's rows and the Website row", () => {
  assert.deepEqual(Object.keys(COMPARE_TOPIC_FIELDS).sort(), [...COMPARE_TOPIC_KEYS].sort());
  for (const [key, fields] of Object.entries(COMPARE_TOPIC_FIELDS)) assert.equal(new Set(fields).size, fields.length, `${key} lists a field twice`);
  assert.equal(new Set(COMPARE_OVERVIEW_FIELDS).size, COMPARE_OVERVIEW_FIELDS.length, "the overview lists a field twice");
  const table = new Set(COMPARE_TOPIC_FIELDS.table);
  for (const g of TABLE_GROUPS) for (const f of tableGroupFields(g)) assert.ok(table.has(f), `table lacks ${g.topic}'s ${f}`);
  assert.ok(table.has("links.website"));
});

test("every Key differences metric opens a topic page, and the overview cites it", () => {
  // keyDifferences (lib/insights.ts, server-only) lists its metrics in a `keys` array; read it from the source.
  const src = readFileSync(join(ROOT, "lib/insights.ts"), "utf8");
  const fn = src.slice(src.indexOf("export function keyDifferences"));
  const list = fn.slice(fn.indexOf("const keys: MetricKey[] = ["));
  const keys = [...list.slice(0, list.indexOf("];")).matchAll(/"(\w+)"/g)].map((m) => m[1] as MetricKey);
  assert.ok(keys.length >= 10, `read ${keys.length} metrics`);
  const assigned = Object.values(TOPIC_DIFF_METRICS).flat();
  assert.deepEqual([...keys].sort(), [...assigned].sort(), "each keyDifferences metric belongs to exactly one topic");
  for (const k of keys) assert.ok(COMPARE_OVERVIEW_FIELDS.includes(METRICS[k].field), `the overview doesn't cite ${k} (${METRICS[k].field})`);
});
