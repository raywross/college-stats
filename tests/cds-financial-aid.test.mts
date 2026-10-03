/**
 * CDS financial aid (specs/data-expansion/cds-financial-aid.md#build, tests 1–12): lib/cds/financial-aid.ts against the
 * four real 2025–26 records (Vanderbilt, Cornell, William & Mary, Illinois). Every guard is shown failing on a broken
 * copy of a real document. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { CollegeRecord, DocumentRecord } from "../lib/cds-sections.ts";
import { parseAidYear } from "../lib/cds-sections.ts";
import {
  aidMethodology,
  aidYearLabel,
  applyFinancialAid,
  buildFinancialAid,
  cdsAidYearNote,
  checkCdsAidDetail,
  checkDates,
  checkH1Row,
  checkH2Column,
  checkH6,
  checkMethodology,
  financialAidProblems,
  meritDollarShare,
  noCssProfile,
  normalizeNeedMet,
  offersInternationalAid,
  packageApproxRule,
  pickAidRecord,
  restoreCdsAid,
} from "../lib/cds/financial-aid.ts";
import { compareAidRows } from "../lib/cds/financial-aid-compare.ts";
import { stripReported } from "../lib/reported-merge.ts";
import { lineageFor, validateSchool } from "../lib/lineage.ts";
import { validateDetail } from "../lib/detail.ts";
import { FIELDS, type FieldPath } from "../lib/fields.ts";
import { parseFilters } from "../lib/params.ts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const records = new Map(readRecords(join(ROOT, "data", "cds-records")).map((r) => [r.unit_id, r]));

const VU = "221999";
const CU = "190415";
const WM = "231624";
const IL = "145637";

const school = (id: string) => structuredClone(schools.find((s) => s.unit_id === id)!);
/** The school as it was before any merge (no reported block, aid.cds back where the override put it). */
const before = (id: string) => stripReported(school(id));
const record = (id: string): CollegeRecord => structuredClone(records.get(id)!);
const doc = (r: CollegeRecord): DocumentRecord => r.documents[0];
/** A copy of a record with some items changed: a value, or a blank (null). */
function edited(id: string, changes: Record<string, number | string | boolean | null>): CollegeRecord {
  const r = record(id);
  for (const [code, v] of Object.entries(changes)) {
    const it = doc(r).items[code];
    if (v === null) doc(r).items[code] = { status: "blank" };
    else doc(r).items[code] = { ...it, v, status: "passed", quote: it?.quote ?? `${code} | ${v}`, cell: it?.cell ?? "CDS-H!AC1" };
  }
  return r;
}
const build = (id: string, r: CollegeRecord = record(id), s: School = before(id)) => buildFinancialAid(s, r)!;

/* 1 ---------------------------------------------------------------- */
test("1. line I percents: Cornell's \"1\" is 100% because H = D; other forms become fractions; ambiguous and tiny values go to review", () => {
  assert.deepEqual(normalizeNeedMet(1, { h: 1744, d: 1744 }), { v: 1 });
  assert.equal(normalizeNeedMet(1, { h: 100, d: 200 }).v, null);
  assert.ok(normalizeNeedMet(1, { h: 100, d: 200 }).review);
  assert.equal(normalizeNeedMet(1, { h: 100, d: 200, otherColumnsUseFractions: true }).v, 1);
  assert.equal(normalizeNeedMet(58.6, { h: null, d: null }).v, 0.586);
  assert.equal(normalizeNeedMet("99.4%", { h: null, d: null }).v, 0.994);
  assert.equal(normalizeNeedMet(0.82, { h: null, d: null }).v, 0.82);
  assert.ok(normalizeNeedMet(0.03, { h: null, d: null }).review);
  // Real: Cornell's first-years and full-time columns are "1" with H = D, so 100%.
  assert.equal(build(CU).aid.first_years?.i, 1);
  // Break: without line H near line D (and no fraction in another column), the same "1" can't be published as 100%.
  const broken = build(CU, edited(CU, { "H.208": 100, "H.221": 100, "H.234": 1 }));
  assert.equal(broken.aid.first_years?.i, null, "line I goes to review; the rest of the column still publishes");
  assert.ok(broken.reviews.some((r) => r.check === "need-met-percent"));
});

/* 2 ---------------------------------------------------------------- */
test("2. H.101: both template choices parse; \"2023\" or a blank keeps H1/H2/H2A/H6 unpublished while H8 still publishes", () => {
  assert.deepEqual(parseAidYear("2025-2026 Estimated"), { start: 2025, status: "estimated" });
  assert.deepEqual(parseAidYear("2024-2025 Final"), { start: 2024, status: "final" });
  assert.equal(aidYearLabel({ start: 2025, status: "estimated" }), "2025–26 (estimated)");
  assert.equal(aidYearLabel({ start: 2024, status: "final" }), "2024–25");
  for (const bad of ["2023", null]) {
    const b = build(CU, edited(CU, { "H.101": bad }));
    assert.equal(b.aid.aid_year, null);
    assert.equal(b.aid.first_years, null);
    assert.equal(b.aid.international, null);
    assert.equal(b.aid.institutional_grants, null);
    assert.equal(b.detail.h2, null);
    assert.ok(b.aid.forms?.css_profile, "H8 still publishes");
    assert.ok(!("reported.aid.first_years" in b.lineage));
  }
});

/* 3 ---------------------------------------------------------------- */
test("3. H2 order and package bounds: the four real workbooks pass; swapped lines and a package smaller than its parts fail", () => {
  for (const id of [VU, CU, WM, IL]) {
    const b = build(id);
    assert.deepEqual(b.reviews, [], id);
    for (const col of ["first_years", "full_time"] as const) assert.deepEqual(checkH2Column(b.detail.h2![col]), [], `${id} ${col}`);
  }
  const wm = build(WM).detail.h2!.first_years;
  // Break: swap B (applied) and C (have need).
  assert.ok(checkH2Column({ ...wm, b: wm.c, c: wm.b }).length > 0);
  // Break: a package smaller than its own grant.
  assert.ok(checkH2Column({ ...wm, j: Math.round(wm.k! / 2) }).length > 0);
  // The brief's J ≈ K + L rule fails a valid document (W&M: J also holds non-need grants), which is why it isn't a check.
  assert.equal(packageApproxRule(wm), false);
  // And the spec's M ≤ L: Vanderbilt's first-years have M > L, validly (M averages only the loan recipients).
  const vu = build(VU).detail.h2!.first_years;
  assert.ok(vu.m! > vu.l!);
  // A failing column isn't published (and its lines aren't in the detail file).
  const broken = build(WM, edited(WM, { "H.202": 500 }));
  assert.equal(broken.aid.first_years, null);
  assert.ok(broken.reviews.some((r) => r.check === "h2-column"));
});

/* 4 ---------------------------------------------------------------- */
test("4. H6 product and H1 sums: Cornell and Illinois pass; a ×10 typo, a dropped row, and \"not available\" with recipients fail", () => {
  for (const id of [CU, IL]) {
    const b = build(id);
    assert.ok(b.detail.h6);
    assert.deepEqual(checkH6(b.detail.h6!, null), []);
    assert.deepEqual(checkH1Row(b.detail.h1!.need), []);
    assert.deepEqual(checkH1Row(b.detail.h1!.non_need), []);
  }
  const cu = build(CU).detail;
  assert.ok(checkH6({ ...cu.h6!, average: cu.h6!.average! * 10 }, null).length > 0);
  assert.ok(checkH1Row({ ...cu.h1!.need, state: null }).length > 0);
  assert.ok(checkH6({ ...cu.h6!, none: true, need_based: false }, null).length > 0);
  // Through the build: a typo keeps H6 off the snapshot.
  const typo = build(CU, edited(CU, { "H.605": 882630 }));
  assert.equal(typo.aid.international, null);
  assert.ok(typo.reviews.some((r) => r.check === "h6"));
});

/* 5 ---------------------------------------------------------------- */
test("5. forms and methodology: Illinois (FM, FAFSA only) passes; IM without the CSS Profile fails; blank methodology with the CSS Profile is inferred, cited as derived; a blank H8 is null", () => {
  const il = build(IL);
  assert.equal(il.aid.methodology, "federal");
  assert.deepEqual(il.aid.forms, { fafsa: true, own_form: false, css_profile: false, state_form: false, noncustodial_profile: false, business_farm_supplement: false, other: null });
  assert.deepEqual(checkMethodology("institutional", il.aid.forms), ["institutional methodology without the CSS Profile or the college's own form"]);
  const cu = build(CU).aid;
  assert.equal(cu.methodology, null);
  assert.deepEqual(aidMethodology(cu), { value: "institutional", inferred: true });
  const merged = applyFinancialAid(before(CU), record(CU));
  assert.equal(lineageFor("derived.aid_methodology", merged, meta).method, "derived");
  // A wholly blank H8: forms null, so "No CSS Profile" doesn't match it (blank isn't "not required").
  const blank = applyFinancialAid(before(IL), edited(IL, { "H.801": null }));
  assert.equal(blank.reported?.aid?.forms, null);
  assert.equal(noCssProfile(blank), false);
  assert.equal(noCssProfile(applyFinancialAid(before(IL), record(IL))), true);
  // FAFSA missing from a non-blank list fails the H8 check.
  const noFafsa = build(CU, edited(CU, { "H.801": null }));
  assert.equal(noFafsa.aid.forms, null);
  assert.ok(noFafsa.reviews.some((r) => r.check === "h8-fafsa"));
});

/* 7 ---------------------------------------------------------------- */
test("7. years: the newer aid year beats a newer edition; final beats estimate; the panel's note one and two years back", () => {
  const twoDocs = (a: { edition: string; aid: string }, b: { edition: string; aid: string }): CollegeRecord => {
    const r = record(WM);
    const d1 = structuredClone(doc(r));
    const d2 = structuredClone(doc(r));
    d1.edition = a.edition;
    d1.items["H.101"] = { ...d1.items["H.101"], v: a.aid };
    d2.edition = b.edition;
    d2.sha256 = "0".repeat(64);
    d2.items["H.101"] = { ...d2.items["H.101"], v: b.aid };
    return { ...r, documents: [d1, d2] };
  };
  // Newer edition (2025-26) reports an older aid year than the older edition's estimate: the newer aid year wins.
  let pick = pickAidRecord(twoDocs({ edition: "2025-26", aid: "2023-2024 Final" }, { edition: "2024-25", aid: "2024-2025 Estimated" }))!;
  assert.equal(pick.document.edition, "2024-25");
  // Same aid year: final beats the estimate, whatever the edition.
  pick = pickAidRecord(twoDocs({ edition: "2024-25", aid: "2024-2025 Estimated" }, { edition: "2025-26", aid: "2024-2025 Final" }))!;
  assert.deepEqual(pick.aidYear, { start: 2024, status: "final" });
  assert.equal(pick.document.edition, "2025-26");

  assert.deepEqual(cdsAidYearNote({ start: 2024, status: "final" }, "2023–24"), { show: true, suffix: "" });
  assert.deepEqual(cdsAidYearNote({ start: 2022, status: "final" }, "2023–24"), { show: true, suffix: ", a year before the federal figures above" });
  assert.equal(cdsAidYearNote({ start: 2021, status: "final" }, "2023–24").show, false);
  // Compare drops the aid-year rows for a college two years behind the federal aid year.
  const old = applyFinancialAid(before(WM), edited(WM, { "H.101": "2021-2022 Final" }));
  const needMet = compareAidRows("2023–24").find((r) => r[0] === "Need met, first-years")!;
  assert.equal(needMet[3](old), null);
  assert.equal(needMet[3](applyFinancialAid(before(WM), record(WM))), "82%");
  // No literal year in the new components (the repo-wide guard is in citation-guards; checked here directly too).
  for (const f of ["CdsAidTable.tsx", "ApplyingForAid.tsx", "InternationalAid.tsx"]) {
    const src = readFileSync(join(ROOT, "components", "school", f), "utf8");
    assert.doesNotMatch(src, /\b[Ff]all 20\d\d\b|\b20\d\d[–-]\d\d\b/, f);
  }
});

/* 8 ---------------------------------------------------------------- */
test("8. supersession: a same-or-newer record moves aid.cds to aid.cds_previous; an older record leaves it; strip restores it byte for byte", () => {
  for (const id of [CU, VU]) {
    const s = before(id);
    assert.ok(s.aid?.cds, `${id} has the hand-imported aid.cds`);
    const merged = applyFinancialAid(s, record(id));
    assert.equal(merged.aid?.cds, undefined);
    assert.deepEqual(merged.aid?.cds_previous?.values, s.aid!.cds);
    assert.equal(merged.lineage?.["aid.cds_previous"]?.source, "cds");
    assert.equal(JSON.stringify(restoreCdsAid(merged).aid), JSON.stringify(s.aid));
    assert.equal(JSON.stringify(stripReported(merged)), JSON.stringify(s));
  }
  // Break: a record older than the override (Vanderbilt's override is 2024-25) must not replace it.
  const older = record(VU);
  doc(older).edition = "2023-24";
  const kept = applyFinancialAid(before(VU), older);
  assert.ok(kept.aid?.cds);
  assert.equal(kept.aid?.cds_previous, undefined);
  // And the guard: a same-or-newer published H2 alongside a kept aid.cds is an error.
  const unsuperseded = { ...applyFinancialAid(before(CU), record(CU)) };
  unsuperseded.aid = { ...unsuperseded.aid!, cds: unsuperseded.aid!.cds_previous!.values };
  assert.ok(financialAidProblems(unsuperseded).length > 0);
});

/* 9 ---------------------------------------------------------------- */
test("9. lineage: the committed four validate; a reported.aid value without its record, or a detail value without a quote, fails", () => {
  for (const id of [VU, CU, WM, IL]) {
    const s = school(id);
    assert.ok(s.reported?.aid, id);
    assert.deepEqual(validateSchool(s, meta), [], id);
  }
  const s = school(CU);
  delete s.lineage!["reported.aid.forms"];
  assert.ok(validateSchool(s, meta).some((e) => e.includes("reported.aid.forms is stored without a lineage record")));

  const detail = JSON.parse(readFileSync(join(ROOT, "data", "detail", "schools", `${CU}.json`), "utf8"));
  assert.deepEqual(validateDetail(detail, meta), []);
  assert.equal(checkCdsAidDetail(detail.tables.cds_aid.rows), null);
  delete detail.tables.cds_aid.rows.cite["H.209"];
  assert.match(checkCdsAidDetail(detail.tables.cds_aid.rows) ?? "", /H\.209 has a value but no quote/);
  assert.ok(validateDetail(detail, meta).length > 0);
});

/* 10 --------------------------------------------------------------- */
test("10. never ranked: partial-coverage aid fields aren't metrics (ranks, standouts, radar, key differences) or sort keys", () => {
  const partial = (Object.keys(FIELDS) as FieldPath[]).filter((p) => p.startsWith("reported.aid.") || p === "derived.merit_dollar_share" || p === "derived.aid_methodology");
  assert.ok(partial.length >= 10);
  const inputsOf = (p: FieldPath, seen = new Set<string>()): string[] => {
    if (seen.has(p)) return [];
    seen.add(p);
    const def = FIELDS[p] as (typeof FIELDS)[FieldPath];
    const ins = "derived" in def && def.derived ? (def.derived.inputs as readonly string[]) : [];
    return [p, ...ins.flatMap((i) => (i in FIELDS ? inputsOf(i as FieldPath, seen) : []))];
  };
  // Every metric (lib/metrics.ts METRICS: what rankOf, standouts, the radar, and key differences read) names its field.
  const metricFields = [...readFileSync(join(ROOT, "lib", "metrics.ts"), "utf8").matchAll(/\bfield: "([^"]+)"/g)].map((m) => m[1] as FieldPath);
  assert.ok(metricFields.length > 20);
  for (const f of metricFields) for (const p of inputsOf(f)) assert.ok(!partial.includes(p as FieldPath), `a metric uses ${p}`);
  // Break: a metric on merit dollar share would be caught.
  assert.ok(inputsOf("derived.merit_dollar_share").some((p) => partial.includes(p as FieldPath)));
  for (const key of ["merit_dollar_share", "need_met", "aid_methodology"]) assert.notEqual(parseFilters({ sortBy: key }).sortBy, key);
  for (const f of ["lib/dataset.ts", "lib/insights.ts", "lib/metrics.ts"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(src.replace(/import[^\n]*\n/g, "").replace(/filters\.(aidForms|intlAid)[^\n]*\n/g, ""), /reported\??\.aid|merit_dollar_share|meritDollarShare/, f);
  }
  // Filters only: booleans that exclude colleges with no report.
  assert.equal(parseFilters({ aidForms: "no-css" }).aidForms, "no-css");
  assert.equal(parseFilters({ intlAid: "1" }).intlAid, true);
  const plain = before("186131");
  assert.equal(noCssProfile(plain), false);
  assert.equal(offersInternationalAid(plain), false);
  assert.equal(offersInternationalAid(school(CU)), true);
  assert.equal(offersInternationalAid(school(WM)), false);
  assert.equal(meritDollarShare(school(WM).reported?.aid?.institutional_grants)?.toFixed(3), "0.126");
});

/* 12 --------------------------------------------------------------- */
test("12. Division III: athletic scholarships at an NCAA III college go to review (P and Q only)", () => {
  const s = before(WM);
  assert.ok(build(WM, record(WM), s).aid.first_years?.p, "W&M (Division I) publishes its athletic scholarships");
  s.campus = { ...s.campus, athletics: { ...s.campus!.athletics!, division: "III" } };
  const b = build(WM, record(WM), s);
  assert.equal(b.aid.first_years?.p, null);
  assert.equal(b.aid.first_years?.q, null);
  assert.equal(b.aid.first_years?.i, 0.82, "the rest of the column still publishes");
  assert.ok(b.reviews.some((r) => r.check === "h2a-athletic"));
});

test("dates: real dates pass; contradicting boxes and out-of-order dates are dropped", () => {
  assert.deepEqual(checkDates(build(IL).aid.dates!), []);
  const d = { priority: { month: 3, day: 1 }, deadline: { month: 2, day: 1 }, no_deadline: null, notify_by: null, notify_rolling_from: null, reply_by: null, reply_within_weeks: 20 };
  assert.deepEqual(checkDates(d).map((p) => p.field), ["deadline", "reply_within_weeks"]);
  // The fall-to-spring cycle: a December priority date before a March deadline is in order.
  assert.deepEqual(checkDates({ ...d, priority: { month: 12, day: 15 }, deadline: { month: 3, day: 1 }, reply_within_weeks: null }), []);
});

test("the committed records' aid years: Cornell 2025–26 estimated, William & Mary and Illinois 2024–25 final", () => {
  assert.equal(school(CU).lineage?.["reported.aid.first_years"]?.year, "2025–26 (estimated)");
  assert.equal(school(WM).lineage?.["reported.aid.first_years"]?.year, "2024–25");
  assert.equal(school(IL).lineage?.["reported.aid.first_years"]?.year, "2024–25");
  assert.equal(school(VU).lineage?.["reported.aid.forms"]?.year, "Fall 2026 entrants");
  // Only the four colleges with records have the block.
  assert.deepEqual(schools.filter((s) => s.reported?.aid).map((s) => s.unit_id).sort(), [IL, CU, VU, WM].sort());
  assert.equal(readdirSync(join(ROOT, "data", "cds-records")).length >= 4, true);
});
