/**
 * Religious life, phase 1 (specs/religious-life.md): IPEDS RELAFFIL → `school.religion` with NCES's dictionary label,
 * the faith families and Explore filter, the profile block's display rules, "Faith-centered" (C7 only), and the CDS
 * step `mergeReligion` (H14, F2) with its lineage and idempotence. Real records: data/cds-records/{221999,199120,
 * 110680}.json. `npm test`.
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
import {
  FAITH_FAMILIES,
  FAITH_FILTERS,
  RELAFFIL_FAMILY,
  faithFilterOf,
  isFaithCentered,
  matchesFaith,
  religionFrom,
  religionView,
} from "../lib/religion.ts";
import { RELIGION_LINEAGE_PREFIX, mergeReligion, religionFromRecord } from "../lib/cds/religion.ts";
import { valueLabelsFrom } from "../scripts/lib/ipeds-dictionary.mts";
import type { Workbook } from "../scripts/lib/cds-xlsx.mts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const records = readRecords(join(ROOT, "data", "cds-records"));
const record = (id: string) => structuredClone(records.find((r) => r.unit_id === id)!);
const school = (id: string) => structuredClone(schools.find((s) => s.unit_id === id)!);

const LABELS = new Map([
  [30, "Roman Catholic"],
  [80, "Jewish"],
  [-2, "Not applicable"],
]);

/* ---- IPEDS: RELAFFIL and the dictionary ---- */

test("religionFrom: code + dictionary label; not applicable = no affiliation; no answer = nothing stored", () => {
  assert.deepEqual(religionFrom({ RELAFFIL: "30" }, LABELS), { affiliation: { code: 30, label: "Roman Catholic" } });
  assert.deepEqual(religionFrom({ RELAFFIL: "-2" }, LABELS), { affiliation: null });
  assert.equal(religionFrom({ RELAFFIL: "-1" }, LABELS), null, "IPEDS 'not reported' is unknown, not 'none'");
  assert.equal(religionFrom({ RELAFFIL: "" }, LABELS), null);
  assert.equal(religionFrom({}, LABELS), null);
  assert.equal(religionFrom(undefined, LABELS), null);
});

test("religionFrom guards: a code the dictionary doesn't label, or with no family, fails the sync", () => {
  // 54 (Baptist) has a family but no label in this dictionary: never typed by hand.
  assert.throws(() => religionFrom({ RELAFFIL: "54" }, LABELS), /no label in the IPEDS data dictionary/);
  // A labeled code with no family: a new NCES code must be grouped on purpose.
  assert.throws(() => religionFrom({ RELAFFIL: "999" }, new Map([[999, "New Church"]])), /no faith family/);
  assert.throws(() => religionFrom({ RELAFFIL: "x" }, LABELS), /not a code/);
});

/** A Frequencies sheet in the IC2025 dictionary's layout (row 1 header; one row per code). */
function dictionary(rows: [string, number | string, string][]): Workbook {
  const sheet = new Map<number, { col: string; value: string | number }[]>([[1, [{ col: "A", value: "VarName" }, { col: "D", value: "CodeValue" }, { col: "E", value: "valuelabel" }, { col: "F", value: "Frequency" }]]]);
  rows.forEach(([v, code, label], i) =>
    sheet.set(i + 2, [{ col: "A", value: v }, { col: "D", value: code }, { col: "E", value: label }, { col: "F", value: "1" }])
  );
  return new Map([["FREQUENCIES", sheet]]) as Workbook;
}

test("valueLabelsFrom reads one variable's labels from the Frequencies sheet, and fails loudly on a changed layout", () => {
  const book = dictionary([
    ["PEO1ISTR", 1, "Yes"],
    ["RELAFFIL", 30, "Roman Catholic"],
    ["RELAFFIL", "94", "The Church of Jesus Christ of Latter-day Saints"],
    ["RELAFFIL", -2, "Not applicable"],
  ]);
  assert.deepEqual([...valueLabelsFrom(book, "RELAFFIL")], [
    [30, "Roman Catholic"],
    [94, "The Church of Jesus Christ of Latter-day Saints"],
    [-2, "Not applicable"],
  ]);
  assert.throws(() => valueLabelsFrom(book, "CALSYS"), /not in the Frequencies sheet/);
  assert.throws(() => valueLabelsFrom(new Map() as Workbook, "RELAFFIL"), /no Frequencies sheet/);
  const noHeader = new Map([["FREQUENCIES", new Map([[1, [{ col: "A", value: "Name" }]]])]]) as Workbook;
  assert.throws(() => valueLabelsFrom(noHeader, "RELAFFIL"), /header/);
});

/* ---- Families and the Explore filter ---- */

test("every RELAFFIL code maps to a listed family, and every family has at least one code", () => {
  const keys = new Set(FAITH_FAMILIES.map((f) => f.key));
  for (const [code, fam] of Object.entries(RELAFFIL_FAMILY)) assert.ok(keys.has(fam), `${code} → ${fam}`);
  for (const f of FAITH_FAMILIES) assert.ok(Object.values(RELAFFIL_FAMILY).includes(f.key), f.key);
  assert.equal(FAITH_FILTERS.at(-1)?.key, "none");
});

test("the filter: families and 'none' match; a college IPEDS has no answer for never matches", () => {
  const nd = { religion: { affiliation: { code: 30, label: "Roman Catholic" } } };
  const pub = { religion: { affiliation: null } };
  assert.equal(faithFilterOf(nd), "catholic");
  assert.equal(faithFilterOf(pub), "none");
  assert.equal(faithFilterOf({}), null);
  assert.ok(matchesFaith(nd, ["catholic", "jewish"]));
  assert.ok(!matchesFaith(nd, ["none"]));
  assert.ok(matchesFaith(pub, ["none"]));
  assert.ok(!matchesFaith({}, ["none"]), "no answer isn't 'no affiliation'");
  const f = parseFilters({ faith: "catholic,bogus,none,catholic" });
  assert.deepEqual(f.faith, ["catholic", "none"]);
  assert.equal(parseFilters({ faith: "bogus" }).faith, undefined);
  assert.equal(countActiveFilters({ faith: "catholic" }), 1);
});

/* ---- Display rules ---- */

const withC7 = (s: Pick<School, "religion">, level: "very_important" | "important" | "considered" | "not_considered") =>
  ({ ...s, reported: { admission_profile: { factors: { religious: level } } } }) as Pick<School, "religion" | "reported">;

test("religionView: shown for an affiliated college or any CDS religion fact; hidden for a secular college with nothing", () => {
  const catholic = { religion: { affiliation: { code: 30, label: "Roman Catholic" } } };
  const secular = { religion: { affiliation: null } };
  assert.equal(religionView(secular), null, "'No religious affiliation' alone is noise");
  assert.equal(religionView(withC7(secular, "not_considered")), null);
  assert.equal(religionView(withC7(secular, "considered"))?.commitment, "considered");
  assert.equal(religionView(catholic)?.commitment, null);
  assert.equal(religionView(withC7(catholic, "not_considered"))?.commitment, "not_considered", "shown at an affiliated college");
  const ministries = religionView({ ...secular, reported: { religion: { campus_ministries: true } } });
  assert.equal(ministries?.ministries, true);
  assert.deepEqual(ministries?.religion, { affiliation: null }, "the block then says 'No religious affiliation'");
  assert.equal(religionView({ reported: { religion: { campus_ministries: true } } })?.religion, null, "no IPEDS answer: no affiliation line");
});

test("Faith-centered comes only from C7 = very important, never from affiliation", () => {
  const catholic = { religion: { affiliation: { code: 30, label: "Roman Catholic" } } };
  assert.ok(!isFaithCentered(catholic as Pick<School, "reported">));
  assert.ok(!isFaithCentered(withC7(catholic, "important")));
  assert.ok(isFaithCentered(withC7(catholic, "very_important")));
  assert.ok(isFaithCentered(withC7({ religion: { affiliation: null } }, "very_important")));
});

/* ---- CDS: H14 and F2 ---- */

/** A one-document record whose items are the given values (workbook cells with quotes); null = blank. */
function recordWith(values: Partial<Record<CdsCode, string | boolean | null>>, edition = "2025-26"): CollegeRecord {
  const items: Record<CdsCode, ItemResult> = {};
  for (const [code, v] of Object.entries(values))
    items[code] = v === null ? { status: "blank" } : { v, status: "passed", cell: `CDS-X!A${code.slice(2)}`, quote: `x | ${v}` };
  return {
    unit_id: "1",
    documents: [{ sha256: "sha", edition, type: "xlsx-template", url: "https://example.edu/cds.xlsx", retrieved: "2026-10-03", reads: {}, years: {}, items }],
  } as unknown as CollegeRecord;
}

test("religionFromRecord: marked boxes only; an unmarked box stores nothing (never 'no')", () => {
  assert.deepEqual(religionFromRecord(recordWith({ "H.1409": true, "F.201": true })).religion, { aid_by_affiliation: { non_need: true, need: false }, campus_ministries: true });
  assert.deepEqual(religionFromRecord(recordWith({ "H.1418": "x" })).religion, { aid_by_affiliation: { non_need: false, need: true } }, "H.1418 is a text cell");
  assert.equal(religionFromRecord(recordWith({ "H.1401": true, "H.1409": null, "F.201": null })).religion, null);
  assert.equal(religionFromRecord(recordWith({ "F.201": false })).religion, null);
  const { lineage } = religionFromRecord(recordWith({ "H.1409": true, "F.201": true }));
  assert.equal(lineage["reported.religion.aid_by_affiliation"]?.year, "Fall 2026 entrants", "H14 is the aid cycle");
  assert.equal(lineage["reported.religion.campus_ministries"]?.year, "2025–26", "F2 is the edition");
});

test("F2 comes from the newest document that read section F: a newer blank hides an older mark", () => {
  const old = recordWith({ "F.201": true }, "2024-25").documents[0];
  const newer = recordWith({ "F.201": null }, "2025-26").documents[0];
  const notRead = { ...recordWith({}, "2025-26").documents[0], items: { "F.201": { status: "not-read" } } };
  assert.equal(religionFromRecord({ unit_id: "1", documents: [old, newer] } as CollegeRecord).religion, null);
  assert.equal(religionFromRecord({ unit_id: "1", documents: [old, notRead] } as unknown as CollegeRecord).religion?.campus_ministries, true);
});

test("real records: Vanderbilt and UNC mark religious scholarships; every F2 mark is stored; lineage validates", () => {
  const vu = mergeReligion(school("221999"), record("221999"));
  assert.deepEqual(vu.reported?.religion, { aid_by_affiliation: { non_need: true, need: false }, campus_ministries: true });
  assert.equal(vu.lineage?.["reported.religion.aid_by_affiliation"]?.cell, "CDS-H!AC155");
  assert.deepEqual(validateSchool(vu, meta), []);
  assert.deepEqual(mergeReligion(school("199120"), record("199120")).reported?.religion?.aid_by_affiliation, { non_need: true, need: false });
  // UC San Diego: a flat PDF whose F2 line was read; no H14 religion mark.
  assert.deepEqual(mergeReligion(school("110680"), record("110680")).reported?.religion, { campus_ministries: true });
  // Dropping the lineage record fails the guard.
  const broken = structuredClone(vu);
  delete broken.lineage!["reported.religion.campus_ministries"];
  assert.ok(validateSchool(broken, meta).some((e) => e.includes("reported.religion.campus_ministries")));
});

test("mergeReligion is idempotent, and removes its block when the record goes", () => {
  const once = mergeReligion(school("221999"), record("221999"));
  assert.deepEqual(mergeReligion(once, record("221999")), once);
  const gone = mergeReligion(once, undefined);
  assert.equal(gone.reported?.religion, undefined);
  assert.ok(!Object.keys(gone.lineage ?? {}).some((k) => k.startsWith(RELIGION_LINEAGE_PREFIX)));
});

/* ---- The dataset ---- */

test("registry: phase-1 fields only, cited to IPEDS IC and the college", () => {
  assert.equal(FIELDS["religion.affiliation"].source, "ipeds-ic-char");
  assert.equal(FIELDS["reported.religion.aid_by_affiliation"].source, "college-site");
  assert.equal(FIELDS["reported.religion.campus_ministries"].source, "college-site");
});

test("data/schools.json: every stored affiliation has a family and one label per code; only private colleges are affiliated", () => {
  const labels = new Map<number, string>();
  for (const s of schools) {
    const a = s.religion?.affiliation;
    if (!a) continue;
    assert.ok(RELAFFIL_FAMILY[a.code], `${s.name}: ${a.code} has no family`);
    assert.equal(labels.get(a.code) ?? a.label, a.label, `${a.code} has two labels`);
    labels.set(a.code, a.label);
    assert.notEqual(s.type, "public", `${s.name} is public but affiliated`);
  }
  assert.ok(!schools.some((s) => s.reported?.religion && !records.some((r) => r.unit_id === s.unit_id)), "only colleges with records");
});
