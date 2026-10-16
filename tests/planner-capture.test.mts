/**
 * The Show interest guide's pure helpers (lib/planner/capture.ts; plan v3 build-plan.md U2b "What's removed"): the
 * visit page fallback, "We visited" from the tracking date and logged visits, and the follow links. `rowToDo` (the
 * old row's expand-control count) is gone with the row's capture panel. Plus the row and intake source checks.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { followTargets, visitPageLink, visitedState } from "../lib/planner/capture.ts";
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

test("the row: no expand control, no drawer, no capture panel (plan v3 connections.md 'The row')", () => {
  const row = read("components", "planner", "PlanRow.tsx");
  assert.doesNotMatch(row, /ChevronDown|aria-expanded|rowToDo\(|RowDrawer|RowPanel/);
  assert.doesNotMatch(row, /\bDetails\b/);
  // Round, deadline, and status are off the row and the list header (owner, 2026-10-12, unchanged by plan v3).
  assert.doesNotMatch(row, /RoundChip|SEASON_STATUS_LABEL|Round picked senior year|dayLabel/);
  const list = read("components", "planner", "PlanList.tsx");
  assert.doesNotMatch(list, /<span>Round<\/span>|<span>Deadline<\/span>|<span>Status<\/span>/);
});

test("the row's trash icon: 44px, editors only, asks first in the built words, then removes", () => {
  const row = read("components", "planner", "PlanRow.tsx");
  assert.match(row, /import \{ Heart, Trash2 \} from "lucide-react"/);
  assert.match(row, /\{canEdit && \(\s*<button[\s\S]*?<Trash2/, "an editor-only trash button");
  assert.match(row, /aria-label=\{`Remove \$\{name\} from the list`\}/);
  assert.match(row, /title="Remove from the list"/);
  assert.match(row, /window\.confirm\(`Remove \$\{name\} from the list\? Its notes, visits, and any offer go with it\.`\)\) onRemove\(row\)/);
  assert.match(row, /className="flex size-11 shrink-0 items-center justify-center[^"]*"\s*>\s*<Trash2/, "the trash button is a 44px tap target");
});

test("the row is one line: the name truncates before the pill does", () => {
  const row = read("components", "planner", "PlanRow.tsx");
  assert.match(row, /<div className="min-w-0 flex-1">/, "the name column may shrink below its content");
  assert.match(row, /\{pill\}/, "the pill is a plain node now, not a render prop");
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
