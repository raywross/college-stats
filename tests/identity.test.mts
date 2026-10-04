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
import { citesYear, lineageFor, validateLineage, validateRegistry } from "../lib/lineage.ts";
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

test("re-applying identity to the committed data changes no byte, so a refresh's diff shows only real changes", () => {
  const inputs = loadIdentityInputs(ROOT);
  const changed = schools.filter((s) => JSON.stringify(applyIdentity(structuredClone(s), inputs)) !== JSON.stringify(s)).map((s) => s.unit_id);
  assert.deepEqual(changed.slice(0, 10), [], `${changed.length} colleges reordered or changed; run \`npm run merge-identity\``);
});

test("new identity keys take fixed places, clear of the keys other pipelines re-append", () => {
  const school = structuredClone(byId.get(UGA)!);
  delete school.social;
  delete school.brand;
  school.lineage = {
    directories: { source: "directory" },
    "lgbtq.policies": { source: "policy-page" },
    "reported.admissions.applicants": { source: "college-site" },
  } as School["lineage"];
  (school as unknown as Record<string, unknown>).directories = { count: 1 };
  (school as unknown as Record<string, unknown>).reported = { admissions: null };
  const inputs = emptyIdentityInputs();
  inputs.wikidata.set(UGA, { unit_id: UGA, qid: "Q761534", wikipedia: null, website: null, accounts: { x: "universityofga" }, logo_file: null, alt_labels: [], retrieved: "2026-10-04" });
  inputs.probe.set(UGA, {
    unit_id: UGA, retrieved: "2026-10-04", homepage: null, admissions: null, social: {}, icons: [],
    visit: { url: "https://www.admissions.uga.edu/visit/", found_on: "https://www.admissions.uga.edu/", text: "Visit", score: 4 }, virtual_tour: null,
  });
  applyIdentity(school, inputs);
  const top = Object.keys(school);
  assert.ok(top.indexOf("social") < top.indexOf("directories"), "a new social block goes before the directories summary");
  assert.ok(top.indexOf("reported") === top.length - 1 || top.indexOf("reported") > top.indexOf("social"), "reported stays after it");
  assert.deepEqual(Object.keys(school.lineage!).slice(0, 3), ["directories", "lgbtq.policies", "links.visit"], "identity records after the pinned ones");
  assert.equal(Object.keys(school.lineage!).at(-1), "reported.admissions.applicants", "other pipelines' records stay last");
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

test("a link or account found on the college's site isn't credited to its admissions document", () => {
  // Duke has a newer admissions class from its own document (reported.admissions) and identity values from its site.
  const duke = structuredClone(byId.get("198419")!);
  assert.ok(duke.reported?.admissions, "fixture: Duke has college-reported admissions");
  duke.links = { ...(duke.links ?? { website: null, price_calculator: null }), visit: "https://admissions.duke.edu/visit/" };
  duke.lineage = {
    ...(duke.lineage ?? {}),
    "links.visit": { source: "college-site", method: "extracted", url: "https://admissions.duke.edu/", retrieved: "2026-10-04", year: "2026", quote: "Visit" },
  };
  const visit = lineageFor("links.visit", duke, meta);
  assert.equal(visit.sourceKind, undefined, "the visit link names no Common Data Set or class profile");
  const applicants = lineageFor("admissions.applicants", duke, meta);
  if (duke.lineage["admissions.applicants"]?.source === "college-site") assert.ok(applicants.sourceKind, "admissions values keep their document");
});

test("an undated reference names no year; every other source still does", () => {
  const school = structuredClone(byId.get(UGA)!);
  school.social = { instagram: "universityofga" };
  assert.equal(citesYear(lineageFor("social.instagram", school, meta)), false, "Wikidata: no 'most recent release'");
  assert.equal(citesYear(lineageFor("links.admissions", school, meta)), true, "IPEDS HD names its edition");
  assert.equal(citesYear(lineageFor("outcomes.median_earnings_10yr", school, meta)), true, "Scorecard keeps 'most recent release'");
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
