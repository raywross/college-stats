/**
 * Where first-years come from (specs/data-expansion/residence.md): the EF part C reader, the Explore filter and sort,
 * "Known for" rules, the per-college detail file (lib/detail.ts) and its guards, and the stored values and history.
 * `npm test`. Fixture values are Vanderbilt's (221999) fall 2024 EF2024C rows, probed 2026-10-02.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import {
  DRAWS_NATIONALLY,
  drawsNationally,
  efcColumn,
  homeStatesFrom,
  mostFromOtherState,
  residenceCounts,
  residenceFrom,
  unknownShare,
} from "../lib/residence.ts";
import { DETAIL_TABLES, detailMismatches, formatDetail, topHomeStates, validateDetail, type SchoolDetail } from "../lib/detail.ts";
import { FIELDS } from "../lib/fields.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import { HISTORY_FAMILIES, validateHistoryMeta, type HistoryMeta, type SchoolHistory } from "../lib/history.ts";
import { ERAS } from "../scripts/history/registry.mts";
import { buildCollege, coverageDrops } from "../scripts/history/build.mts";
import { detailFileProblems, readDetails } from "../scripts/lib/publish-details.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;

/** A wide EF{Y}C row: EFCSTATE code → EFRES01. */
const wide = (codes: Record<number, number>) => Object.fromEntries([["UNITID", "221999"], ...Object.entries(codes).map(([c, n]) => [efcColumn(Number(c)), String(n)])]);

// Vanderbilt, fall 2024 (EF2024C): TN 208, CA 145, … (58 = U.S. total incl. 57 unknown state; 89 territories; 90 abroad).
const VU = wide({ 47: 208, 6: 145, 36: 132, 48: 119, 57: 5, 58: 1402, 66: 1, 69: 3, 72: 1, 78: 1, 89: 6, 90: 222, 99: 1630 });

/* ---- Reader ---- */

test("EF part C counts match NCES's derived file (DRVEF2024: 208 in-state, 1,195 out-of-state, 222 abroad, 5 unknown)", () => {
  assert.deepEqual(residenceCounts(VU, "TN"), { in_state: 208, out_of_state: 1195, international: 222, unknown: 5, total: 1630 });
  // Territories count as out of state; "state unknown" (57) and "not reported" (98) don't.
  const pr = residenceCounts(wide({ 72: 50, 12: 10, 58: 10, 89: 50, 98: 5, 99: 65 }), "PR")!;
  assert.deepEqual(pr, { in_state: 50, out_of_state: 10, international: 0, unknown: 5, total: 65 });
  assert.equal(residenceCounts(wide({ 99: 0 }), "TN"), null, "no first-years");
  assert.equal(residenceCounts(undefined, "TN"), null, "no row");
});

test("stored shares are of every first-year, rounded like the snapshot; the top state comes from the same rows", () => {
  const r = residenceFrom(VU, "TN")!;
  assert.deepEqual(r, { in_state: 0.1276, out_of_state: 0.7331, international: 0.1362, first_years: 1630, top_state: { state: "TN", share: 0.1276 } });
  assert.equal(unknownShare(r), 0.0031);
  // Home states: postal codes, largest first; never aggregate codes (57, 58, 89, 90, 98, 99).
  const hs = homeStatesFrom(VU);
  assert.deepEqual(Object.keys(hs).slice(0, 4), ["TN", "CA", "NY", "TX"]);
  for (const k of ["57", "58", "89", "90", "98", "99"]) assert.ok(!(k in hs));
  assert.equal(hs.MP, 3, "territories are kept");
});

/* ---- Explore and Known for ---- */

test("the Draws nationally filter and the out-of-state sort parse from the URL", () => {
  assert.equal(parseFilters({ national: "1" }).national, true);
  assert.equal(parseFilters({ national: "0" }).national, undefined);
  assert.equal(countActiveFilters({ national: "1" }), 1);
  assert.equal(parseFilters({ sortBy: "out_of_state" }).sortBy, "out_of_state");
  const at = (out_of_state: number | null) =>
    ({ demographics: { residence: out_of_state === null ? null : { in_state: 0, out_of_state, international: 0, first_years: 100, top_state: null } } }) as Pick<School, "demographics">;
  assert.ok(drawsNationally(at(DRAWS_NATIONALLY)));
  assert.ok(!drawsNationally(at(DRAWS_NATIONALLY - 0.01)));
  assert.ok(!drawsNationally(at(null)), "unreported never matches");
});

test("'Most students are from {state}' needs a majority from another state and a class of 100+", () => {
  const s = (state: string, top: string, share: number, first_years = 500) =>
    ({ location: { state }, demographics: { residence: { in_state: 0.3, out_of_state: 0.6, international: 0, first_years, top_state: { state: top, share } } } }) as unknown as School;
  assert.equal(mostFromOtherState(s("ND", "MN", 0.54)), "MN", "North Dakota State");
  assert.equal(mostFromOtherState(s("ND", "ND", 0.9)), null, "home state isn't a standout");
  assert.equal(mostFromOtherState(s("ND", "MN", 0.49)), null, "a plurality isn't 'most'");
  assert.equal(mostFromOtherState(s("ND", "MN", 0.9, 12)), null, "tiny class");
  // In the data: North Dakota State draws most of its first-years from Minnesota.
  assert.equal(mostFromOtherState(byId("200332")), "MN");
});

/* ---- Detail file guards (each must fail when broken) ---- */

const sample = (): SchoolDetail => ({
  unit_id: "221999",
  tables: { home_states: { source: "ipeds-ef-c", vintage: "ipeds-ef-c", year: meta.vintages["ipeds-ef-c"]!, rows: { TN: 208, CA: 145 } } },
});

test("validateDetail accepts a good file and rejects each kind of mistake", () => {
  const ids = new Set(schools.map((s) => s.unit_id));
  assert.deepEqual(validateDetail(sample(), meta, ids), []);
  const broken: [string, (d: SchoolDetail) => unknown][] = [
    ["unknown college", (d) => (d.unit_id = "999999")],
    ["unknown table", (d) => ((d.tables as Record<string, unknown>).majors_typo = d.tables.home_states)],
    ["wrong source", (d) => (d.tables.home_states!.source = "ipeds-ef")],
    ["wrong vintage", (d) => (d.tables.home_states!.vintage = "ipeds-ef")],
    ["stale year", (d) => (d.tables.home_states!.year = "Fall 1999")],
    ["unknown state", (d) => (d.tables.home_states!.rows = { ZZ: 3 })],
    ["fractional count", (d) => (d.tables.home_states!.rows = { TN: 2.5 })],
    ["zero count", (d) => (d.tables.home_states!.rows = { TN: 0 })],
    ["empty rows", (d) => (d.tables.home_states!.rows = {})],
    ["no tables", (d) => (d.tables = {})],
  ];
  for (const [name, breakIt] of broken) {
    const d = sample();
    breakIt(d);
    assert.ok(validateDetail(d, meta, ids).length > 0, name);
  }
  // Every table names a registered field, with the source and vintage its own spec picked (home_states:
  // residence.md; programs: field-of-study.md; tests/majors.test.mts checks the majors table).
  assert.equal(FIELDS[DETAIL_TABLES.home_states.field].source, "ipeds-ef-c");
  assert.equal(FIELDS[DETAIL_TABLES.programs.field].source, "scorecard-fos");
});

test("detail files must agree with the snapshot", () => {
  const vu = byId("221999");
  assert.deepEqual(detailMismatches(vu, sample()), []);
  const wrongTop = sample();
  wrongTop.tables.home_states!.rows = { CA: 300, TN: 208 };
  assert.ok(detailMismatches(vu, wrongTop).length > 0, "top state differs");
  const tooMany = sample();
  tooMany.tables.home_states!.rows = { TN: 208, CA: 5000 };
  assert.ok(detailMismatches(vu, tooMany).length > 0, "more students than first-years");
  const noResidence = { ...vu, demographics: { ...vu.demographics, residence: null } };
  assert.ok(detailMismatches(noResidence, sample()).length > 0, "home states without residence");
  // The file layout reads back as the same object.
  assert.deepEqual(JSON.parse(formatDetail(sample())), sample());
  assert.deepEqual(topHomeStates(sample(), 1630, 1), [{ state: "TN", count: 208, share: 208 / 1630 }]);
  assert.deepEqual(topHomeStates(null, 1630), []);
});

/* ---- History: every other fall ---- */

test("residence history reads even-numbered falls only, and the checks expect that cadence", () => {
  const era = ERAS.find((e) => e.family === "ef-c")!;
  assert.equal(era.years[0], 2004);
  assert.equal(era.step, 2);
  assert.equal((HISTORY_FAMILIES["ef-c"] as { step?: number }).step, 2);
  const h = buildCollege({ unit_id: "221999", type: "private-nonprofit", location: { state: "TN" } }, {
    admissions: [],
    prices: [],
    sfa: [],
    efc: [
      { year: 2022, family: "ef-c", rows: new Map([["221999", wide({ 47: 149, 58: 1431, 57: 8, 89: 1, 90: 187, 99: 1619 })]]) },
      { year: 2024, family: "ef-c", rows: new Map([["221999", VU]]) },
    ],
  });
  assert.deepEqual(h.series.out_of_state_share, { start: 2022, values: [0.7875, null, 0.7331] });
  assert.deepEqual(h.series.international_share, { start: 2022, values: [0.1155, null, 0.1362] });
  // Two years between points is the cadence, not a gap; for a yearly series it is a gap.
  const cov = { out_of_state_share: new Map([[2022, 100], [2024, 100]]), undergrads: new Map([[2022, 100], [2024, 100]]) };
  assert.deepEqual(coverageDrops(cov), ["undergrads 2024: no colleges reported the year before"]);
});

test("history metadata: residence files every two years pass; a skipped even year fails", () => {
  const files = (years: number[]) => years.map((year) => ({ year, file: `EF${year}C`, url: "", revised: true }));
  const base = JSON.parse(readFileSync(join(ROOT, "data", "history", "meta.json"), "utf8")) as HistoryMeta;
  assert.deepEqual(validateHistoryMeta({ ...base, files: { ...base.files, "ef-c": files([2020, 2022, 2024]) } }, meta), []);
  assert.ok(validateHistoryMeta({ ...base, files: { ...base.files, "ef-c": files([2020, 2024]) } }, meta).length > 0);
  assert.ok(validateHistoryMeta({ ...base, files: { ...base.files, "ef-c": files([2022, 2023, 2024]) } }, meta).length > 0);
});

/* ---- Committed data ---- */

test("stored residence covers nearly every college, with Vanderbilt matching NCES", () => {
  const reported = schools.filter((s) => s.demographics.residence);
  assert.ok(reported.length > 0.9 * schools.length, `${reported.length} colleges`);
  for (const s of reported) {
    const r = s.demographics.residence!;
    assert.ok(r.first_years > 0 && Number.isInteger(r.first_years), s.name);
    assert.ok(r.in_state + r.out_of_state + r.international <= 1.0002, s.name);
  }
  assert.deepEqual(byId("221999").demographics.residence, residenceFrom(VU, "TN"));
  // Missing is null, never zeros.
  for (const s of schools.filter((x) => x.demographics.residence === null)) assert.equal(s.demographics.residence, null);
  assert.match(meta.vintages["ipeds-ef-c"] ?? "", /^Fall \d{4}$/);
  assert.equal(Number(meta.vintages["ipeds-ef-c"]!.slice(5)) % 2, 0, "an even-numbered fall");
});

test("committed detail files pass the same checks as check:lineage, one per college with home states", () => {
  const details = readDetails(ROOT)!;
  assert.ok(details.length > 0.9 * schools.length);
  assert.deepEqual(detailFileProblems(details, schools, meta), []);
  const dir = join(ROOT, "data", "detail", "schools");
  for (const f of readdirSync(dir)) assert.match(f, /^\d+\.json$/);
  assert.equal(JSON.parse(readFileSync(join(dir, "221999.json"), "utf8")).tables.home_states.rows.TN, 208);
});

test("committed history: residence series are even years ending on the snapshot", { skip: !existsSync(join(ROOT, "data", "history", "schools", "221999.json")) }, () => {
  const h: SchoolHistory = JSON.parse(readFileSync(join(ROOT, "data", "history", "schools", "221999.json"), "utf8"));
  const s = h.series.out_of_state_share!;
  assert.equal(s.start, 2004);
  s.values.forEach((v, i) => assert.equal(v === null, i % 2 === 1, `${s.start + i}`));
  assert.equal(s.values.at(-1), byId("221999").demographics.residence!.out_of_state);
  assert.equal(h.series.international_share!.values.at(-1), byId("221999").demographics.residence!.international);
});
