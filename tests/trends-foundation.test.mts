/**
 * National trends, shared pieces (specs/national-trends.md#shared-computation-and-tests): groupings and floors, the
 * study registry against the builders and the trends index (the mini fixture's `trends/index.json`, copied from the
 * real snapshot), the shared envelope and the study-file rules over each builder's output from the mini fixture
 * (tests/helpers/snapshot.mts miniTrendFile), and that a build is deterministic. The real files are built from the
 * full history by the publisher.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { isFieldPath } from "../lib/fields.ts";
import { SERIES, isSeriesKey, type SchoolHistory } from "../lib/history.ts";
import {
  CONFERENCE_FLOOR,
  GROUPINGS,
  GROUPING_KEYS,
  GROUP_FLOOR,
  STANDARD_GROUPINGS,
  STATE_FLOOR,
  control,
  designation,
  division,
  region,
  research,
  selectivity,
  setting,
  size,
  size4,
  splitBy,
} from "../lib/trend-groups.ts";
import { byGroup, byGroupThen, fixedPanel, medianBy, shareBy, splitByThen, totalBy, weightedBy, yearly, type Member } from "../lib/trend-panel.ts";
import { STUDIES, studyWindow, type StudyDef } from "../lib/trend-studies.ts";
import type { GroupingResult, StudyFile, TrendEnvelope, TrendIndex } from "../lib/trends.ts";
import { trendFileText } from "../scripts/trends/build.mts";
import { BUILDERS } from "../scripts/trends/index.mts";
import { miniHistoryFiles, miniTrend, miniTrendContext, miniTrendFile } from "./helpers/snapshot.mts";

const ROOT = join(import.meta.dirname, "..");
const hmeta = miniHistoryFiles().meta;
/** The trends index the fixture carries (the real snapshot's). */
const INDEX = miniTrend<TrendIndex>("index")!;
/** Each builder's file over the mini fixture; a builder that can't run on 38 colleges is left out. */
const BUILT = new Map<string, TrendEnvelope>();
for (const b of BUILDERS) {
  try {
    BUILT.set(b.name, await miniTrendFile<TrendEnvelope>(b.name));
  } catch {
    // where-students-go's card needs groups over the floor (scripts/trends/studies/where-students-go.mts).
  }
}
const read = <T,>(name: string): T => BUILT.get(name) as T;
const studies = STUDIES as readonly StudyDef[];

/** A minimal School for grouping tests. */
function school(over: { region?: string; type?: School["type"]; undergrads?: number; rate?: number | null; campus?: School["campus"]; state?: string }): School {
  return {
    unit_id: "1",
    location: { region: over.region ?? "West", state: over.state ?? "CA" },
    type: over.type ?? "public",
    admissions: { acceptance_rate: over.rate === undefined ? 0.5 : over.rate },
    demographics: { undergrad_enrollment: over.undergrads ?? 5000 },
    campus: over.campus,
  } as unknown as School;
}

/* ---- Groups ---- */

test("floors: 30 per group, 10 per state, 8 per conference", () => {
  assert.equal(GROUP_FLOOR, 30);
  assert.equal(STATE_FLOOR, 10);
  assert.equal(CONFERENCE_FLOOR, 8);
  assert.equal(GROUPINGS.state.floor, STATE_FLOOR);
  assert.equal(GROUPINGS.conference.floor, CONFERENCE_FLOOR);
  for (const k of ["region", "control", "size", "size4", "selectivity", "setting", "division", "research", "designation"] as const) assert.equal(GROUPINGS[k].floor, GROUP_FLOOR, k);
});

test("grouping functions classify by today's fields, with the hub's boundaries", () => {
  assert.equal(region(school({ region: "Northeast" })), "Northeast");
  assert.equal(control(school({ type: "private-nonprofit" })), "private-nonprofit");
  assert.equal(size(school({ undergrads: 1999 })), "small");
  assert.equal(size(school({ undergrads: 2000 })), "medium");
  assert.equal(size(school({ undergrads: 9999 })), "medium");
  assert.equal(size(school({ undergrads: 10_000 })), "large");
  assert.equal(selectivity(school({ rate: 0.2499 })), "most");
  assert.equal(selectivity(school({ rate: 0.25 })), "more");
  assert.equal(selectivity(school({ rate: 0.5999 })), "more");
  assert.equal(selectivity(school({ rate: 0.6 })), "less");
  assert.equal(selectivity(school({ rate: null })), null, "no rate, no selectivity group (never treated as 0)");
  assert.equal(setting(school({ campus: { setting: { locale: 41, label: "Rural, near a city", group: "rural" } } })), "rural");
  assert.equal(division(school({})), "none");
  assert.equal(division(school({ campus: { athletics: { division: "III" } as never } })), "III");
  assert.equal(research(school({})), "other");
  assert.deepEqual(designation(school({ campus: { designations: ["hbcu", "land_grant"], msi: ["women"] } })).sort(), ["hbcu", "land_grant", "women"]);
});

test("every grouping cites a registered field; the standard four come first in every study", () => {
  for (const k of GROUPING_KEYS) assert.ok(isFieldPath(GROUPINGS[k].field), `${k}: ${GROUPINGS[k].field}`);
  for (const s of studies) assert.deepEqual(s.groupings.slice(0, 4), [...STANDARD_GROUPINGS], s.slug);
});

test("splitBy keeps the display order, leaves out the unclassified, and puts a college in each of its designations", () => {
  const items = [school({ region: "West" }), school({ region: "Northeast" }), school({ region: "West" })];
  assert.deepEqual(
    splitBy(items, "region", (s) => s).map((g) => [g.key, g.items.length]),
    [["Northeast", 1], ["West", 2]]
  );
  assert.deepEqual(splitBy([school({ rate: null })], "selectivity", (s) => s), []);
  const two = school({ campus: { designations: ["hbcu"], msi: ["women"] } });
  assert.deepEqual(splitBy([two], "designation", (s) => s).map((g) => g.key), ["hbcu", "women"]);
});

/* ---- Panel helpers ---- */

const member = (id: string, values: Partial<Record<"applicants" | "admit_rate_men", (number | null)[]>>, over: Parameters<typeof school>[0] = {}): Member => ({
  school: { ...school(over), unit_id: id },
  h: { unit_id: id, series: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { start: 2020, values: v }])) } as SchoolHistory,
});

test("panel helpers: fixed panel, median, share (nulls excluded), weighted, total, yearly with step", () => {
  const ms = [member("a", { applicants: [100, 200] }), member("b", { applicants: [null, 300] }), member("c", { applicants: [50, 60] })];
  const reported = (m: Member, y: number) => (m.h.series.applicants?.values[y - 2020] ?? null) !== null;
  assert.deepEqual(fixedPanel(ms, [2020, 2021], reported).map((m) => m.school.unit_id), ["a", "c"]);
  const v = (m: Member) => m.h.series.applicants?.values[1] ?? null;
  assert.equal(medianBy(ms, v), 200);
  assert.equal(shareBy(ms, (m) => (v(m) === null ? null : v(m)! > 100)), 2 / 3);
  assert.equal(shareBy([], () => true), null);
  assert.equal(weightedBy(ms, () => 1, v), 1);
  assert.equal(weightedBy(ms, (m) => (m.school.unit_id === "a" ? 1 : 0), v), 200 / 560);
  assert.equal(totalBy(ms, v), 560);
  assert.deepEqual(yearly(2020, 2023, (y) => y, 2), [2020, null, 2022, null]);
});

test("byGroup: groups under the floor carry n and tooFew, no values", () => {
  const ms = [...Array.from({ length: 30 }, (_, i) => member(`w${i}`, {}, { region: "West" })), ...Array.from({ length: 29 }, (_, i) => member(`n${i}`, {}, { region: "Northeast" }))];
  const r = byGroup(ms, "region", (g) => g.length);
  assert.deepEqual(r.groups, [
    { key: "Northeast", label: "Northeast", n: 29, tooFew: true },
    { key: "West", label: "West", n: 30, values: 30 },
  ]);
  assert.equal(r.floor, GROUP_FLOOR);
});

/* ---- Registry ↔ builders ↔ committed files ---- */

test("every registered study has a builder, a file in the index, a page, and an index card", () => {
  const builders = new Set(BUILDERS.map((b) => b.name));
  const index = INDEX;
  for (const s of studies) {
    assert.ok(builders.has(s.slug), `${s.slug}: register its builder in scripts/trends/index.mts`);
    assert.ok(index.files.includes(s.slug), `${s.slug}: the trends index lists no ${s.slug}.json`);
    assert.ok(existsSync(join(ROOT, "app", "trends", s.slug, "page.tsx")), `${s.slug}: add app/trends/${s.slug}/page.tsx`);
    assert.ok(index.cards.some((c) => c.slug === s.slug), `${s.slug}: no card in index.json`);
  }
  assert.deepEqual(index.files, [...builders].sort(), "index.json lists exactly the builders' files");
  assert.ok(BUILT.size >= BUILDERS.length - 1, `only ${BUILT.size} of ${BUILDERS.length} builders run on the mini fixture`);
  assert.equal(new Set(studies.map((s) => s.slug)).size, studies.length, "study slugs are unique");
  assert.deepEqual(studies.map((s) => s.number), studies.map((_, i) => i + 1), "studies are numbered 1, 2, … in order");
});

test("registry: series exist, fields cover each series' registered field, window fits history", () => {
  for (const s of studies) {
    assert.ok(s.series.length, s.slug);
    for (const k of s.series) {
      assert.ok(isSeriesKey(k), `${s.slug}: ${k}`);
      assert.ok((s.fields as readonly string[]).includes(SERIES[k].field), `${s.slug}: add ${SERIES[k].field} (series ${k}) to fields`);
    }
    for (const f of s.fields) assert.ok(isFieldPath(f), `${s.slug}: ${f} isn't registered in lib/fields.ts`);
    assert.ok(Number.isInteger(s.added) && s.added > 20260000 && s.added < 21000000, `${s.slug}: added is YYYYMMDD`);
    assert.match(s.color, /^var\(--[a-z0-9-]+\)$/, s.slug);
  }
});

test("every trend file carries the envelope: name, built, year kind, from < to, panel size", () => {
  for (const [name, f] of BUILT) {
    assert.equal(f.name, name);
    assert.equal(f.built, hmeta.built, `${name}: stale; run npm run build-trends`);
    assert.ok(["fall", "academic", "cohort"].includes(f.yearKind), name);
    assert.ok(Number.isInteger(f.from) && Number.isInteger(f.to) && f.from < f.to && f.to <= hmeta.latest[f.yearKind], `${name}: ${f.from}–${f.to}`);
    assert.ok(Number.isInteger(f.n) && f.n > 0, `${name}: n`);
  }
  assert.equal(INDEX.built, hmeta.built);
});

test("study files: the window is the registry's, groupings in registry order, floors applied, groups within the panel", () => {
  for (const s of studies.filter((x) => BUILT.has(x.slug))) {
    const f = read<StudyFile<unknown>>(s.slug);
    assert.deepEqual([f.from, f.to], studyWindow(s, hmeta.latest), s.slug);
    assert.equal(f.yearKind, s.yearKind);
    assert.ok(f.lineFrom <= f.from, s.slug);
    assert.equal(f.national.n, f.n);
    assert.ok(f.national.values, `${s.slug}: national row has values`);
    assert.deepEqual(f.groupings.map((g) => g.grouping), [...s.groupings], s.slug);
    for (const g of f.groupings as GroupingResult<unknown>[]) {
      assert.equal(g.floor, GROUPINGS[g.grouping].floor);
      for (const r of g.groups) {
        assert.ok(r.n <= f.n, `${s.slug} ${g.grouping}/${r.key}`);
        if (r.n < g.floor) assert.ok(r.tooFew && r.values === undefined, `${s.slug} ${g.grouping}/${r.key}: ${r.n} colleges must be "too few"`);
        else assert.ok(!r.tooFew && r.values !== undefined, `${s.slug} ${g.grouping}/${r.key}`);
      }
      // A college is in one group per grouping (designations excepted).
      if (g.grouping !== "designation") assert.ok(g.groups.reduce((a, r) => a + r.n, 0) <= f.n, `${s.slug} ${g.grouping}`);
    }
  }
});

test("a trend build is deterministic: building each file again from the same history gives the same text", async () => {
  // (The real data's check, the committed files equal a fresh build of the committed history, is the publisher's:
  // it renders the trend files from the history layer at every publish.)
  const ctx = await miniTrendContext();
  for (const b of BUILDERS) {
    if (!BUILT.has(b.name)) continue;
    assert.equal(trendFileText(b.build(ctx).file), trendFileText(BUILT.get(b.name)!), `${b.name}: two builds differ`);
  }
});

/* ---- Classified then (Study 7) ---- */

/** A member whose undergraduates and acceptance rate are given by fall from 2014. */
const memberThen = (id: string, undergrads: (number | null)[], rate: (number | null)[], over: Parameters<typeof school>[0] = {}): Member => ({
  school: { ...school(over), unit_id: id },
  h: { unit_id: id, series: { undergrads: { start: 2014, values: undergrads }, acceptance_rate: { start: 2014, values: rate } } } as unknown as SchoolHistory,
});

test("size4: the 20,000+ split on today's size, same boundaries below it as size", () => {
  assert.equal(size4(school({ undergrads: 1999 })), "small");
  assert.equal(size4(school({ undergrads: 2000 })), "medium");
  assert.equal(size4(school({ undergrads: 9999 })), "medium");
  assert.equal(size4(school({ undergrads: 10_000 })), "large");
  assert.equal(size4(school({ undergrads: 19_999 })), "large");
  assert.equal(size4(school({ undergrads: 20_000 })), "xl");
  assert.deepEqual(GROUPINGS.size4.groups!.map((g) => g.key), ["small", "medium", "large", "xl"]);
  assert.equal(GROUPINGS.size4.field, GROUPINGS.size.field);
});

test("ofThen reads the grouping from history at the given fall; today's grouping is unaffected", () => {
  const grew = memberThen("g", [18_000, 25_000], [0.2, 0.3], { undergrads: 25_000, rate: 0.3 });
  assert.deepEqual(GROUPINGS.size4.ofThen!(grew, 2014), ["large"]);
  assert.deepEqual(GROUPINGS.size4.ofThen!(grew, 2015), ["xl"]);
  assert.deepEqual(GROUPINGS.size4.of(grew.school), ["xl"]);
  assert.deepEqual(GROUPINGS.size.ofThen!(memberThen("s", [1999], [null]), 2014), ["small"]);
  assert.deepEqual(GROUPINGS.selectivity.ofThen!(grew, 2014), ["most"]);
  assert.deepEqual(GROUPINGS.selectivity.ofThen!(grew, 2015), ["more"]);
  assert.deepEqual(GROUPINGS.selectivity.ofThen!(memberThen("n", [5000], [null]), 2014), [], "no rate that fall, no group");
  assert.deepEqual(GROUPINGS.size4.ofThen!(grew, 2030), [], "a fall outside the series, no group");
  for (const k of ["region", "control", "setting", "research"] as const) assert.equal(GROUPINGS[k].ofThen, undefined, `${k} doesn't move with enrollment`);
});

test("byGroupThen classifies as of the fall given, falls back to today's grouping, and keeps the floor", () => {
  const ms = [
    ...Array.from({ length: 30 }, (_, i) => memberThen(`x${i}`, [25_000, 26_000], [0.5, 0.5], { undergrads: 26_000, region: "West" })),
    ...Array.from({ length: 30 }, (_, i) => memberThen(`c${i}`, [15_000, 21_000], [0.5, 0.5], { undergrads: 21_000, region: "West" })),
  ];
  const then = byGroupThen(ms, "size4", 2014, (g) => g.length);
  assert.deepEqual(then.groups.map((r) => [r.key, r.n]), [["large", 30], ["xl", 30]], "the colleges that crossed 20,000 stay large");
  assert.deepEqual(byGroup(ms, "size4", (g) => g.length).groups.map((r) => [r.key, r.n]), [["xl", 60]], "today's classification counts them as 20,000+");
  assert.deepEqual(byGroupThen(ms, "region", 2014, (g) => g.length).groups.map((r) => [r.key, r.n]), [["West", 60]], "no ofThen: today's region");
  assert.deepEqual(splitByThen(ms.slice(0, 31), "size4", 2014).map((g) => [g.key, g.items.length]), [["large", 1], ["xl", 30]]);
  const under = byGroupThen(ms.slice(0, 31), "size4", 2014, (g) => g.length);
  assert.deepEqual(under.groups[0], { key: "large", label: "10,000–19,999", n: 1, tooFew: true });
  assert.equal(under.floor, GROUP_FLOOR);
});
