/**
 * History: era mapping, derivations, the build's checks, and the committed files. `npm test`.
 * See specs/trends-data.md. Fixture values are Vanderbilt's (221999) real NCES figures, probed 2026-09-28.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { FIELDS } from "../lib/fields.ts";
import { computePrices, priceSuffix, yieldOf } from "../lib/derive.ts";
import {
  HISTORY_FAMILIES,
  SERIES,
  changeOver,
  formatChange,
  historySources,
  isNotable,
  real,
  validateHistoryMeta,
  validateShard,
  type CpiTable,
  type HistoryMeta,
  type NationalHistory,
  type SchoolHistory,
} from "../lib/history.ts";
import { ERAS, eraFor, readSpec, requiredColumns } from "../scripts/history/registry.mts";
import {
  buildCollege,
  buildFacts,
  coverage,
  coverageDrops,
  lastPointMismatches,
  missingColumns,
  toSeries,
  type Inputs,
  type YearTable,
} from "../scripts/history/build.mts";
import { schoolYearAverages, type CpiMonth } from "../scripts/history/cpi.mts";

const ROOT = join(import.meta.dirname, "..");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const HISTORY = join(ROOT, "data", "history");
const hasHistory = existsSync(join(HISTORY, "meta.json"));

const V = "221999";
const rows = (row: Record<string, string>) => new Map([[V, { UNITID: V, ...row }]]);
const adm = (year: number, row: Record<string, string>): YearTable => {
  const era = eraFor(year >= 2014 ? "adm" : "ic-admissions", year)!;
  return { year, family: era.family, rows: rows(row), values: era.values };
};
const flatCpi: CpiTable = { series: "t", label: "t", url: "", retrieved: "", basis: "", start: 2000, values: Array(30).fill(100), missing: [] };

/* ---- Registry ---- */

test("admissions eras: IC2001 by gender, IC2002–2013 totals, ADM from 2014", () => {
  assert.equal(eraFor("ic-admissions", 2001)!.values!.applicants instanceof Object, true);
  assert.equal(eraFor("ic-admissions", 2002)!.values!.applicants, "APPLCN");
  assert.equal(eraFor("ic-admissions", 2014), null);
  assert.equal(eraFor("adm", 2014)!.files(2014)[0].name, "ADM2014");
  // IC2001 sums men and women; a single-gender college's blank half counts as nothing, not as missing.
  const ic2001 = eraFor("ic-admissions", 2001)!.values!;
  assert.equal(readSpec({ APPLCNM: "4870", APPLCNW: "4860" }, ic2001.applicants), 9730);
  assert.equal(readSpec({ APPLCNM: "", APPLCNW: "812" }, ic2001.applicants), 812);
  assert.equal(readSpec({ APPLCNM: ".", APPLCNW: "" }, ic2001.applicants), null);
});

test("every year from each era's start maps to exactly one era per family", () => {
  for (const fam of Object.keys(HISTORY_FAMILIES) as (keyof typeof HISTORY_FAMILIES)[]) {
    const eras = ERAS.filter((e) => e.family === fam);
    for (let y = Math.min(...eras.map((e) => e.years[0])); y <= 2030; y++) {
      const n = eras.filter((e) => y >= e.years[0] && y <= e.years[1]).length;
      if (fam === "ic-admissions" && y > 2013) continue;
      assert.equal(n, 1, `${fam} ${y}`);
    }
  }
});

test("price suffixes: IC_AY files hold the year in …AY3, COST1 files in …AY2", () => {
  assert.equal(priceSuffix("IC2013_AY"), "3");
  assert.equal(priceSuffix("COST1_2024"), "2");
  // COST1_2024 carries 2023–24 in AY2 and 2024–25 in AY3: reading AY3 would mislabel next year's price.
  const cost1 = { UNITID: V, CHG1AY2: "63946", CHG2AY2: "63946", CHG3AY2: "63946", CHG4AY2: "1194", CHG5AY2: "21054", CHG6AY2: "3396", CHG2AY3: "67498" };
  const p = computePrices("private-nonprofit", cost1, priceSuffix("COST1_2024"), undefined, undefined)!;
  assert.equal(p.tuition_fees.in_state, 63946);
  assert.equal(p.full_price, 63946 + 1194 + 21054 + 3396);
  const pricesEra = eraFor("prices", 2023)!;
  assert.deepEqual(pricesEra.files(2023).map((f) => f.name), ["IC2023_AY", "COST1_2024"]);
  assert.deepEqual(requiredColumns(pricesEra, pricesEra.files(2023)[1]), ["CHG1AY2", "CHG2AY2", "CHG3AY2", "CHG4AY2", "CHG5AY2", "CHG6AY2"]);
});

test("aid from 2023–24 needs its COST2 supplement for residency and net price", () => {
  assert.equal(eraFor("sfa", 2023)!.supplement!(2023), "COST2_2024");
  assert.ok(eraFor("sfa", 2023)!.supplementRequired!.includes("SCFA12P"));
  assert.equal(eraFor("sfa", 2022)!.supplement, undefined);
});

/* ---- Build ---- */

function vanderbiltInputs(): Inputs {
  return {
    admissions: [
      adm(2001, { APPLCNM: "4800", APPLCNW: "4930", ADMSSNM: "2200", ADMSSNW: "2314", ENRLFTM: "760", ENRLFTW: "797", ENRLPTM: "", ENRLPTW: "" }),
      adm(2002, { APPLCN: "9836", ADMSSN: "4550", ENRLT: "1579" }),
      // Carried forward from 2002: identical triple, dropped.
      adm(2003, { APPLCN: "9836", ADMSSN: "4550", ENRLT: "1579" }),
      // A reporting error: more enrollees than admits. Counts kept, yield left out.
      adm(2004, { APPLCN: "11173", ADMSSN: "400", ENRLT: "1602" }),
    ],
    prices: [
      { year: 2007, family: "prices", suffix: "3", rows: rows({ CHG1AY3: "35278", CHG2AY3: "35278", CHG3AY3: "35278", CHG4AY3: "1000", CHG5AY3: "11000", CHG6AY3: "2556" }) },
      { year: 2008, family: "prices", suffix: "3", rows: rows({ CHG1AY3: "37005", CHG2AY3: "37005", CHG3AY3: "37005", CHG4AY3: "1000", CHG5AY3: "12000", CHG6AY3: "2298" }) },
    ],
    sfa: [
      // 2007–08: no total grant dollars yet, so the average cost uses share × average (flagged approx).
      { year: 2007, family: "sfa", rows: rows({ SCUGFFN: "1500", AGRNT_N: "823", AGRNT_P: "55", AGRNT_A: "29179" }) },
      { year: 2008, family: "sfa", rows: rows({ SCUGFFN: "1560", AGRNT_N: "890", AGRNT_P: "57", AGRNT_A: "31857", AGRNT_T: "28352730", NPGRN2: "20446", NPT412: "3099" }) },
    ],
  };
}

test("buildCollege: sums, repeats, impossible yields, approximations", () => {
  const h = buildCollege({ unit_id: V, type: "private-nonprofit" }, vanderbiltInputs());
  assert.deepEqual(h.series.applicants, { start: 2001, values: [9730, 9836, null, 11173] });
  assert.deepEqual(h.series.enrolled!.values, [1557, 1579, null, 1602]);
  assert.deepEqual(h.repeated, [2003]);
  assert.equal(h.series.yield!.values.length, 2, "2004's impossible yield is left out, so the series ends at 2002");
  assert.equal(h.series.acceptance_rate!.values[0], Math.round((4514 / 9730) * 10000) / 10000);
  assert.deepEqual(h.series.avg_paid_all!.approx, [2007]);
  assert.equal(h.series.aided_net_price!.start, 2008);
  assert.equal(h.series.net_price_income_1!.values[0], 3099);
  assert.deepEqual(validateShard(h), []);
});

test("toSeries trims to reported years and keeps gaps as null", () => {
  assert.deepEqual(toSeries(new Map([[2005, 1], [2007, 3]])), { start: 2005, values: [1, null, 3] });
  assert.equal(toSeries(new Map()), undefined);
});

test("yield over 100% is treated as not reported, on the profile and in history", () => {
  assert.equal(yieldOf(400, 1602), null);
  assert.equal(yieldOf(0, 5), null);
  assert.equal(yieldOf(100, 40), 0.4);
});

/* ---- Checks (each proven to fail when broken) ---- */

test("missingColumns names every mapped column a file lacks", () => {
  assert.deepEqual(missingColumns(["APPLCN", "ADMSSN"], new Set(["UNITID", "APPLCN"])), ["ADMSSN"]);
  assert.deepEqual(missingColumns(["APPLCN"], new Set(["APPLCN"])), []);
});

test("coverageDrops catches a drop over 20% and a missing year; the allow-list needs the exact year", () => {
  const mk = (ids: string[], year: number): SchoolHistory[] => ids.map((id) => ({ unit_id: id, series: { applicants: { start: year, values: [100] } } }));
  const ids = Array.from({ length: 10 }, (_, i) => String(i));
  const fine = coverage([...mk(ids, 2010), ...mk(ids.slice(0, 9), 2011)]);
  assert.deepEqual(coverageDrops(fine), []);
  const drop = coverage([...mk(ids, 2010), ...mk(ids.slice(0, 7), 2011)]);
  assert.equal(coverageDrops(drop).length, 1);
  assert.deepEqual(coverageDrops(drop, [{ series: "applicants", year: 2011, reason: "test" }]), []);
  const gap = coverage([...mk(ids, 2010), ...mk(ids, 2012)]);
  assert.match(coverageDrops(gap)[0], /no colleges reported the year before/);
});

test("lastPointMismatches: history must end on the snapshot's value (rule 1)", () => {
  const s = structuredClone(schools.find((x) => !x.lineage && x.admissions.year && x.admissions.applicants)!);
  const latest = { fall: s.admissions.year!, academic: 2023 };
  const h: SchoolHistory = { unit_id: s.unit_id, series: { applicants: { start: latest.fall, values: [s.admissions.applicants] } } };
  const map = new Map([[s.unit_id, h]]);
  const only = (list: string[]) => list.filter((m) => m.includes(" applicants:"));
  assert.deepEqual(only(lastPointMismatches([s], map, latest)), []);
  h.series.applicants!.values = [s.admissions.applicants! + 1];
  assert.equal(only(lastPointMismatches([s], map, latest)).length, 1);
  // A CDS override replaces the snapshot's value, so history isn't expected to match it.
  s.lineage = { "admissions.applicants": { source: "cds" } };
  assert.deepEqual(only(lastPointMismatches([s], map, latest)), []);
});

test("validateShard rejects unknown series, impossible values, and untrimmed arrays; allows negative net price", () => {
  const ok: SchoolHistory = { unit_id: V, series: { net_price_income_1: { start: 2020, values: [-500, 200] } } };
  assert.deepEqual(validateShard(ok), []);
  assert.match(validateShard({ unit_id: V, series: { made_up: { start: 2020, values: [1] } } } as unknown as SchoolHistory)[0], /unknown series/);
  assert.match(validateShard({ unit_id: V, series: { acceptance_rate: { start: 2020, values: [1.2] } } })[0], /impossible/);
  assert.match(validateShard({ unit_id: V, series: { applicants: { start: 2020, values: [-1] } } })[0], /impossible/);
  assert.match(validateShard({ unit_id: V, series: { applicants: { start: 2020, values: [null, 5] } } })[0], /trimmed/);
  assert.match(validateShard(ok, new Set(["1"]))[0], /not a college/);
});

test("every series extends a registered field and every family cites a known source", () => {
  for (const [k, def] of Object.entries(SERIES)) assert.ok(def.field in FIELDS, `${k} → ${def.field}`);
  for (const [f, fam] of Object.entries(HISTORY_FAMILIES)) assert.ok(fam.source in meta.sources, `${f} → ${fam.source}`);
});

/* ---- CPI and changes ---- */

test("CPI school-year averages: July–June, a missing month skipped, an unfinished year left out", () => {
  const months: CpiMonth[] = [];
  for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push([y, m, y === 2025 && m === 10 ? null : 100 + (y - 2024) * 12 + m]);
  const cut = months.filter(([y, m]) => y < 2026 || m <= 6);
  const { start, values, missing } = schoolYearAverages(cut, 2024);
  assert.equal(start, 2024);
  assert.equal(values.length, 2, "2024–25 and 2025–26; 2026–27 has no June yet");
  assert.equal(values[0], (107 + 108 + 109 + 110 + 111 + 112 + 113 + 114 + 115 + 116 + 117 + 118) / 12);
  assert.deepEqual(missing, ["2025-10"]);
});

test("real(), changeOver(), and the notable rule", () => {
  const cpi: CpiTable = { ...flatCpi, values: flatCpi.values.map((_, i) => 100 + i * 10) };
  assert.equal(real(100, 2000, cpi, 2010), 200);
  const s = { start: 2013, values: [40000, ...Array(9).fill(null), 60000] };
  const c = changeOver("avg_paid_all", s, [2013, 2023], cpi)!;
  assert.equal(c.from.value, (40000 * 330) / 230);
  assert.ok(Math.abs(c.change - (60000 / ((40000 * 330) / 230) - 1)) < 1e-9);
  assert.equal(formatChange({ measure: "ratio", change: -0.116 }), "−12%");
  assert.equal(formatChange({ measure: "points", change: 0.07 }), "+7 pts");
  const national: NationalHistory = { series: {}, changes: { avg_paid_all: { from: 2013, to: 2023, measure: "ratio", p5: -0.3, p25: -0.2, median: -0.1, p75: 0, p95: 0.2, n: 100 } } };
  assert.equal(isNotable({ ...c, change: 0.06 }, national), true, "above p75 and past the 5% floor");
  assert.equal(isNotable({ ...c, change: -0.04 }, national), false, "inside the middle half");
  assert.equal(isNotable({ ...c, change: 0.03 }, { ...national, changes: { avg_paid_all: { ...national.changes.avg_paid_all!, p75: 0.01 } } }), false, "under the floor");
  // A start more than two years late is a different window.
  assert.equal(changeOver("avg_paid_all", { start: 2017, values: [1, 2, 3, 4, 5, 6, 7] }, [2013, 2023], cpi), null);
});

test("facts use fixed panels: colleges missing an endpoint are left out", () => {
  const mk = (id: string, a: number, b: number): SchoolHistory => ({
    unit_id: id,
    series: { full_price: { start: 2013, values: [a, ...Array(9).fill(null), b] }, avg_paid_all: { start: 2013, values: [a / 2, ...Array(9).fill(null), b / 2] } },
  });
  const panel = Array.from({ length: 25 }, (_, i) => mk(String(i), 100, 110));
  const outsider: SchoolHistory = { unit_id: "x", series: { full_price: { start: 2023, values: [10_000] }, avg_paid_all: { start: 2023, values: [10_000] } } };
  const f = buildFacts([...panel, outsider], { academic: [2013, 2023], fall: [2014, 2024] }, flatCpi);
  assert.equal(f.priceGap!.n, 25);
  assert.equal(f.priceGap!.fullPriceChange, 0.1);
  assert.equal(f.harderToGetIn, null, "needs 100 selective colleges");
});

/* ---- The committed files ---- */

test("committed history: every shard is valid and ends on the snapshot's values", { skip: !hasHistory }, () => {
  const hmeta: HistoryMeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8"));
  assert.deepEqual(validateHistoryMeta(hmeta, meta), []);
  const ids = new Set(schools.map((s) => s.unit_id));
  const shards = readdirSync(join(HISTORY, "schools")).map((f) => JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory);
  assert.equal(shards.length, hmeta.schools);
  for (const h of shards) assert.deepEqual(validateShard(h, ids), []);
  assert.deepEqual(lastPointMismatches(schools, new Map(shards.map((h) => [h.unit_id, h])), hmeta.latest), []);
});

test("committed history: citations name each survey with the years used", { skip: !hasHistory }, () => {
  const hmeta: HistoryMeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8"));
  const adm = historySources(["applicants"], hmeta, meta);
  assert.deepEqual(adm.map((s) => s.key), ["ipeds-ic", "ipeds-adm"]);
  assert.match(adm[1].years, /^Fall 2014 to Fall \d{4}$/);
  assert.deepEqual(historySources(["applicants"], hmeta, meta, [2014, hmeta.latest.fall]).map((s) => s.key), ["ipeds-adm"]);
});
