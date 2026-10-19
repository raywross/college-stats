/**
 * The Health page's two views (specs/product/admin-health-views.md): the estimate inputs' grouping, each core input's
 * status on fixtures (presence and age against the current cycle), that supporting inputs never change the overall,
 * that a missing value names no source; the published files' rows and health; the dating check; and the URL filters.
 * No network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORE_INPUT_KEYS,
  ESTIMATE_INPUTS,
  collegeInputs,
  countInputs,
  fallOf,
  shortSource,
  ungroupedFactPaths,
  type CollegeInputs,
} from "../lib/admin/estimate-inputs.ts";
import { ESTIMATE_FACT_PATHS } from "../lib/chances/what-went-in.ts";
import { ESTIMATE_INPUT_RULES, CURRENT_CDS_EDITION_START } from "../lib/admin/health-rules.ts";
import { filesInEdition, lastModifiedDate, sourceFileRefs, sourceFileRows, undatedFiles, type SourceFilesRecord } from "../lib/admin/source-files.ts";
import { filterInputRows, inputsQuery, isFilesQuery, parseInputFilters } from "../lib/admin/inputs-view.ts";
import type { Cited } from "../lib/lineage.ts";
import type { CollegeGpa } from "../lib/planner/gpa-model.ts";
import type { School } from "../lib/types.ts";

const ROOT = join(import.meta.dirname, "..");
const CURRENT = ESTIMATE_INPUT_RULES.currentFall;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** A college with every core input at `fall`, from its CDS; `patch` changes the parts a case needs. */
function school(patch: { admissions?: Record<string, unknown>; reported?: Record<string, unknown> | null; selectivity?: Record<string, unknown> | null } = {}): School {
  return {
    unit_id: "999999",
    name: "Example College",
    type: "private",
    location: { city: "Town", state: "GA", region: "Southeast" },
    admissions: { acceptance_rate: 0.3, act_composite_25_75: [28, 33], test_policy: "considered", factors: { gpa: "required", hs_record: "required", class_rank: "considered" }, ...patch.admissions },
    reported:
      patch.reported === null
        ? undefined
        : {
            admission_profile: {
              gpa: { average: 3.8, scale: "unweighted", submitted_share: 0.9, bands: null },
              factors: { gpa: "very_important", rigor: "important", class_rank: "considered", test_scores: "considered" },
              ...(patch.reported ?? {}),
            },
          },
    selectivity: patch.selectivity === null ? undefined : { tier: "selective", year: `Fall ${CURRENT}`, ...(patch.selectivity ?? {}) },
    outcomes: {},
    demographics: { undergrad_enrollment: 5000 },
  } as unknown as School;
}

/** A citation reader that dates every field with `years[path]`, else `defaultYear`. */
function citer(defaultYear: string | null, years: Record<string, string | null> = {}) {
  return (path: string): Cited =>
    ({
      key: "cds",
      label: "Example College Common Data Set",
      publisher: "Example College",
      year: path in years ? years[path] : defaultYear,
      url: "https://example.edu/cds.pdf",
      retrieved: "2026-10-01",
      path,
      field: path,
      method: "reported",
      isDefault: false,
    }) as unknown as Cited;
}

const reported: CollegeGpa = { kind: "reported", range: [3.8, 3.8], point: 3.8, weighted: null, n: null };
const estimated: CollegeGpa = { kind: "estimated", range: [3.5, 3.9], point: 3.7, weighted: null, n: 300 };

const statusOf = (c: CollegeInputs, key: string) => c.inputs.find((i) => i.key === key)?.status;

/* ------------------------------------------------------------------ */
/* The inputs                                                          */
/* ------------------------------------------------------------------ */

test("every fact the estimate can cite is in exactly one input", () => {
  assert.deepEqual(ungroupedFactPaths(), []);
  const all = ESTIMATE_INPUTS.flatMap((i) => i.paths as readonly string[]);
  assert.equal(new Set(all).size, all.length, "a path is in two inputs");
  for (const p of all) assert.ok((ESTIMATE_FACT_PATHS as readonly string[]).includes(p), `${p} isn't an estimate fact`);
  assert.deepEqual([...CORE_INPUT_KEYS], ["admit_rate", "tests", "gpa", "academic_factors", "selectivity"]);
});

test("the current cycle is the CDS edition's fall", () => {
  assert.equal(CURRENT, CURRENT_CDS_EDITION_START);
});

test("fallOf reads the first year in a label", () => {
  assert.equal(fallOf("Fall 2025"), 2025);
  assert.equal(fallOf("2025–26"), 2025);
  assert.equal(fallOf("Entered fall 2018"), 2018);
  assert.equal(fallOf("Most recent release"), null);
  assert.equal(fallOf(null), null);
});

test("current-cycle core inputs are Fresh", () => {
  const c = collegeInputs(school(), citer(`Fall ${CURRENT}`), { gpa: reported });
  for (const k of CORE_INPUT_KEYS) assert.equal(statusOf(c, k), "fresh", k);
  assert.equal(c.overall, "fresh");
});

test("one cycle behind is Watch, two or more is Stale", () => {
  const one = collegeInputs(school(), citer(`Fall ${CURRENT}`, { "admissions.acceptance_rate": `Fall ${CURRENT - 1}` }), { gpa: reported });
  assert.equal(statusOf(one, "admit_rate"), "watch");
  assert.equal(one.overall, "watch");
  const two = collegeInputs(school(), citer(`Fall ${CURRENT}`, { "admissions.acceptance_rate": `Fall ${CURRENT - 2}` }), { gpa: reported });
  assert.equal(statusOf(two, "admit_rate"), "stale");
  assert.equal(two.overall, "stale");
  assert.match(two.inputs[0].reason, /2 cycles behind/);
});

test("a source that states no year is Watch", () => {
  const c = collegeInputs(school(), citer(`Fall ${CURRENT}`, { "admissions.acceptance_rate": null }), { gpa: reported });
  assert.equal(statusOf(c, "admit_rate"), "watch");
  assert.match(c.inputs[0].reason, /states no year/);
});

test("a missing admit rate is Watch, read as open admission, never Failing", () => {
  const c = collegeInputs(school({ admissions: { acceptance_rate: null } }), citer(`Fall ${CURRENT}`), { gpa: reported });
  assert.equal(statusOf(c, "admit_rate"), "watch");
  assert.match(c.inputs[0].reason, /open admission/);
  assert.notEqual(c.overall, "failing");
});

test("no test scores is Watch, unless the college doesn't consider them", () => {
  const none = { act_composite_25_75: null, sat_math_25_75: null };
  const optional = collegeInputs(school({ admissions: none }), citer(`Fall ${CURRENT}`), { gpa: reported });
  assert.equal(statusOf(optional, "tests"), "watch");
  const blind = collegeInputs(school({ admissions: { ...none, test_policy: "not-considered" } }), citer(`Fall ${CURRENT}`), { gpa: reported });
  assert.equal(statusOf(blind, "tests"), "fresh");
});

test("a GPA from the model only is Watch; a reported one is judged by its year", () => {
  const model = collegeInputs(school(), citer(`Fall ${CURRENT}`), { gpa: estimated });
  assert.equal(statusOf(model, "gpa"), "watch");
  assert.match(model.inputs.find((i) => i.key === "gpa")!.reason, /model's estimate/);
  const old = collegeInputs(school(), citer(`Fall ${CURRENT}`, { "reported.admission_profile.gpa.average": `Fall ${CURRENT - 3}` }), { gpa: reported });
  assert.equal(statusOf(old, "gpa"), "stale");
});

test("academic factors prefer the CDS ratings over the federal answers", () => {
  const c = collegeInputs(school(), citer(`Fall ${CURRENT}`, { "admissions.factors": `Fall ${CURRENT - 1}` }), { gpa: reported });
  assert.equal(statusOf(c, "academic_factors"), "fresh");
  const federalOnly = collegeInputs(school({ reported: { factors: {} } }), citer(`Fall ${CURRENT}`, { "admissions.factors": `Fall ${CURRENT - 1}` }), { gpa: reported });
  assert.equal(statusOf(federalOnly, "academic_factors"), "watch");
});

test("an unrated college's tier is Watch", () => {
  const c = collegeInputs(school({ selectivity: { tier: undefined } }), citer(`Fall ${CURRENT}`), { gpa: reported });
  assert.equal(statusOf(c, "selectivity"), "watch");
});

test("supporting inputs are never judged and never change the overall", () => {
  const c = collegeInputs(school(), citer(`Fall ${CURRENT - 5}`, Object.fromEntries(ESTIMATE_INPUTS.filter((i) => i.core).flatMap((i) => i.paths.map((p) => [p, `Fall ${CURRENT}`])))), {
    gpa: reported,
  });
  for (const i of c.inputs.filter((x) => !x.core)) assert.equal(i.status, null, i.key);
  assert.equal(c.overall, "fresh");
});

test("a missing value shows no source or dates", () => {
  const c = collegeInputs(school(), citer(`Fall ${CURRENT}`), { gpa: reported });
  const ed = c.inputs.find((i) => i.key === "early_decision")!;
  for (const f of ed.fields) {
    assert.equal(f.value, null);
    assert.equal(f.source, null);
    assert.equal(f.describes, null);
    assert.equal(f.collected, null);
  }
  assert.equal(ed.reason, "Not reported.");
});

test("sources drop the college's own name", () => {
  assert.equal(shortSource("Harvard University Common Data Set 2025–26", "Harvard University"), "Common Data Set 2025–26");
  assert.equal(shortSource("Harvard University (Fall 2025)", "Harvard University"), "The college's own figures (Fall 2025)");
  assert.equal(shortSource("IPEDS Admissions survey", "Harvard University"), "IPEDS Admissions survey");
});

test("counts tally overall and per core input", () => {
  const a = collegeInputs(school(), citer(`Fall ${CURRENT}`), { gpa: reported });
  const b = collegeInputs(school(), citer(`Fall ${CURRENT - 2}`), { gpa: estimated });
  const counts = countInputs([a, b]);
  assert.equal(counts.total, 2);
  assert.equal(counts.overall.fresh, 1);
  assert.equal(counts.overall.stale, 1);
  assert.equal(counts.inputs.gpa.watch, 1);
});

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

const meta = {
  retrieved: "2026-10-12",
  sources: {
    scorecard: { label: "College Scorecard", publisher: "ED", edition: "Most recent release", url: "https://collegescorecard.ed.gov/data/" },
    "scorecard-fos": { label: "Scorecard FOS", publisher: "ED", edition: "Most recent release", url: "https://x/Most-Recent-Cohorts-Field-of-Study_06102026.zip" },
    "ipeds-adm": { label: "IPEDS Admissions survey", publisher: "NCES", edition: "Fall 2024 (ADM2024)", url: "" },
    "ipeds-sfa": { label: "IPEDS SFA", publisher: "NCES", edition: "2023–24 (SFA2324 + COST2_2024)", url: "" },
    cds: { label: "Common Data Set", publisher: "", edition: "Varies by college", url: "" },
  },
  vintages: { "ipeds-adm": "Fall 2024", "ipeds-sfa": "2023–24" },
} as never;

const record = (published: string | null = "2025-12-11", status = 200): SourceFilesRecord => ({
  checked: "2026-10-19",
  files: Object.fromEntries(
    ["Most-Recent-Cohorts-Field-of-Study_06102026", "ADM2024", "SFA2324", "COST2_2024"].map((f) => [f, { source: "ipeds-adm", url: `https://x/${f}.zip`, published, status }]),
  ) as SourceFilesRecord["files"],
});

test("file names come from each edition, and Scorecard from its download", () => {
  assert.deepEqual(filesInEdition("2023–24 (SFA2324 + COST2_2024)"), ["SFA2324", "COST2_2024"]);
  assert.deepEqual(filesInEdition("Varies by college"), []);
  const refs = sourceFileRefs(meta);
  assert.deepEqual(
    refs.map((r) => `${r.source}:${r.file}`),
    ["scorecard:Most-Recent-Cohorts-Field-of-Study_06102026", "scorecard-fos:Most-Recent-Cohorts-Field-of-Study_06102026", "ipeds-adm:ADM2024", "ipeds-sfa:SFA2324", "ipeds-sfa:COST2_2024"],
  );
  assert.equal(refs.find((r) => r.file === "ADM2024")!.url, "https://nces.ed.gov/ipeds/complete-data-files/ADM2024.zip");
});

test("Last-Modified becomes a date", () => {
  assert.equal(lastModifiedDate("Thu, 11 Dec 2025 16:17:12 GMT"), "2025-12-11");
  assert.equal(lastModifiedDate("nonsense"), null);
  assert.equal(lastModifiedDate(null), null);
});

const release = (over: Record<string, unknown>) => ({ id: "r", source: "ipeds", label: "IPEDS winter release", brings: [], updates: ["ipeds-adm"], expected: "2026-12", status: "estimated", basis: "", ...over }) as never;

test("file health: fresh, overdue, newer release out, gone", () => {
  const row = (rec: SourceFilesRecord, releases: never[], today = "2026-10-19") => sourceFileRows(meta, rec, { releases }, today).find((r) => r.source === "ipeds-adm")!;
  assert.equal(row(record(), [release({})]).status, "fresh");
  assert.equal(row(record(), [release({})], "2027-02-01").status, "watch");
  const out = row(record(), [release({ status: "published", published: "2026-12-09" })]);
  assert.equal(out.status, "stale");
  assert.match(out.reason, /sync-data/);
  assert.equal(row(record("2025-12-11", 404), [release({})]).status, "failing");
  assert.equal(row(record(null), []).status, "watch");
  assert.equal(row(record(), []).published, "2025-12-11");
  assert.equal(row(record(), []).describes, "Fall 2024");
});

test("Scorecard rows match the calendar's scorecard-* vintages", () => {
  const rows = sourceFileRows(meta, record(), { releases: [release({ updates: ["scorecard-cost"], status: "published" })] }, "2026-10-19");
  assert.equal(rows.find((r) => r.source === "scorecard")!.status, "stale");
  assert.equal(rows.find((r) => r.source === "ipeds-adm")!.status, "fresh");
});

test("the dating check names files with no entry", () => {
  const rec = record();
  delete rec.files.COST2_2024;
  assert.deepEqual(
    undatedFiles(sourceFileRefs(meta), rec).map((r) => r.file),
    ["COST2_2024"],
  );
});

test("the committed source-files.json dates every file meta.json names", () => {
  const realMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
  const real = JSON.parse(readFileSync(join(ROOT, "data", "source-files.json"), "utf8")) as SourceFilesRecord;
  assert.deepEqual(undatedFiles(sourceFileRefs(realMeta), real), []);
});

/* ------------------------------------------------------------------ */
/* URL filters                                                         */
/* ------------------------------------------------------------------ */

test("input filters round-trip and drop bad values", () => {
  const f = parseInputFilters(new URLSearchParams("status=watch&input=gpa&state=ga&tier=2&family=1&sort=name&page=3"));
  assert.deepEqual(f, { status: "watch", input: "gpa", state: "GA", tier: 2, family: true, sort: "name", page: 3 });
  assert.equal(inputsQuery(f), "status=watch&input=gpa&state=GA&tier=2&family=1&sort=name&page=3");
  const bad = parseInputFilters({ status: "failing-ish", input: "test_policy", tier: "9", sort: "x", page: "-1" });
  assert.deepEqual(bad, { status: null, input: null, state: null, tier: null, family: false, sort: "worst", page: 1 });
});

test("input alone keeps colleges where that input isn't Fresh; with status, that status", () => {
  const row = (unitId: string, gpa: "fresh" | "watch") => ({
    inputs: { unitId, overall: gpa, inputs: [{ key: "gpa", status: gpa }] },
    name: unitId,
    state: "GA",
    tier: { level: 1 },
  });
  const rows = [row("1", "fresh"), row("2", "watch")];
  assert.deepEqual(filterInputRows(rows, parseInputFilters({ input: "gpa" }), null).map((r) => r.inputs.unitId), ["2"]);
  assert.deepEqual(filterInputRows(rows, parseInputFilters({ input: "gpa", status: "fresh" }), null).map((r) => r.inputs.unitId), ["1"]);
  assert.deepEqual(filterInputRows(rows, parseInputFilters({ status: "watch" }), null).map((r) => r.inputs.unitId), ["2"]);
});

test("old per-college bookmarks are sent to the Files view", () => {
  assert.equal(isFilesQuery({ group: "reported", status: "stale" }), true);
  assert.equal(isFilesQuery({ reason: "fetch_failed" }), true);
  assert.equal(isFilesQuery({ status: "stale", input: "gpa" }), false);
});
