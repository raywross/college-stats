/**
 * Lineage: resolution, validation, and the real dataset. `npm test`.
 * See specs/data-lineage.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { FIELDS, registeredPathFor } from "../lib/fields.ts";
import { lineageFor, lineageForPatch, sourcesForFields, validateLineage, validateRegistry, validateSchool } from "../lib/lineage.ts";

const ROOT = join(import.meta.dirname, "..");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const VANDERBILT = "221999"; // has a Common Data Set override

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
  const v = byId.get(VANDERBILT)!;
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
  const vYield = lineageFor("derived.yield", byId.get(VANDERBILT)!, meta);
  assert.deepEqual(vYield.inputs?.map((i) => i.key), ["cds"]);
});

test("a derived value from non-default inputs is flagged non-default (so it gets a chip)", () => {
  const v = byId.get(VANDERBILT)!;
  for (const p of ["derived.yield", "derived.diversity_index", "derived.sat_composite", "derived.sat_mid"] as const) {
    assert.equal(lineageFor(p, v, meta).isDefault, false, p);
  }
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

test("registry: every derived input is registered and every non-CDS field has a release year", () => {
  for (const [path, def] of Object.entries(FIELDS)) {
    if ("derived" in def && def.derived) for (const i of def.derived.inputs) assert.ok(i in FIELDS, `${path} → ${i}`);
    if (def.source !== "cds") assert.ok(def.vintage, `${path} has no vintage`);
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
    demographics: { racial_diversity: { asian: 0.2, white: 0.8 } },
  });
  assert.deepEqual(Object.keys(out).sort(), ["admissions.admitted", "admissions.applicants", "demographics.racial_diversity"]);
  assert.deepEqual(out["admissions.applicants"], { source: "cds", year: "2024-25", url: "https://example.edu/cds.xlsx", retrieved: "2026-09-27" });
});

test("an override setting an unregistered field is rejected", () => {
  assert.throws(() => lineageForPatch("1", { cds: { edition: "2024-25", url: "u" }, admissions: { waitlist: 3 } }), /isn't registered/);
});
