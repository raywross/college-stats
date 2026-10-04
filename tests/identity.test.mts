/**
 * School identity's shared contract (lib/identity.ts, scripts/lib/identity-sync.mts): applying identity is
 * idempotent, overrides touch only links/social/brand, and merge-identity leaves a dataset it has nothing to add to
 * byte-identical. `npm test`. See specs/school-identity/README.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { addIdentityMeta, applyIdentity, applyIdentityOverride, emptyIdentityInputs } from "../lib/identity.ts";
import { validateLineage, validateRegistry } from "../lib/lineage.ts";
import { formatSchools, loadIdentityInputs, mergeIdentity } from "../scripts/lib/identity-sync.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const UGA = "139959";
const sample = [UGA, "221999", "166027", "110635", "139755"].map((id) => byId.get(id)!);

test("applying identity twice gives the same school as applying it once", () => {
  const inputs = loadIdentityInputs(ROOT);
  for (const s of sample) {
    const once = applyIdentity(structuredClone(s), inputs);
    const twice = applyIdentity(structuredClone(once), inputs);
    assert.deepEqual(twice, once, s.name);
  }
});

test("applying identity never leaves an empty lineage behind", () => {
  const inputs = loadIdentityInputs(ROOT);
  const bare = schools.filter((s) => !s.lineage).slice(0, 50);
  assert.ok(bare.length > 0);
  for (const s of bare) {
    const out = applyIdentity(structuredClone(s), inputs);
    assert.ok(out.lineage === undefined || Object.keys(out.lineage).length > 0, `${s.name}: empty lineage`);
  }
});

test("an override's links/social/brand part is applied with its lineage; the rest is left to sync-data", () => {
  const school = structuredClone(byId.get(UGA)!);
  const before = structuredClone(school);
  const patch = {
    _lineage: { source: "college-site", url: "https://www.admissions.uga.edu/visit/", year: "2026", retrieved: "2026-10-04" },
    links: { visit: "https://www.admissions.uga.edu/visit/" },
    admissions: { applicants: 1 },
  };
  applyIdentityOverride(school, patch);
  assert.equal(school.links?.visit, "https://www.admissions.uga.edu/visit/");
  assert.equal(school.links?.website, before.links?.website, "other links stay");
  assert.equal(school.lineage?.["links.visit"]?.source, "college-site");
  assert.equal(school.admissions.applicants, before.admissions.applicants, "non-identity paths are sync-data's");
  assert.equal(school.lineage?.["admissions.applicants"], before.lineage?.["admissions.applicants"]);
});

test("an identity override without a source is refused", () => {
  const school = structuredClone(byId.get(UGA)!);
  assert.throws(() => applyIdentityOverride(school, { links: { visit: "https://example.edu/visit" } }), /say where the values came from/);
});

test("identity sources are dated by the newest retrieval in their files and need no vintage", () => {
  const m = structuredClone(meta);
  const inputs = emptyIdentityInputs();
  inputs.wikidata.set(UGA, { unit_id: UGA, qid: "Q761534", wikipedia: null, website: null, accounts: {}, logo_file: null, alt_labels: [], retrieved: "2026-10-01" });
  inputs.wikidata.set("221999", { unit_id: "221999", qid: "Q29052", wikipedia: null, website: null, accounts: {}, logo_file: null, alt_labels: [], retrieved: "2026-10-03" });
  addIdentityMeta(m, inputs);
  assert.equal(m.sources.wikidata?.edition, "Retrieved 2026-10-03");
  assert.equal(m.sources.wikipedia?.edition, "Not retrieved yet");
  assert.deepEqual(validateRegistry(m), []);
  assert.deepEqual(validateLineage([], m), []);
});

test("merge-identity writes the same bytes when it has nothing new to apply, and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "identity-"));
  mkdirSync(join(dir, "data"));
  writeFileSync(join(dir, "data", "schools.json"), formatSchools(sample));
  writeFileSync(join(dir, "data", "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  mergeIdentity(dir);
  const first = readFileSync(join(dir, "data", "schools.json"), "utf8");
  assert.equal(first, formatSchools(sample.map((s) => applyIdentity(structuredClone(s), loadIdentityInputs(dir)))));
  mergeIdentity(dir);
  assert.equal(readFileSync(join(dir, "data", "schools.json"), "utf8"), first);
});
