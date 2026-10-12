/**
 * Study 7, where the students went (specs/trends/where-students-go.md): recomputes the by-kind rows and the 20,000+
 * share then and now straight from the committed shards, without the shared helpers; checks the campus-based panel
 * (no online-first college at either end of the window, no for-profit, no merged or split campus), that size is
 * classified as of the window's first fall, the cost fifths' sizes, that the three periods tile the window, and that
 * the pace figures are the share difference over the period's length.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { HistoryMeta, SchoolHistory } from "../lib/history.ts";
import { PRE_PANDEMIC_FALL } from "../scripts/history/build.mts";
import type { WhereStudentsGoFile, WhereStudentsGoValues } from "../lib/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const HISTORY = join(ROOT, "data", "history");
const file = JSON.parse(readFileSync(join(HISTORY, "trends", "where-students-go.json"), "utf8")) as WhereStudentsGoFile;
const hmeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8")) as HistoryMeta;
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const campusList = JSON.parse(readFileSync(join(ROOT, "data", "trends", "excluded-campuses.json"), "utf8")) as { unit_id: string; before?: number; years?: number[] }[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = readdirSync(join(HISTORY, "schools"))
  .filter((f) => f.endsWith(".json") && byId.has(f.replace(/\.json$/, "")))
  .map((f) => JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory);

const val = (h: SchoolHistory, k: "undergrads" | "online_share" | "avg_paid_all", y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? (s.values[y - s.start] ?? null) : null;
};
const r4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
const total = (hs: SchoolHistory[], y: number) => hs.reduce((a, h) => a + (val(h, "undergrads", y) ?? 0), 0);

const { from, to } = file;
const MIN = 300;
/** The online-first rule, written out: over half exclusively online; the pandemic falls (2020, 2021) read fall 2019. */
const onlineFirst = (h: SchoolHistory, y: number) => (val(h, "online_share", y === 2020 || y === 2021 ? 2019 : y) ?? 0) > 0.5;
const merged = (id: string) => {
  const e = campusList.find((c) => c.unit_id === id);
  if (!e) return false;
  if (e.before === undefined && e.years === undefined) return true;
  return (e.before !== undefined && from < e.before && to >= e.before) || !!e.years?.some((y) => y === from || y === to);
};
const kindOf = (h: SchoolHistory) =>
  merged(h.unit_id) ? "merged-or-split" : byId.get(h.unit_id)!.type === "private-forprofit" ? "for-profit" : onlineFirst(h, from) || onlineFirst(h, to) ? "online-first" : "campus-based";

const all = shards.filter((h) => [from, to].every((y) => (val(h, "undergrads", y) ?? 0) >= MIN));
const campus = all.filter((h) => kindOf(h) === "campus-based");
const groupRow = (grouping: string, key: string) => file.groupings.find((g) => g.grouping === grouping)!.groups.find((r) => r.key === key)!;
const everyGroup = (): { label: string; v: WhereStudentsGoValues }[] =>
  file.groupings.flatMap((g) => g.groups.filter((r) => r.values).map((r) => ({ label: `${g.grouping}/${r.key}`, v: r.values! })));

test("window: ten falls to history's newest; Study 3's 300 floor; the pandemic boundary is PRE_PANDEMIC_FALL", () => {
  assert.equal(to, hmeta.latest.fall);
  assert.equal(from, to - 10);
  assert.equal(file.minUndergrads, MIN);
  assert.equal(file.prePandemicFall, PRE_PANDEMIC_FALL);
  assert.equal(file.cost.toMoney, hmeta.latest.academic);
  assert.equal(file.cost.fromMoney, hmeta.latest.academic - 10);
});

test("by kind recomputed from the shards: the whole 300-floor panel split four ways", () => {
  assert.equal(file.allN, all.length);
  for (const row of file.byKind) {
    const hs = all.filter((h) => kindOf(h) === row.key);
    assert.equal(row.n, hs.length, row.key);
    assert.deepEqual(row.share, [r4(total(hs, from) / total(all, from)), r4(total(hs, to) / total(all, to))], row.key);
    assert.equal(row.totalChange, r4(total(hs, to) / total(hs, from) - 1), row.key);
  }
  assert.equal(file.byKind.reduce((a, r) => a + r.n, 0), all.length, "every panel college has exactly one kind");
});

test("the campus-based panel has no online-first (at either end), for-profit, or merged college", () => {
  assert.equal(file.n, campus.length);
  assert.equal(file.national.n, campus.length);
  assert.equal(file.campusBased.n, campus.length);
  for (const h of campus) {
    assert.notEqual(byId.get(h.unit_id)!.type, "private-forprofit", h.unit_id);
    assert.ok(!onlineFirst(h, from) && !onlineFirst(h, to), `${h.unit_id} is online-first`);
    assert.ok(!merged(h.unit_id), `${h.unit_id} merged or split`);
  }
  // Both ends: some colleges are online-first only in the newest fall, and they're out too.
  const lateOnline = all.filter((h) => !merged(h.unit_id) && byId.get(h.unit_id)!.type !== "private-forprofit" && !onlineFirst(h, from) && onlineFirst(h, to));
  assert.ok(lateOnline.length > 0, "expected colleges that became online-first inside the window");
  assert.equal(file.byKind.find((k) => k.key === "online-first")!.n, all.filter((h) => kindOf(h) === "online-first").length);
});

test("the 20,000+ share then and now, recomputed with size as of the window's first fall", () => {
  const xl = campus.filter((h) => val(h, "undergrads", from)! >= 20_000);
  const row = groupRow("size4", "xl");
  assert.equal(row.n, xl.length);
  assert.deepEqual(row.values!.share, [r4(total(xl, from) / total(campus, from)), r4(total(xl, to) / total(campus, to))]);
  // Today's classification is the method note's one-line comparison, and differs.
  const today = campus.filter((h) => (byId.get(h.unit_id)!.demographics.undergrad_enrollment ?? 0) >= 20_000);
  assert.deepEqual(file.todayClassified.xlShare, [r4(total(today, from) / total(campus, from)), r4(total(today, to) / total(campus, to))]);
});

test("a college that crossed 20,000 inside the window stays in its first-fall size group", () => {
  const crossed = campus.filter((h) => val(h, "undergrads", from)! < 20_000 && val(h, "undergrads", to)! >= 20_000);
  assert.ok(crossed.length > 0, "expected at least one college that grew past 20,000");
  const large = campus.filter((h) => val(h, "undergrads", from)! >= 10_000 && val(h, "undergrads", from)! < 20_000);
  assert.equal(groupRow("size4", "large").n, large.length);
  assert.equal(groupRow("size4", "xl").n, campus.filter((h) => val(h, "undergrads", from)! >= 20_000).length, "crossers are not counted as 20,000+");
});

test("each cost fifth holds n ÷ 5 (± 1) colleges, and the fifths cover the cost panel", () => {
  const costPanel = campus.filter((h) => val(h, "avg_paid_all", file.cost.fromMoney) !== null && val(h, "avg_paid_all", file.cost.toMoney) !== null);
  assert.equal(file.cost.n, costPanel.length);
  for (const set of [file.cost.byChange, file.cost.byLevel]) {
    for (const { control, fifths } of set) {
      const n = fifths.reduce((a, f) => a + f.n, 0);
      const want = control === "all" ? costPanel.length : costPanel.filter((h) => byId.get(h.unit_id)!.type === control).length;
      assert.equal(n, want, control);
      assert.equal(fifths.length, 5);
      for (const f of fifths) assert.ok(Math.abs(f.n - n / 5) <= 1, `${control}: a fifth of ${f.n} from ${n}`);
      for (let i = 1; i < fifths.length; i++) assert.ok(fifths[i].lo >= fifths[i - 1].hi, `${control}: fifths are ordered`);
    }
  }
});

test("the three periods tile the window; the pandemic starts at PRE_PANDEMIC_FALL and ends at the lowest campus-based fall", () => {
  // The low point, recomputed: the fall after PRE_PANDEMIC_FALL (before the newest) with the smallest total, over falls where 90% report.
  let low = -1;
  let lowTotal = Infinity;
  for (let y = PRE_PANDEMIC_FALL + 1; y < to; y++) {
    const r = campus.filter((h) => val(h, "undergrads", y) !== null);
    if (r.length < campus.length * 0.9) continue;
    const t = total(r, y);
    if (t < lowTotal) [low, lowTotal] = [y, t];
  }
  assert.equal(file.lowFall, low);
  for (const { label, v } of [...everyGroup(), { label: "national", v: file.national.values! }]) {
    const [b, p, a] = v.periods;
    assert.deepEqual(v.periods.map((x) => x.key), ["before", "pandemic", "after"], label);
    assert.equal(b.from, from, label);
    assert.equal(b.to, PRE_PANDEMIC_FALL, label);
    assert.equal(p.from, PRE_PANDEMIC_FALL, label);
    assert.equal(p.to, file.lowFall, label);
    assert.equal(a.from, file.lowFall, label);
    assert.equal(a.to, to, label);
  }
});

test("pace is the share difference over the period's length, in points per year", () => {
  for (const { label, v } of everyGroup()) {
    assert.equal(v.line.length, to - file.lineFrom + 1, label);
    assert.equal(v.line[0], v.share[0], `${label}: the line starts at the then share`);
    assert.equal(v.line[v.line.length - 1], v.share[1], `${label}: the line ends at the now share`);
    for (const p of v.periods) {
      const a = v.line[p.from - file.lineFrom]!;
      const b = v.line[p.to - file.lineFrom]!;
      assert.equal(p.pacePerYear, r3(((b - a) * 100) / (p.to - p.from)), `${label} ${p.key}`);
    }
  }
});

/**
 * Groups whose after-period pace has the opposite sign from their before-period pace, acknowledged in the page's copy.
 * Empty while the after period is under four falls (the check below doesn't run yet).
 */
const ACKNOWLEDGED_FLIPS: string[] = [];

test("owner assumption 4: once the after period is 4+ falls long, no group's pace may have flipped sign without the copy being rewritten", () => {
  if (to - file.lowFall < 4) return; // two falls today: too short to call a reversal, and the page says "so far"
  const flipped = everyGroup().filter(({ v }) => {
    const before = v.periods.find((p) => p.key === "before")!.pacePerYear;
    const after = v.periods.find((p) => p.key === "after")!.pacePerYear;
    return before * after < 0;
  });
  const fresh = flipped.map((f) => f.label).filter((l) => !ACKNOWLEDGED_FLIPS.includes(l));
  assert.deepEqual(
    fresh,
    [],
    "these groups' share now moves the other way from before the pandemic: rewrite the takeaway in app/trends/where-students-go/page.tsx, then add them to ACKNOWLEDGED_FLIPS"
  );
});
