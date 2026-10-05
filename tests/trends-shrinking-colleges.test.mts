/**
 * Study 3, shrinking colleges (specs/trends/shrinking-colleges.md): recomputes the national row and the Midwest's
 * straight from the committed shards, without the shared panel helpers, and checks the 300-undergrad floor and that
 * the "students" total-change view uses the same panel as the "colleges" shares.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { HistoryMeta, SchoolHistory } from "../lib/history.ts";
import { GROUP_FLOOR } from "../lib/trend-groups.ts";
import type { ShrinkingCollegesFile, ShrinkingValues } from "../lib/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const HISTORY = join(ROOT, "data", "history");
const file = JSON.parse(readFileSync(join(HISTORY, "trends", "shrinking-colleges.json"), "utf8")) as ShrinkingCollegesFile;
const hmeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8")) as HistoryMeta;
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = readdirSync(join(HISTORY, "schools"))
  .filter((f) => f.endsWith(".json") && byId.has(f.replace(/\.json$/, "")))
  .map((f) => JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory);

const val = (h: SchoolHistory, k: "undergrads" | "applicants" | "enrolled", y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? s.values[y - s.start] : null;
};
const r4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;
const change = (h: SchoolHistory, from: number, to: number): number | null => {
  const a = val(h, "undergrads", from);
  const b = val(h, "undergrads", to);
  return a === null || b === null || a === 0 ? null : r4((b - a) / a);
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
};

const { from, to } = file;
const MIN = file.minUndergrads;
const T = file.threshold;
const panel = shards.filter((h) => [from, to].every((y) => (val(h, "undergrads", y) ?? 0) >= MIN));

/** The window's values over one set of colleges, computed the long way. */
function recompute(hs: SchoolHistory[]): ShrinkingValues {
  const changes = hs.map((h) => change(h, from, to)!);
  const thenTotal = hs.reduce((a, h) => a + val(h, "undergrads", from)!, 0);
  const nowTotal = hs.reduce((a, h) => a + val(h, "undergrads", to)!, 0);
  return {
    shrank10: r4(changes.filter((c) => c <= -T).length / changes.length),
    grew10: r4(changes.filter((c) => c >= T).length / changes.length),
    medianChange: r4(median(changes)),
    totalChange: r4((nowTotal - thenTotal) / thenTotal),
  };
}

test("ten-year window ends with history's newest fall; 10-point bar; 300-undergrad floor", () => {
  assert.equal(to, hmeta.latest.fall);
  assert.equal(from, to - 10);
  assert.equal(file.threshold, 0.1);
  assert.equal(file.minUndergrads, 300);
  assert.equal(file.yearKind, "fall");
});

test("the panel excludes colleges with under 300 undergraduates at either end of the window", () => {
  assert.equal(file.n, panel.length);
  assert.ok(file.n > 1000, `panel of ${file.n} is implausibly small`);
  for (const h of panel) for (const y of [from, to]) assert.ok(val(h, "undergrads", y)! >= MIN, `${h.unit_id} under the floor in ${y}`);
  // A college under the floor at either end (even if over it at the other) is excluded.
  const marginal = shards.find((h) => (val(h, "undergrads", from) ?? 0) >= MIN && (val(h, "undergrads", to) ?? Infinity) < MIN);
  if (marginal) assert.ok(!panel.includes(marginal));
});

test("national row recomputed from the shards", () => {
  assert.deepEqual(file.national.values, recompute(panel));
});

test("the Midwest recomputed from the shards (today's region)", () => {
  const row = file.groupings.find((g) => g.grouping === "region")!.groups.find((r) => r.key === "Midwest")!;
  const mw = panel.filter((h) => byId.get(h.unit_id)!.location.region === "Midwest");
  assert.equal(row.n, mw.length);
  assert.deepEqual(row.values, recompute(mw));
});

test("the total-students change ('students' view) uses the same fixed panel as the 'colleges' shares (control grouping)", () => {
  const g = file.groupings.find((g) => g.grouping === "control")!;
  for (const r of g.groups) {
    if (r.tooFew || !r.values) continue;
    const members = panel.filter((h) => byId.get(h.unit_id)!.type === r.key);
    assert.equal(r.n, members.length, `control/${r.key} panel size`);
    const want = recompute(members);
    assert.deepEqual(r.values, want, `control/${r.key} values`);
    // totalChange is computed over exactly the colleges counted in shrank10/grew10, not a different (e.g. unfiltered) set.
    const thenTotal = members.reduce((a, h) => a + val(h, "undergrads", from)!, 0);
    const nowTotal = members.reduce((a, h) => a + val(h, "undergrads", to)!, 0);
    assert.equal(r.values.totalChange, Math.round(((nowTotal - thenTotal) / thenTotal) * 10_000) / 10_000 || 0);
  }
});

test("groups under 30 colleges have no values", () => {
  // This study's groupings (region/control/size/selectivity/setting/research) all clear 30 today — the invariant
  // still holds, it's just not exercised by the current panel (unlike Study 1's selectivity groups).
  for (const g of file.groupings) for (const r of g.groups) if (r.n < GROUP_FLOOR) assert.equal(r.values, undefined, `${g.grouping}/${r.key}`);
});

test("the five-year window has its own fixed panel, ending at the same fall", () => {
  assert.equal(file.five.to, to);
  assert.equal(file.five.from, to - 5);
  const fivePanel = shards.filter((h) => [file.five.from, file.five.to].every((y) => (val(h, "undergrads", y) ?? 0) >= MIN));
  assert.equal(file.five.n, fivePanel.length);
});

test("the histogram and belowStart line cover the same ten-year panel", () => {
  assert.equal(file.histogram.n, panel.length);
  assert.equal(file.belowStart.length, to - from + 1);
  assert.equal(file.belowStart[0], 0); // no college can be smaller than itself at the window's start
});

test("the companion panel is a subset of the ten-year panel that shrank 10%+", () => {
  const shrunk = panel.filter((h) => (change(h, from, to) ?? 0) <= -T);
  assert.equal(file.companion.n, shrunk.length);
  assert.equal(file.companion.n, Math.round(file.national.values!.shrank10 * file.n));
});
