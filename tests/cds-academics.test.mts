/**
 * CDS academics (specs/data-expansion/cds-academics.md): the record → block read (I-2, I-3, E1, E3), its checks, the
 * blank ≠ no rule, open curriculum, Explore's honors filter, Compare's cell, lineage, and the partial-coverage guard.
 * Real records: data/cds-records/{221999,190415,231624,145637}.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { CdsCode, CollegeRecord, DocumentRecord } from "../lib/cds-sections.ts";
import { FIELDS } from "../lib/fields.ts";
import { validateSchool } from "../lib/lineage.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import { mergeReported } from "../lib/reported-merge.ts";
import {
  CORE_CODES,
  FEDERAL_RATIO_CHECK,
  PROGRAM_CODES,
  academicsFromRecord,
  binsMatchTotal,
  classSectionsFrom,
  coreFrom,
  mergeAcademics,
  programsFrom,
  ratioFrom,
} from "../lib/cds/academics.ts";
import {
  CORE_AREA_KEYS,
  PROGRAM_KEYS,
  assertOfferedOnly,
  classSizeShareOver50,
  classSizeShareUnder20,
  compareClassesUnder20,
  coreCurriculum,
  hasCdsProgram,
  hasHonorsProgram,
  offeredPrograms,
} from "../lib/cds/academics-display.ts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const records = readRecords(join(ROOT, "data", "cds-records"));
const record = (id: string): CollegeRecord => structuredClone(records.find((r) => r.unit_id === id)!);
const school = (id: string): School => structuredClone(schools.find((s) => s.unit_id === id)!);
const vuDoc = (): DocumentRecord => record("221999").documents[0];
const IDS = ["221999", "190415", "231624", "145637"];

/** Source code without comments, for the guards that scan for forbidden code. */
const code = (file: string) =>
  readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/* ------------------------------------------------------------------ */
/* 1. Sections sum within ±1                                           */
/* ------------------------------------------------------------------ */

test("sections-sum check: fails when the 7 bins miss the printed total by more than 1, passes within 1", () => {
  const bins = [418, 621, 346, 227, 39, 117, 41]; // Vanderbilt 2025–26, sums to 1,809
  assert.ok(binsMatchTotal(bins, 1809));
  assert.ok(binsMatchTotal(bins, 1810), "within 1 (rounding)");
  assert.ok(binsMatchTotal(bins, 1808));
  assert.ok(!binsMatchTotal(bins, 1811));
  assert.ok(!binsMatchTotal(bins, 1807));
  assert.ok(binsMatchTotal(bins, null), "no printed total: nothing to check");

  const doc = vuDoc();
  doc.items["I.308"] = { ...doc.items["I.308"], v: 1843 };
  const r = classSectionsFrom(doc);
  assert.ok(r && "failures" in r && r.failures[0].check === "academics-sections-sum");
  doc.items["I.308"] = { ...doc.items["I.308"], v: 1810 };
  const ok = classSectionsFrom(doc);
  assert.ok(ok && "block" in ok);
  // A failing block isn't merged.
  const rec = record("221999");
  rec.documents[0].items["I.308"] = { ...rec.documents[0].items["I.308"], v: 1900 };
  assert.equal(academicsFromRecord(rec).block?.class_sections, undefined);
});

test("subsections are checked the same way, and an unreadable printed total (Excel ##) is summed from the bins", () => {
  const doc = vuDoc();
  doc.items["I.316"] = { ...doc.items["I.316"], v: 300 };
  const r = classSectionsFrom(doc);
  assert.ok(r && "failures" in r && r.failures.some((f) => f.check === "academics-subsections-sum"));
  const loyola = vuDoc();
  loyola.items["I.308"] = { status: "failed", failures: [{ check: "type-range", detail: "##" }] } as DocumentRecord["items"][string];
  const ok = classSectionsFrom(loyola);
  assert.ok(ok && "block" in ok);
  assert.equal(ok.block.sections_total, 1809);
});

/* ------------------------------------------------------------------ */
/* 2. No federal check on I.201                                        */
/* ------------------------------------------------------------------ */

test("I.201 is never checked against the federal ratio: CDS 11 vs federal 7 (Harvard's numbers) publishes clean", () => {
  assert.equal(FEDERAL_RATIO_CHECK, null, "round-3's draft 'within 2 of federal' tolerance must not come back");
  const rec = record("231624"); // William & Mary prints 11 to 1 (8,297 ÷ 751)
  const s = school("231624");
  s.academics = { ...s.academics, student_faculty_ratio: 7 };
  const merged = mergeAcademics(s, rec);
  assert.equal(merged.reported?.academics?.student_faculty_ratio?.ratio, 11);
  assert.equal(merged.academics?.student_faculty_ratio, 7, "the federal figure is never touched");
  assert.deepEqual(validateSchool(merged, meta), []);
  const { outcomes } = academicsFromRecord(rec);
  assert.ok(outcomes.every((o) => o.status === "merged"), "no check fails on disagreement");
  // The module never reads the federal ratio at all.
  assert.doesNotMatch(code("lib/cds/academics.ts"), /(?<!reported\??)\.academics\??\.student_faculty_ratio|school\.academics\b/);
});

test("the ratio's internal check: printed ratio within 0.5 of students ÷ faculty", () => {
  const doc = vuDoc(); // 8 vs 7,329 ÷ 935 = 7.84
  const ok = ratioFrom(doc);
  assert.ok(ok && "block" in ok && ok.block.ratio === 8 && ok.block.term === "Fall 2025");
  doc.items["I.201"] = { ...doc.items["I.201"], v: 9 };
  const bad = ratioFrom(doc);
  assert.ok(bad && "failures" in bad && bad.failures[0].check === "academics-ratio-internal");
  // UW–Eau Claire leaves I-2 blank: not a failure, just absent.
  const blank = vuDoc();
  blank.items["I.201"] = { status: "blank" };
  assert.equal(ratioFrom(blank), null);
});

/* ------------------------------------------------------------------ */
/* 3. Blank ≠ no: only `true` or absent                                */
/* ------------------------------------------------------------------ */

test("a program or core key is only ever true or absent; false is rejected and never rendered as 'not offered'", () => {
  assert.throws(() => assertOfferedOnly({ honors: false }, PROGRAM_KEYS, "programs"), /only "true"/);
  assert.throws(() => assertOfferedOnly({ english: null }, CORE_AREA_KEYS, "core"), /only "true"/);
  assert.throws(() => assertOfferedOnly({ ballet: true }, PROGRAM_KEYS, "programs"), /unknown key/);
  assert.doesNotThrow(() => assertOfferedOnly({ honors: true }, PROGRAM_KEYS, "programs"));
  // Cornell leaves E.116 (teacher certification) blank: absent, not false.
  const p = programsFrom(record("190415").documents[0]);
  assert.ok(p);
  assert.equal("teacher_certification" in p.value, false);
  assert.equal(hasCdsProgram(p.value, "teacher_certification"), false);
  // A box read as "no" (false) is not stored either.
  const doc = vuDoc();
  doc.items["E.110"] = { ...doc.items["E.110"], v: false };
  assert.equal("honors" in (programsFrom(doc)?.value ?? {}), false);
  // Every stored value in the dataset is true.
  for (const s of schools) {
    const a = s.reported?.academics;
    if (!a) continue;
    assertOfferedOnly(a.programs, PROGRAM_KEYS, `${s.unit_id} programs`);
    assertOfferedOnly(a.core_curriculum, CORE_AREA_KEYS, `${s.unit_id} core`);
  }
  // The chips never say a program is missing.
  for (const f of ["components/school/ProgramChips.tsx", "components/school/ClassSizes.tsx", "lib/cds/academics-display.ts"]) {
    assert.doesNotMatch(code(f), /not offered|not listed|unavailable|no honors/i, f);
    assert.doesNotMatch(code(f), /"No [A-Z]|>No [A-Z]/, f);
  }
});

/* ------------------------------------------------------------------ */
/* 4. Open curriculum                                                  */
/* ------------------------------------------------------------------ */

const blankCore = (doc: DocumentRecord, status: "blank" | "not-read" | "missing") => {
  for (const c of Object.values(CORE_CODES)) {
    if (status === "missing") delete doc.items[c];
    else doc.items[c] = { status };
  }
  return doc;
};

test("open curriculum only when E3 was read with nothing checked, never when the section wasn't reached", () => {
  const open = coreFrom(blankCore(vuDoc(), "blank"));
  assert.ok(open);
  assert.deepEqual(open.value, {});
  assert.equal(coreCurriculum({ reported: { academics: { core_curriculum: open.value } } } as School)?.kind, "open");
  assert.equal(coreFrom(blankCore(vuDoc(), "not-read")), null, "not read");
  assert.equal(coreFrom(blankCore(vuDoc(), "missing")), null, "absent from the record");
  // Partly read (one area not reached) and nothing checked: not open.
  const partly = blankCore(vuDoc(), "blank");
  partly.items["E.312"] = { status: "not-found" };
  assert.equal(coreFrom(partly), null);
  // E3 blank and no E1 mark at all: the college skipped section E, not an open curriculum.
  const skipped = blankCore(vuDoc(), "blank");
  for (const c of [...Object.values(PROGRAM_CODES), "E.102", "E.115", "E.117"] as CdsCode[]) skipped.items[c] = { status: "blank" };
  assert.equal(coreFrom(skipped), null);
  // Not stored → no line at all.
  assert.equal(coreCurriculum({ reported: { academics: {} } } as School), null);
  assert.equal(coreCurriculum({} as School), null);
  // Vanderbilt's checked areas.
  const vu = coreCurriculum(school("221999"));
  assert.ok(vu?.kind === "areas" && vu.areas.includes("English composition") && vu.areas.includes("math"));
});

/* ------------------------------------------------------------------ */
/* 5. Explore: honors=1 only narrows toward colleges with the key       */
/* ------------------------------------------------------------------ */

test("Explore honors=1: positive only, matches exactly the colleges whose CDS marks an honors program", () => {
  assert.equal(parseFilters({ honors: "1" }).honors, true);
  assert.equal(parseFilters({ honors: "0" }).honors, undefined, "there is no exclude state");
  assert.equal(parseFilters({}).honors, undefined);
  assert.equal(countActiveFilters({ honors: "1" }), 1);
  const matched = schools.filter(hasHonorsProgram);
  assert.deepEqual(matched.map((s) => s.unit_id).sort(), [...IDS].sort());
  for (const s of matched) assert.equal(s.reported?.academics?.programs?.honors, true);
  // The only use in the query narrows with the positive predicate; nothing filters on its absence.
  const dataset = code("lib/dataset.ts");
  const uses = dataset.split("\n").filter((l) => /honors|hasHonorsProgram/i.test(l) && !/^import/.test(l));
  assert.deepEqual(uses.map((l) => l.trim()), ["if (filters.honors) results = results.filter(hasHonorsProgram);"]);
  assert.doesNotMatch(dataset, /!\s*hasHonorsProgram|honors\s*[!=]==?\s*false/);
});

/* ------------------------------------------------------------------ */
/* 6. classSizeShareUnder20                                            */
/* ------------------------------------------------------------------ */

test("classSizeShareUnder20 is pure and matches the worked examples", () => {
  // The spec's Vanderbilt worked example (2024–25): (489 + 605) ÷ 1,843 ≈ 59%.
  const ex = [489, 605, 400, 200, 50, 70, 29];
  assert.equal(ex.reduce((a, b) => a + b, 0), 1843);
  assert.equal(Math.round(classSizeShareUnder20(ex)! * 100), 59);
  assert.deepEqual(ex, [489, 605, 400, 200, 50, 70, 29], "input untouched");
  // From the real 2025–26 record: (418 + 621) ÷ 1,809.
  const r = classSectionsFrom(vuDoc());
  assert.ok(r && "block" in r);
  assert.equal(classSizeShareUnder20(r.block.sections), (418 + 621) / 1809);
  assert.equal(classSizeShareOver50(r.block.sections), (117 + 41) / 1809);
  assert.equal(classSizeShareUnder20([1, 2, 3]), null, "not seven bins");
  assert.equal(classSizeShareUnder20([0, 0, 0, 0, 0, 0, 0]), null);
  assert.equal(classSizeShareUnder20([1, -1, 0, 0, 0, 0, 0]), null);
});

/* ------------------------------------------------------------------ */
/* Data, lineage, merge, Compare                                       */
/* ------------------------------------------------------------------ */

test("data/schools.json carries the real values for the four colleges, and a merge of the committed records reproduces it", () => {
  const a = (id: string) => schools.find((s) => s.unit_id === id)!.reported?.academics;
  assert.deepEqual(a("221999")?.class_sections?.sections, [418, 621, 346, 227, 39, 117, 41]);
  assert.equal(a("221999")?.class_sections?.sections_total, 1809);
  assert.equal(a("221999")?.class_sections?.subsections_total, 254);
  assert.deepEqual(a("221999")?.student_faculty_ratio, { ratio: 8, students: 7329, faculty: 935, term: "Fall 2025" });
  assert.equal(a("190415")?.student_faculty_ratio?.ratio, 12.1);
  assert.equal(a("231624")?.class_sections?.sections_total, 1176);
  assert.equal(a("145637")?.class_sections?.sections_total, 4040);
  assert.deepEqual(offeredPrograms(school("221999")).map((p) => p.key).slice(0, 3), ["accelerated", "double_major", "esl"]);
  assert.ok(!schools.some((s) => s.reported?.academics && !IDS.includes(s.unit_id)), "only colleges with records");
  const reported = JSON.parse(readFileSync(join(ROOT, "data", "college-reported.json"), "utf8"));
  const again = mergeReported(IDS.map(school), reported, records).schools;
  for (const s of again) assert.equal(JSON.stringify(s), JSON.stringify(schools.find((x) => x.unit_id === s.unit_id)), s.name);
});

test("lineage: each block cites the college's document with a quote and the item's own year; dropping one fails", () => {
  const vu = school("221999");
  assert.deepEqual(validateSchool(vu, meta), []);
  const L = vu.lineage!;
  assert.equal(L["reported.academics.class_sections"]?.year, "Fall 2025");
  assert.equal(L["reported.academics.class_sections"]?.cell, "CDS-I!AC42");
  assert.match(L["reported.academics.student_faculty_ratio"]?.quote ?? "", /Fall 2025 Student to Faculty ratio \| 8/);
  assert.equal(L["reported.academics.programs"]?.year, "2025–26", "E1/E3 use the edition's year");
  assert.equal(L["reported.academics.core_curriculum"]?.year, "2025–26");
  for (const k of ["class_sections", "student_faculty_ratio", "programs", "core_curriculum"] as const) assert.equal(L[`reported.academics.${k}`]?.source, "college-site");
  delete vu.lineage!["reported.academics.class_sections"];
  assert.ok(validateSchool(vu, meta).some((e) => e.includes("reported.academics.class_sections is stored without a lineage record")));
});

test("mergeAcademics is idempotent, removes a block whose record is gone, and leaves the other reported blocks", () => {
  const vu = school("221999");
  assert.equal(JSON.stringify(mergeAcademics(vu, record("221999"))), JSON.stringify(vu));
  const gone = mergeAcademics(vu, undefined);
  assert.equal(gone.reported?.academics, undefined);
  assert.ok(!Object.keys(gone.lineage ?? {}).some((k) => k.startsWith("reported.academics.")));
  assert.ok(gone.reported?.admissions_by_residency, "the residency block stays");
});

test("Compare: 'Classes under 20 students' is the profile's share, '–' (null) without a record", () => {
  assert.equal(compareClassesUnder20(school("221999")), "57%");
  assert.equal(compareClassesUnder20({} as School), null);
  const compare = readFileSync(join(ROOT, "app", "compare", "page.tsx"), "utf8");
  assert.match(compare, /\["Classes under 20 students", "class-section", "derived\.class_share_under_20", compareClassesUnder20\]/);
});

/* ------------------------------------------------------------------ */
/* Partial-coverage guard                                              */
/* ------------------------------------------------------------------ */

const ACADEMICS_FIELD = /reported\??\.academics|class_sections|class_share_|academics-display|cds\/academics|hasHonorsProgram/;

test("partial coverage: no METRICS entry, distribution, rank, sort, radar, Key difference, Known-for, or Home fact uses CDS academics", () => {
  for (const f of ["lib/metrics.ts", "lib/insights.ts", "lib/indicators.ts", "lib/history.ts", "app/page.tsx"]) {
    assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), ACADEMICS_FIELD, f);
  }
  const dataset = readFileSync(join(ROOT, "lib", "dataset.ts"), "utf8");
  const sorters = dataset.slice(dataset.indexOf("const SORTERS"), dataset.indexOf("};", dataset.indexOf("const SORTERS")));
  assert.ok(sorters.length > 100 && !ACADEMICS_FIELD.test(sorters), "an Explore sort uses a CDS academics field");
  for (const k of ["derived.class_share_under_20", "derived.class_share_50_plus"] as const) assert.equal((FIELDS[k] as { computed?: true }).computed, true, k);
});
