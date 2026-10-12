/**
 * The row capture panel's pure parts (lib/planner/capture.ts; specs/planner/redesign/list.md "The capture panel"):
 * the visit page fallback, "We visited" from the tracking date and logged visits, and the follow links. Plus source
 * checks that the panel is only the capture controls now (owner, 2026-10-12). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { followTargets, visitPageLink, visitedState } from "../lib/planner/capture.ts";
import type { PlanVisit } from "../lib/planner/types.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const visit = (id: string, on_date: string): PlanVisit => ({
  id,
  item_id: "i1",
  kind: "campus_tour",
  on_date,
  at_time: null,
  registered: false,
  registration_url: null,
  who: [],
  rating: null,
  notes: {},
  created_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

test("the visit link: the campus visit page, else the virtual tour, else admissions, else nothing", () => {
  assert.deepEqual(visitPageLink({ visit: "https://a.edu/visit", virtual_tour: "https://a.edu/tour", admissions: "https://a.edu/adm" }), { href: "https://a.edu/visit", label: "Campus visit page" });
  assert.deepEqual(visitPageLink({ visit: null, virtual_tour: "https://a.edu/tour", admissions: "https://a.edu/adm" }), { href: "https://a.edu/tour", label: "Virtual tour" });
  assert.deepEqual(visitPageLink({ visit: null, virtual_tour: null, admissions: "https://a.edu/adm" }), { href: "https://a.edu/adm", label: "Admissions page" });
  assert.equal(visitPageLink({ visit: null, virtual_tour: null, admissions: null }), null);
  assert.equal(visitPageLink(null), null);
});

test("We visited: off with nothing logged; on from the tracking date alone; the first past visit wins", () => {
  const today = "2026-10-12";
  assert.deepEqual(visitedState(null, [], today), { visited: false, date: null, visit: null, pastCount: 0, upcoming: null });
  const fromDate = visitedState("2026-06-01", [], today);
  assert.equal(fromDate.visited, true);
  assert.equal(fromDate.date, "2026-06-01");
  assert.equal(fromDate.visit, null, "no visit to edit: the date alone is the tracking row's");
  const two = visitedState("2026-06-01", [visit("b", "2026-09-01"), visit("a", "2026-03-01"), visit("c", "2026-11-01")], today);
  assert.equal(two.date, "2026-03-01");
  assert.equal(two.visit?.id, "a");
  assert.equal(two.pastCount, 2);
  assert.equal(two.upcoming?.id, "c");
  // Today counts as visited; only a planned visit doesn't.
  assert.equal(visitedState(null, [visit("t", today)], today).visited, true);
  const planned = visitedState(null, [visit("f", "2026-12-01")], today);
  assert.equal(planned.visited, false);
  assert.equal(planned.upcoming?.id, "f");
});

test("follow targets: the college's accounts in the site's order, each with its follow link and state", () => {
  const t = followTargets({ x: "Cal", instagram: "ucberkeleyofficial", youtube: "UC1234567890123456789012" }, ["x"]);
  assert.deepEqual(t.map((f) => f.network), ["instagram", "youtube", "x"]);
  assert.equal(t[0].href, "https://www.instagram.com/ucberkeleyofficial");
  assert.equal(t[2].href, "https://x.com/intent/follow?screen_name=Cal");
  assert.match(t[1].href, /sub_confirmation=1$/);
  assert.deepEqual(t.map((f) => f.followed), [false, false, true]);
  assert.deepEqual(followTargets(null, []), []);
});

test("the row's panel is the capture panel: legacy, recruited, visited, follows, quick links, remove — no estimate text", () => {
  const drawer = read("components", "planner", "RowDrawer.tsx");
  for (const gone of [/WhatWentIn/, /panelParts/, /ComparedWith/, /estimate\.level\./, /track\("estimate_shown"/, /RoundChip|roundWhy|Requirements/]) assert.doesNotMatch(drawer, gone);
  for (const kept of [/<AboutYouAndCollege\b/, /We visited/, /recordFollow\(/, /visitPageLink\(/, /followTargets\(/, /logVisit\(/]) assert.match(drawer, kept);
  // Round, deadline, and status are off the row and the list header (owner, 2026-10-12).
  const row = read("components", "planner", "PlanRow.tsx");
  assert.doesNotMatch(row, /RoundChip|SEASON_STATUS_LABEL|Round picked senior year|dayLabel/);
  const list = read("components", "planner", "PlanList.tsx");
  assert.doesNotMatch(list, /<span>Round<\/span>|<span>Deadline<\/span>|<span>Status<\/span>/);
});
