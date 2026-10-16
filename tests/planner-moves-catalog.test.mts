/**
 * The playbook's words (lib/planner/moves-catalog.ts; seasons.md "Rules"; build-plan.md "The playbook"): no title or
 * why carries a number from the estimate. The guard fails on a percentage, "×", "odds", "chance", a probability
 * "likely" (the level name "Likely" is fine), or a bare number; dates ("Oct 1", "May 1") and the list-size ranges
 * ("15–20", "12–15") are allowed by an explicit list. Plus the catalog's shape: unique keys, a season for each, the
 * explainer for every season, and no "you should". `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOVE_TEXT, PLAYBOOK, playbookEntryFor, SEASON_EXPLAINER } from "../lib/planner/moves-catalog.ts";
import { MOVE_APPLIES } from "../lib/planner/generators/season.ts";
import { SEASONS } from "../lib/planner/seasons.ts";

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";
/** What may carry a digit: a month and day ("Oct 1", "May 1", "Oct 1–31"), the list-size ranges, and names with digits. */
const ALLOWED = [new RegExp(`\\b${MONTH} \\d{1,2}(?:–\\d{1,2})?\\b`, "g"), /\b15–20\b/g, /\b12–15\b/g, /\bPSAT\/NMSQT\b/g, /\bED II\b/g];

/** Every problem with one line of copy (empty when it's fine). */
function numberProblems(text: string): string[] {
  const problems: string[] = [];
  if (/%|percent/i.test(text)) problems.push("a percentage");
  if (/×|\b\d+x\b/i.test(text)) problems.push("a multiple");
  if (/\bodds\b/i.test(text)) problems.push("odds");
  if (/\bchances?\b/i.test(text)) problems.push("chance");
  if (/\blikely\b/.test(text)) problems.push("a probability 'likely'");
  let rest = text;
  for (const re of ALLOWED) rest = rest.replace(re, "");
  if (/\d/.test(rest)) problems.push("a bare number");
  if (/\byou should\b/i.test(text)) problems.push("'you should'");
  return problems;
}

function allCopy(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const e of PLAYBOOK) out.push({ where: `${e.key}.title`, text: e.title }, { where: `${e.key}.why`, text: e.why });
  for (const [k, v] of Object.entries(MOVE_TEXT)) out.push({ where: `${k}.title`, text: v.title }, { where: `${k}.why`, text: v.why });
  for (const [s, v] of Object.entries(SEASON_EXPLAINER)) {
    out.push({ where: `${s}.lead`, text: v.lead }, { where: `${s}.paragraph`, text: v.paragraph });
    if (v.next) out.push({ where: `${s}.next`, text: v.next });
  }
  return out;
}

test("no title, why, or explainer carries a percentage, a multiple, odds, chance, a probability 'likely', a bare number, or 'you should'", () => {
  const bad = allCopy()
    .map(({ where, text }) => ({ where, problems: numberProblems(text) }))
    .filter((x) => x.problems.length > 0);
  assert.deepEqual(bad, []);
});

test("guard: the check fails on planted bad strings and passes the allowed ones", () => {
  for (const s of ["A 35% admit rate", "Your odds are good", "2× the chance", "A good chance here", "You're likely to get in", "Apply to 3 more", "Admits 1 in 4", "You should visit", "Work toward your 1400"]) {
    assert.ok(numberProblems(s).length > 0, s);
  }
  for (const s of ["Decide by May 1", "PSAT/NMSQT in October", "Build the list toward 15–20 to visit and cut", "Final list: 12–15", "Add a Likely you'd be happy at", "Oct 1–31", "ED II at {college}", "Work toward your {target}"]) {
    assert.deepEqual(numberProblems(s), [], s);
  }
});

test("the playbook's shape: unique keys, applies from the vocabulary, only the unknown season's move without a class year", () => {
  const keys = PLAYBOOK.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, "unique keys");
  for (const e of PLAYBOOK) {
    assert.ok(SEASONS.includes(e.season), e.key);
    assert.ok(MOVE_APPLIES.includes(e.applies), `${e.key}: ${e.applies}`);
    assert.match(e.key, /^[a-z][a-z0-9_]*$/, e.key);
    if (e.replaces) assert.ok(keys.includes(e.replaces), `${e.key} replaces ${e.replaces}`);
  }
  assert.deepEqual(PLAYBOOK.filter((e) => e.season === "unknown").map((e) => e.key), ["class_year"]);
  // Built tasks are not repeated (review note 1): the cycle file's own moves have no playbook row.
  for (const built of ["ask_recommenders", "personal_essay_draft", "common_app_opens", "fafsa_opens", "css_profile_opens", "final_transcript"]) {
    assert.ok(!keys.includes(built), built);
  }
  // The course choice defers to the cycle file's choose_courses_* entry where the student's cycle has one.
  assert.ok(PLAYBOOK.filter((e) => e.key.endsWith("choose_courses")).every((e) => e.builtBy === "choose_courses"));
});

test("every season has an explainer; juniors and seniors get the what-counts-next line", () => {
  for (const s of SEASONS) assert.ok(SEASON_EXPLAINER[s].lead && SEASON_EXPLAINER[s].paragraph, s);
  for (const s of ["junior_fall", "junior_winter", "junior_spring", "summer_before_senior", "senior_fall", "senior_winter", "senior_spring"] as const) {
    assert.ok(SEASON_EXPLAINER[s].next, s);
  }
});

test("MOVE_TEXT covers every rule unit's kind", () => {
  for (const k of ["ed_decide", "ed2_decide", "visit_ed", "show_interest", "shape_cost", "confirm_complete", "compare_offers", "decide_by", "outcome_share", "story"]) assert.ok(MOVE_TEXT[k], k);
  for (const g of ["likely_min", "affordable", "target_min", "reach_min", "over_max", "total_off"]) assert.ok(MOVE_TEXT[`shape_gap:${g}`], g);
});

test("plan v3: the catalog's only placeholders are {target} in titles; reach_score and pick_recommenders are in, notice_teachers is out", () => {
  for (const e of PLAYBOOK) {
    for (const m of e.title.matchAll(/\{([a-zA-Z]+)\}/g)) assert.equal(m[1], "target", `${e.key}.title`);
    assert.doesNotMatch(e.why, /\{/, `${e.key}.why`);
  }
  assert.ok(PLAYBOOK.some((e) => e.title.includes("{target}")));
  assert.ok(PLAYBOOK.some((e) => e.key === "pick_recommenders"));
  assert.ok(!PLAYBOOK.some((e) => e.key === "notice_teachers"));
});

test("playbookEntryFor finds a task's entry by its key", () => {
  assert.equal(playbookEntryFor("list-1:playbook:long_list")?.season, "freshman");
  assert.equal(playbookEntryFor("list-1:cycle:fafsa_opens"), null);
  assert.equal(playbookEntryFor(null), null);
});
