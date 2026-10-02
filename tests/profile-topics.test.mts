/**
 * The profile's topic pages (specs/profile-redesign.md): every topic has a route and a fields list, the pages
 * together still show every field the single-page profile showed, and the old anchors map to real topics. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ANCHOR_TOPICS, OVERVIEW_FIELDS, PROFILE_FIELDS, PROFILE_TOPICS, TOPIC_FIELDS, TOPIC_KEYS, adjacentTopics, topicHref } from "../lib/profile-topics.ts";

const ROOT = join(import.meta.dirname, "..");

/**
 * The pre-redesign profile's SECTION_FIELDS (app/schools/[id]/page.tsx before the split into topic pages), frozen so
 * that no value silently stops being shown. A field shown somewhere new goes into TOPIC_FIELDS, not here.
 */
const LEGACY_FIELDS = Object.freeze({
  overview: [
    "admissions.acceptance_rate",
    "derived.sat_composite",
    "admissions.act_composite_25_75",
    "demographics.undergrad_enrollment",
    "derived.yield",
    "demographics.pell_grant_percent",
    "derived.diversity_index",
    "cost.avg_paid_all",
    "derived.aid_generosity",
    "outcomes.median_earnings_10yr",
    "outcomes.graduation_rate",
    "trends",
    "campus.setting",
    "campus.carnegie",
    "campus.designations",
    "campus.msi",
    "academics.student_faculty_ratio",
  ],
  admissions: ["admissions.applicants", "admissions.admitted", "admissions.enrolled", "admissions.acceptance_rate", "derived.yield", "admissions.by_sex", "derived.admit_rate_men", "derived.admit_rate_women", "admissions.application_fee", "admissions.accepts_ap_credit", "admissions.factors"],
  scores: [
    "admissions.sat_reading_25_75",
    "admissions.sat_math_25_75",
    "admissions.act_composite_25_75",
    "admissions.test_submission_rate_sat",
    "admissions.test_submission_rate_act",
    "admissions.test_policy",
    "admissions.sat_reading_median",
    "admissions.sat_math_median",
    "admissions.act_composite_median",
    "admissions.act_english_25_75",
    "admissions.act_math_25_75",
    "derived.sat_median",
  ],
  students: [
    "demographics.racial_diversity",
    "derived.diversity_index",
    "demographics.pell_grant_percent",
    "demographics.first_gen_percent",
    "demographics.undergrad_enrollment",
    "demographics.men_share",
    "demographics.women_share",
    "demographics.part_time_share",
    "demographics.age_25_plus_share",
    "demographics.residence",
    "demographics.transfer_in",
    "detail.home_states",
  ],
  cost: [
    "cost.avg_paid_all",
    "cost.sticker",
    "cost.tuition_fees",
    "cost.residency",
    "cost.aided_net_price",
    "cost.net_price_by_income",
    "derived.aid_generosity",
    "aid.grant_pct",
    "aid.grant_avg",
    "aid.institutional_pct",
    "aid.pell_pct",
    "aid.loan_pct",
    "aid.by_income",
    "outcomes.median_debt",
    "outcomes.monthly_loan_payment",
    "outcomes.federal_loan_rate",
    "outcomes.median_debt_pell",
    "outcomes.median_debt_no_pell",
    "outcomes.median_debt_by_income",
    "outcomes.repayment_3yr",
    "cost.tuition_plans",
    "cost.promise_program",
    "derived.payback_years",
    "outcomes.median_earnings_10yr",
    "outcomes.median_earnings_6yr",
    "outcomes.retention_rate",
    "outcomes.graduation_rate",
    "outcomes.eight_year",
    "outcomes.grad_rate_pell",
    "outcomes.grad_rate_loan_no_pell",
    "outcomes.grad_rate_no_pell_no_loan",
    "outcomes.grad_rate_ftft",
    "outcomes.grad_cohorts",
    "outcomes.grad_rate_by_race",
    "outcomes.grad_cohorts_by_race",
  ],
  academics: [
    "academics.bachelors_awarded",
    "academics.majors_top",
    "detail.majors",
    "detail.programs",
    "academics.programs_with_earnings",
    "academics.student_faculty_ratio",
    "academics.faculty",
    "academics.faculty.full_time_share",
    "finances",
  ],
  campus: ["campus.housing", "campus.athletics", "campus.programs", "campus.services", "campus.calendar", "demographics.disability_services"],
  ranks: ["derived.sat_mid", "derived.yield", "demographics.pell_grant_percent", "derived.diversity_index", "admissions.acceptance_rate"],
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

test("every topic has a route file and a fields list", () => {
  for (const t of PROFILE_TOPICS) {
    assert.ok(existsSync(join(ROOT, "app/schools/[id]", t.key, "page.tsx")), `app/schools/[id]/${t.key}/page.tsx`);
    assert.ok(Array.isArray(TOPIC_FIELDS[t.key]), `TOPIC_FIELDS.${t.key}`);
  }
  assert.deepEqual(Object.keys(TOPIC_FIELDS).sort(), [...TOPIC_KEYS].sort());
  assert.equal(new Set(TOPIC_KEYS).size, TOPIC_KEYS.length);
});

test("the overview and topic pages together show every field the single-page profile showed", () => {
  const legacy = new Set<string>(Object.values(LEGACY_FIELDS).flat());
  const now = new Set<string>([...OVERVIEW_FIELDS, ...Object.values(TOPIC_FIELDS).flat()]);
  assert.deepEqual([...legacy].filter((f) => !now.has(f)), [], "fields no page shows any more");
  assert.deepEqual([...now].filter((f) => !legacy.has(f)), [], "fields the single-page profile didn't show (add them to LEGACY_FIELDS deliberately)");
  const all = new Set<string>(PROFILE_FIELDS);
  for (const f of now) assert.ok(all.has(f), `PROFILE_FIELDS lacks ${f}`);
});

test("every field is cited on some page exactly where it is shown: a page's list has no duplicates", () => {
  for (const [key, fields] of Object.entries(TOPIC_FIELDS)) assert.equal(new Set(fields).size, fields.length, `${key} lists a field twice`);
  assert.equal(new Set(OVERVIEW_FIELDS).size, OVERVIEW_FIELDS.length);
});

test("old anchors map to real topics, with sub-anchors only where a block has that id", () => {
  for (const [anchor, target] of Object.entries(ANCHOR_TOPICS)) {
    assert.ok(TOPIC_KEYS.includes(target.topic), `#${anchor} → ${target.topic}`);
    if (target.hash) {
      const page = readFileSync(join(ROOT, "app/schools/[id]", target.topic, "page.tsx"), "utf8");
      assert.match(page, new RegExp(`id="${target.hash}"`), `#${anchor} → /${target.topic}#${target.hash} needs id="${target.hash}" on that page`);
    }
  }
  assert.equal(topicHref("1", "admissions", "scores"), "/schools/1/admissions#scores");
  assert.equal(topicHref("1", "history"), "/schools/1/history");
});

test("adjacent topics skip the pages a college doesn't have", () => {
  assert.deepEqual(adjacentTopics("students", ["admissions", "students", "cost"]), { prev: PROFILE_TOPICS[0], next: PROFILE_TOPICS[3] });
  assert.equal(adjacentTopics("admissions", ["admissions", "students"]).prev, null);
  assert.equal(adjacentTopics("students", ["admissions", "students"]).next, null);
  assert.equal(adjacentTopics("history", ["students"]).prev, null);
});

test("nothing links to the retired #history anchor; history links take an href", () => {
  const UI = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))];
  const offenders = UI.filter((f) => /href=["'`]#history["'`]/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, []);
  assert.ok(!existsSync(join(ROOT, "components/school/SectionNav.tsx")), "SectionNav was retired with the single-page profile");
});

test("Over time renders the ?group= it's linked to on the server, not after hydration", () => {
  const page = readFileSync(join(ROOT, "app/schools/[id]/history/page.tsx"), "utf8");
  assert.match(page, /searchParams/, "the history page reads searchParams");
  assert.match(page, /parseHistoryGroup\(query\.group\)/, "parses ?group=");
  assert.match(page, /initialGroup=\{initialGroup\}/, "and passes it to OverTimeSection and the side list");
  // A segment-level revalidate would be misleading on a page that renders per request.
  assert.doesNotMatch(page, /export const revalidate/);
  const section = readFileSync(join(ROOT, "components/profile/OverTimeSection.tsx"), "utf8");
  assert.match(section, /initialGroup=\{initialGroup\}/, "OverTimeSection hands it to OverTime");
});

test("tablets fold the tall secondary blocks (ShowMore until lg)", () => {
  // [page, ShowMore label] that fold below lg (specs/profile-redesign.md#phones-tablets-desktop).
  const folded: [string, string][] = [
    ["admissions", "Show out of every 100 applicants"],
    ["admissions", "Show the admissions map"],
    ["cost", "Show borrowing and repayment"],
    ["cost", "Show who gets aid"],
    ["outcomes", "Show the cost vs. earnings map"],
  ];
  for (const [topic, label] of folded) {
    const page = readFileSync(join(ROOT, "app/schools/[id]", topic, "page.tsx"), "utf8");
    const tag = page.match(new RegExp(`<ShowMore[^>]*label="${label}"[^>]*>`))?.[0];
    assert.ok(tag, `${topic}: ShowMore "${label}"`);
    assert.match(tag, /until="lg"/, `${topic}: "${label}" folds on tablets`);
  }
});
