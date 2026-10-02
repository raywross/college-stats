/**
 * Majors (specs/data-expansion/majors.md): reading IPEDS Completions (C{Y}_A), the snapshot fields, the detail table and
 * its guards, history by field and its checks, the Home fact, the profile's fastest-growing field, Explore's field
 * filter, and lineage. `npm test`. Fixture values follow Vanderbilt's (221999) C2025_A rows, probed 2026-10-02.
 * Tests over committed data skip until the data has majors (the wave's merge rebuilds it once).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import {
  FIELD_MIN_OPTIONS,
  GROWTH_MIN_GRADUATES,
  MAJOR_FAMILIES,
  MAJOR_FAMILY_CODES,
  MAJORS_TOP_N,
  familiesFromRow,
  familyColumn,
  familyCounts,
  familyShares,
  fastestGrowingField,
  fieldFacets,
  graduatesInField,
  majorFamilyName,
  majorRowsFrom,
  majorsSnapshot,
  matchesField,
  matchesProgram,
  programsFrom,
  programsFromRows,
  totalRowFrom,
} from "../lib/majors.ts";
import { cipTitle, fromCip2010, hasCip } from "../lib/cip.ts";
import { DETAIL_TABLES, detailMismatches, formatDetail, mergeDetails, validateDetail, type SchoolDetail } from "../lib/detail.ts";
import { FIELDS } from "../lib/fields.ts";
import { HISTORY_FAMILIES, SERIES, majorSeriesKey, validateShard, type SchoolHistory } from "../lib/history.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import { forEachCsvRow } from "../scripts/lib/ipeds.mts";
import { completionsKey, completionsYearLabel, familyKey } from "../scripts/lib/majors-sync.mts";
import { ERAS } from "../scripts/history/registry.mts";
import { buildCollege, lastPointMismatches, majorsShift } from "../scripts/history/build.mts";
import { detailFileProblems, readDetails } from "../scripts/lib/publish-details.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;
/** True once data/ has been rebuilt with majors (until then, committed-data tests skip). */
const HAS_DATA = !!meta.vintages["ipeds-c"] && schools.some((s) => s.academics?.majors_top);

/** A C{Y}_A row as the CSV has it (C2020_A quotes codes and zero-pads AWLEVEL; C2025_A doesn't). */
const row = (CIPCODE: string, AWLEVEL: string, MAJORNUM: string, CTOTALT = "1") => ({ UNITID: "221999", CIPCODE, AWLEVEL, MAJORNUM, CTOTALT });

/** A summed row (scripts/lib/ipeds.mts `sum`): `{cip}|{major}` → count. */
const summed = (cols: Record<string, number>) => Object.fromEntries([["UNITID", "221999"], ...Object.entries(cols).map(([k, v]) => [k, String(v)])]);

// Vanderbilt 2024–25 (C2025_A), first majors, top programs; 1,830 in all.
const VU = summed({
  "45.0101|1": 283,
  "45.0101|2": 14,
  "45.0603|1": 203,
  "30.9999|1": 194,
  "11.0701|1": 170,
  "11.0701|2": 74,
  "14.1901|1": 65,
  "27.0101|1": 45,
  "27.0101|2": 141,
  "05.0299|2": 3,
  "99|1": 960,
});

/* ---- Reading C{Y}_A ---- */

test("completions rows: bachelor's only (AWLEVEL parsed as a number), first and second majors apart, 99 kept as the total", () => {
  assert.equal(completionsKey(row("11.0701", "5", "1")), "11.0701|1");
  assert.equal(completionsKey(row("11.0701", "05", "1")), "11.0701|1", "C2020_A zero-pads the award level");
  assert.equal(completionsKey(row("11.0701", "5", "2")), "11.0701|2");
  assert.equal(completionsKey(row("1.0701", "5", "1")), "01.0701|1", "codes are normalized");
  assert.equal(completionsKey(row("11.0701", "7", "1")), null, "master's");
  assert.equal(completionsKey(row("11.0701", "3", "1")), null, "associate's");
  assert.equal(completionsKey(row("11.0701", "5", "3")), null);
  assert.equal(completionsKey(row("99", "5", "1")), "99|1");
  assert.equal(completionsKey(row("99", "5", "2")), null, "only the first-major total is kept");
  // Families for history: first majors only, CIP 2010 codes through the crosswalk.
  assert.equal(familyKey(row("51.2401", "5", "1"), fromCip2010), familyColumn("01"), "veterinary moved to agriculture");
  assert.equal(familyKey(row("51.2401", "5", "1")), familyColumn("51"));
  assert.equal(familyKey(row("11.0701", "5", "2")), null);
  assert.equal(familyKey(row("99", "5", "1")), null);
});

test("the CSV reader handles quoted codes and skips other colleges before building rows", () => {
  const csv = '﻿UNITID,CIPCODE,MAJORNUM,AWLEVEL,CTOTALT\r\n221999,"01.0101",1,05,3\r\n100654,"11.0701",1,05,9\r\n221999,99,1,5,3\r\n';
  const rows: Record<string, string>[] = [];
  const header = forEachCsvRow(csv, (r) => rows.push(r), new Set(["221999"]));
  assert.deepEqual(header, ["UNITID", "CIPCODE", "MAJORNUM", "AWLEVEL", "CTOTALT"]);
  assert.deepEqual(rows.map((r) => r.CIPCODE), ["01.0101", "99"]);
});

test("programs: counts by code, most first majors first; the total row; missing is null, never zeros", () => {
  const p = programsFrom(VU)!;
  assert.deepEqual(p.slice(0, 2), [
    { cip: "45.0101", first: 283, second: 14 },
    { cip: "45.0603", first: 203, second: 0 },
  ]);
  assert.deepEqual(p.at(-1), { cip: "05.0299", first: 0, second: 3 }, "second majors only, last");
  assert.ok(!p.some((x) => x.cip === "99"));
  assert.equal(totalRowFrom(VU), 960);
  assert.equal(programsFrom(undefined), null);
  assert.equal(totalRowFrom(undefined), null);
  assert.deepEqual(programsFromRows(majorRowsFrom(p)), p, "detail rows round-trip");
});

test("snapshot: top 5 by first majors with shares of all first-major bachelor's; families by code", () => {
  const s = majorsSnapshot(programsFrom(VU), cipTitle);
  assert.equal(s.bachelors_awarded, 960);
  assert.equal(s.majors_top!.length, MAJORS_TOP_N);
  assert.deepEqual(s.majors_top![0], { cip: "45.0101", title: "Social Sciences, General", share: 0.2948 });
  assert.deepEqual(s.majors_top!.map((m) => m.cip), ["45.0101", "45.0603", "30.9999", "11.0701", "14.1901"]);
  assert.deepEqual(s.bachelors_by_family, { 11: 170, 14: 65, 27: 45, 30: 194, 45: 486 });
  assert.ok(!("05" in s.bachelors_by_family!), "second majors don't count toward families");
  // A college in the file with no bachelor's: 0 awarded and no shares. Not in the file: all null.
  assert.deepEqual(majorsSnapshot(programsFrom(summed({ "99|1": 0 })), cipTitle), { bachelors_awarded: 0, majors_top: null, bachelors_by_family: null });
  assert.deepEqual(majorsSnapshot(null, cipTitle), { bachelors_awarded: null, majors_top: null, bachelors_by_family: null });
  // A code without a CIP 2020 title stops the sync rather than showing a bare number.
  assert.throws(() => majorsSnapshot(programsFrom(summed({ "11.9998|1": 4 })), cipTitle), /no CIP 2020 title/);
  assert.equal(completionsYearLabel(2025), "2024–25 graduates");
});

test("family helpers: names, shares, Explore's filter (unreported never matches), facets", () => {
  assert.equal(majorFamilyName("52"), "Business");
  assert.equal(majorFamilyName("11.0701"), "Computer science");
  assert.equal(majorFamilyName("53"), null);
  assert.deepEqual(familyShares({ "11": 1, "45": 3 }, 4)[0], { family: "45", count: 3, share: 0.75 });
  assert.deepEqual(familiesFromRow(summed({ "F|11": 5, "F|45": 0, "11.0701|1": 3 })), { 11: 5 });
  assert.deepEqual(familyCounts([{ cip: "45.0101", first: 2, second: 0 }, { cip: "05.0102", first: 1, second: 4 }]), { "05": 1, 45: 2 });
  const s = (by: Record<string, number> | null, total: number | null = 10) => ({ academics: { student_faculty_ratio: null, bachelors_awarded: total, bachelors_by_family: by } }) as Pick<School, "academics">;
  assert.equal(graduatesInField(s({ "51": 60 }), "51"), 60);
  assert.equal(graduatesInField(s({ "51": 60 }), "11"), 0, "awards bachelor's, none in this field");
  assert.equal(graduatesInField(s(null, null), "11"), null, "not reported");
  assert.ok(matchesField(s({ "51": 60 }), "51", 50));
  assert.ok(!matchesField(s({ "51": 60 }), "51", 100));
  assert.ok(!matchesField(s({ "51": 60 }), "11"));
  assert.ok(!matchesField(s(null, null), "11", 1));
  const f = fieldFacets([s({ "51": 60 }), s({ "51": 20, "11": 300 })]);
  assert.deepEqual(f["51"], FIELD_MIN_OPTIONS.map((m) => [60, 20].filter((n) => n >= m).length));
  assert.equal(f["11"][FIELD_MIN_OPTIONS.length - 1], 1);
});

test("program search matches the start of a word or code, so 'econ' doesn't find Secondary Education", () => {
  const p = (cip: string) => ({ cip, title: cipTitle(cip)!, family: majorFamilyName(cip) });
  assert.ok(matchesProgram(p("45.0603"), "econ"));
  assert.ok(!matchesProgram(p("13.1205"), "econ"), "Secondary Education and Teaching");
  assert.ok(matchesProgram(p("51.3801"), "nursing"));
  assert.ok(matchesProgram(p("51.3801"), "health"), "by field name");
  assert.ok(matchesProgram(p("11.0701"), "computer sci"));
  assert.ok(matchesProgram(p("51.3801"), "51.38"));
  assert.ok(!matchesProgram(p("11.0701"), "nursing"));
  assert.ok(matchesProgram(p("11.0701"), "  "), "an empty search matches everything");
});

test("Explore parses the field filter and the bachelor's sort; unknown fields are ignored", () => {
  assert.equal(parseFilters({ field: "51" }).field, "51");
  assert.equal(parseFilters({ field: "51", fieldMin: "50" }).fieldMin, 50);
  assert.equal(parseFilters({ field: "51", fieldMin: "1" }).fieldMin, undefined);
  assert.equal(parseFilters({ field: "99" }).field, undefined);
  assert.equal(parseFilters({ field: "53" }).field, undefined, "high school diplomas aren't a bachelor's field");
  assert.equal(countActiveFilters({ field: "51", fieldMin: "50" }), 1);
  assert.equal(parseFilters({ sortBy: "bachelors" }).sortBy, "bachelors");
});

/* ---- Detail table guards (each must fail when broken) ---- */

const VU_PROGRAMS = programsFrom(VU)!;
const sampleSchool = (): School => {
  const base = structuredClone(schools.find((x) => x.unit_id === "221999") ?? schools[0]);
  base.unit_id = "221999";
  base.academics = { student_faculty_ratio: null, ...majorsSnapshot(VU_PROGRAMS, cipTitle) };
  return base;
};
const sample = (): SchoolDetail => ({
  unit_id: "221999",
  tables: { majors: { source: "ipeds-c", vintage: "ipeds-c", year: "2024–25 graduates", rows: majorRowsFrom(VU_PROGRAMS) } },
});
const sampleMeta: DatasetMeta = { ...meta, sources: { ...meta.sources, "ipeds-c": meta.sources["ipeds-c"] ?? { label: "", publisher: "", edition: "", url: "", description: "" } }, vintages: { ...meta.vintages, "ipeds-c": "2024–25 graduates" } };

test("validateDetail accepts a majors table and rejects each kind of mistake", () => {
  assert.deepEqual(validateDetail(sample(), sampleMeta), []);
  assert.equal(FIELDS[DETAIL_TABLES.majors.field].source, "ipeds-c");
  assert.equal(FIELDS[DETAIL_TABLES.majors.field].vintage, "ipeds-c");
  const broken: [string, (d: SchoolDetail) => unknown][] = [
    ["wrong source", (d) => (d.tables.majors!.source = "ipeds-ef-c")],
    ["wrong vintage", (d) => (d.tables.majors!.vintage = "ipeds-ef-c")],
    ["stale year", (d) => (d.tables.majors!.year = "2009–10 graduates")],
    ["4-digit code", (d) => (d.tables.majors!.rows = { "11.07": [3, 0] })],
    ["not a CIP 2020 code", (d) => (d.tables.majors!.rows = { "11.9998": [3, 0] })],
    ["the total row", (d) => (d.tables.majors!.rows = { "99.0000": [3, 0] })],
    ["negative", (d) => (d.tables.majors!.rows = { "11.0701": [-1, 0] })],
    ["fractional", (d) => (d.tables.majors!.rows = { "11.0701": [2.5, 0] })],
    ["neither major", (d) => (d.tables.majors!.rows = { "11.0701": [0, 0] })],
    ["not a pair", (d) => (d.tables.majors!.rows = { "11.0701": [3] as unknown as [number, number] })],
    ["empty rows", (d) => (d.tables.majors!.rows = {})],
  ];
  for (const [name, breakIt] of broken) {
    const d = sample();
    breakIt(d);
    assert.ok(validateDetail(d, sampleMeta).length > 0, name);
  }
});

test("majors tables must agree with the snapshot: total, top 5, and field counts", () => {
  assert.deepEqual(detailMismatches(sampleSchool(), sample()), []);
  const total = sampleSchool();
  total.academics!.bachelors_awarded = 961;
  assert.ok(detailMismatches(total, sample()).length > 0, "total");
  const top = sampleSchool();
  top.academics!.majors_top![0].share = 0.3;
  assert.ok(detailMismatches(top, sample()).length > 0, "top share");
  const fams = sampleSchool();
  fams.academics!.bachelors_by_family = { "45": 486 };
  assert.ok(detailMismatches(fams, sample()).length > 0, "field counts");
  const none = sampleSchool();
  none.academics = { student_faculty_ratio: null };
  assert.ok(detailMismatches(none, sample()).length > 0, "majors table without snapshot majors");
  assert.deepEqual(JSON.parse(formatDetail(sample())), sample(), "the file layout reads back as the same object");
});

test("mergeDetails joins each step's tables per college in a fixed order and refuses duplicates", () => {
  const hs: SchoolDetail = { unit_id: "221999", tables: { home_states: { source: "ipeds-ef-c", vintage: "ipeds-ef-c", year: "Fall 2024", rows: { TN: 1 } } } };
  const other: SchoolDetail = { unit_id: "100654", tables: { home_states: { source: "ipeds-ef-c", vintage: "ipeds-ef-c", year: "Fall 2024", rows: { AL: 1 } } } };
  const merged = mergeDetails([hs, other], [sample()]);
  assert.deepEqual(merged.map((d) => d.unit_id), ["100654", "221999"]);
  assert.deepEqual(Object.keys(merged[1].tables), ["home_states", "majors"]);
  assert.deepEqual(Object.keys(mergeDetails([sample()], [hs])[0].tables), ["home_states", "majors"], "order doesn't depend on the step order");
  assert.throws(() => mergeDetails([sample()], [sample()]), /built twice/);
});

/* ---- History ---- */

const ca = (year: number, fams: Record<string, number>) => ({ year, family: "c-a" as const, rows: new Map([["221999", summed(Object.fromEntries(Object.entries(fams).map(([f, n]) => [familyColumn(f), n])))]]) });

test("history keeps each field's share of first-major bachelor's, 0 in years without it, plus the total", () => {
  const h = buildCollege({ unit_id: "221999", type: "private-nonprofit" }, { admissions: [], prices: [], sfa: [], ca: [ca(2013, { "45": 300, "14": 100 }), ca(2015, { "45": 300, "11": 100 })] });
  assert.deepEqual(h.series.bachelors, { start: 2013, values: [400, null, 400] });
  assert.deepEqual(h.series.major_45, { start: 2013, values: [0.75, null, 0.75] });
  assert.deepEqual(h.series.major_11, { start: 2013, values: [0, null, 0.25] }, "0 before the field existed, not null");
  assert.deepEqual(h.series.major_14, { start: 2013, values: [0.25, null, 0] });
  assert.equal(h.series.major_52, undefined, "never had it: no series");
  assert.deepEqual(validateShard(h), []);
  assert.throws(
    () => buildCollege({ unit_id: "221999", type: "private-nonprofit" }, { admissions: [], prices: [], sfa: [], ca: [ca(2015, { "53": 5 })] }),
    /MAJOR_FAMILIES/,
    "a field the site doesn't list stops the build"
  );
});

test("history eras: completions from C2014_A, crosswalked before C2020_A, every year after", () => {
  const eras = ERAS.filter((e) => e.family === "c-a");
  assert.deepEqual(eras.map((e) => e.years[0]), [2013, 2019]);
  assert.equal(eras[0].years[1] + 1, eras[1].years[0], "no gap between eras");
  assert.deepEqual(eras[0].files(2013), [{ name: "C2014_A" }]);
  assert.deepEqual(eras[1].files(2024), [{ name: "C2025_A" }]);
  assert.equal(eras[0].sum!.key(row("51.2401", "5", "1")), familyColumn("01"), "CIP 2010 era reads through the crosswalk");
  assert.equal(eras[1].sum!.key(row("01.8001", "5", "1")), familyColumn("01"));
  assert.equal(HISTORY_FAMILIES["c-a"].source, "ipeds-c");
  assert.equal(HISTORY_FAMILIES["c-a"].kind, "academic");
});

test("rule 1: the newest year's shares and total must equal the snapshot", () => {
  const s = sampleSchool();
  s.lineage = undefined;
  const total = s.academics!.bachelors_awarded!;
  const by = s.academics!.bachelors_by_family!;
  const series: SchoolHistory["series"] = { bachelors: { start: 2024, values: [total] } };
  for (const [f, n] of Object.entries(by)) series[majorSeriesKey(f as keyof typeof MAJOR_FAMILIES)] = { start: 2024, values: [Math.round((n / total) * 10_000) / 10_000] };
  // A field the college had earlier but not now is 0 in the newest year.
  series.major_54 = { start: 2023, values: [0.01, 0] };
  const h: SchoolHistory = { unit_id: s.unit_id, series };
  const only = (list: string[]) => list.filter((m) => / (major_\d\d|bachelors):/.test(m));
  const latest = { fall: 2024, academic: 2023 };
  assert.deepEqual(only(lastPointMismatches([s], new Map([[s.unit_id, h]]), latest)), []);
  series.major_45 = { start: 2024, values: [0.5] };
  assert.equal(only(lastPointMismatches([s], new Map([[s.unit_id, h]]), latest)).length, 1, "a share differs");
  series.major_45 = { start: 2024, values: [Math.round((by["45"] / total) * 10_000) / 10_000] };
  series.major_54 = { start: 2023, values: [0.01, 0.02] };
  assert.equal(only(lastPointMismatches([s], new Map([[s.unit_id, h]]), latest)).length, 1, "a field the snapshot doesn't have");
});

test("Home fact: national shares over a fixed panel, weighted by graduates; the largest gain first", () => {
  const college = (id: string, from: Record<string, number>, to: Record<string, number>): SchoolHistory =>
    buildCollege({ unit_id: id, type: "public" }, { admissions: [], prices: [], sfa: [], ca: [{ ...ca(2014, from), rows: new Map([[id, summed(Object.fromEntries(Object.entries(from).map(([f, n]) => [familyColumn(f), n])))]]) }, { ...ca(2024, to), rows: new Map([[id, summed(Object.fromEntries(Object.entries(to).map(([f, n]) => [familyColumn(f), n])))]]) }] });
  const panel = Array.from({ length: 25 }, (_, i) => college(String(100000 + i), { "11": 10, "45": 90 }, { "11": 40, "45": 60 }));
  // A college with bachelor's in only the newest year is outside the panel.
  const newcomer = buildCollege({ unit_id: "999999", type: "public" }, { admissions: [], prices: [], sfa: [], ca: [{ ...ca(2024, { "52": 1000 }), rows: new Map([["999999", summed({ [familyColumn("52")]: 1000 })]]) }] });
  const f = majorsShift([...panel, newcomer])!;
  assert.equal(f.from, 2014);
  assert.equal(f.to, 2024);
  assert.equal(f.n, 25);
  assert.equal(f.gradsFrom, 2500);
  assert.deepEqual(f.families[0], { family: "11", from: 0.1, to: 0.4 });
  assert.deepEqual(f.families.at(-1), { family: "45", from: 0.9, to: 0.6 });
  assert.ok(!f.families.some((r) => r.family === "52"), "the newcomer's field isn't in the panel");
  assert.equal(f.byYear[0], 0.1);
  assert.equal(f.byYear.at(-1), 0.4);
  assert.equal(majorsShift(panel.slice(0, 3)), null, "too few colleges");
});

test("fastest-growing field: the largest share gain with 25+ graduates now and 100+ bachelor's at both ends", () => {
  const s = (start: number, values: number[]) => ({ start, values });
  const series = {
    bachelors: s(2014, [400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400]),
    major_11: s(2014, [0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.12]),
    major_42: s(2014, [0.05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1]),
    major_45: s(2014, [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3]),
  };
  const g = fastestGrowingField(series, [2014, 2024])!;
  assert.equal(g.family, "11");
  assert.deepEqual(g.from, { year: 2014, share: 0.02 });
  assert.equal(g.graduates, 48);
  // Under 25 graduates now: not a growing field, just a few students.
  assert.equal(fastestGrowingField({ ...series, bachelors: s(2014, [150, ...Array(9).fill(150), 150]), major_11: s(2014, [0.02, ...Array(9).fill(0), 0.12]), major_42: undefined, major_45: undefined }, [2014, 2024]), null, `${GROWTH_MIN_GRADUATES}+ graduates`);
  // A small college: no line at all.
  assert.equal(fastestGrowingField({ ...series, bachelors: s(2014, [80, ...Array(9).fill(80), 80]) }, [2014, 2024]), null);
  // The start can be up to 2 years late, like other 10-year changes.
  const late = { ...series, bachelors: s(2016, [400, ...Array(7).fill(400), 400]), major_11: s(2016, [0.04, ...Array(7).fill(0), 0.12]) };
  assert.equal(fastestGrowingField(late, [2014, 2024])!.from.year, 2016);
  assert.equal(fastestGrowingField({ bachelors: series.bachelors, major_45: series.major_45 }, [2014, 2024]), null, "nothing grew");
});

/* ---- Lineage ---- */

test("every majors field, series, and table is registered and cited as IPEDS Completions", () => {
  for (const f of ["academics.bachelors_awarded", "academics.majors_top", "academics.bachelors_by_family", "detail.majors"] as const) {
    assert.equal(FIELDS[f].source, "ipeds-c", f);
    assert.equal(FIELDS[f].vintage, "ipeds-c", f);
  }
  assert.deepEqual(
    Object.keys(SERIES).filter((k) => k.startsWith("major_")),
    MAJOR_FAMILY_CODES.map((f) => `major_${f}`)
  );
  for (const f of MAJOR_FAMILY_CODES) {
    assert.ok(hasCip(f), `family ${f} exists in CIP 2020`);
    assert.equal(SERIES[majorSeriesKey(f)].field, "academics.bachelors_by_family");
    assert.deepEqual(SERIES[majorSeriesKey(f)].families, ["c-a"]);
  }
  assert.deepEqual(MAJOR_FAMILY_CODES, [...MAJOR_FAMILY_CODES].sort(), "families in code order (01 before 11)");
  assert.equal(SERIES.bachelors.field, "academics.bachelors_awarded");
});

/* ---- Committed data ---- */

test("committed data: Vanderbilt's majors, and every college's majors agree with its detail table", { skip: !HAS_DATA && "data/ not rebuilt with majors yet" }, () => {
  const vu = byId("221999");
  assert.ok(vu.academics?.majors_top?.length === MAJORS_TOP_N);
  assert.ok((vu.academics?.bachelors_awarded ?? 0) > 1000);
  assert.match(meta.vintages["ipeds-c"] ?? "", /^\d{4}–\d{2} graduates$/);
  const with_ = schools.filter((s) => s.academics?.majors_top);
  assert.ok(with_.length > 0.9 * schools.length, `${with_.length} colleges`);
  for (const s of with_) {
    const sum = s.academics!.majors_top!.reduce((a, m) => a + m.share, 0);
    assert.ok(sum <= 1.0005, s.name);
    assert.equal(Object.values(s.academics!.bachelors_by_family!).reduce((a, b) => a + b, 0), s.academics!.bachelors_awarded, s.name);
  }
  const details = readDetails(ROOT)!;
  assert.deepEqual(detailFileProblems(details, schools, meta), []);
  const withTable = new Set(details.filter((d) => d.tables.majors).map((d) => d.unit_id));
  for (const s of with_) assert.ok(withTable.has(s.unit_id), `${s.name} has top majors but no majors table`);
});

test("committed history: field shares end on the snapshot, and the Home fact is computed", { skip: (!HAS_DATA || !existsSync(join(ROOT, "data", "history", "schools", "221999.json"))) && "history not rebuilt with majors yet" }, () => {
  const h: SchoolHistory = JSON.parse(readFileSync(join(ROOT, "data", "history", "schools", "221999.json"), "utf8"));
  const vu = byId("221999");
  if (!h.series.bachelors) return;
  assert.equal(h.series.bachelors.values.at(-1), vu.academics!.bachelors_awarded);
  const total = vu.academics!.bachelors_awarded!;
  assert.equal(h.series.major_11!.values.at(-1), Math.round((vu.academics!.bachelors_by_family!["11"] / total) * 10_000) / 10_000);
  const facts = JSON.parse(readFileSync(join(ROOT, "data", "history", "facts.json"), "utf8"));
  assert.ok(facts.majors && facts.majors.n > 1000, "fixed panel");
  assert.equal(facts.majors.to - facts.majors.from, 10);
});
