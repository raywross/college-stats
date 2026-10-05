/**
 * Study 5, public colleges and students from other states (specs/trends/out-of-state.md): recomputes the national
 * row and the Northeast's straight from the committed shards, without the shared panel helpers, and checks the panel
 * rule (out-of-state share reported in both falls, 200+ enrolled first-years at the window's start), that odd years
 * are absent (not zero) in the yearly lines, and that the under-30 "most selective" group has no values.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { HistoryMeta, SchoolHistory } from "../lib/history.ts";
import { GROUP_FLOOR } from "../lib/trend-groups.ts";
import type { OutOfStateFile, OutOfStateValues } from "../lib/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const HISTORY = join(ROOT, "data", "history");
const file = JSON.parse(readFileSync(join(HISTORY, "trends", "out-of-state.json"), "utf8")) as OutOfStateFile;
const hmeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8")) as HistoryMeta;
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = readdirSync(join(HISTORY, "schools"))
  .filter((f) => f.endsWith(".json") && byId.has(f.replace(/\.json$/, "")))
  .map((f) => JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory);

const val = (h: SchoolHistory, k: "out_of_state_share" | "international_share" | "enrolled", y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? s.values[y - s.start] : null;
};
const isPublic = (h: SchoolHistory) => byId.get(h.unit_id)!.type === "public";
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
};
const r4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;

const { from, to } = file;
const MIN_ENROLLED = 200;
const panel = shards.filter(
  (h) => isPublic(h) && val(h, "out_of_state_share", from) !== null && val(h, "out_of_state_share", to) !== null && (val(h, "enrolled", from) ?? 0) >= MIN_ENROLLED
);

/** The then-now values of one set of colleges, computed the long way. */
function recompute(hs: SchoolHistory[]): Pick<OutOfStateValues, "medianShare" | "share30"> {
  const ends = (f: (y: number) => number) => [r4(f(from)), r4(f(to))] as [number, number];
  const share = (y: number, test: (v: number) => boolean) => hs.filter((h) => test(val(h, "out_of_state_share", y)!)).length / hs.length;
  return {
    medianShare: ends((y) => median(hs.map((h) => val(h, "out_of_state_share", y)!))),
    share30: ends((y) => share(y, (v) => v >= 0.3)),
  };
}

const pick = (v: OutOfStateValues) => ({ medianShare: v.medianShare, share30: v.share30 });

test("window: fall 2014 to history's newest fall; 200-enrolled floor at the start; 30% bar", () => {
  assert.equal(to, hmeta.latest.fall);
  assert.equal(from, to - 10);
  assert.equal(file.threshold, 0.3);
  assert.equal(file.minEnrolled, 200);
  assert.equal(file.yearKind, "fall");
});

test("the panel is every public college with the share reported in both falls and 200+ enrolled first-years at the window's start", () => {
  assert.equal(file.n, panel.length);
  assert.ok(file.n > 300, `panel of ${file.n} is implausibly small`);
  for (const h of panel) {
    assert.ok((val(h, "enrolled", from) ?? 0) >= MIN_ENROLLED);
    assert.equal(isPublic(h), true);
  }
  // A college short of the floor only at the window's end still qualifies (the floor applies at the start only).
  const onlyAtStart = shards.find(
    (h) => isPublic(h) && val(h, "out_of_state_share", from) !== null && val(h, "out_of_state_share", to) !== null && (val(h, "enrolled", from) ?? 0) >= MIN_ENROLLED && (val(h, "enrolled", to) ?? 0) < MIN_ENROLLED
  );
  if (onlyAtStart) assert.ok(panel.some((h) => h.unit_id === onlyAtStart.unit_id), "a college under the floor only at the end should still be in the panel");
});

test("national row recomputed from the shards", () => {
  assert.deepEqual(pick(file.national.values!), recompute(panel));
  const v = file.national.values!;
  const last = (a: (number | null)[]) => a[a.length - 1];
  assert.equal(last(v.lines.medianShare), v.medianShare[1]);
  assert.equal(last(v.lines.share30), v.share30[1]);
});

test("the Northeast recomputed from the shards (today's region)", () => {
  const row = file.groupings.find((g) => g.grouping === "region")!.groups.find((r) => r.key === "Northeast")!;
  const ne = panel.filter((h) => byId.get(h.unit_id)!.location.region === "Northeast");
  assert.equal(row.n, ne.length);
  assert.deepEqual(pick(row.values!), recompute(ne));
});

test("odd years are absent (null), not zero, in every yearly line", () => {
  const v = file.national.values!;
  for (const key of Object.keys(v.lines) as (keyof OutOfStateValues["lines"])[]) {
    const line = v.lines[key];
    for (let y = file.lineFrom; y <= to; y++) {
      const i = y - file.lineFrom;
      if (y % 2 !== 0) assert.equal(line[i], null, `${key} at ${y} should be null (odd fall, not collected)`);
    }
  }
  assert.equal(v.lines.medianShare.length, to - file.lineFrom + 1);
});

test("groups under 30 colleges have no values (the under-25%-admitted group among publics)", () => {
  const selectivity = file.groupings.find((g) => g.grouping === "selectivity")!;
  const most = selectivity.groups.find((r) => r.key === "most")!;
  assert.ok(most.n < GROUP_FLOOR, "today's panel should have under 30 publics admitting under 25%, per the spec's first look");
  assert.equal(most.tooFew, true);
  assert.equal(most.values, undefined);

  let tooFew = 0;
  for (const g of file.groupings) for (const r of g.groups) if (r.n < GROUP_FLOOR) tooFew++;
  assert.ok(tooFew > 0);
});

test("the premium window lags the residence window by the fall-vs-academic-year gap", () => {
  assert.equal(file.premium.to, hmeta.latest.academic);
  assert.ok(file.premium.to <= to);
});
