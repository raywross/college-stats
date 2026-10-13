/**
 * The row capture panel's pure parts (lib/planner/capture.ts; specs/planner/redesign/list.md "The capture panel"):
 * the visit page fallback, "We visited" from the tracking date and logged visits, and the follow links. Plus source
 * checks that the panel is only the capture controls now (owner, 2026-10-12). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { followTargets, rowToDo, visitPageLink, visitedState } from "../lib/planner/capture.ts";
import { entryCount, intakeScrollFor, scrollBehavior } from "../lib/planner/intake-scroll.ts";
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
  // Requested info is back as a third one-tap item, dated and undoable (owner, 2026-10-12).
  assert.match(drawer, /We requested info/);
  assert.match(drawer, /markInfoRequested\(itemId, next !== null, next\)/);
  // A guardian sees each network's follow state, not a greyed-out control.
  assert.match(drawer, /\{canMark \? \(/);
  assert.match(drawer, /"Not following"/);
  assert.match(drawer, /canMark=\{canEdit && !ctx\.viewer\.isGuardian\}/);
  // Round, deadline, and status are off the row and the list header (owner, 2026-10-12).
  const row = read("components", "planner", "PlanRow.tsx");
  assert.doesNotMatch(row, /RoundChip|SEASON_STATUS_LABEL|Round picked senior year|dayLabel/);
  const list = read("components", "planner", "PlanList.tsx");
  assert.doesNotMatch(list, /<span>Round<\/span>|<span>Deadline<\/span>|<span>Status<\/span>/);
});

test("row to-do: a visit or info request, and following an account the college has; gentle, never legacy or recruiting", () => {
  const item = (o: Record<string, unknown> = {}) => ({ id: "i1", visited_on: null, info_requested_on: null, followed_networks: [], follows_social: false, ...o });
  const social = { instagram: "college" };
  assert.deepEqual(rowToDo(item(), [], social), ["interest", "follow"]);
  assert.deepEqual(rowToDo(item({ visited_on: "2026-09-01" }), [], social), ["follow"]);
  assert.deepEqual(rowToDo(item(), [{ item_id: "i1" }], social), ["follow"], "a logged visit, past or planned");
  assert.deepEqual(rowToDo(item(), [{ item_id: "other" }], social), ["interest", "follow"]);
  assert.deepEqual(rowToDo(item({ info_requested_on: "2026-09-01" }), [], social), ["follow"]);
  assert.deepEqual(rowToDo(item({ followed_networks: ["instagram"] }), [], social), ["interest"]);
  assert.deepEqual(rowToDo(item({ follows_social: true }), [], social), ["interest"], "the older tracking switch");
  assert.deepEqual(rowToDo(item(), [], null), ["interest"], "no accounts on record: nothing to follow");
  assert.deepEqual(rowToDo(item(), [], {}), ["interest"]);
  assert.deepEqual(rowToDo(item({ visited_on: "2026-09-01", followed_networks: ["x"] }), [], social), [], "nothing left");
});

test("the row's control is an expand toggle with the accent and count when there's more to do", () => {
  const row = read("components", "planner", "PlanRow.tsx");
  assert.doesNotMatch(row, /\bInfo\b/, "no info icon");
  assert.match(row, /ChevronDown/);
  assert.match(row, /aria-expanded=\{open\}/);
  assert.match(row, /rowToDo\(/);
  assert.match(row, /todo\.length \? "bg-primary\/10 text-primary/);
});

test("Connections: one line of chips (parent or grandparent, sibling, Recruited) with the picks behind Recruited", () => {
  const src = read("components", "planner", "AboutYouAndCollege.tsx");
  assert.match(src, /Connections/);
  assert.match(src, /Parent or grandparent went here/);
  assert.match(src, /Sibling went here/);
  assert.match(src, /setItemSibling\(item\.id, !sibling\)/);
  assert.match(src, /aria-expanded=\{picking\}/);
  assert.match(src, /\{picking && \(/, "the four picks show only when Recruited is tapped");
  assert.match(src, /none: "No", contact: "Coach contact", pre_read: "Pre-read", likely_letter: "Likely letter"/);
});

test("intake scroll: page top on a step change, the step's top after an add, nothing on first render or a removal", () => {
  assert.equal(intakeScrollFor(null, { step: 3, count: 2 }), null);
  assert.equal(intakeScrollFor({ step: 3, count: 2 }, { step: 4, count: 2 }), "page-top");
  assert.equal(intakeScrollFor({ step: 3, count: 2 }, { step: 4, count: 3 }), "page-top", "a step change wins");
  assert.equal(intakeScrollFor({ step: 3, count: 2 }, { step: 3, count: 3 }), "step-top");
  assert.equal(intakeScrollFor({ step: 3, count: 3 }, { step: 3, count: 2 }), null, "a removal doesn't scroll");
  assert.equal(intakeScrollFor({ step: 3, count: 3 }, { step: 3, count: 3 }), null);
  assert.equal(entryCount({ activities: [1, 2], awards: [1], courses: [1, 2, 3] }), 6);
  assert.equal(scrollBehavior(true), "auto");
  assert.equal(scrollBehavior(false), "smooth");
  const intake = read("components", "planner", "intake", "PlanIntake.tsx");
  assert.match(intake, /prefers-reduced-motion: reduce/);
  assert.match(intake, /heading\.focus\(\{ preventScroll: true \}\)/);
  assert.match(intake, /useIntakeScroll\(step, entryCount\(draft\)\)/);
});
