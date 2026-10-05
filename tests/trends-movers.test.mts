/**
 * Biggest movers (specs/trends/top-10-lists.md): every entry clears its list's floors, no excluded college appears,
 * ranks and ties follow rule 5, the reviewed exclusion files are well formed, every series a list reads is cited, and
 * one list ("Applications surged", ten years) is recomputed straight from the shards without lib/movers.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { SERIES, type HistoryMeta, type SchoolHistory, type SeriesKey } from "../lib/history.ts";
import {
  ENTERING_CLASS_SERIES,
  MOVER_LISTS,
  MOVER_WINDOWS,
  campusExcluded,
  computeMovers,
  exclusionSets,
  formatMoverChange,
  moverSeries,
  shownEntries,
  type CampusExclusionEntry,
  type ExclusionEntry,
  type MoverListDef,
} from "../lib/movers.ts";
import { parseFilters } from "../lib/params.ts";
import type { MoversFile } from "../lib/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const HISTORY = join(ROOT, "data", "history");
const read = <T,>(p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T;
const file = read<MoversFile>("data/history/trends/movers.json");
const hmeta = read<HistoryMeta>("data/history/meta.json");
const schools = read<School[]>("data/schools.json");
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = new Map(
  readdirSync(join(HISTORY, "schools"))
    .filter((f) => f.endsWith(".json") && byId.has(f.replace(/\.json$/, "")))
    .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory])
);
const onlineFirst = read<ExclusionEntry[]>("data/trends/online-first.json");
const campuses = read<CampusExclusionEntry[]>("data/trends/excluded-campuses.json");
const LISTS = MOVER_LISTS as readonly MoverListDef[];

const val = (h: SchoolHistory, k: SeriesKey, y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? s.values[y - s.start] : null;
};
const floorAt = (h: SchoolHistory, series: SeriesKey | "entering_class", y: number): number | null => {
  if (series !== "entering_class") return val(h, series, y);
  const parts = ENTERING_CLASS_SERIES.map((k) => val(h, k, y));
  return parts.every((v) => v === null) ? null : parts.reduce<number>((a, v) => a + (v ?? 0), 0);
};
const latestUndergrads = (id: string) => val(shards.get(id)!, "undergrads", hmeta.latest.fall) ?? byId.get(id)!.demographics.undergrad_enrollment;

test("movers.json has every list for every window, with the registry's years", () => {
  assert.deepEqual(
    file.windows.map((w) => w.years),
    [...MOVER_WINDOWS]
  );
  for (const w of file.windows) {
    assert.deepEqual(
      w.lists.map((l) => l.key),
      LISTS.map((l) => l.key)
    );
    for (const l of w.lists) {
      const def = LISTS.find((d) => d.key === l.key)!;
      assert.equal(l.kind, def.kind);
      assert.equal(l.to, hmeta.latest[def.kind], `${l.key}: ends at history's newest ${def.kind} year`);
      assert.equal(l.from, l.to - w.years);
      assert.deepEqual(l.floors, def.floors);
    }
  }
});

test("every entry clears its list's floors, moved the list's way, and is ranked by change with ties sharing a rank", () => {
  for (const w of file.windows) {
    for (const l of w.lists) {
      const def = LISTS.find((d) => d.key === l.key)!;
      assert.ok(l.entries.length >= file.shown, `${l.key} ${w.years}y has at least ${file.shown} entries`);
      l.entries.forEach((e, i) => {
        const h = shards.get(e.unit_id)!;
        assert.ok(e.since >= l.from && e.since <= l.from + 2, `${e.name}: starts within 2 years of the window`);
        for (const f of def.floors) {
          for (const y of f.at === "both" ? [e.since, l.to] : [e.since]) {
            assert.ok((floorAt(h, f.series, y) ?? -1) >= f.min, `${l.key} ${w.years}y: ${e.name} has ${f.series} ${floorAt(h, f.series, y)} in ${y}, floor ${f.min}`);
          }
        }
        if (def.types) assert.ok(def.types.includes(byId.get(e.unit_id)!.type), `${e.name} is ${def.types.join("/")}`);
        assert.ok((def.direction === "up" ? 1 : -1) * e.change > 0, `${e.name} moved ${def.direction}`);
        if (i > 0) {
          const prev = l.entries[i - 1];
          assert.ok((def.direction === "up" ? prev.change >= e.change : prev.change <= e.change), `${l.key}: ranked by change`);
          assert.equal(e.rank, prev.change === e.change ? prev.rank : i + 1, `${l.key}: competition rank`);
        }
      });
      assert.ok(l.entries.every((e) => e.rank <= file.kept), "no rank past the kept count");
      assert.ok(shownEntries(l.entries, file.shown).every((e) => e.rank <= file.shown));
    }
  }
});

test("no excluded college appears: closed or reorganized campuses, under 300 today, for-profits and online-first on growth lists", () => {
  const online = new Set(onlineFirst.map((e) => e.unit_id));
  const camp = new Map(campuses.map((e) => [e.unit_id, e]));
  for (const w of file.windows) {
    for (const l of w.lists) {
      const def = LISTS.find((d) => d.key === l.key)!;
      for (const e of l.entries) {
        assert.ok(!campusExcluded(camp.get(e.unit_id), e.since, l.to), `${e.name} is on the excluded-campuses list for ${e.since}–${l.to}`);
        assert.ok(latestUndergrads(e.unit_id) >= file.rules.stillOpenMinUndergrads, `${e.name} has under 300 undergraduates today`);
        if (def.campusBased) {
          assert.notEqual(byId.get(e.unit_id)!.type, "private-forprofit", `${e.name} is for-profit (${l.key})`);
          assert.ok(!online.has(e.unit_id), `${e.name} is online-first (${l.key})`);
        }
      }
    }
  }
  // The first look's problem colleges (spec): none on a growth or decline list.
  const growth = file.windows.flatMap((w) => w.lists.filter((l) => l.key === "grew-most" || l.key === "applications-surged" || l.key === "shrank-most"));
  for (const id of ["183026", "126827", "231165", "482635", "120184", "199582"]) {
    assert.ok(!growth.some((l) => l.entries.some((e) => e.unit_id === id)), `${byId.get(id)?.name} is kept off the growth and decline lists`);
  }
});

test("the reviewed exclusion files are well formed: known colleges, a reason and date each, no duplicates", () => {
  for (const [name, entries] of [["online-first", onlineFirst], ["excluded-campuses", campuses]] as const) {
    const ids = entries.map((e) => e.unit_id);
    assert.equal(new Set(ids).size, ids.length, `${name}: no duplicate ids`);
    for (const e of entries) {
      assert.ok(byId.has(e.unit_id), `${name}: ${e.unit_id} is in the dataset`);
      assert.equal(e.name, byId.get(e.unit_id)!.name, `${name}: ${e.unit_id}'s name matches the dataset`);
      assert.ok(e.reason.length > 20, `${name}: ${e.name} has a reason`);
      assert.match(e.added, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
  for (const e of onlineFirst) assert.notEqual(byId.get(e.unit_id)!.type, "private-forprofit", "for-profits are excluded by rule, not listed");
  for (const e of campuses) {
    if (e.before !== undefined) assert.ok(Number.isInteger(e.before));
    if (e.years) assert.ok(e.years.length && e.years.every(Number.isInteger));
  }
  // A window entirely after a merger keeps the merged college; one spanning it doesn't.
  assert.equal(campusExcluded({ before: 2018 }, 2014, 2024), true);
  assert.equal(campusExcluded({ before: 2018 }, 2019, 2024), false);
  assert.equal(campusExcluded({ years: [2019] }, 2019, 2024), true);
  assert.equal(campusExcluded({ years: [2019] }, 2014, 2024), false);
  assert.equal(campusExcluded({}, 2014, 2024), true);
});

test("Applications surged, ten years, recomputed from the shards without lib/movers.ts", () => {
  const [from, to] = [hmeta.latest.fall - 10, hmeta.latest.fall];
  const online = new Set(onlineFirst.map((e) => e.unit_id));
  const camp = new Map(campuses.map((e) => [e.unit_id, e]));
  const jumpy = (h: SchoolHistory, y: number) => {
    const [a, b, c] = [val(h, "applicants", y - 1), val(h, "applicants", y), val(h, "applicants", y + 1)];
    const j = (x: number | null, z: number | null) => !!x && !!z && x >= 50 && (z / x > 3 || x / z > 3);
    return j(a, b) || j(b, c);
  };
  const rows: { id: string; change: number }[] = [];
  for (const [id, h] of shards) {
    const s = byId.get(id)!;
    const end = val(h, "applicants", to);
    const since = [from, from + 1, from + 2].find((y) => val(h, "applicants", y) !== null);
    if (end === null || since === undefined) continue;
    const start = val(h, "applicants", since)!;
    if (start < 2000) continue;
    const c = camp.get(id);
    const closed = c && (c.before === undefined && c.years === undefined ? true : (c.before !== undefined && since < c.before) || !!c.years?.some((y) => y === since || y === to));
    if (closed || latestUndergrads(id) < 300 || s.type === "private-forprofit" || online.has(id) || jumpy(h, since) || jumpy(h, to)) continue;
    rows.push({ id, change: end / start - 1 });
  }
  const list = file.windows.find((w) => w.years === 10)!.lists.find((l) => l.key === "applications-surged")!;
  assert.equal(list.n, rows.length, "colleges ranked");
  const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
  const sorted = rows
    .map((r) => ({ ...r, key: r4(r.change) }))
    .filter((r) => r.key > 0)
    .sort((a, b) => b.key - a.key || (a.id < b.id ? -1 : 1));
  assert.deepEqual(
    list.entries.map((e) => e.unit_id),
    sorted.slice(0, list.entries.length).map((r) => r.id)
  );
  list.entries.forEach((e, i) => assert.equal(e.change, sorted[i].key));
  const all = rows.map((r) => r.change).sort((a, b) => a - b);
  const mid = (all.length - 1) / 2;
  assert.equal(list.median, Math.round(((all[Math.floor(mid)] + all[Math.ceil(mid)]) / 2) * 10_000) / 10_000, "median college");
});

test("computeMovers over a subset (a state's colleges) applies the same rules", () => {
  const ctx = {
    cpi: read<Parameters<typeof computeMovers>[3]["cpi"]>("data/history/cpi.json"),
    latest: hmeta.latest,
    exclusions: exclusionSets(onlineFirst, campuses),
  };
  const members = [...shards].filter(([id]) => byId.get(id)!.location.state === "GA").map(([id, h]) => ({ school: byId.get(id)!, h }));
  const def = LISTS.find((l) => l.key === "applications-surged")!;
  const ga = computeMovers(members, def, 10, ctx);
  const national = file.windows.find((w) => w.years === 10)!.lists.find((l) => l.key === def.key)!;
  // Every Georgia college the national list ranks appears in Georgia's list in the same order.
  const gaInNational = national.entries.filter((e) => byId.get(e.unit_id)!.location.state === "GA").map((e) => e.unit_id);
  assert.deepEqual(ga.entries.map((e) => e.unit_id).slice(0, gaInNational.length), gaInNational);
  assert.ok(ga.entries.every((e) => byId.get(e.unit_id)!.location.state === "GA"));
});

test("every series a list reads is cited through the registry's fields", () => {
  for (const def of LISTS) {
    for (const k of moverSeries(def)) assert.ok((def.fields as readonly string[]).includes(SERIES[k].field), `${def.key}: fields include ${SERIES[k].field} (${k})`);
    assert.ok(!/worst|loser/i.test(def.title), `${def.key}: no "worst" framing`);
  }
});

test("display precision: one decimal for percent changes, whole points for rates", () => {
  assert.equal(formatMoverChange({ change: "ratio" }, 7.1054), "+710.5%");
  assert.equal(formatMoverChange({ change: "ratio" }, -0.6491), "−64.9%");
  assert.equal(formatMoverChange({ change: "points" }, -0.4603), "−46 pts");
});

test("Explore's minApplicants / minUndergrads floors (the lists' See all links)", () => {
  const f = parseFilters({ minApplicants: "2000", minUndergrads: "1000" });
  assert.equal(f.minApplicants, 2000);
  assert.equal(f.minUndergrads, 1000);
  assert.equal(parseFilters({ minApplicants: "-5" }).minApplicants, undefined);
});
