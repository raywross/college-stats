/**
 * CDS Greek life, phase 1 (specs/greek-life.md): the record → block read (F1 participation percentages, F4 housing),
 * the `greek-f1-ratio` units-mix-up check, lineage, display helpers (benchmark medians, the profile card, Compare
 * cells, Explore's "Fraternity or sorority participation" filter), merge idempotence, and the partial-coverage
 * guard. Real records: data/cds-records/{221999,190415,231624,134130}.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { CdsCode, CollegeRecord, ItemResult } from "../lib/cds-sections.ts";
import { FIELDS } from "../lib/fields.ts";
import { validateSchool } from "../lib/lineage.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import { GREEK_LINEAGE_PREFIX, GREEK_RATIO_MAX, greekFromRecord, mergeGreek, ratioInconsistent } from "../lib/cds/greek.ts";
import {
  KNOWN_FOR_MIN_REPORTERS,
  compareFratPct,
  compareSorPct,
  fratMedian,
  greekCard,
  greekReporters,
  hasGreekParticipation,
  meetsGreekThreshold,
  sorMedian,
} from "../lib/cds/greek-display.ts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const records = readRecords(join(ROOT, "data", "cds-records"));
const record = (id: string) => structuredClone(records.find((r) => r.unit_id === id)!);
const school = (id: string) => structuredClone(schools.find((s) => s.unit_id === id)!);

/** A one-document synthetic record whose items are the given passed values (workbook cells with quotes). */
function recordWith(values: Partial<Record<CdsCode, number | string | boolean | null>>): CollegeRecord {
  const items: Record<CdsCode, ItemResult> = {};
  for (const [code, v] of Object.entries(values)) {
    items[code] = v === null ? { status: "blank" } : { v, status: "passed", cell: `CDS-F!B${code.slice(2)}`, quote: `x | ${v}` };
  }
  return {
    unit_id: "1",
    documents: [
      {
        sha256: "sha",
        edition: "2025-26",
        type: "xlsx-template",
        url: "https://example.edu/cds.xlsx",
        retrieved: "2026-10-03",
        reads: {},
        years: { edition: "2025–26", fall: "Fall 2025" },
        items,
      },
    ],
  } as unknown as CollegeRecord;
}

/* ------------------------------------------------------------------ */
/* Real records                                                        */
/* ------------------------------------------------------------------ */

test("real 2025–26 workbooks: F1 percentages and F4 housing", () => {
  const vu = greekFromRecord(record("221999"));
  assert.deepEqual(vu.outcome.failures, []);
  assert.equal(vu.block!.frat_pct_first_year, 0.26);
  assert.equal(vu.block!.frat_pct_undergrad, 0.274);
  assert.equal(vu.block!.sor_pct_first_year, 0.364);
  assert.equal(vu.block!.sor_pct_undergrad, 0.316);
  assert.equal(vu.block!.housing, true);

  // Cornell reports the undergrad percentages but left the first-year columns blank: null, not 0.
  const cornell = greekFromRecord(record("190415"));
  assert.deepEqual(cornell.outcome.failures, []);
  assert.equal(cornell.block!.frat_pct_first_year, null);
  assert.equal(cornell.block!.frat_pct_undergrad, 0.22803009943563557);
  assert.equal(cornell.block!.sor_pct_first_year, null);
  assert.equal(cornell.block!.sor_pct_undergrad, 0.1939972401103956);
  assert.equal(cornell.block!.housing, true);

  // William & Mary answers F4 only: no F1 row at all. The block still merges for the housing fact alone.
  const wm = greekFromRecord(record("231624"));
  assert.deepEqual(wm.outcome.failures, []);
  assert.equal(wm.block!.frat_pct_first_year, null);
  assert.equal(wm.block!.frat_pct_undergrad, null);
  assert.equal(wm.block!.housing, true);
});

test("years: F1 is the document's fall, F4 the edition", () => {
  const { lineage } = greekFromRecord(record("221999"));
  assert.equal(lineage["reported.greek.frat_pct_undergrad"].year, "Fall 2025");
  assert.equal(lineage["reported.greek.sor_pct_undergrad"].year, "Fall 2025");
  assert.equal(lineage["reported.greek.housing"].year, "2025–26");
  for (const rec of Object.values(lineage)) {
    assert.equal(rec.source, "college-site");
    assert.ok(rec.quote && rec.quote.length <= 160 && rec.url && rec.retrieved && rec.edition === "2025–26");
  }
});

test("data/schools.json carries the merged block for the pilot colleges, and every merged school validates", () => {
  for (const [id, frat, sor] of [
    ["221999", 0.274, 0.316],
    ["190415", 0.22803009943563557, 0.1939972401103956],
    ["134130", 0.17, 0.26],
  ] as const) {
    const s = school(id);
    assert.equal(s.reported?.greek?.frat_pct_undergrad, frat, id);
    assert.equal(s.reported?.greek?.sor_pct_undergrad, sor, id);
    assert.deepEqual(validateSchool(s, meta), [], id);
  }
});

/* ------------------------------------------------------------------ */
/* Blank is not 0, and the F1 ratio check                              */
/* ------------------------------------------------------------------ */

test("blank is not 0: a college with no F1 answer and no F4 answer merges no block at all", () => {
  const r = greekFromRecord(recordWith({}));
  assert.equal(r.block, null);
  assert.deepEqual(r.lineage, {});
});

test("greek-f1-ratio: a units mix-up (one side read as points, the other a fraction) drops that pair only", () => {
  assert.equal(ratioInconsistent(0.5, 0.01), true, `${GREEK_RATIO_MAX}x+ apart`);
  assert.equal(ratioInconsistent(0.08, 0.07), false, "ordinary gap");
  assert.equal(ratioInconsistent(0, 0.2), false, "deferred recruitment: a real near-zero first-year share");
  assert.equal(ratioInconsistent(null, 0.2), false);

  // Fraternities: 50% first-year vs 1% undergrad (planted, > 20x) — dropped, with a failure.
  // Sororities: 9% vs 7% (an ordinary gap) — kept, undisturbed by the fraternity failure.
  const r = greekFromRecord(recordWith({ "F.102": 0.5, "F.110": 0.01, "F.103": 0.09, "F.111": 0.07 }));
  assert.deepEqual(r.outcome.failures.map((f) => f.check), ["greek-f1-ratio"]);
  assert.equal(r.block!.frat_pct_first_year, null);
  assert.equal(r.block!.frat_pct_undergrad, null);
  assert.equal(r.block!.sor_pct_first_year, 0.09);
  assert.equal(r.block!.sor_pct_undergrad, 0.07);
  assert.ok(!r.lineage["reported.greek.frat_pct_first_year"]);
  assert.ok(r.lineage["reported.greek.sor_pct_first_year"]);

  // Deferred recruitment: 0% first-year next to a normal undergrad share is not a mix-up.
  const deferred = greekFromRecord(recordWith({ "F.102": 0, "F.110": 0.18 }));
  assert.deepEqual(deferred.outcome.failures, []);
  assert.equal(deferred.block!.frat_pct_first_year, 0);
  assert.equal(deferred.block!.frat_pct_undergrad, 0.18);
});

test("F.408 follows the E1/E3 convention: checked stores true; unchecked or blank stores nothing, never false", () => {
  const checked = greekFromRecord(recordWith({ "F.408": true }));
  assert.equal(checked.block!.housing, true);
  const blank = greekFromRecord(recordWith({ "F.102": 0.1 }));
  assert.equal(blank.block!.housing, null);
});

/* ------------------------------------------------------------------ */
/* Merge                                                                */
/* ------------------------------------------------------------------ */

test("mergeGreek is idempotent and removes a block whose record is gone", () => {
  const s = school("221999");
  assert.deepEqual(mergeGreek(s, record("221999")), s);
  const gone = mergeGreek(s, undefined);
  assert.equal(gone.reported?.greek, undefined);
  assert.ok(!Object.keys(gone.lineage ?? {}).some((k) => k.startsWith(GREEK_LINEAGE_PREFIX)));
  assert.deepEqual(validateSchool(gone, meta), []);
});

/* ------------------------------------------------------------------ */
/* Display                                                              */
/* ------------------------------------------------------------------ */

test("greekCard: null without any F1 or F4 answer; frat/sor sub-objects only when that organization has a value", () => {
  assert.equal(greekCard({} as School), null);
  assert.equal(greekCard({ reported: {} } as unknown as School), null);
  const vu = greekCard(school("221999"))!;
  assert.ok(vu.frat && vu.sor);
  assert.equal(vu.housing, true);
  const wm = greekCard(school("231624"))!;
  assert.equal(wm.frat, null);
  assert.equal(wm.sor, null);
  assert.equal(wm.housing, true);
});

test("Compare: the two undergrad percentages, blank (null, never 0) without a reported value", () => {
  assert.equal(compareFratPct(school("221999")), "27%");
  assert.equal(compareSorPct(school("221999")), "32%");
  assert.equal(compareFratPct({} as School), null);
  assert.equal(compareFratPct({ reported: { greek: { frat_pct_undergrad: null } } } as unknown as School), null);
});

test("benchmark medians: computed only over colleges that report an undergrad percentage", () => {
  const mk = (frat: number | null, sor: number | null): Pick<School, "reported"> => ({ reported: { greek: { frat_pct_undergrad: frat, sor_pct_undergrad: sor } } }) as unknown as Pick<School, "reported">;
  const rows = [mk(0.1, 0.2), mk(0.3, null), mk(null, null), mk(0.2, 0.1)];
  assert.equal(hasGreekParticipation(rows[0]), true);
  assert.equal(hasGreekParticipation(rows[2]), false);
  assert.equal(greekReporters(rows).length, 3);
  assert.equal(fratMedian(rows), 0.2);
  assert.ok(Math.abs(sorMedian(rows)! - 0.15) < 1e-9);
  assert.equal(fratMedian([]), null);
});

test("Explore \"Fraternity or sorority participation\": either undergrad percentage meets the floor; non-reporters never match", () => {
  const mk = (frat: number | null, sor: number | null) => ({ reported: { greek: { frat_pct_undergrad: frat, sor_pct_undergrad: sor } } }) as unknown as School;
  assert.equal(meetsGreekThreshold(mk(0.3, 0.1), 0.2), true, "fraternity side alone meets it");
  assert.equal(meetsGreekThreshold(mk(0.1, 0.3), 0.2), true, "sorority side alone meets it");
  assert.equal(meetsGreekThreshold(mk(0.1, 0.1), 0.2), false);
  assert.equal(meetsGreekThreshold(mk(null, null), 0.2), false, "a non-reporter never matches, however low the floor");
  assert.equal(meetsGreekThreshold({} as School, 0.2), false);

  assert.equal(parseFilters({ minGreek: "20" }).minGreek, 0.2);
  assert.equal(parseFilters({}).minGreek, undefined);
  assert.equal(countActiveFilters({ minGreek: "20" }), 1);
});

test("\"Known for: Big Greek life\" stays unbuilt regardless of reporter count: lib/insights.ts (where Known For badges are computed) never names a Greek field", () => {
  // KNOWN_FOR_MIN_REPORTERS (spec Open questions) only records when building "Known for: Big Greek life" would be
  // meaningful; reaching it doesn't build the feature by itself (specs/greek-life.md, specs/backlog.md track that
  // decision separately). This guard holds regardless of how many colleges report, unlike the old tripwire that
  // asserted the count stayed below threshold.
  assert.equal(typeof KNOWN_FOR_MIN_REPORTERS, "number");
  const insights = readFileSync(join(ROOT, "lib", "insights.ts"), "utf8");
  assert.ok(!/reported\??\.greek|reported\.greek|cds\/greek/.test(insights), "lib/insights.ts uses a CDS Greek-life field");
});

/* ------------------------------------------------------------------ */
/* Partial-coverage guard                                               */
/* ------------------------------------------------------------------ */

const GREEK_FIELD = /reported\??\.greek|reported\.greek|greek-display|cds\/greek|meetsGreekThreshold|hasGreekParticipation/;

test("partial coverage: reported.greek never reaches METRICS, rankOf, a percentile, a median, a sort, a trend indicator, or Home facts", () => {
  for (const planted of ["s.reported?.greek?.frat_pct_undergrad", "school.reported.greek", 'import { x } from "./cds/greek.ts"', "meetsGreekThreshold(s, 0.2)"]) {
    assert.ok(GREEK_FIELD.test(planted), planted);
  }
  for (const f of ["lib/metrics.ts", "lib/insights.ts", "lib/indicators.ts", "lib/history.ts", "lib/compare.ts", "app/page.tsx"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!GREEK_FIELD.test(src), `${f} uses a CDS Greek-life field`);
  }
  // lib/dataset.ts may name the module only for the boolean/threshold filter.
  const dataset = readFileSync(join(ROOT, "lib", "dataset.ts"), "utf8");
  const sorters = dataset.slice(dataset.indexOf("const SORTERS"), dataset.indexOf("};", dataset.indexOf("const SORTERS")));
  assert.ok(sorters.length > 100 && !GREEK_FIELD.test(sorters), "an Explore sort uses a Greek-life field");
  const outside = dataset.replace(/^.*meetsGreekThreshold.*$/gm, "").replace(/^.*minGreek.*$/gm, "");
  assert.ok(!GREEK_FIELD.test(outside), "lib/dataset.ts uses a Greek-life field outside its filter");
  // Stored fields are registered, topic "campus", and never computed into a rank.
  for (const k of ["reported.greek.frat_pct_undergrad", "reported.greek.sor_pct_undergrad", "reported.greek.housing"] as const) {
    assert.equal(FIELDS[k].source, "college-site", k);
    assert.equal(FIELDS[k].topic, "campus", k);
  }
});
