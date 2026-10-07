/**
 * Discovery instrumentation (specs/product/telemetry.md, Unit D): search, Explore, compare, and the score checker
 * report through the registry. The pure decisions are tested directly; the components are source-scanned so the
 * instrumentation can't be removed or start sending a query or a score unnoticed. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  exploreChangeEvents,
  isPresetCompare,
  scoreInRange,
  toggledCompare,
} from "../lib/discovery-events.ts";
import { EVENTS, resultCountBucket } from "../lib/analytics.ts";

const ROOT = join(import.meta.dirname, "..");

/** Code with comments removed, so documentation doesn't trip the guards. */
function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The argument text of every `track(` call in `src` (balanced parentheses). */
function trackCalls(src: string): string[] {
  const calls: string[] = [];
  for (const m of src.matchAll(/\btrack\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    calls.push(src.slice(start, i - 1));
  }
  return calls;
}

// ---- Explore ----

test("a filter change is explore_filtered with the key names, the view, and the active filter count", () => {
  const events = exploreChangeEvents(["minSAT", "maxSAT"], { minSAT: "1200", maxSAT: "1500", states: "CA" });
  assert.deepEqual(events, [
    { event: "explore_filtered", properties: { filter: "minSAT+maxSAT", view: "grid", active_filter_count: 2 } },
  ]);
});

test("a view change is explore_view_changed only, with the new view", () => {
  assert.deepEqual(exploreChangeEvents(["view"], { view: "table" }), [
    { event: "explore_view_changed", properties: { view: "table" } },
  ]);
  // Back to grid removes the param: the default view.
  assert.deepEqual(exploreChangeEvents(["view"], {}), [{ event: "explore_view_changed", properties: { view: "grid" } }]);
});

test("a view change alongside a filter change sends both; sorting counts as a filter; page counts for nothing", () => {
  const both = exploreChangeEvents(["view", "sortBy"], { view: "map", sortBy: "net_price" });
  assert.deepEqual(
    both.map((e) => e.event),
    ["explore_view_changed", "explore_filtered"]
  );
  assert.equal(both[1].event === "explore_filtered" && both[1].properties.filter, "sortBy");
  assert.deepEqual(exploreChangeEvents(["page"], { page: "3" }), []);
  assert.deepEqual(exploreChangeEvents([], {}), []);
  const paged = exploreChangeEvents(["page", "q"], { q: "tech" });
  assert.equal(paged.length, 1);
  assert.equal(paged[0].event === "explore_filtered" && paged[0].properties.filter, "q");
});

test("explore events carry key names, never values (a search text or a score typed into a filter)", () => {
  const events = exploreChangeEvents(["q", "mySAT"], { q: "secret college text", mySAT: "1337" });
  const sent = JSON.stringify(events);
  assert.ok(!sent.includes("secret"), "the query text leaked");
  assert.ok(!sent.includes("1337"), "a score leaked");
});

test("explore events pass the registry unchanged (every property is registered)", () => {
  for (const e of exploreChangeEvents(["view", "states"], { view: "chart", states: "CA" })) {
    assert.deepEqual(Object.keys(e.properties).sort(), [...EVENTS[e.event].properties].sort());
  }
});

// ---- Compare ----

test("toggling adds, removes, and a full list refuses an add (no change, no event)", () => {
  assert.deepEqual(toggledCompare(["a"], "b", 4), { ids: ["a", "b"], action: "add" });
  assert.deepEqual(toggledCompare(["a", "b"], "a", 4), { ids: ["b"], action: "remove" });
  assert.deepEqual(toggledCompare(["a", "b", "c", "d"], "e", 4), { ids: ["a", "b", "c", "d"], action: null });
  assert.deepEqual(toggledCompare(["a", "b", "c", "d"], "d", 4), { ids: ["a", "b", "c"], action: "remove" });
  assert.deepEqual(toggledCompare([], "a", 4), { ids: ["a"], action: "add" });
});

test("toggledCompare doesn't mutate the stored list", () => {
  const stored = ["a", "b"];
  toggledCompare(stored, "c", 4);
  assert.deepEqual(stored, ["a", "b"]);
});

test("a compare view is a preset when the URL's colleges differ from the saved list", () => {
  assert.equal(isPresetCompare(["a", "b"], ["a", "b"]), false);
  assert.equal(isPresetCompare([], ["a", "b"]), true);
  assert.equal(isPresetCompare(["a", "b"], ["b", "a"]), true);
  assert.equal(isPresetCompare(["a"], ["a", "b"]), true);
});

// ---- Score checker ----

test("a score is in range inside the middle 50%, edges included; null without a range", () => {
  assert.equal(scoreInRange(1450, [1400, 1550]), true);
  assert.equal(scoreInRange(1400, [1400, 1550]), true);
  assert.equal(scoreInRange(1550, [1400, 1550]), true);
  assert.equal(scoreInRange(1399, [1400, 1550]), false);
  assert.equal(scoreInRange(1551, [1400, 1550]), false);
  assert.equal(scoreInRange(30, null), null);
  assert.equal(scoreInRange(30, undefined), null);
});

test("search result counts are bucketed, never exact", () => {
  assert.deepEqual([0, 1, 2, 5, 6, 40].map(resultCountBucket), ["0", "1", "2-5", "2-5", "6+", "6+"]);
});

// ---- Source guards: the instrumentation stays, and stays free of what people type ----

const INSTRUMENTED: [path: string, event: string][] = [
  ["components/search/SchoolSearch.tsx", "search_performed"],
  ["components/explore/useExploreParams.ts", "explore_filtered"],
  ["lib/compare.ts", "compare_changed"],
  ["components/compare/CompareViewed.tsx", "compare_viewed"],
  ["components/school/ScoreChecker.tsx", "score_checked"],
];

test("each discovery component imports track from @/lib/analytics and calls it", () => {
  for (const [path, event] of INSTRUMENTED) {
    const src = code(path);
    assert.match(src, /import \{[^}]*\btrack\b[^}]*\} from "@\/lib\/analytics"/, `${path} must import track`);
    assert.ok(trackCalls(src).length > 0, `${path} never calls track(`);
    // The Explore hook sends its events by name through the helper; the others spell them out.
    if (path !== "components/explore/useExploreParams.ts") assert.ok(src.includes(`"${event}"`), `${path} must send ${event}`);
  }
  assert.match(code("components/explore/useExploreParams.ts"), /exploreChangeEvents\(/);
});

test("SchoolSearch never sends the query", () => {
  const calls = trackCalls(code("components/search/SchoolSearch.tsx"));
  assert.ok(calls.length > 0);
  for (const call of calls) assert.ok(!/query|\bq\b|href/i.test(call), `a track() call mentions the query: ${call}`);
});

test("SchoolSearch takes a required source and every instance passes one", () => {
  assert.match(code("components/search/SchoolSearch.tsx"), /\n\s*source: "hero" \| "header" \| "tabbar";/);
  const expected: [string, string, number][] = [
    ["app/page.tsx", "hero", 1],
    ["components/layout/Header.tsx", "header", 2],
    ["components/layout/BottomNav.tsx", "tabbar", 1],
  ];
  for (const [path, source, count] of expected) {
    const src = code(path);
    const tags = src.match(/<SchoolSearch\b[^>]*>/g) ?? [];
    assert.equal(tags.length, count, `${path} renders ${count} SchoolSearch`);
    for (const tag of tags) assert.ok(tag.includes(`source="${source}"`), `${path}: ${tag} needs source="${source}"`);
  }
});

test("a picked search marks the next view as from search; an Explore submit doesn't", () => {
  const src = code("components/search/SchoolSearch.tsx");
  assert.match(src, /if \(picked\) markNextViewFrom\("search"\)/);
});

test("ScoreChecker sends only the test and whether it was in range, only for typed entries", () => {
  const src = code("components/school/ScoreChecker.tsx");
  const calls = trackCalls(src);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.match(call, /^"score_checked", \{ test, in_range: [^}]*\}$/);
  // Properties are `test` and `in_range`; the entry itself must not be a property.
  assert.ok(!/\b(you|raw|value|score)\b\s*[,:}]/.test(call.replace(/in_range:.*$/, "")), "the score is a property");
  assert.match(src, /if \(!typed \|\| you === null/, "prefilled values must not be reported");
  assert.match(src, /setTyped\(true\)/);
  assert.match(src, /, 800\)/, "the report must be debounced");
  assert.match(src, /reported\.current\.has\(entry\)/, "each entry is reported once");
});

test("CompareViewed is rendered before CompareHeader so it reads the saved list before the header syncs it", () => {
  const src = code("app/compare/page.tsx");
  const viewed = src.indexOf("<CompareViewed");
  const header = src.indexOf("<CompareHeader");
  assert.ok(viewed > 0 && header > 0, "both render on the compare overview");
  assert.ok(viewed < header, "CompareViewed must come first");
});

test("clearing the compare list and toggling report, and setCompareIds (the URL sync) does not", () => {
  const src = code("lib/compare.ts");
  const calls = trackCalls(src);
  assert.equal(calls.length, 2);
  assert.ok(calls.some((c) => c.includes('action: "clear", count: 0')));
  assert.ok(calls.some((c) => /action, count: ids\.length/.test(c)));
  const setter = /export function setCompareIds[\s\S]*?\n}/.exec(src)?.[0] ?? "";
  assert.ok(setter && !setter.includes("track("), "setCompareIds is URL sync, not a user action");
});
