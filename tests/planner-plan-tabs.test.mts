/**
 * The Plan page's tabs and links (lib/planner/plan-tabs.ts; specs/planner/redesign/page.md, build-plan.md "Tabs and
 * routing"): parsing, the default tab per viewer, Everyone as the calendar alone, Offers only after a decision, old
 * stage links, and `/plan` hrefs. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultTab, parseTab, planHref, tabForStage, tabsFor } from "../lib/planner/plan-tabs.ts";

test("parseTab keeps the four tabs and nothing else", () => {
  for (const t of ["colleges", "scores", "calendar", "offers"]) assert.equal(parseTab(t), t);
  for (const v of ["", "Colleges", "list", null, undefined, 3, ["scores"]]) assert.equal(parseTab(v), null);
});

test("a student opens on Colleges, a parent on the Calendar, Everyone on the Calendar", () => {
  assert.equal(defaultTab("student", false), "colleges");
  assert.equal(defaultTab("guardian", false), "calendar");
  assert.equal(defaultTab("guardian", true), "calendar");
  assert.equal(defaultTab("student", true), "calendar");
});

test("Everyone is the calendar alone; Offers appears only once a decision is recorded", () => {
  assert.deepEqual(tabsFor({ everyone: true, hasDecision: true }), ["calendar"]);
  assert.deepEqual(tabsFor({ everyone: true, hasDecision: false }), ["calendar"]);
  assert.deepEqual(tabsFor({ everyone: false, hasDecision: false }), ["colleges", "scores", "calendar"]);
  assert.deepEqual(tabsFor({ everyone: false, hasDecision: true }), ["colleges", "scores", "calendar", "offers"]);
});

test("old ?stage= links: List, Rounds, Actions, Apply → Colleges; Timeline → Calendar; Offers → Offers", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(tabForStage), ["colleges", "colleges", "colleges", "calendar", "colleges", "offers"]);
  assert.equal(tabForStage(0), "colleges");
  assert.equal(tabForStage(Number.NaN), "colleges");
});

test("planHref builds /plan with the person and the tab, leaving out what's missing", () => {
  assert.equal(planHref({}), "/plan");
  assert.equal(planHref({ person: null, tab: null }), "/plan");
  assert.equal(planHref({ tab: "scores" }), "/plan?tab=scores");
  assert.equal(planHref({ person: "6b0f1c1e-0000-4000-8000-000000000001" }), "/plan?for=6b0f1c1e-0000-4000-8000-000000000001");
  assert.equal(planHref({ person: "abc", tab: "calendar" }), "/plan?for=abc&tab=calendar");
  assert.equal(planHref({ person: "a b&c" }), "/plan?for=a+b%26c");
});
