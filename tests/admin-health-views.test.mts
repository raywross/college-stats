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
  INPUT_CONTEXT_PATHS,
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
import { lineageFor, type Cited } from "../lib/lineage.ts";
import { miniSchools, miniMeta, miniLayerDocument } from "./helpers/snapshot.mts";
import { FIELDS } from "../lib/fields.ts";
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
  for (const p of all) assert.ok((ESTIMATE_FACT_PATHS as readonly string[]).includes(p) || INPUT_CONTEXT_PATHS.includes(p), `${p} isn't an estimate fact`);
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

test("a missing admit rate: Fresh when open admission, Failing when the college says it isn't, Watch when unknown", () => {
  const cite = citer(`Fall ${CURRENT}`, { "admissions.open_admission": "2024–25" });
  const open = collegeInputs(school({ admissions: { acceptance_rate: null, open_admission: true } }), cite, { gpa: reported });
  assert.equal(statusOf(open, "admit_rate"), "fresh");
  assert.match(open.inputs[0].reason, /^Open admission \(.*2024–25\)/);
  const notOpen = collegeInputs(school({ admissions: { acceptance_rate: null, open_admission: false } }), cite, { gpa: reported });
  assert.equal(statusOf(notOpen, "admit_rate"), "failing");
  assert.equal(notOpen.overall, "failing");
  const unknown = collegeInputs(school({ admissions: { acceptance_rate: null, open_admission: null } }), cite, { gpa: reported });
  assert.equal(statusOf(unknown, "admit_rate"), "watch");
  assert.match(unknown.inputs[0].reason, /doesn't say whether/);
  // The estimate reads nothing else at an open-admission college, so missing scores or GPA don't count against it.
  const bare = collegeInputs(school({ admissions: { acceptance_rate: null, open_admission: true, act_composite_25_75: null }, reported: null, selectivity: null }), cite, { gpa: null });
  for (const k of CORE_INPUT_KEYS) assert.equal(statusOf(bare, k), "fresh", k);
  assert.match(bare.inputs.find((i) => i.key === "tests")!.reason, /Not needed/);
  // Fewer than 10 applicants: no rate on purpose (a tiny pool), so Watch, not Failing, whatever the flag says.
  for (const flag of [false, null]) {
    const tiny = collegeInputs(school({ admissions: { acceptance_rate: null, open_admission: flag, applicants: 7 } }), cite, { gpa: reported });
    assert.equal(statusOf(tiny, "admit_rate"), "watch", `open_admission ${flag}`);
    assert.match(tiny.inputs[0].reason, /Too few applicants to give an admit rate \(7 reported; a rate needs 10\)/);
  }
  const none = collegeInputs(school({ admissions: { acceptance_rate: null, open_admission: false, applicants: 0 } }), cite, { gpa: reported });
  assert.equal(statusOf(none, "admit_rate"), "watch", "zero applicants is a tiny pool too");
  const unreported = collegeInputs(school({ admissions: { acceptance_rate: null, open_admission: false, applicants: null } }), cite, { gpa: reported });
  assert.equal(statusOf(unreported, "admit_rate"), "failing", "no applicant count either: a real gap");
  // A college with a rate is judged by its rate, whatever the flag says.
  const both = collegeInputs(school({ admissions: { open_admission: false } }), cite, { gpa: reported });
  assert.equal(statusOf(both, "admit_rate"), "fresh");
});

test("open admission: OPENADMP 1 and 2, anything else unknown; its release names the IC file and year", async () => {
  const { openAdmissionFrom, hasOpenAdmissionAnswers, applyOpenAdmission, icFileYear, openAdmissionMeta } = await import("../lib/open-admission.ts");
  assert.equal(openAdmissionFrom({ OPENADMP: "1" }), true);
  assert.equal(openAdmissionFrom({ OPENADMP: "2" }), false);
  assert.equal(openAdmissionFrom({ OPENADMP: "-2" }), null);
  assert.equal(openAdmissionFrom({ OPENADMP: "" }), null);
  assert.equal(openAdmissionFrom(undefined), null);
  assert.equal(hasOpenAdmissionAnswers([{ OPENADMP: "" }, { OPENADMP: "-2" }]), false);
  assert.equal(hasOpenAdmissionAnswers([{ OPENADMP: "" }, { OPENADMP: "1" }]), true);
  assert.equal(icFileYear("IC2024"), "2024–25");
  const a = school();
  const b = { ...school(), unit_id: "888888" } as unknown as School;
  const counts = applyOpenAdmission([a, b], new Map([["999999", { OPENADMP: "1" }]]));
  assert.deepEqual(counts, { open: 1, notOpen: 0, unknown: 1 });
  assert.equal(a.admissions.open_admission, true);
  assert.equal(b.admissions.open_admission, null);
  assert.equal(a.lineage, undefined, "no per-college lineage: the release in meta.json cites it");
  const m = openAdmissionMeta({ name: "IC2024", url: "https://x/IC2024.zip" });
  assert.equal(m.vintage, "2024–25");
  assert.equal(m.source.edition, "2024–25 (IC2024)");
});

test("the committed data cites open admission to its own release", () => {
  const meta = miniMeta();
  assert.match(meta.sources["ipeds-ic-open"].edition, /^\d{4}–\d{2} \(IC\d{4}\)$/);
  const schools = miniSchools();
  const open = schools.filter((s) => s.admissions.open_admission === true);
  assert.ok(open.length > 0);
  for (const s of open) assert.equal(s.admissions.acceptance_rate, null, `${s.name}: an open-admission college has no admit rate`);
  const c = lineageFor("admissions.open_admission", open[0], meta);
  assert.equal(c.key, "ipeds-ic-open");
  assert.equal(c.year, meta.vintages["ipeds-ic-open"]);
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
/* Quad's selectivity is cited by the admit rate it read               */
/* ------------------------------------------------------------------ */

test("a derived field's primary input is one of its inputs", () => {
  for (const [path, def] of Object.entries(FIELDS) as [string, { derived?: { inputs: readonly string[]; primary?: string } }][]) {
    const primary = def.derived?.primary;
    if (primary) assert.ok(def.derived!.inputs.includes(primary), `${path}: primary ${primary} isn't among its inputs`);
  }
});

test("every rated college's tier cites the year of the admit rate it read, not the field's default vintage", () => {
  const schools = miniSchools();
  const meta = miniMeta();
  let fromCollege = 0;
  for (const s of schools) {
    if (!s.selectivity?.tier) continue;
    const c = lineageFor("selectivity.tier", s, meta);
    assert.equal(c.year, s.selectivity.year, `${s.unit_id} ${s.name}`);
    const rate = lineageFor("admissions.acceptance_rate", s, meta);
    assert.equal(c.label, rate.label, `${s.unit_id}: the tier names the admit rate's source`);
    if (c.key !== "ipeds-adm") fromCollege++;
  }
  assert.ok(fromCollege > 0, "some tiers read a college's own newer rate");
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

test("the committed source-files.json dates every file meta.json names", async () => {
  const realMeta = miniMeta();
  const real = (await miniLayerDocument<SourceFilesRecord>("base.source_files", "source-files"))!;
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
