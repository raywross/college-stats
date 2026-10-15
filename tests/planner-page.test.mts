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
  joinNames,
  nextUpGroup,
  nextUpInfo,
  personPlanRedirectHref,
  resolveSelectedChild,
  seasonWords,
  shortSummaryLine,
  weekdayLabel,
} from "../lib/planner/plan-frame.ts";
import type { PlanRowView, PlanView } from "../lib/planner/plan-view.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ------------------------------------------------------------------ */
/* Route choice per viewer                                             */
/* ------------------------------------------------------------------ */

test("resolveSelectedChild: ?for= wins, else the last viewed, else the soonest open deadline, else the first (decision 2026-10-11: no Everyone)", () => {
  const two = [{ studentId: "a" }, { studentId: "b" }];
  assert.equal(resolveSelectedChild({ forParam: "b", children: two }), "b");
  assert.equal(resolveSelectedChild({ forParam: "nope", children: two }), "a"); // not a real child: falls through to the default
  assert.equal(resolveSelectedChild({ forParam: "everyone", children: two }), "a"); // a legacy ?for=everyone link falls through too
  assert.equal(resolveSelectedChild({ forParam: null, children: two }), "a"); // two children, no pick, no cookie, no deadline: the first
  assert.equal(resolveSelectedChild({ forParam: null, children: [{ studentId: "a" }] }), "a"); // one child: no switcher needed
  assert.equal(resolveSelectedChild({ forParam: "a", children: [] }), null); // no children at all

  // The last-viewed cookie wins over the default, but never over an explicit, valid ?for=.
  assert.equal(resolveSelectedChild({ forParam: null, children: two, lastViewed: "b" }), "b");
  assert.equal(resolveSelectedChild({ forParam: "a", children: two, lastViewed: "b" }), "a");
  assert.equal(resolveSelectedChild({ forParam: null, children: two, lastViewed: "nope" }), "a"); // an unknown cookie is ignored

  // With no ?for= and no cookie, the child with the soonest open deadline wins.
  const withDeadlines = [
    { studentId: "a", nextDeadline: "2026-12-01" },
    { studentId: "b", nextDeadline: "2026-11-01" },
    { studentId: "c", nextDeadline: null },
  ];
  assert.equal(resolveSelectedChild({ forParam: null, children: withDeadlines }), "b");
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

function row(overrides: {
  status?: string;
  withdrawn_on?: string | null;
  deadline?: { iso: string } | null;
  decision?: { iso: string } | null;
  name?: string;
  round?: string;
}): PlanRowView {
  return {
    item: { status: overrides.status ?? "considering", withdrawn_on: overrides.withdrawn_on ?? null },
    school: overrides.name ? { name: overrides.name } : null,
    dream: false,
    standing: null,
    group: "unsorted",
    groupAuto: true,
    round: overrides.round ?? "rd",
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
  return { student: { gpa: 3.8, test: { kind: "sat", score: 1400 } }, rows, balance: { reach: 0, target: 0, likely: 0 }, balanceLine: null, problems: [], retake: null, next, inSeason: true, notices: [] } as unknown as PlanView;
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

test("weekdayLabel formats an ISO date as 'Thu, Oct 15'", () => {
  assert.equal(weekdayLabel("2026-10-15"), "Thu, Oct 15");
  assert.equal(weekdayLabel("2027-01-01"), "Fri, Jan 1");
});

test("joinNames: one name as itself, two joined with 'and', three or more with a comma list and 'and'", () => {
  assert.equal(joinNames([]), "A college");
  assert.equal(joinNames(["Georgia"]), "Georgia");
  assert.equal(joinNames(["Georgia", "South Carolina"]), "Georgia and South Carolina");
  assert.equal(joinNames(["Georgia", "South Carolina", "Clemson"]), "Georgia, South Carolina, and Clemson");
});

test("nextUpGroup: every open row sharing Next up's exact deadline and round, for joining names", () => {
  const ga = row({ name: "Georgia", round: "ea", deadline: { iso: "2026-10-15" } });
  const sc = row({ name: "South Carolina", round: "ea", deadline: { iso: "2026-10-15" } });
  const other = row({ name: "Elsewhere", round: "rd", deadline: { iso: "2026-10-15" } }); // same date, different round
  const later = row({ name: "Later", round: "ea", deadline: { iso: "2026-11-01" } }); // same round, later date
  const withdrawn = row({ name: "Withdrawn", round: "ea", deadline: { iso: "2026-10-15" }, withdrawn_on: "2026-09-01" });
  const v = view(ga, [ga, sc, other, later, withdrawn]);
  const info = nextUpInfo({ view: v, today: "2026-10-08", cycleStartYear: 2026 });
  const group = nextUpGroup(v, info);
  assert.deepEqual(
    group.map((r) => r.school?.name),
    ["Georgia", "South Carolina"],
  );
});

test("nextUpGroup: for a decision, every applied row sharing the exact decision date", () => {
  const a = row({ name: "A", status: "applied", decision: { iso: "2026-12-15" } });
  const b = row({ name: "B", status: "applied", decision: { iso: "2026-12-15" } });
  const v = view(a, [a, b]);
  const info = nextUpInfo({ view: v, today: "2026-12-01", cycleStartYear: 2026 });
  assert.deepEqual(
    nextUpGroup(v, info).map((r) => r.school?.name),
    ["A", "B"],
  );
});

test("nextUpGroup: nothing to group before the season or with nothing dated", () => {
  const info = nextUpInfo({ view: view(null), today: "2026-05-01", cycleStartYear: 2026 });
  assert.deepEqual(nextUpGroup(view(null), info), []);
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

test("the plan opens on Next steps (owner, 2026-10-14): the page and the frame fall back to defaultTab, which is next; PlanTabs renders it with Footprints", async () => {
  const { defaultTab } = await import("../lib/planner/plan-tabs.ts");
  assert.equal(defaultTab("student", false), "next");
  assert.equal(defaultTab("guardian", false), "next");
  const page = read("app/plan/page.tsx");
  assert.match(page, /tab=\{tab \?\? defaultTab\("student", false\)\}/);
  assert.match(page, /tab=\{tab \?\? defaultTab\("guardian", false\)\}/);
  assert.match(read("components/planner/PlanFrame.tsx"), /: defaultTab\(viewer, false\)/);
  const tabs = read("components/planner/PlanTabs.tsx");
  assert.match(tabs, /next: Footprints/);
  assert.match(tabs, /tab === "next" && <NextSteps /);
});

test("guard: a header missing Plan, or out of order, is caught by the label check", () => {
  const bad = 'const NAV_ITEMS = [{ label: "Explore", href: "/explore" }, { label: "Compare", href: "/compare" }];';
  const labels = [...bad.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.notDeepEqual(labels, ["Explore", "Plan", "Compare", "High schools", "Glossary", "Data"]);
});
