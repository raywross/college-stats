/**
 * The header's Plan dot read from the stored tasks (lib/planner/plan-frame.ts tasksDueSoon; app/api/plan/next):
 * the performance pass of 2026-10-16 replaced a whole plan load per student with the bundle's tasks alone.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tasksDueSoon } from "../lib/planner/plan-frame.ts";

const base = { done_at: null, dismissed: false, snoozed_until: null, orphaned: false, due_on: null, window_start: null, window_end: null };

test("tasksDueSoon: an open task dated within the window lights it; outside, done, skipped, or orphaned don't", () => {
  const today = "2026-10-16";
  assert.equal(tasksDueSoon([{ ...base, due_on: "2026-10-20" }], today), true);
  assert.equal(tasksDueSoon([{ ...base, due_on: "2026-10-23" }], today), true, "the seventh day counts");
  assert.equal(tasksDueSoon([{ ...base, due_on: "2026-10-24" }], today), false, "the eighth doesn't");
  assert.equal(tasksDueSoon([{ ...base, due_on: "2026-10-15" }], today), false, "yesterday is overdue, not due soon");
  assert.equal(tasksDueSoon([{ ...base, window_start: "2026-10-01", window_end: "2026-10-20" }], today), true, "a window dates by its end (taskDate)");
  assert.equal(tasksDueSoon([{ ...base, window_start: "2026-10-18", window_end: "2026-11-01" }], today), false, "a window ending later isn't due soon");
  assert.equal(tasksDueSoon([{ ...base, due_on: "2026-10-20", done_at: "2026-10-10T00:00:00Z" }], today), false);
  assert.equal(tasksDueSoon([{ ...base, due_on: "2026-10-20", dismissed: true }], today), false);
  assert.equal(tasksDueSoon([{ ...base, due_on: "2026-10-20", orphaned: true }], today), false);
  assert.equal(tasksDueSoon([{ ...base, due_on: "2026-10-20", snoozed_until: "2026-11-01" }], today), false);
  assert.equal(tasksDueSoon([{ ...base }], today), false, "undated never");
});

test("the dot route reads the plan bundle, never the full plan load", () => {
  const src = readFileSync(new URL("../app/api/plan/next/route.ts", import.meta.url), "utf8");
  assert.match(src, /planBundle\(/);
  assert.doesNotMatch(src, /loadPlanFor/, "a full plan load per page view is what the pass removed");
  assert.match(src, /tasksDueSoon/);
});

test("the header and the bottom nav share one dot hook with a short memory", () => {
  const hook = readFileSync(new URL("../components/layout/usePlanDot.ts", import.meta.url), "utf8");
  assert.match(hook, /sessionStorage/);
  assert.match(hook, /DOT_TTL_MS = 5 \* 60_000/);
  for (const f of ["Header.tsx", "BottomNav.tsx"]) {
    const src = readFileSync(new URL(`../components/layout/${f}`, import.meta.url), "utf8");
    assert.match(src, /usePlanDot\(/, f);
    assert.doesNotMatch(src, /fetch\("\/api\/plan\/next"/, `${f} fetches through the hook only`);
  }
});
