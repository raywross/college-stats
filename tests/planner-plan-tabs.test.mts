/**
 * The Plan page's tabs and links (lib/planner/plan-tabs.ts; specs/planner/redesign/page.md, build-plan.md "Tabs and
 * routing"): parsing, the default tab per viewer, Everyone as the calendar alone, Offers only after a decision, old
 * stage links, and `/advisor` hrefs. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultTab, parseTab, PLAN_TABS, planHref, TAB_LABELS, tabForStage, tabsFor } from "../lib/planner/plan-tabs.ts";
import { intakeStepParam } from "../lib/planner/intake.ts";

test("parseTab keeps the four tabs and nothing else; the dropped Scores tab falls back to the default (owner, 2026-10-12)", () => {
  for (const t of ["next", "colleges", "calendar", "offers"]) assert.equal(parseTab(t), t);
  for (const v of ["", "Colleges", "list", "scores", null, undefined, 3, ["colleges"]]) assert.equal(parseTab(v), null);
});

test("a student opens on Next steps, and a guardian too (owner, 2026-10-14; it was Colleges); the deferred family view (everyone) is still the Calendar", () => {
  assert.equal(defaultTab("student", false), "next");
  assert.equal(defaultTab("guardian", false), "next");
  assert.equal(TAB_LABELS.next, "Next steps");
  assert.equal(PLAN_TABS[0], "next", "first in the strip");
  assert.equal(defaultTab("guardian", true), "calendar");
  assert.equal(defaultTab("student", true), "calendar");
});

test("Everyone is the calendar alone; Offers appears only once a decision is recorded", () => {
  assert.deepEqual(tabsFor({ everyone: true, hasDecision: true }), ["calendar"]);
  assert.deepEqual(tabsFor({ everyone: true, hasDecision: false }), ["calendar"]);
  assert.deepEqual(tabsFor({ everyone: false, hasDecision: false }), ["next", "colleges", "calendar"]);
  assert.deepEqual(tabsFor({ everyone: false, hasDecision: true }), ["next", "colleges", "calendar", "offers"]);
});

test("old ?stage= links: List, Rounds, Actions, Apply → Colleges; Timeline → Calendar; Offers → Offers", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(tabForStage), ["colleges", "colleges", "colleges", "calendar", "colleges", "offers"]);
  assert.equal(tabForStage(0), "colleges");
  assert.equal(tabForStage(Number.NaN), "colleges");
});

test("planHref builds /plan with the person and the tab, leaving out what's missing", () => {
  assert.equal(planHref({}), "/advisor");
  assert.equal(planHref({ person: null, tab: null }), "/advisor");
  assert.equal(planHref({ tab: "offers" }), "/advisor?tab=offers");
  assert.equal(planHref({ person: "6b0f1c1e-0000-4000-8000-000000000001" }), "/advisor?for=6b0f1c1e-0000-4000-8000-000000000001");
  assert.equal(planHref({ person: "abc", tab: "calendar" }), "/advisor?for=abc&tab=calendar");
  assert.equal(planHref({ person: "a b&c" }), "/advisor?for=a+b%26c");
  // The intake's edit mode (the ✎ on the numbers line).
  assert.equal(planHref({ person: "abc", setup: true }), "/advisor?for=abc&setup=1");
  assert.equal(planHref({ setup: true }), "/advisor?setup=1");
  assert.equal(planHref({ person: "abc", setup: false }), "/advisor?for=abc");
  // A step into edit mode (the people line's next-step link); ignored without setup.
  assert.equal(planHref({ person: "abc", setup: true, step: 4 }), "/advisor?for=abc&setup=1&step=4");
  assert.equal(planHref({ setup: true, step: 0 }), "/advisor?setup=1&step=0");
  assert.equal(planHref({ step: 4 }), "/advisor");
  // Next steps: the people line's Next: opens the tab scrolled to the card; `move` is ignored on any other tab.
  assert.equal(planHref({ person: "abc", tab: "next", move: "t-1" }), "/advisor?for=abc&tab=next&move=t-1");
  assert.equal(planHref({ tab: "next" }), "/advisor?tab=next");
  assert.equal(planHref({ person: "abc", tab: "colleges", move: "t-1" }), "/advisor?for=abc&tab=colleges");
});

test("intakeStepParam takes the entry steps 0–12 and nothing else (Your record: Major 8 through Recommenders 12; Review 13 and Done 14 aren't links)", () => {
  for (const v of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]) assert.equal(intakeStepParam(v), Number(v));
  for (const v of [null, undefined, "", "13", "14", "-1", "4.0", " 4", "four"]) assert.equal(intakeStepParam(v), null);
});
