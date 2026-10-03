/**
 * CDS admissions profile (specs/data-expansion/cds-admissions.md, Tests): record → `reported.admission_profile`
 * (lib/cds/admissions.ts), the six-factor newest rule, the checker, the Compare/Explore guards, and the lineage guard.
 * Every guard here was shown to fail when broken (noted per test). `npm test`.
 *
 * Extraction-side tests (2 column scale from raw text, 3 lone column from a totals row, 10 C7 marks placed by x,
 * Michigan's boxes, MIT's empty <td>s) belong to the readers and checks tracks; this file consumes records only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyNewestFactors,
  buildAdmissionProfile,
  classRankSentence,
  gpaMiddleHalf,
  gpaPosition,
  importanceOf,
  restoreFederalFactors,
  sameDocumentRate,
  withAdmissionProfile,
} from "../lib/cds/admissions.ts";
import { restoreFederal } from "../lib/newest.ts";
import { mergeReported } from "../lib/reported-merge.ts";
import type { ReportedFile } from "../lib/reported.ts";
import { FACTOR_FILTERS } from "../lib/factors.ts";
import { validateLineage } from "../lib/lineage.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { normalizeValue, type CollegeRecord, type DocumentRecord, type ItemResult } from "../lib/cds-sections.ts";
import type { DatasetMeta, GpaBands, School } from "../lib/types.ts";

const ROOT = join(import.meta.dirname, "..");
const read = <T,>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T;
const meta = read<DatasetMeta>("data/meta.json");
const schools = read<School[]>("data/schools.json");
const real = (id: string) => read<CollegeRecord>(`data/cds-records/${id}.json`);
const WM = "231624";
const CORNELL = "190415";

let cell = 0;
const passed = (v: number | string | boolean, quote = `q ${String(v)}`): ItemResult => ({ v, status: "passed", cell: `CDS-C!A${++cell}`, quote });
const blank: ItemResult = { status: "blank" };

/** A 2025–26 document holding only `items`, with W&M's years and URL. */
function doc(items: Record<string, ItemResult>, opts: { edition?: string; url?: string } = {}): DocumentRecord {
  const base = real(WM).documents[0];
  return { ...base, edition: opts.edition ?? base.edition, url: opts.url ?? base.url, items };
}
const college = (...docs: DocumentRecord[]): CollegeRecord => ({ unit_id: "999999", documents: docs });
const profileOf = (...docs: DocumentRecord[]) => buildAdmissionProfile(college(...docs), CDS_TEMPLATE)?.profile ?? null;

const column = (first: number, values: number[]) => Object.fromEntries(values.map((v, i) => [`C.${first + i}`, passed(v)]));

/* ---- Real records ---- */

test("real records: William & Mary's weighted 4.34, Vanderbilt's three GPA columns, Cornell's visible-form ED, Illinois's EA", () => {
  const wm = buildAdmissionProfile(real(WM), CDS_TEMPLATE)!.profile;
  assert.equal(wm.gpa?.average, 4.34);
  assert.equal(wm.gpa?.scale, "weighted");
  assert.equal(wm.gpa?.bands.with_test, null, "an all-zero column with a formula total of 0 is blank");
  assert.equal(wm.gpa?.bands.all?.[0], 0.8886);
  assert.deepEqual(wm.wait_list, { policy: true, offered: 4085, accepted: 1901, admitted: 103 });
  assert.deepEqual(wm.early_decision?.other, { closing: { month: 1, day: 5 }, notification: { month: 2, day: 1 } });
  assert.equal(wm.factors?.alumni_relation, "not_considered");

  const vu = buildAdmissionProfile(real("221999"), CDS_TEMPLATE)!.profile;
  assert.equal(vu.gpa?.scale, "not_stated");
  assert.ok(vu.gpa?.bands.with_test && vu.gpa.bands.without_test && vu.gpa.bands.all);
  assert.deepEqual(vu.wait_list, { policy: true, offered: null, accepted: null, admitted: 207 }, "Vanderbilt's 'X' policy reads as yes");

  const il = buildAdmissionProfile(real("145637"), CDS_TEMPLATE)!.profile;
  assert.equal(il.gpa, undefined, "Illinois publishes no C11/C12");
  assert.deepEqual(il.early_action, { offered: true, closing: { month: 11, day: 1 }, notification: { month: 1, day: 30 }, restrictive: false });
  assert.equal(il.early_decision?.offered, false);
});

/* ---- 1. C11 by code ---- */

test("1. C11 is keyed by code: C.1102 lands in the sent-scores column's 3.75–3.99 band", () => {
  // Break: key bands by the template's lowercase tag (band-by-column), and C.1102 lands in the not-submitted 4.0 band.
  const p = profileOf(doc({ ...column(1101, [0.2, 0.5, 0.3, 0, 0, 0, 0, 0, 0]), "C.1110": passed(1) }));
  assert.equal(p?.gpa?.bands.with_test?.[1], 0.5);
  assert.equal(p?.gpa?.bands.without_test, null);
});

/* ---- 2–4. Columns ---- */

test("2. a column that doesn't sum to 100 ± 1 fails alone; the others publish", () => {
  const p = profileOf(doc({ ...column(1101, [0.2, 0.5, 0.2, 0, 0, 0, 0, 0, 0]), ...column(1121, [0.2, 0.5, 0.3, 0, 0, 0, 0, 0, 0]) }));
  assert.equal(p?.gpa?.bands.with_test, null);
  assert.deepEqual(p?.gpa?.bands.all, [0.2, 0.5, 0.3, 0, 0, 0, 0, 0, 0]);
});

test("3. a lone 'all' column is stored as all", () => {
  const p = profileOf(doc({ ...column(1121, [0.7, 0.3, 0, 0, 0, 0, 0, 0, 0]) }));
  assert.ok(p?.gpa?.bands.all);
  assert.equal(p?.gpa?.bands.with_test, null);
  assert.equal(p?.gpa?.bands.without_test, null);
});

test("4. formula totals: a column with total 0 and blank bands is blank, not 0%", () => {
  const p = profileOf(doc({ "C.1110": passed(0), "C.1201": passed(3.6) }));
  assert.equal(p?.gpa?.bands.with_test, null);
  assert.equal(p?.gpa?.average, 3.6);
});

test("with all three columns, an 'all' band outside the other two fails the C11 block", () => {
  const p = profileOf(
    doc({
      ...column(1101, [0.3, 0.7, 0, 0, 0, 0, 0, 0, 0]),
      ...column(1111, [0.2, 0.8, 0, 0, 0, 0, 0, 0, 0]),
      ...column(1121, [0.5, 0.5, 0, 0, 0, 0, 0, 0, 0]),
      "C.1201": passed(3.9),
    })
  );
  assert.equal(p?.gpa?.bands.all, null);
  assert.equal(p?.gpa?.average, 3.9, "the average still publishes");
});

/* ---- 5. Weighted, and never ranked ---- */

test("5. 4.22 stores scale weighted; 0 or above 5 isn't a GPA", () => {
  assert.equal(profileOf(doc({ "C.1201": passed(4.22) }))?.gpa?.scale, "weighted");
  assert.equal(profileOf(doc({ "C.1201": passed(3.95) }))?.gpa?.scale, "not_stated");
  assert.equal(profileOf(doc({ "C.1201": passed(87) })), null);
});

/** Code without comments. */
const code = (p: string) =>
  readFileSync(join(ROOT, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("5. no Explore sort, percentile, Known for, Home fact, radar, or key difference reads the profile", () => {
  // Break: add `gpa: (s) => admissionProfile(s)?.gpa?.average ?? null` to SORTERS, and this fails.
  const PROFILE = /admission_profile|cds\/admissions|admissionProfile|hasGpaData|gpaPosition|compare-rows/;
  for (const f of ["lib/params.ts", "lib/dataset.ts", "lib/insights.ts", "lib/metrics.ts", "lib/indicators.ts", "app/page.tsx", "lib/profile-cards.ts"]) {
    const hits = code(f).split("\n").filter((l) => PROFILE.test(l));
    assert.deepEqual(hits, [], `${f} reads the CDS admissions profile`);
  }
  // Explore reaches it only through the one "has GPA data" filter (lib/factors.ts).
  assert.match(code("lib/factors.ts"), /param: "gpa".*test: hasGpaData/);
});

/* ---- 6. The checker ---- */

test("6. gpaPosition reads bands only; over 4.0 asks for an unweighted GPA", () => {
  const bands: GpaBands = [0.316, 0.566, 0.091, 0.014, 0.006, 0.006, 0.001, 0, 0];
  const pos = gpaPosition(bands, 3.8);
  assert.equal(pos?.kind, "band");
  assert.ok(pos?.kind === "band" && pos.label === "3.75–3.99" && Math.abs(pos.higher - 0.316) < 0.001);
  assert.deepEqual(gpaPosition(bands, 4.3), { kind: "over-scale" });
  assert.equal(gpaPosition(null, 3.5), null);
  // The checker never sees the average: it gets only the band columns.
  assert.doesNotMatch(code("components/school/GpaChecker.tsx"), /average/);
  assert.deepEqual(gpaMiddleHalf(bands), { low: 3.75, high: 4 });
});

/* ---- 7. Cornell's C21 ---- */

test("7. Cornell: the off-by-one code table yields to the visible form, which passes the C1 checks", () => {
  const ed = buildAdmissionProfile(real(CORNELL), CDS_TEMPLATE)!;
  assert.equal(ed.profile.early_decision?.applicants, 10057);
  assert.equal(ed.profile.early_decision?.admitted, 1889);
  assert.equal(ed.profile.early_decision?.first, undefined, "the shifted code-table dates are dropped");
  assert.equal(ed.lineage["reported.admission_profile.early_decision.admitted"]?.cell, "CDS-C!E327");
});

test("7. without the form, a code-table 'admitted' larger than C1's admits is never published", () => {
  // Break: drop the `ad <= C1 admitted` comparison, and 10,057 is published as early admits.
  const p = profileOf(doc({ "C.116": passed(72523), "C.117": passed(6077), "C.2101": passed(true), "C.2111": passed(10057) }));
  assert.equal(p?.early_decision?.offered, true);
  assert.equal(p?.early_decision?.admitted, null);
});

/* ---- 8. Duke ---- */

test("8. Duke: offered yes with blank counts publishes offered, null counts, and the 'doesn't publish' line", () => {
  const p = profileOf(doc({ "C.2101": passed(true), "C.2110": blank, "C.2111": blank }));
  assert.deepEqual(p?.early_decision, { offered: true, applicants: null, admitted: null });
  assert.match(readFileSync(join(ROOT, "components/school/EarlyRounds.tsx"), "utf8"), /doesn&apos;t publish how many apply or are admitted early/);
});

test("C21: offered No with counts fails the block", () => {
  assert.equal(profileOf(doc({ "C.2101": passed(false), "C.2110": passed(500), "C.2111": passed(100) }))?.early_decision, undefined);
});

/* ---- 9. Placeholders ---- */

test("9. placeholders: 'Yes or No' is blank; 'X' is yes; all-zero C2 counts beside Yes are blank", () => {
  const yesNo = CDS_TEMPLATE.byCode.get("C.2101")!;
  assert.equal(normalizeValue(yesNo, "Yes or No").status, "blank");
  assert.deepEqual(normalizeValue(CDS_TEMPLATE.byCode.get("C.201")!, "X"), { status: "value", v: true });
  const p = profileOf(doc({ "C.201": passed(true), "C.202": passed(0), "C.203": passed(0), "C.204": passed(0) }));
  assert.deepEqual(p?.wait_list, { policy: true, offered: null, accepted: null, admitted: null });
  // A published 0 next to nonzero counts stands (Spelman's 0 admitted).
  assert.equal(profileOf(doc({ "C.201": passed(true), "C.202": passed(568), "C.203": passed(2), "C.204": passed(0) }))?.wait_list?.admitted, 0);
});

test("C2: counts must nest (admitted ≤ accepted ≤ offered)", () => {
  assert.equal(profileOf(doc({ "C.201": passed(true), "C.202": passed(100), "C.203": passed(200), "C.204": passed(5) }))?.wait_list, undefined);
});

/* ---- 10–11. C7 ---- */

test("10. C7 levels from the template's words and a fillable PDF's radio values", () => {
  assert.equal(importanceOf("Very Important"), "very_important");
  assert.equal(importanceOf("VI"), "very_important");
  assert.equal(importanceOf("NC"), "not_considered");
  assert.equal(importanceOf("Not  Considered"), "not_considered");
  assert.equal(importanceOf("x"), null);
});

const grid = (levels: string[]) => Object.fromEntries(levels.map((l, i) => [`C.${701 + i}`, passed(l)]));

test("11. C7 sanity: every mark in one column, or fewer than 9 marked rows, is a misread", () => {
  // Break: drop the one-column rule, and an all-"Considered" grid (x ranges off) publishes.
  assert.equal(profileOf(doc(grid(Array(18).fill("Considered"))))?.factors, undefined);
  assert.equal(profileOf(doc(grid(["Very Important", "Considered", "Important"])))?.factors, undefined);
  const ok = profileOf(doc(grid([...Array(9).fill("Considered"), ...Array(9).fill("Very Important")])));
  assert.equal(ok?.factors?.rigor, "considered");
  assert.equal(ok?.factors?.interest, "very_important");
});

/* ---- 12. Six shared factors ---- */

test("12. a newer C7 'not considered' flips legacy; restore is byte for byte; federal required stays; an older C7 changes nothing", () => {
  const before = structuredClone(schools.find((s) => s.unit_id === WM)!);
  const clean = restoreFederal(before);
  assert.equal(clean.admissions.factors?.legacy, "considered", "IPEDS fall 2024 says legacy is considered");
  assert.equal(FACTOR_FILTERS.find((f) => f.param === "noLegacy")!.test(clean), false);

  const flipped = applyNewestFactors(clean, 2024);
  assert.equal(flipped.admissions.factors?.legacy, "not_considered");
  assert.deepEqual(flipped.admissions.federal_factors, { legacy: "considered" });
  assert.equal(flipped.lineage?.["admissions.factors.legacy"]?.quote, "Alumni/ae relation | Not Considered");
  assert.equal(FACTOR_FILTERS.find((f) => f.param === "noLegacy")!.test(flipped), true, "Explore follows the newest answer");
  // GPA: federal "required", C7 "very important": they agree, nothing changes.
  assert.equal(flipped.admissions.factors?.gpa, "required");
  assert.equal(JSON.stringify(restoreFederalFactors(flipped)), JSON.stringify(clean));
  // Break: skip the year comparison, and this older-or-same C7 overrides IPEDS.
  assert.equal(applyNewestFactors(clean, 2025), clean);
  // The committed data went through the same rule: the full merge (which also re-applies the other CDS blocks) reproduces it.
  const reportedFile = read<ReportedFile>("data/college-reported.json");
  assert.equal(JSON.stringify(mergeReported([before], reportedFile, { records: [real(WM)], meta, table: CDS_TEMPLATE }).schools[0]), JSON.stringify(before));
});

/* ---- 13. Same-class ED comparison ---- */

test("13. the overall rate beside the ED rate comes from the same document's C1, never another year's funnel", () => {
  const wm = schools.find((s) => s.unit_id === WM)!;
  const rate = sameDocumentRate(wm);
  assert.ok(rate !== null && Math.abs(rate - 6245 / 16895) < 1e-9);
  // Illinois's funnel is a class profile (another document): no overall rate beside a CDS ED figure.
  const otherDoc = structuredClone(wm);
  otherDoc.lineage!["admissions.applicants"] = { ...otherDoc.lineage!["admissions.applicants"]!, url: "https://example.edu/class-profile" };
  assert.equal(sameDocumentRate(otherDoc), null);
});

/* ---- 14. Lineage ---- */

test("14. every stored profile value has an extracted record with its edition's year; removing or retyping one fails", () => {
  const wm = schools.find((s) => s.unit_id === WM)!;
  assert.deepEqual(validateLineage([wm], meta).filter((e) => !e.startsWith("meta.json") && !e.startsWith("fields.ts")), []);
  const missing = structuredClone(wm);
  delete missing.lineage!["reported.admission_profile.gpa.average"];
  assert.ok(validateLineage([missing], meta).some((e) => e.includes("reported.admission_profile.gpa.average is stored without a lineage record")));
  const typed = structuredClone(wm);
  typed.lineage!["reported.admission_profile.early_decision.first.closing"]!.year = "Fall 2025";
  assert.ok(validateLineage([typed], meta).some((e) => e.includes("early_decision.first.closing year")));
  const noEdition = structuredClone(wm);
  delete noEdition.lineage!["reported.admission_profile.wait_list.admitted"]!.edition;
  assert.ok(validateLineage([noEdition], meta).some((e) => e.includes("wait_list.admitted has no CDS edition")));
});

test("withAdmissionProfile leaves a school without a record untouched", () => {
  const s = schools[0];
  assert.equal(withAdmissionProfile(s, undefined, CDS_TEMPLATE), s);
});

/* ---- 15. Class rank ---- */

test("15. class rank: bands without the submitted share fail; the sentence always carries the share", () => {
  assert.equal(profileOf(doc({ "C.1001": passed(0.9), "C.1002": passed(0.95) }))?.class_rank, undefined);
  const p = profileOf(doc({ "C.1001": passed(0.91), "C.1002": passed(0.95), "C.1006": passed(0.2) }));
  assert.match(classRankSentence(p?.class_rank)!, /91% were in the top tenth .* of the 20% whose high school reported a rank/);
  assert.equal(profileOf(doc({ "C.1001": passed(0.96), "C.1002": passed(0.9), "C.1006": passed(0.2) }))?.class_rank, undefined, "top tenth > top quarter");
});

/* ---- Which edition ---- */

test("each block comes from the newest edition where it passed, at most two editions back", () => {
  const newest = doc({ "C.201": passed(true), "C.204": passed(50) }, { edition: "2025-26" });
  const older = doc({ "C.1201": passed(3.7), "C.201": passed(true), "C.204": passed(40) }, { edition: "2024-25" });
  const p = profileOf(newest, older);
  assert.equal(p?.wait_list?.admitted, 50);
  assert.equal(p?.gpa?.average, 3.7, "GPA from the older edition where it passed");
  const stale = doc({ "C.1201": passed(3.6) }, { edition: "2022-23" });
  assert.equal(profileOf(newest, stale)?.gpa, undefined, "three editions back is too old");
});
