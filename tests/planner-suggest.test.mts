/**
 * Stage 1's suggestion rules and sorts (lib/planner/suggest.ts; specs/planner/list-building.md "Suggested category",
 * "Sorting"), plus the CSV round-trip for the new dream/priority columns (lib/list-rules.ts). Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIKELY_ADMIT_RATE_MIN,
  REACH_ADMIT_RATE_MAX,
  extendedBalanceLines,
  sortItems,
  suggestCategory,
  suggestionLabel,
  type SortableItem,
} from "../lib/planner/suggest.ts";
import { emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import { toCsv, parseCsv, type CsvRow } from "../lib/list-rules.ts";
import type { PlanSchool } from "../lib/planner/types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function cite(year: string | null): PlanSchool["admitRateCite"] {
  // Only `year` is read by suggest.ts; the rest of a real Cited object is irrelevant to these rules.
  return { year } as PlanSchool["admitRateCite"];
}

let n = 0;
function school(over: Partial<PlanSchool> = {}): PlanSchool {
  return {
    unit_id: `u${++n}`,
    name: `College ${n}`,
    city: null,
    state: null,
    admitRate: null,
    admitRateCite: null,
    avgCost: null,
    avgCostCite: null,
    sticker: null,
    distanceMiles: null,
    links: null,
    social: null,
    profile: null,
    logistics: null,
    aid: null,
    testPolicy: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    satRange: null,
    actRange: null,
    ...over,
  };
}

function profileWith(over: Partial<StudentProfileData["tests"]> = {}): StudentProfileData {
  const p = emptyProfile();
  return { ...p, tests: { ...p.tests, ...over } };
}

/* ------------------------------------------------------------------ */
/* Every rule row (list-building.md "Suggested category")              */
/* ------------------------------------------------------------------ */

test("suggestCategory: admit rate under the threshold suggests Reach, cited with the rate's own year", () => {
  const s = school({ admitRate: REACH_ADMIT_RATE_MAX - 0.001, admitRateCite: cite("2024") });
  const r = suggestCategory(s, null);
  assert.equal(r.category, "reach");
  assert.match(r.reason!, /fewer than 1 in 5/);
  assert.match(r.reason!, /fall 2024/);
  assert.equal(r.cite, s.admitRateCite);
});

test("suggestCategory: an admit rate right at the threshold does not count as Reach by this rule", () => {
  const s = school({ admitRate: REACH_ADMIT_RATE_MAX, admitRateCite: cite("2024") });
  assert.notEqual(suggestCategory(s, null).category, "reach");
});

test("suggestCategory: no reported admit rate suggests Likely (open admission), with no cite and no year", () => {
  const s = school({ admitRate: null });
  const r = suggestCategory(s, null);
  assert.equal(r.category, "likely");
  assert.equal(r.reason, "Admits everyone who applies.");
  assert.equal(r.cite, null);
});

test("suggestCategory: a score above the middle 50% suggests Likely when the admit rate is at or above the threshold, else Target", () => {
  const range: [number, number] = [1200, 1450];
  const likely = school({ admitRate: LIKELY_ADMIT_RATE_MIN, satRange: range, cites: { "derived.sat_total": cite("2024") } });
  const r1 = suggestCategory(likely, profileWith({ satTotal: 1500 }));
  assert.equal(r1.category, "likely");
  assert.match(r1.reason!, /above this college's middle 50%/);
  assert.match(r1.reason!, /1200–1450/);
  assert.match(r1.reason!, /fall 2024/);

  const target = school({ admitRate: LIKELY_ADMIT_RATE_MIN - 0.001, satRange: range, cites: { "derived.sat_total": cite("2024") } });
  assert.equal(suggestCategory(target, profileWith({ satTotal: 1500 })).category, "target");
});

test("suggestCategory: a score inside the middle 50% suggests Target", () => {
  const s = school({ admitRate: 0.4, satRange: [1200, 1450], cites: { "derived.sat_total": cite("2024") } });
  const r = suggestCategory(s, profileWith({ satTotal: 1300 }));
  assert.equal(r.category, "target");
  assert.match(r.reason!, /within this college's middle 50%/);
});

test("suggestCategory: a score below the middle 50% suggests Reach", () => {
  const s = school({ admitRate: 0.4, satRange: [1200, 1450], cites: { "derived.sat_total": cite("2024") } });
  const r = suggestCategory(s, profileWith({ satTotal: 1100 }));
  assert.equal(r.category, "reach");
  assert.match(r.reason!, /below this college's middle 50%/);
});

test("suggestCategory: an ACT score and range work the same way when there's no SAT", () => {
  const s = school({ admitRate: 0.4, actRange: [28, 32], cites: { "admissions.act_composite_25_75": cite("2024") } });
  const r = suggestCategory(s, profileWith({ actComposite: 34 }));
  assert.match(r.reason!, /Your ACT 34 is above/);
});

test("suggestCategory: otherwise, nothing to suggest from", () => {
  const s = school({ admitRate: 0.4 });
  const r = suggestCategory(s, profileWith());
  assert.equal(r.category, "none");
  assert.equal(r.reason, "Add a score or GPA to see a suggestion.");
  assert.equal(r.cite, null);
});

/* ------------------------------------------------------------------ */
/* A profile with no numbers at all                                    */
/* ------------------------------------------------------------------ */

test("suggestCategory: a signed-in student with no saved numbers gets 'none' at a college that needs one, not a guess", () => {
  const s = school({ admitRate: 0.5, satRange: [1200, 1450], actRange: [26, 30] });
  const r = suggestCategory(s, emptyProfile());
  assert.equal(r.category, "none");
});

test("suggestCategory: a guardian's own list (no profile at all) behaves the same as a student with no numbers", () => {
  const s = school({ admitRate: 0.5, satRange: [1200, 1450] });
  assert.equal(suggestCategory(s, null).category, "none");
});

test("suggestionLabel: every real category has a label; 'none' is blank", () => {
  assert.equal(suggestionLabel("reach"), "Reach");
  assert.equal(suggestionLabel("target"), "Target");
  assert.equal(suggestionLabel("likely"), "Likely");
  assert.equal(suggestionLabel("none"), "");
});

/* ------------------------------------------------------------------ */
/* Sorting: "not reported" goes last, in every sort                    */
/* ------------------------------------------------------------------ */

function item(over: Partial<SortableItem> = {}): SortableItem {
  return {
    id: `i${++n}`,
    category: "unsorted",
    position: 0,
    dream: false,
    priority: null,
    admitRate: null,
    avgCost: null,
    distanceMiles: null,
    nextDate: null,
    standing: "none",
    ...over,
  };
}

test("sortItems: admit rate — a college without one sorts last, ascending otherwise", () => {
  const items = [item({ id: "unreported", admitRate: null, position: 0 }), item({ id: "high", admitRate: 0.8, position: 1 }), item({ id: "low", admitRate: 0.1, position: 2 })];
  assert.deepEqual(sortItems(items, "admit_rate").map((i) => i.id), ["low", "high", "unreported"]);
});

test("sortItems: average cost — not reported goes last", () => {
  const items = [item({ id: "unreported", avgCost: null, position: 0 }), item({ id: "cheap", avgCost: 10000, position: 1 }), item({ id: "pricey", avgCost: 60000, position: 2 })];
  assert.deepEqual(sortItems(items, "avg_cost").map((i) => i.id), ["cheap", "pricey", "unreported"]);
});

test("sortItems: distance — no home / no coordinates goes last", () => {
  const items = [item({ id: "far", distanceMiles: 500, position: 0 }), item({ id: "unreported", distanceMiles: null, position: 1 }), item({ id: "near", distanceMiles: 5, position: 2 })];
  assert.deepEqual(sortItems(items, "distance").map((i) => i.id), ["near", "far", "unreported"]);
});

test("sortItems: next date — undated tasks go last", () => {
  const items = [item({ id: "undated", nextDate: null, position: 0 }), item({ id: "later", nextDate: "2026-12-01", position: 1 }), item({ id: "soon", nextDate: "2026-11-01", position: 2 })];
  assert.deepEqual(sortItems(items, "next_date").map((i) => i.id), ["soon", "later", "undated"]);
});

test("sortItems: where I stand — 'none' (no suggestion) goes last, Likely first", () => {
  const items = [
    item({ id: "none", standing: "none", position: 0 }),
    item({ id: "reach", standing: "reach", position: 1 }),
    item({ id: "likely", standing: "likely", position: 2 }),
    item({ id: "target", standing: "target", position: 3 }),
  ];
  assert.deepEqual(sortItems(items, "standing").map((i) => i.id), ["likely", "target", "reach", "none"]);
});

test("sortItems: dream and priority — the Dream first, then priority (unranked last), then the student's own order", () => {
  const items = [
    item({ id: "unranked", dream: false, priority: null, position: 0 }),
    item({ id: "second", dream: false, priority: 2, position: 1 }),
    item({ id: "dream", dream: true, priority: 3, position: 2 }),
    item({ id: "first", dream: false, priority: 1, position: 3 }),
  ];
  assert.deepEqual(sortItems(items, "dream_priority").map((i) => i.id), ["dream", "first", "second", "unranked"]);
});

test("sortItems: category groups Reach/Target/Likely/Unsorted, ties by the student's own order; mine is just position", () => {
  const items = [item({ id: "a", category: "likely", position: 2 }), item({ id: "b", category: "reach", position: 0 }), item({ id: "c", category: "target", position: 1 })];
  assert.deepEqual(sortItems(items, "category").map((i) => i.id), ["b", "c", "a"]);
  assert.deepEqual(sortItems(items, "mine").map((i) => i.id), ["b", "c", "a"]);
});

test("sortItems: never drops a row, whatever the sort", () => {
  const items = [item({ id: "x" }), item({ id: "y" })];
  for (const sort of ["mine", "category", "dream_priority", "next_date", "admit_rate", "avg_cost", "distance", "standing"] as const) {
    assert.equal(sortItems(items, sort).length, 2, sort);
  }
});

/* ------------------------------------------------------------------ */
/* The balance line, extended                                          */
/* ------------------------------------------------------------------ */

test("extendedBalanceLines: no Likely, no Target, only Reach, and over budget each show as their own fact", () => {
  const onlyReach = extendedBalanceLines([{ category: "reach", avgCost: null }, { category: "reach", avgCost: null }]);
  assert.deepEqual(onlyReach.map((l) => l.text), ["Only Reaches so far."]);

  const noLikely = extendedBalanceLines([{ category: "reach", avgCost: null }, { category: "target", avgCost: null }]);
  assert.deepEqual(noLikely.map((l) => l.text), ["No Likely yet."]);

  const noTarget = extendedBalanceLines([{ category: "reach", avgCost: null }, { category: "likely", avgCost: null }]);
  assert.deepEqual(noTarget.map((l) => l.text), ["No Target yet."]);
});

test("extendedBalanceLines: average cost above the family's limit, counted", () => {
  const lines = extendedBalanceLines(
    [{ category: "target", avgCost: 40000 }, { category: "target", avgCost: 20000 }, { category: "likely", avgCost: 15000 }],
    { maxAverageCost: 30000 },
  );
  assert.ok(lines.some((l) => l.text === "Average cost above your family's limit at 1 college."));
});

test("extendedBalanceLines: a large list is noted against Common App's average, with no advice attached", () => {
  const items = Array.from({ length: 13 }, () => ({ category: "unsorted" as const, avgCost: null }));
  const lines = extendedBalanceLines(items);
  assert.ok(lines.some((l) => /^13 colleges: Common App's average is 7\.$/.test(l.text)));
});

test("extendedBalanceLines: a short, balanced list says nothing extra", () => {
  const lines = extendedBalanceLines([{ category: "reach", avgCost: null }, { category: "target", avgCost: null }, { category: "likely", avgCost: null }, { category: "likely", avgCost: null }]);
  assert.deepEqual(lines, []);
});

/* ------------------------------------------------------------------ */
/* CSV round-trip with the new dream/priority columns                  */
/* ------------------------------------------------------------------ */

test("toCsv / parseCsv: dream and priority round-trip", () => {
  const rows: CsvRow[] = [
    {
      name: "Dream U",
      category: "target",
      round: null,
      status: "considering",
      outcome: null,
      deadline: null,
      enrolling: false,
      notes: "",
      updates: true,
      visited_on: null,
      follows_social: false,
      dream: true,
      priority: 1,
    },
    {
      name: "No Dream College",
      category: "likely",
      round: null,
      status: "considering",
      outcome: null,
      deadline: null,
      enrolling: false,
      notes: "",
      updates: true,
      visited_on: null,
      follows_social: false,
      dream: false,
      priority: null,
    },
  ];
  const csv = toCsv(rows);
  assert.match(csv.split("\n")[0], /,dream,priority$/);
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].dream, true);
  assert.equal(parsed[0].priority, 1);
  assert.equal(parsed[1].dream, false);
  assert.equal(parsed[1].priority, null);
});

test("parseCsv: dream/priority are optional — a plain Scoir export still parses, with both off/unset", () => {
  const parsed = parseCsv("College,Category,Round,Status,Outcome,Deadline,Enrolling,Notes\nRice University,Target,,Considering,,,,");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].dream, false);
  assert.equal(parsed[0].priority, null);
});

test("parseCsv: a non-numeric or out-of-range priority is dropped, not coerced to 0 or clamped", () => {
  const parsed = parseCsv("College,Category,Round,Status,Outcome,Deadline,Enrolling,Notes,updates,visited_on,follows_social,dream,priority\nRice University,Target,,,,,,,,,,,abc");
  assert.equal(parsed[0].priority, null);
  const parsed2 = parseCsv("College,Category,Round,Status,Outcome,Deadline,Enrolling,Notes,updates,visited_on,follows_social,dream,priority\nRice University,Target,,,,,,,,,,,0");
  assert.equal(parsed2[0].priority, null);
});
