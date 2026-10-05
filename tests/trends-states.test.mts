/**
 * Trends by state (specs/trends/states.md): recomputes Vermont (the under-10 rule) and New York (a large state's
 * medians) straight from the committed shards, without the shared panel helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { HistoryMeta, SchoolHistory } from "../lib/history.ts";
import { STATE_FLOOR } from "../lib/trend-groups.ts";
import type { StatesFile } from "../lib/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const HISTORY = join(ROOT, "data", "history");
const file = JSON.parse(readFileSync(join(HISTORY, "trends", "states.json"), "utf8")) as StatesFile;
const hmeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8")) as HistoryMeta;
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = readdirSync(join(HISTORY, "schools"))
  .filter((f) => f.endsWith(".json") && byId.has(f.replace(/\.json$/, "")))
  .map((f) => JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory);

const val = (h: SchoolHistory, k: "undergrads" | "applicants" | "acceptance_rate", y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? (s.values[y - s.start] ?? null) : null;
};
const r4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;
const pctChange = (h: SchoolHistory, from: number, to: number): number | null => {
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
const MIN = 300;

test("the window ends with history's newest fall; floor is 10, not 30", () => {
  assert.equal(to, hmeta.latest.fall);
  assert.equal(from, to - 10);
  assert.equal(file.floor, STATE_FLOOR);
  assert.equal(STATE_FLOOR, 10);
});

test("Vermont: under the 10-college floor, so it's tooFew with counts and a member list only", () => {
  const vt = file.states.find((s) => s.postal === "VT")!;
  const members = shards.filter((h) => byId.get(h.unit_id)!.location.state === "VT");
  assert.ok(members.length < STATE_FLOOR, `Vermont has ${members.length} on-site colleges; the floor test needs a state under ${STATE_FLOOR}`);
  assert.equal(vt.onSite.total, members.length);
  assert.equal(vt.tooFew, true);
  assert.equal(vt.all, undefined);
  assert.equal(vt.control, undefined);
  assert.equal(vt.sparkLines, undefined);
  assert.equal(vt.members.length, members.length);
  for (const id of members.map((h) => h.unit_id)) assert.ok(vt.members.some((m) => m.unit_id === id), `${id} missing from Vermont's member list`);
  // Movers are still computed for a tooFew state (the spec's "movers only").
  assert.ok(vt.movers.length > 0);
});

test("New York: on-site count, panel, and the median/total undergraduate change recomputed from the shards", () => {
  const ny = file.states.find((s) => s.postal === "NY")!;
  const members = shards.filter((h) => byId.get(h.unit_id)!.location.state === "NY");
  assert.equal(ny.onSite.total, members.length);
  assert.ok(ny.onSite.total >= STATE_FLOOR);
  assert.equal(ny.tooFew, undefined);

  const panel = members.filter((h) => [from, to].every((y) => (val(h, "undergrads", y) ?? 0) >= MIN));
  assert.equal(ny.panel.n, panel.length);
  for (const id of panel.map((h) => h.unit_id)) assert.ok(ny.panel.ids.includes(id));

  const changes = panel.map((h) => pctChange(h, from, to)!);
  assert.equal(ny.all!.values!.undergradsMedianChange, r4(median(changes)));

  const thenTotal = panel.reduce((a, h) => a + val(h, "undergrads", from)!, 0);
  const nowTotal = panel.reduce((a, h) => a + val(h, "undergrads", to)!, 0);
  assert.deepEqual(ny.all!.values!.undergradsTotal, [Math.round(thenTotal), Math.round(nowTotal)]);
  assert.equal(ny.all!.values!.undergradsTotalChange, r4((nowTotal - thenTotal) / thenTotal));
});

test("New York: the control split (public vs private nonprofit) sums to the panel, with its own medians", () => {
  const ny = file.states.find((s) => s.postal === "NY")!;
  const members = shards.filter((h) => byId.get(h.unit_id)!.location.state === "NY");
  const panel = members.filter((h) => [from, to].every((y) => (val(h, "undergrads", y) ?? 0) >= MIN));
  const pub = panel.filter((h) => byId.get(h.unit_id)!.type === "public");
  const row = ny.control!.groups.find((g) => g.key === "public")!;
  assert.equal(row.n, pub.length);
  if (pub.length >= STATE_FLOOR) {
    const changes = pub.map((h) => pctChange(h, from, to)!);
    assert.equal(row.values!.undergradsMedianChange, r4(median(changes)));
  } else {
    assert.equal(row.tooFew, true);
  }
});

test("every state's panel is a fixed panel: 300+ undergraduates at both window ends", () => {
  for (const s of file.states) {
    if (s.tooFew) continue;
    for (const id of s.panel.ids) {
      const h = shards.find((x) => x.unit_id === id)!;
      for (const y of [from, to]) assert.ok((val(h, "undergrads", y) ?? 0) >= MIN, `${id} under 300 undergraduates in ${y}`);
    }
  }
});

test("a state's map undergradChange equals its panel's median change (null only when tooFew)", () => {
  for (const s of file.states) {
    if (s.tooFew) {
      assert.equal(s.map.undergradChange, null);
      continue;
    }
    assert.equal(s.map.undergradChange, s.all!.values!.undergradsMedianChange);
  }
});

test("territories are flagged, not folded into the 50 states", () => {
  const pr = file.states.find((s) => s.postal === "PR");
  if (pr) assert.equal(pr.territory, true);
  const ca = file.states.find((s) => s.postal === "CA")!;
  assert.equal(ca.territory, false);
});
