/**
 * Lineage: resolution, validation, and the real dataset. `npm test`.
 * See specs/data-lineage.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { FIELDS, PER_DOCUMENT_SOURCES, registeredPathFor } from "../lib/fields.ts";
import { applyNewest } from "../lib/newest.ts";
import { lineageFor, lineageForPatch, sourcesForFields, validateLineage, validateRegistry, validateSchool } from "../lib/lineage.ts";

const ROOT = join(import.meta.dirname, "..");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const VANDERBILT = "221999"; // a Common Data Set override, replaced by its newer college-reported class (fall 2025)
const NYU = "193900"; // a Common Data Set override and no newer college-reported class

/** A minimal valid school to mutate in validation tests. */
function fixture(): School {
  return structuredClone(schools.find((s) => !s.lineage && s.admissions.applicants)!);
}

/* ---- The real dataset ---- */

test("the committed dataset passes the lineage check", () => {
  assert.deepEqual(validateLineage(schools, meta), []);
});

test("citations survive a dataset published before the code's newest source (deploy racing the publish)", () => {
  // PR #36's production build prerendered /data against the previous publish, which had no ipeds-ic-char source,
  // and crashed on info.label. Drop each source in turn: every field still cites, with a placeholder, and the check
  // that guards what the sync writes still refuses such a dataset.
  const vu = byId.get(VANDERBILT)!;
  for (const key of Object.keys(meta.sources) as (keyof DatasetMeta["sources"])[]) {
    const older: DatasetMeta = { ...meta, sources: { ...meta.sources, [key]: undefined } };
    for (const path of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
      assert.doesNotThrow(() => lineageFor(path, vu, older), `${path} without ${key}`);
      assert.doesNotThrow(() => sourcesForFields([path], undefined, older), `${path} without ${key}`);
    }
    assert.ok(validateRegistry(older).includes(`meta.json: sources.${key} is missing`), `the check still requires ${key}`);
  }
});

test("the registry is internally consistent with meta.json", () => {
  assert.deepEqual(validateRegistry(meta), []);
});

/* ---- Resolution ---- */

test("a default value cites its field's default source and release year", () => {
  const s = fixture();
  const c = lineageFor("admissions.applicants", s, meta);
  assert.equal(c.key, "ipeds-adm");
  assert.equal(c.year, meta.vintages["ipeds-adm"]);
  assert.equal(c.isDefault, true);
  assert.equal(c.method, "reported");
});

test("CDS values cite the college's own file; untouched fields stay federal", () => {
  const v = byId.get(NYU)!;
  const applicants = lineageFor("admissions.applicants", v, meta);
  assert.equal(applicants.key, "cds");
  assert.equal(applicants.url, v.cds!.url);
  assert.equal(applicants.year, v.cds!.edition);
  assert.equal(applicants.isDefault, false);
  // Regression: topic-level provenance cited Pell and first-gen as CDS because enrollment was.
  assert.equal(lineageFor("demographics.pell_grant_percent", v, meta).key, "scorecard");
  assert.equal(lineageFor("demographics.first_gen_percent", v, meta).key, "scorecard");
});

test("derived values cite their inputs' sources", () => {
  const s = fixture();
  const yld = lineageFor("derived.yield", s, meta);
  assert.equal(yld.method, "derived");
  assert.ok(yld.formula);
  assert.deepEqual(yld.inputs?.map((i) => i.key), ["ipeds-adm"]);
  // Average cost combines prices (IC) and aid (SFA).
  const cost = new Set(sourcesForFields(["cost.avg_paid_all"], s, meta).map((x) => x.key));
  assert.ok(cost.has("ipeds-ic") && cost.has("ipeds-sfa"), [...cost].join(","));
  // A derived value over CDS inputs cites the CDS.
  const vYield = lineageFor("derived.yield", byId.get(NYU)!, meta);
  assert.deepEqual(vYield.inputs?.map((i) => i.key), ["cds"]);
});

test("a derived value from non-default inputs is flagged non-default (so it gets a chip)", () => {
  const v = byId.get(NYU)!;
  for (const p of ["derived.yield", "derived.sat_composite", "derived.sat_mid"] as const) {
    assert.equal(lineageFor(p, v, meta).isDefault, false, p);
  }
  // Race at a college whose newer CDS fall replaced it (specs/data-expansion/cds-student-body-and-outcomes.md).
  assert.equal(lineageFor("derived.diversity_index", byId.get(VANDERBILT)!, meta).isDefault, false);
  // Pell comes from Scorecard even at a CDS school, so it stays default.
  assert.equal(lineageFor("demographics.pell_grant_percent", v, meta).isDefault, true);
  assert.equal(lineageFor("derived.yield", fixture(), meta).isDefault, true);
});

test("section sources are de-duplicated and carry years", () => {
  const s = fixture();
  const src = sourcesForFields(["admissions.applicants", "admissions.admitted", "admissions.acceptance_rate"], s, meta);
  assert.equal(src.length, 1);
  assert.equal(src[0].year, meta.vintages["ipeds-adm"]);
});

test("every stored path in the dataset maps to a registered, stored (non-computed) field", () => {
  for (const s of schools.slice(0, 50)) assert.deepEqual(validateSchool(s, meta), []);
  assert.equal(registeredPathFor("demographics.racial_diversity.asian"), "demographics.racial_diversity");
  assert.equal(registeredPathFor("aid.by_income.counts"), "aid.by_income");
  assert.equal(registeredPathFor("nope.nothing"), null);
});

/* ---- Validation catches what it should ---- */

test("an unregistered stored field fails", () => {
  const s = fixture() as School & { admissions: { early_decision?: number } };
  s.admissions.early_decision = 123;
  assert.match(validateSchool(s, meta).join("\n"), /admissions\.early_decision" isn't registered/);
});

test("lineage for a field with no value fails", () => {
  const s = fixture();
  delete (s as Partial<School>).outcomes;
  s.lineage = { "outcomes.median_debt": { source: "scorecard" } };
  assert.match(validateSchool(s, meta).join("\n"), /no value/);
});

test("CDS lineage without a CDS record fails, and a CDS record nothing cites fails", () => {
  const s = fixture();
  s.lineage = { "admissions.applicants": { source: "cds" } };
  assert.match(validateSchool(s, meta).join("\n"), /no "cds" record/);
  const t = fixture();
  t.cds = { edition: "2025-26", url: "https://example.edu/cds.pdf" };
  assert.match(validateSchool(t, meta).join("\n"), /no field cites it/);
});

test("extracted values must carry a quote, URL, date, and year", () => {
  const s = fixture();
  s.lineage = { "admissions.applicants": { source: "scorecard", method: "extracted", url: "https://example.edu" } };
  assert.match(validateSchool(s, meta).join("\n"), /extracted but lacks/);
});

test("lineage for a computed (render-time) field fails", () => {
  const s = fixture();
  (s.lineage as Record<string, unknown>) = { "derived.yield": { source: "ipeds-adm" } };
  assert.match(validateSchool(s, meta).join("\n"), /computed field/);
});

test("a release without a year fails the registry check", () => {
  const broken: DatasetMeta = { ...meta, vintages: { ...meta.vintages, "ipeds-adm": null } };
  assert.match(validateRegistry(broken).join("\n"), /vintages\.ipeds-adm has no year/);
});

test("registry: every derived input is registered and every field not from a per-document source has a release year", () => {
  for (const [path, def] of Object.entries(FIELDS)) {
    if ("derived" in def && def.derived) for (const i of def.derived.inputs) assert.ok(i in FIELDS, `${path} → ${i}`);
    if (!PER_DOCUMENT_SOURCES.has(def.source)) assert.ok(def.vintage, `${path} has no vintage`);
  }
});

/* ---- Overrides ---- */

test("an override must say where its values came from", () => {
  assert.throws(() => lineageForPatch("1", { admissions: { applicants: 5 } }), /say where the values came from/);
  assert.throws(() => lineageForPatch("1", { provenance: {}, cds: { edition: "2024-25", url: "u" } }), /provenance/);
});

test("an override attributes exactly the fields it sets", () => {
  const out = lineageForPatch("1", {
    _imported: "2026-09-27",
    cds: { edition: "2024-25", url: "https://example.edu/cds.xlsx" },
    admissions: { applicants: 10, admitted: 5 },
    aid: { cds: { undergrads: 100 } },
  });
  assert.deepEqual(Object.keys(out).sort(), ["admissions.admitted", "admissions.applicants", "aid.cds"]);
  assert.deepEqual(out["admissions.applicants"], { source: "cds", year: "2024-25", url: "https://example.edu/cds.xlsx", retrieved: "2026-09-27" });
});

test("an override setting an unregistered field is rejected", () => {
  assert.throws(() => lineageForPatch("1", { cds: { edition: "2024-25", url: "u" }, admissions: { waitlist: 3 } }), /isn't registered/);
});

/* ---- Newest figures in the dataset (specs/college-reported-round-2.md, Decision 1; lib/newest.ts) ---- */

const RETRIEVED = "2026-10-03";
const extracted = (quote: string, year = "Fall 2026") => ({ source: "college-site" as const, method: "extracted" as const, year, url: "https://example.edu/profile", retrieved: RETRIEVED, quote });

/** The fixture (federal, fall 2024) with a newer college-reported class merged and applied, as merge-reported does. */
function replaced(r: Partial<NonNullable<NonNullable<School["reported"]>["admissions"]>> = {}): School {
  const s = fixture();
  const admissions = { entering_term: "Fall 2026", year: 2026, applicants: 50000, admitted: 2000, enrolled: null, acceptance_rate: 0.04, source_kind: "class-profile" as const, ...r };
  s.reported = { admissions };
  const lineage: NonNullable<School["lineage"]> = {};
  for (const k of ["entering_term", "year", "source_kind", "applicants", "admitted", "enrolled", "acceptance_rate"] as const) {
    if (admissions[k] != null) lineage[`reported.admissions.${k}`] = extracted(`${k} ${admissions[k]}`);
  }
  s.lineage = lineage;
  return applyNewest(s);
}

test("a replaced value cites the college's document and names the federal value it replaced, with its year", () => {
  const s = replaced();
  const fed = fixture().admissions;
  const c = lineageFor("admissions.applicants", s, meta);
  assert.equal(c.key, "college-site");
  assert.equal(c.year, "Fall 2026");
  assert.equal(c.quote, "applicants 50000");
  assert.deepEqual(c.replaces, { value: fed.applicants, year: `Fall ${fed.year}` });
  // Enrolled wasn't published, so it stays federal and replaces nothing; an untouched school has no `replaces` at all.
  assert.equal(lineageFor("admissions.enrolled", s, meta).replaces, undefined);
  assert.equal(lineageFor("admissions.enrolled", s, meta).key, "ipeds-adm");
  assert.equal(lineageFor("admissions.applicants", fixture(), meta).replaces, undefined);
  assert.deepEqual(validateSchool(s, meta), []);
});

test("a value that replaced a hand-imported CDS figure names the CDS edition it replaced", () => {
  const v = byId.get(VANDERBILT)!;
  const c = lineageFor("admissions.admitted", v, meta);
  assert.equal(c.key, "college-site");
  assert.deepEqual(c.replaces, { value: v.admissions.federal!.admitted, year: v.cds!.edition });
});

test("yield cites the class it was calculated from: the newest pair, or the previous class's when they differ", () => {
  // Same class: both from the college's document.
  const both = replaced({ enrolled: 1500 });
  assert.deepEqual(lineageFor("derived.yield", both, meta).inputs?.map((i) => [i.key, i.year]), [["college-site", "Fall 2026"]]);
  // Mixed: enrolled is federal (fall 2024), admitted the college's (fall 2026), so yield comes from admissions.federal.
  const mixed = replaced();
  assert.deepEqual(lineageFor("derived.yield", mixed, meta).inputs?.map((i) => [i.key, i.year]), [["ipeds-adm", meta.vintages["ipeds-adm"]]]);
});

test("validator: a reported class must be newer than what it replaced", () => {
  const s = replaced();
  s.admissions.federal!.year = 2026;
  assert.match(validateSchool(s, meta).join("\n"), /reported\.admissions\.year 2026 isn't newer than the federal year 2026/);
  // Not applied (nothing replaced): still must be newer than admissions.year.
  const t = fixture();
  t.reported = { admissions: { entering_term: "Fall 2020", year: 2020, applicants: 5, admitted: null, enrolled: null, acceptance_rate: null, source_kind: "cds" } };
  t.lineage = {
    "reported.admissions.entering_term": extracted("x", "Fall 2020"),
    "reported.admissions.year": extracted("x", "Fall 2020"),
    "reported.admissions.source_kind": extracted("x", "Fall 2020"),
    "reported.admissions.applicants": extracted("x", "Fall 2020"),
  };
  assert.match(validateSchool(t, meta).join("\n"), /isn't newer than the federal year/);
});

test("validator: replaced applicants or admitted move admissions.year to the reported class", () => {
  const s = replaced();
  s.admissions.year = 2024;
  assert.match(validateSchool(s, meta).join("\n"), /come from the college's 2026 class, but admissions\.year is 2024/);
});

test("validator: an admissions value cited to the college's site is extracted or derived, names its document, and keeps what it replaced", () => {
  const s = replaced();
  s.lineage!["admissions.applicants"] = { source: "college-site", method: "reported", url: "https://example.edu", year: "Fall 2026", retrieved: RETRIEVED, quote: "q" };
  assert.match(validateSchool(s, meta).join("\n"), /admissions\.applicants cites the college's site, so it must be extracted or derived/);
  const t = replaced();
  delete t.lineage!["admissions.applicants"]!.quote;
  assert.match(validateSchool(t, meta).join("\n"), /admissions\.applicants cites the college's site but lacks quote/);
  const u = replaced();
  delete u.admissions.federal;
  assert.match(validateSchool(u, meta).join("\n"), /admissions\.federal doesn't keep the value it replaced/);
});

test("validator: a value that differs from admissions.federal must be cited to the college's site", () => {
  const s = replaced();
  delete s.lineage!["admissions.admitted"];
  assert.match(validateSchool(s, meta).join("\n"), /admissions\.admitted differs from admissions\.federal\.admitted/);
});
