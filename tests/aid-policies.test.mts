/**
 * Published aid promises (lib/aid-policies.ts; data/aid-policies.json; specs/product/cost-by-income.md "Published
 * promises"): the validator accepts the real file and rejects each broken rule, the `aid_policy.*` citations resolve
 * to the entry's own page, and an uncurated college has no policy. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { DatasetMeta, School } from "../lib/types";
import { FIELDS, type FieldPath } from "../lib/fields.ts";
import { aidPolicyFor, aidYearLabel, allAidPolicies, validateAidPolicies, type AidPolicy, type AidPolicyFile } from "../lib/aid-policies.ts";
import { lineageFor, sourcesForFields, validateRegistry, validateSchool } from "../lib/lineage.ts";

const ROOT = join(import.meta.dirname, "..");
const FILE = JSON.parse(readFileSync(join(ROOT, "data", "aid-policies.json"), "utf8")) as AidPolicyFile;
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const known = new Set(schools.map((s) => s.unit_id));
const byId = new Map(schools.map((s) => [s.unit_id, s]));

const HARVARD = "166027";
const POLICY_PATHS = [
  "aid_policy.free_tuition_under",
  "aid_policy.no_contribution_under",
  "aid_policy.meets_full_need",
  "aid_policy.no_loans",
  "aid_policy.need_only",
  "aid_policy.home_equity",
  "aid_policy.siblings",
] as const satisfies readonly FieldPath[];

/** A valid entry to break one rule at a time. */
function entry(over: Partial<AidPolicy> = {}): AidPolicy {
  return {
    unit_id: HARVARD,
    as_of: "2025-26",
    free_tuition_under: 200000,
    no_contribution_under: 100000,
    meets_full_need: true,
    no_loans: null,
    need_only: true,
    home_equity: "ignored",
    siblings: null,
    siblings_note: null,
    source: "https://college.harvard.edu/financial-aid/how-aid-works",
    checked: "2026-10-10",
    verified_via: "search",
    ...over,
  };
}
const file = (...policies: AidPolicy[]): AidPolicyFile => ({ policies });
const problems = (...policies: AidPolicy[]) => validateAidPolicies(file(...policies), known);

/* ---- The real file ---- */

test("the real aid-policies file passes the check, with at least 40 colleges", () => {
  assert.deepEqual(validateAidPolicies(FILE, known), []);
  assert.ok(allAidPolicies().length >= 40, `${allAidPolicies().length} colleges curated`);
});

test("every curated college is in the dataset and cites a page checked through search", () => {
  for (const p of allAidPolicies()) {
    assert.ok(byId.has(p.unit_id), p.unit_id);
    assert.equal(p.verified_via, "search", `${p.unit_id}: curated from search results, not yet opened`);
    assert.equal(p.checked, "2026-10-10");
    assert.ok(new URL(p.source).hostname.length > 0);
  }
});

test("npm run check:aid-policies exits 0 on the real file", () => {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "check-aid-policies.mts")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok/);
});

test("a corrupted copy of the real file is refused (the guard `verify` runs bites)", () => {
  // scripts/check-aid-policies.mts exits 1 on exactly the problems this returns.
  const broken = structuredClone(FILE);
  broken.policies[0].source = "http://example.test/aid";
  assert.ok(validateAidPolicies(broken, known).length > 0);
});

/* ---- Each rule fails when broken ---- */

test("a valid entry passes", () => {
  assert.deepEqual(problems(entry()), []);
  assert.deepEqual(problems(entry({ home_equity: { cap_multiple: 2 }, siblings: "reduce", siblings_note: "Parent contribution × 60%", applies_to: "in_state" })), []);
  assert.deepEqual(problems(entry({ free_tuition_under: null, no_contribution_under: null, meets_full_need: null, need_only: null, home_equity: null })), [], "null is allowed everywhere the college is silent");
});

test("rejects an unknown unit_id (only when the dataset's ids are given)", () => {
  assert.match(problems(entry({ unit_id: "999999" })).join("\n"), /isn't a college in the dataset/);
  assert.deepEqual(validateAidPolicies(file(entry({ unit_id: "999999" }))), [], "no id list, no check");
});

test("rejects a non-numeric or missing unit_id", () => {
  assert.match(problems(entry({ unit_id: "harvard" })).join("\n"), /unit_id must be a numeric string/);
  assert.match(validateAidPolicies(file({ ...entry(), unit_id: undefined as unknown as string })).join("\n"), /unit_id must be a numeric string/);
});

test("rejects a duplicate unit_id", () => {
  assert.match(problems(entry(), entry()).join("\n"), /duplicate unit_id/);
});

test("rejects a source that isn't https", () => {
  assert.match(problems(entry({ source: "http://college.harvard.edu/aid" })).join("\n"), /source must be an https URL/);
  assert.match(problems(entry({ source: "college.harvard.edu/aid" })).join("\n"), /source must be an https URL/);
  assert.match(problems(entry({ source: "" })).join("\n"), /source must be an https URL/);
});

test("rejects a checked date that isn't a real ISO date", () => {
  assert.match(problems(entry({ checked: "10/10/2026" })).join("\n"), /checked must be a real ISO date/);
  assert.match(problems(entry({ checked: "2026-02-30" })).join("\n"), /checked must be a real ISO date/);
  assert.match(problems(entry({ checked: "" })).join("\n"), /checked must be a real ISO date/);
});

test("rejects an as_of that isn't an award year of consecutive years", () => {
  for (const bad of ["2025", "2025-2026", "25-26", "2025-27", "2026-25", "this year"]) {
    assert.match(problems(entry({ as_of: bad })).join("\n"), /as_of must be an award year/, bad);
  }
  assert.deepEqual(problems(entry({ as_of: "2099-00" })), [], "the century rolls over");
});

test("rejects thresholds that aren't positive whole dollars", () => {
  for (const bad of [0, -5, 1.5, NaN]) {
    assert.match(problems(entry({ free_tuition_under: bad })).join("\n"), /free_tuition_under must be a positive whole number/, String(bad));
    assert.match(problems(entry({ no_contribution_under: bad })).join("\n"), /no_contribution_under must be a positive whole number/, String(bad));
  }
  assert.match(problems(entry({ free_tuition_under: "200000" as unknown as number })).join("\n"), /free_tuition_under must be a positive whole number/);
});

test("rejects no_contribution_under above free_tuition_under, but only when both are set", () => {
  assert.match(problems(entry({ free_tuition_under: 100000, no_contribution_under: 150000 })).join("\n"), /no_contribution_under \(150000\) is above free_tuition_under \(100000\)/);
  assert.deepEqual(problems(entry({ free_tuition_under: 125000, no_contribution_under: 125000 })), [], "equal is fine");
  assert.deepEqual(problems(entry({ free_tuition_under: null, no_contribution_under: 150000 })), []);
  assert.deepEqual(problems(entry({ free_tuition_under: 100000, no_contribution_under: null })), []);
});

test("rejects a home-equity cap_multiple outside 0.5 to 10", () => {
  for (const bad of [0, 0.4, 10.5, 100, -1]) {
    assert.match(problems(entry({ home_equity: { cap_multiple: bad } })).join("\n"), /cap_multiple must be a number from 0.5 to 10/, String(bad));
  }
  for (const ok of [0.5, 1, 4, 10]) assert.deepEqual(problems(entry({ home_equity: { cap_multiple: ok } })), [], String(ok));
});

test("rejects an unknown home-equity rule", () => {
  assert.match(problems(entry({ home_equity: "partial" as unknown as "full" })).join("\n"), /home_equity "partial" isn't/);
  assert.match(problems(entry({ home_equity: {} as unknown as "full" })).join("\n"), /home_equity must be/);
});

test("rejects a verified_via that isn't page or search", () => {
  assert.match(problems(entry({ verified_via: "aggregator" as unknown as "page" })).join("\n"), /verified_via must be "page" or "search"/);
  assert.deepEqual(problems(entry({ verified_via: "page" })), []);
});

test("rejects a flag that isn't true, false, or null", () => {
  for (const k of ["meets_full_need", "no_loans", "need_only"] as const) {
    assert.match(problems(entry({ [k]: "yes" as unknown as boolean })).join("\n"), new RegExp(`${k} must be true, false, or null`), k);
  }
});

test("rejects an unknown sibling rule, an empty note, and a note with no rule", () => {
  assert.match(problems(entry({ siblings: "halve" as unknown as "split" })).join("\n"), /siblings must be/);
  assert.match(problems(entry({ siblings: "reduce", siblings_note: "  " })).join("\n"), /siblings_note must be a non-empty string/);
  assert.match(problems(entry({ siblings: null, siblings_note: "Parent contribution × 60%" })).join("\n"), /siblings_note without a siblings rule/);
});

test("rejects an unknown applies_to", () => {
  assert.match(problems(entry({ applies_to: "out_of_state" as unknown as "all" })).join("\n"), /applies_to must be "all" or "in_state"/);
});

test("rejects an entry missing a key (null says 'not stated', absence is a mistake)", () => {
  const missing: Partial<AidPolicy> = entry();
  delete missing.no_loans;
  assert.match(validateAidPolicies(file(missing as AidPolicy), known).join("\n"), /missing "no_loans"/);
});

test("rejects a file without a policies array", () => {
  assert.match(validateAidPolicies({} as AidPolicyFile).join("\n"), /"policies" must be an array/);
  assert.match(validateAidPolicies(file(null as unknown as AidPolicy)).join("\n"), /not an object/);
});

/* ---- Lookup ---- */

test("aidPolicyFor returns the curated entry, and null for an uncurated college", () => {
  assert.equal(aidPolicyFor(HARVARD)?.free_tuition_under, 200000);
  const uncurated = schools.find((s) => !aidPolicyFor(s.unit_id))!;
  assert.equal(aidPolicyFor(uncurated.unit_id), null);
  assert.equal(aidPolicyFor("not-a-unit-id"), null);
});

test("a public's in-state promise says so", () => {
  const michigan = aidPolicyFor("170976")!;
  assert.equal(michigan.applies_to, "in_state");
  assert.equal(michigan.free_tuition_under, 125000);
});

/* ---- Citation (lib/fields.ts aid_policy.*, lib/lineage.ts) ---- */

test("aid_policy.* fields are registered as college-published, in the aid topic", () => {
  assert.deepEqual(validateRegistry(meta), []);
  for (const path of POLICY_PATHS) {
    assert.equal(FIELDS[path].source, "college-site", path);
    assert.equal(FIELDS[path].topic, "aid", path);
  }
});

test("citing an aid_policy field resolves to the entry's page, award year, and check date", () => {
  const harvard = byId.get(HARVARD)!;
  const policy = aidPolicyFor(HARVARD)!;
  for (const path of POLICY_PATHS) {
    const cited = lineageFor(path, harvard, meta);
    assert.equal(cited.key, "college-site", path);
    assert.equal(cited.url, policy.source, path);
    assert.equal(cited.year, aidYearLabel(policy.as_of), path);
    assert.equal(cited.retrieved, policy.checked, path);
    assert.equal(cited.publisher, harvard.name, path);
    assert.match(cited.label, /Harvard/, path);
    assert.equal(cited.field, FIELDS[path].label, path);
  }
  assert.equal(aidYearLabel("2025-26"), "2025–26", "shown with the en dash the site uses");
});

test("each curated college's citation follows its own entry", () => {
  for (const policy of allAidPolicies()) {
    const school = byId.get(policy.unit_id)!;
    const cited = lineageFor("aid_policy.meets_full_need", school, meta);
    assert.equal(cited.url, policy.source, policy.unit_id);
    assert.equal(cited.retrieved, policy.checked, policy.unit_id);
  }
});

test("section footnotes list the entry's page as the source of its policy fields", () => {
  const harvard = byId.get(HARVARD)!;
  const sources = sourcesForFields([...POLICY_PATHS], harvard, meta);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, aidPolicyFor(HARVARD)!.source);
});

test("a college with no entry has nothing to cite for its policy fields", () => {
  const uncurated = schools.find((s) => !aidPolicyFor(s.unit_id))!;
  assert.deepEqual(sourcesForFields([...POLICY_PATHS], uncurated, meta), []);
  // …and the field-level citation falls back to the college-site source's generic entry rather than another college's page.
  const cited = lineageFor("aid_policy.meets_full_need", uncurated, meta);
  assert.notEqual(cited.url, aidPolicyFor(HARVARD)!.source);
});

test("a policy field cited without a school uses the registry default", () => {
  const cited = lineageFor("aid_policy.no_loans", undefined, meta);
  assert.equal(cited.key, "college-site");
  assert.notEqual(cited.url, aidPolicyFor(HARVARD)!.source);
});

test("a school record stays valid with policy entries (the values aren't stored on it)", () => {
  assert.deepEqual(validateSchool(byId.get(HARVARD)!, meta), []);
});
