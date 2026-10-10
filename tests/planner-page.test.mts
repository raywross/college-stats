/**
 * The redesigned Plan page's frame (lib/planner/plan-frame.ts; specs/planner/redesign/page.md, build-plan.md "U2
 * Page frame & navigation"): which child a guardian's `/plan` opens on, where an old `?stage=` person link lands,
 * the header card's season words, Next up, the header nav dot, first-time setup, and the top-level nav order.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dayLabel,
  daysBetween,
  firstTimeNeeded,
  hasDueSoon,
  nextUpInfo,
  personPlanRedirectHref,
  resolveSelectedChild,
  seasonWords,
  shortSummaryLine,
} from "../lib/planner/plan-frame.ts";
import type { PlanRowView, PlanView } from "../lib/planner/plan-view.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ------------------------------------------------------------------ */
/* Route choice per viewer                                             */
/* ------------------------------------------------------------------ */

test("resolveSelectedChild: an explicit ?for= wins, a single child is picked for free, else Everyone", () => {
  const two = [{ studentId: "a" }, { studentId: "b" }];
  assert.equal(resolveSelectedChild({ forParam: "b", children: two }), "b");
  assert.equal(resolveSelectedChild({ forParam: "nope", children: two }), null); // not a real child: Everyone
  assert.equal(resolveSelectedChild({ forParam: null, children: two }), null); // two children, no pick: Everyone
  assert.equal(resolveSelectedChild({ forParam: null, children: [{ studentId: "a" }] }), "a"); // one child: no switcher needed
  assert.equal(resolveSelectedChild({ forParam: "a", children: [] }), null); // no children at all
});

test("personPlanRedirectHref: an old person-plan link becomes /plan?for=<id>, with ?stage= mapped to a tab", () => {
  assert.equal(personPlanRedirectHref("p1", undefined), "/plan?for=p1");
  assert.equal(personPlanRedirectHref("p1", "1"), "/plan?for=p1&tab=colleges");
  assert.equal(personPlanRedirectHref("p1", "4"), "/plan?for=p1&tab=calendar");
  assert.equal(personPlanRedirectHref("p1", "6"), "/plan?for=p1&tab=offers");
  assert.equal(personPlanRedirectHref("p1", ["5"]), "/plan?for=p1&tab=colleges");
  assert.equal(personPlanRedirectHref("p1", "not-a-stage"), "/plan?for=p1");
});

/* ------------------------------------------------------------------ */
/* Season words                                                        */
/* ------------------------------------------------------------------ */

test("seasonWords: before senior fall it's building the list, then applying, then deciding", () => {
  assert.equal(seasonWords({ today: "2026-03-01", cycleStartYear: 2027, anyOpenDeadline: false, anyApplied: false }), "building the list");
  assert.equal(seasonWords({ today: "2027-09-15", cycleStartYear: 2027, anyOpenDeadline: true, anyApplied: false }), "applying this fall");
  assert.equal(seasonWords({ today: "2028-01-15", cycleStartYear: 2027, anyOpenDeadline: false, anyApplied: true }), "deciding");
  assert.equal(seasonWords({ today: "2026-03-01", cycleStartYear: null, anyOpenDeadline: false, anyApplied: false }), "building the list");
});

/* ------------------------------------------------------------------ */
/* Next up                                                             */
/* ------------------------------------------------------------------ */

function row(overrides: { status?: string; withdrawn_on?: string | null; deadline?: { iso: string } | null; decision?: { iso: string } | null }): PlanRowView {
  return {
    item: { status: overrides.status ?? "considering", withdrawn_on: overrides.withdrawn_on ?? null },
    school: null,
    dream: false,
    standing: null,
    group: "unsorted",
    groupAuto: true,
    round: "rd",
    roundAuto: true,
    roundWhy: "",
    pickable: ["rd"],
    deadline: overrides.deadline ? { ...overrides.deadline, field: "f", edition: null, lastCycle: false } : null,
    decision: overrides.decision ?? null,
    moveUp: null,
    seasonStatus: null,
  } as unknown as PlanRowView;
}

function view(next: PlanRowView | null, rows: PlanRowView[] = []): PlanView {
  return { student: { gpa: 3.8, test: { kind: "sat", score: 1400 } }, rows, balance: { reach: 0, target: 0, likely: 0 }, balanceLine: null, problems: [], edTwo: null, retake: null, next, inSeason: true, notices: [] } as unknown as PlanView;
}

test("nextUpInfo: a deadline still to meet", () => {
  const r = row({ deadline: { iso: "2026-11-01" } });
  const info = nextUpInfo({ view: view(r), today: "2026-10-25", cycleStartYear: 2026 });
  assert.equal(info.kind, "deadline");
  assert.equal(info.row, r);
  assert.equal(info.days, 7);
});

test("nextUpInfo: once deadlines are met, the next decision to hear", () => {
  const r = row({ status: "applied", decision: { iso: "2026-12-15" } });
  const info = nextUpInfo({ view: view(r), today: "2026-12-01", cycleStartYear: 2026 });
  assert.equal(info.kind, "decision");
  assert.equal(info.days, 14);
});

test("nextUpInfo: before the season, with nothing dated, says so", () => {
  const info = nextUpInfo({ view: view(null), today: "2026-05-01", cycleStartYear: 2026 });
  assert.equal(info.kind, "before_season");
});

test("nextUpInfo: in season with nothing dated left is just 'none'", () => {
  const info = nextUpInfo({ view: view(null), today: "2026-09-01", cycleStartYear: 2026 });
  assert.equal(info.kind, "none");
});

test("daysBetween counts whole days, and can go negative", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-08"), 7);
  assert.equal(daysBetween("2026-10-08", "2026-10-01"), -7);
  assert.equal(daysBetween("2026-10-01", "2026-10-01"), 0);
});

/* ------------------------------------------------------------------ */
/* The header nav dot                                                  */
/* ------------------------------------------------------------------ */

test("hasDueSoon: an open deadline within 7 days lights the dot; a met or withdrawn one doesn't", () => {
  const soon = row({ deadline: { iso: "2026-10-05" } });
  assert.equal(hasDueSoon(view(soon, [soon]), "2026-10-01"), true);
  const far = row({ deadline: { iso: "2026-12-01" } });
  assert.equal(hasDueSoon(view(far, [far]), "2026-10-01"), false);
  const applied = row({ status: "applied", deadline: { iso: "2026-10-05" } });
  assert.equal(hasDueSoon(view(null, [applied]), "2026-10-01"), false);
  const withdrawn = row({ withdrawn_on: "2026-09-01", deadline: { iso: "2026-10-05" } });
  assert.equal(hasDueSoon(view(null, [withdrawn]), "2026-10-01"), false);
  assert.equal(hasDueSoon(view(null, []), "2026-10-01"), false);
});

/* ------------------------------------------------------------------ */
/* First-time setup                                                    */
/* ------------------------------------------------------------------ */

test("firstTimeNeeded: no numbers at all needs setup; any number on file is enough to skip it", () => {
  assert.equal(firstTimeNeeded({ student: { gpa: null, test: null } } as unknown as PlanView), true);
  assert.equal(firstTimeNeeded({ student: { gpa: 3.8, test: null } } as unknown as PlanView), false);
  assert.equal(firstTimeNeeded({ student: { gpa: null, test: { kind: "sat", score: 1400 } } } as unknown as PlanView), false);
});

/* ------------------------------------------------------------------ */
/* The child switcher's shortened summary                              */
/* ------------------------------------------------------------------ */

test("dayLabel formats an ISO date as 'Nov 1'", () => {
  assert.equal(dayLabel("2026-11-01"), "Nov 1");
  assert.equal(dayLabel("2027-01-05"), "Jan 5");
});

test("shortSummaryLine drops the Dream and shortens next: Name, Date (Round) to next Date", () => {
  assert.equal(shortSummaryLine("Applying · 3 of 8 in · next: Michigan, Nov 1 (ED I) · Dream: Michigan"), "Applying · 3 of 8 in · next Nov 1");
  assert.equal(shortSummaryLine("Building the list · No colleges yet"), "Building the list · No colleges yet");
  assert.equal(shortSummaryLine("Applying · 3 of 8 in · 2 visits planned"), "Applying · 3 of 8 in · 2 visits planned");
});

/* ------------------------------------------------------------------ */
/* Nav order                                                           */
/* ------------------------------------------------------------------ */

test("the desktop header lists Explore, Plan, Compare, High schools, Glossary, Data, with Plan second", () => {
  const src = read("components/layout/Header.tsx");
  const labels = [...src.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Explore", "Plan", "Compare", "High schools", "Glossary", "Data"]);
});

test("the phone tab bar is Explore, Search, Plan, Compare, More, with Plan's icon ListChecks and no Home tab", () => {
  const src = read("components/layout/BottomNav.tsx");
  const tabLabels = [...src.matchAll(/<Tab\b[^>]*\blabel="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabLabels, ["Explore", "Search", "Plan", "Compare", "More"]);
  assert.doesNotMatch(src, /label="Home"/);
  assert.match(src, /href="\/plan"[^]*?icon=\{<ListChecks/);
  assert.match(src, /from "lucide-react"/);
  assert.match(src, /\bListChecks\b/);
});

test("guard: a header missing Plan, or out of order, is caught by the label check", () => {
  const bad = 'const NAV_ITEMS = [{ label: "Explore", href: "/explore" }, { label: "Compare", href: "/compare" }];';
  const labels = [...bad.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.notDeepEqual(labels, ["Explore", "Plan", "Compare", "High schools", "Glossary", "Data"]);
});
