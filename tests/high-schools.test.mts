/**
 * High school foundation (specs/product/high-school-data.md): ids, grades, suppression, ranges, canonical rows, state
 * report merging, medians, citations, the json store, and the validators, each proven to fail on a broken input.
 * Fixture: tests/fixtures/high-schools (also what HIGH_SCHOOLS_DIR points the app at for UI work). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HighSchool, HighSchoolDetail, HighSchoolStateFile } from "../lib/high-school-types.ts";
import {
  computeStateMedians,
  fipsToUsps,
  fromPublishedRow,
  gradeSpan,
  hsSearchKey,
  isHighSchoolId,
  kindOfHighSchoolId,
  mergeStateReport,
  normalizeGrade,
  normalizeHighSchool,
  offersGrade12,
  parseRateRange,
  searchRows,
  stateOfHighSchoolId,
  suppress,
  toPublishedRow,
  uspsToFips,
  validateHighSchoolDetail,
  validateHighSchoolMeta,
  validateHighSchoolRow,
  validateMedians,
  validateShard,
  validateStateFile,
  HS_STATES,
} from "../lib/high-school-core.ts";
import { HS_FIELDS, citeHsField, citeHsView, hsSourcesForFields, isHsSuppressed, registeredHsPathFor, validateHsRegistry } from "../lib/hs-fields.ts";
import { citesYear, yearLabel, type AnyCited } from "../lib/lineage.ts";
import { createJsonHighSchoolStore, highSchoolsDir, readAllShards, readHsMeta, readStateFiles } from "../lib/high-school-store.ts";
import { highSchoolFileProblems, readHighSchoolData } from "../scripts/lib/publish-high-schools.mts";
import { GLOSSARY } from "../lib/glossary.ts";

const ROOT = join(import.meta.dirname, "..");
const FIXTURE = join(import.meta.dirname, "fixtures", "high-schools");
const rows = () => readAllShards(FIXTURE).flatMap((s) => s.shard.schools);
const row = (id: string) => structuredClone(rows().find((r) => r.id === id)!);
const stateFiles = () => readStateFiles(FIXTURE).map((f) => f.data);
const meta = () => readHsMeta(FIXTURE)!;
const detail = (): HighSchoolDetail => JSON.parse(readFileSync(join(FIXTURE, "detail", "060000100001.json"), "utf8"));
const RICH = "060000100001";
const SPARSE = "060000100002";
const PRIVATE = "A9900001";

/* ------------------------------------------------------------------ */
/* Ids, states, grades                                                 */
/* ------------------------------------------------------------------ */

test("ids: 12-digit ncessch with a state FIPS prefix, or an 8-character PSS ppin; nothing else", () => {
  assert.ok(isHighSchoolId("060000100001"));
  assert.ok(isHighSchoolId("110000100001"), "DC");
  assert.ok(isHighSchoolId("A9900001"));
  assert.ok(isHighSchoolId("BB000073"));
  assert.ok(isHighSchoolId("00000226"));
  for (const bad of ["", "06000010000", "0600001000011", "720000100001" /* PR */, "590000100001" /* BIE */, "030000100001" /* no FIPS 03 */, "a9900001", "A990000", "A99000011", "06-0000100001", 60000100001, null]) {
    assert.equal(isHighSchoolId(bad), false, `${bad} should be rejected`);
  }
  assert.equal(kindOfHighSchoolId("060000100001"), "public");
  assert.equal(kindOfHighSchoolId("A9900001"), "private");
  assert.equal(stateOfHighSchoolId("480000200001"), "TX");
  assert.equal(stateOfHighSchoolId("A9900001"), null);
  assert.equal(stateOfHighSchoolId("nope"), null);
});

test("states: 50 + DC, FIPS ↔ USPS both ways", () => {
  assert.equal(HS_STATES.length, 51);
  assert.equal(fipsToUsps("6"), "CA");
  assert.equal(uspsToFips("tx"), "48");
  assert.equal(fipsToUsps("72"), null);
});

test("grades: codes, grade 12 makes a high school, spans", () => {
  assert.equal(normalizeGrade("09"), "9");
  assert.equal(normalizeGrade("K"), "KG");
  assert.equal(normalizeGrade("N"), null);
  assert.ok(offersGrade12({ low: "9", high: "12" }));
  assert.ok(offersGrade12({ low: "PK", high: "13" }));
  assert.ok(!offersGrade12({ low: "6", high: "8" }));
  assert.ok(!offersGrade12({ low: "13", high: "13" }));
  assert.equal(gradeSpan({ low: "9", high: "12" }), "9–12");
  assert.equal(gradeSpan({ low: "12", high: "12" }), "12");
});

/* ------------------------------------------------------------------ */
/* Suppression and ranges                                              */
/* ------------------------------------------------------------------ */

test("suppress: counts 1–4 and privacy codes are suppressed; zero and missing codes aren't", () => {
  assert.deepEqual(suppress("3", { kind: "count" }), { value: null, suppressed: true });
  assert.deepEqual(suppress(4, { kind: "count" }), { value: null, suppressed: true });
  assert.deepEqual(suppress("5", { kind: "count" }), { value: 5, suppressed: false });
  assert.deepEqual(suppress("0", { kind: "count" }), { value: 0, suppressed: false });
  assert.deepEqual(suppress("1,204", { kind: "count" }), { value: 1204, suppressed: false });
  assert.deepEqual(suppress("-11", { kind: "count", suppressedCodes: ["-11"] }), { value: null, suppressed: true });
  assert.deepEqual(suppress("-9", { kind: "count", missingCodes: ["-9"] }), { value: null, suppressed: false });
  assert.deepEqual(suppress("-3", { kind: "count" }), { value: null, suppressed: false }, "unknown negative codes are missing, not data");
  assert.deepEqual(suppress("", { kind: "count" }), { value: null, suppressed: false });
  assert.deepEqual(suppress("*", { kind: "share", suppressedCodes: ["*"] }), { value: null, suppressed: true });
  assert.deepEqual(suppress("62.5", { kind: "share", percent: true }), { value: 0.625, suppressed: false });
  assert.deepEqual(suppress("3", { kind: "share", percent: true }), { value: 0.03, suppressed: false }, "small shares aren't small counts");
  assert.deepEqual(suppress("140", { kind: "share", percent: true }), { value: null, suppressed: false });
});

test("parseRateRange: exact values, closed and open ranges, suppression; never a midpoint", () => {
  assert.deepEqual(parseRateRange("87"), { value: 0.87, low: null, high: null, suppressed: false });
  assert.deepEqual(parseRateRange("90-94"), { value: null, low: 0.9, high: 0.94, suppressed: false });
  assert.deepEqual(parseRateRange("GE80"), { value: null, low: 0.8, high: 1, suppressed: false });
  assert.deepEqual(parseRateRange("GT50"), { value: null, low: 0.51, high: 1, suppressed: false });
  assert.deepEqual(parseRateRange("LE10"), { value: null, low: 0, high: 0.1, suppressed: false });
  assert.deepEqual(parseRateRange("LT50"), { value: null, low: 0, high: 0.49, suppressed: false });
  assert.deepEqual(parseRateRange("PS"), { value: null, low: null, high: null, suppressed: true });
  assert.deepEqual(parseRateRange("."), { value: null, low: null, high: null, suppressed: false });
  assert.deepEqual(parseRateRange("94-90"), { value: null, low: null, high: null, suppressed: false });
  assert.deepEqual(parseRateRange("120"), { value: null, low: null, high: null, suppressed: false });
});

/* ------------------------------------------------------------------ */
/* Canonical rows, search                                              */
/* ------------------------------------------------------------------ */

test("normalizeHighSchool: canonical key order, nulls filled, rounding, sorted suppressed and lineage; idempotent", () => {
  const r = row(RICH);
  const scrambled = Object.fromEntries(Object.entries(r).reverse()) as unknown as HighSchool;
  scrambled.suppressed = ["rigor.ib_enrolled", "enrollment.by_race.pacific_islander", "enrollment.by_race.american_indian", "rigor.ib_enrolled"];
  scrambled.frl_share = 0.123456;
  assert.equal(JSON.stringify(normalizeHighSchool({ ...scrambled, frl_share: r.frl_share })), JSON.stringify(r));
  const n = normalizeHighSchool(scrambled);
  assert.equal(n.frl_share, 0.1235);
  assert.deepEqual(n.suppressed, ["enrollment.by_race.american_indian", "enrollment.by_race.pacific_islander", "rigor.ib_enrolled"]);
  assert.equal(JSON.stringify(normalizeHighSchool(n)), JSON.stringify(n));
  const partial = normalizeHighSchool({ id: "060000100009", kind: "public", name: "X", state: "CA" } as HighSchool);
  assert.equal(partial.city, null);
  assert.deepEqual(partial.status, { charter: null, magnet: null, title_i: null, virtual: null });
});

test("search: key normalization and json-mode ranking (prefix, word prefixes, substring), state and kind filters", () => {
  assert.equal(hsSearchKey("Saint Mary's Académie & Prep", "Los Ángeles"), "saint mary s academie and prep los angeles");
  const all = rows();
  assert.equal(searchRows(all, { q: "fixture hills" })[0].id, RICH);
  assert.deepEqual(searchRows(all, { q: "fix hil" }).map((h) => h.id), [RICH], "word prefixes");
  assert.ok(searchRows(all, { q: "fixture", state: "tx" }).every((h) => h.state === "TX"));
  assert.deepEqual(searchRows(all, { q: "fixture", kind: "private" }).map((h) => h.id), [PRIVATE]);
  assert.equal(searchRows(all, { q: "" }).length, 0, "no query and no state: nothing");
  assert.equal(searchRows(all, { q: "", state: "TX" }).length, 6, "a state alone lists it");
  assert.equal(searchRows(all, { q: "fixture", limit: 2 }).length, 2);
  const hit = searchRows(all, { q: "fixture hills" })[0];
  assert.deepEqual(hit, { id: RICH, name: "Fixture Hills High School", city: "Los Angeles", state: "CA", kind: "public", district: "Fixture Unified School District", grades: "9–12" });
});

/* ------------------------------------------------------------------ */
/* State reports and medians                                           */
/* ------------------------------------------------------------------ */

test("mergeStateReport: the school's values, suppressed cells, and only the sections it uses", () => {
  const report = mergeStateReport(row(RICH), stateFiles())!;
  assert.deepEqual(report.values, { college_going_rate: 0.71, ela_proficiency: 0.58, math_proficiency: null, chronic_absence: 0.19 });
  assert.deepEqual(report.suppressed, ["math_proficiency"]);
  assert.deepEqual(report.sections.map((s) => s.key), ["college-going", "dashboard"]);
  assert.equal(mergeStateReport(row(SPARSE), stateFiles()), null, "not in the state file");
  assert.equal(mergeStateReport(row(PRIVATE), stateFiles()), null, "private schools have no state report");
  const tx = mergeStateReport(row("480000200002"), stateFiles())!;
  assert.deepEqual(tx.suppressed, ["ap_pass_rate"]);
  // Published rows carry it, and split back exactly.
  const published = toPublishedRow(row(RICH), stateFiles());
  assert.deepEqual(published.state_report, report);
  assert.equal(JSON.stringify(fromPublishedRow(published).school), JSON.stringify(row(RICH)));
});

test("medians: public schools only, ≥ 5 values, narrow grad ranges by midpoint, open ranges left out; fixture is fresh", () => {
  const all = rows();
  const medians = computeStateMedians(all, stateFiles());
  assert.deepEqual(JSON.parse(readFileSync(join(FIXTURE, "medians.json"), "utf8")), medians, "fixture medians.json is stale");
  // CA grad: 0.92 (90–94 midpoint), 0.88, 0.90, 0.92, 0.87 (85–89 midpoint) → 0.90.
  assert.equal(medians.CA["grad_rate"], 0.9);
  // TX grad: five exact + one open range (GE90, left out).
  assert.equal(medians.TX["grad_rate"], 0.92);
  // CA math proficiency: four values (one suppressed) → no median.
  assert.equal(medians.CA["state.math_proficiency"], undefined);
  // A private school with an outlier never moves the median.
  const withPrivate = computeStateMedians([...all, { ...row(PRIVATE), id: "A9900002", enrollment: { ...row(PRIVATE).enrollment, total: 99999 } }], stateFiles());
  assert.deepEqual(withPrivate, medians);
  assert.deepEqual(validateMedians(medians, all, stateFiles()), []);
  // Guard: a stale medians file is caught.
  const stale = structuredClone(medians);
  stale.CA["enrollment.total"] = 1;
  assert.match(validateMedians(stale, all, stateFiles())[0], /stale for CA/);
});

/* ------------------------------------------------------------------ */
/* Citations                                                           */
/* ------------------------------------------------------------------ */

test("citeHsField: defaults from meta, PSS for private rows, state sections, profile quotes, derived inputs", () => {
  const m = meta();
  const rich = row(RICH);
  const enr = citeHsField("enrollment.total", rich, m);
  assert.equal(enr.key, "nces-ccd");
  assert.equal(enr.year, m.vintages["ccd-enrollment"]);
  assert.equal(enr.isDefault, true);
  assert.equal(enr.method, "reported");

  const priv = citeHsField("enrollment.total", row(PRIVATE), m);
  assert.equal(priv.key, "nces-pss");
  assert.equal(priv.year, m.vintages.pss);

  const view = createJsonHighSchoolStore(FIXTURE).getHighSchool(RICH)!;
  const cgr = citeHsView("state.college_going_rate", view);
  assert.equal(cgr.key, "state-ca");
  assert.equal(cgr.year, "Class of 2022");
  assert.equal(cgr.publisher, "California Department of Education");

  const gpa = citeHsView("detail.gpa_scale", view);
  assert.equal(gpa.key, "hs-profile");
  assert.equal(gpa.year, "2025–26");
  assert.equal(gpa.method, "extracted");
  assert.equal(gpa.page, 1);
  assert.ok(gpa.quote?.includes("5.0 scale"));

  const ap = citeHsField("derived.ap_enrolled_share", rich, m);
  assert.equal(ap.method, "derived");
  assert.equal(ap.key, "crdc");
  assert.deepEqual(ap.inputs?.map((s) => s.key), ["crdc"]);

  // A lineage record overrides the default source and year.
  const overridden = { ...rich, lineage: { "enrollment.total": { source: "state-ca" as const, year: "2025–26", url: "https://example.org/x", retrieved: "2026-10-01" } } };
  const o = citeHsField("enrollment.total", overridden, m);
  assert.equal(o.key, "state-ca");
  assert.equal(o.year, "2025–26");
  assert.equal(o.isDefault, false);

  // Renders in the same ⓘ as a college citation (AnyCited), and year helpers accept it.
  const asAny: AnyCited = enr;
  assert.equal(yearLabel(asAny), m.vintages["ccd-enrollment"]);
  assert.ok(citesYear(asAny));
});

test("hsSourcesForFields: only sources behind values the school has (or suppressed); sparse and private pages cite less", () => {
  const m = meta();
  const view = createJsonHighSchoolStore(FIXTURE).getHighSchool(RICH)!;
  const extras = { stateReport: view.state_report, detail: view.detail };
  const all = Object.keys(HS_FIELDS) as (keyof typeof HS_FIELDS)[];
  const keys = (r: HighSchool, e = {}) => [...new Set(hsSourcesForFields(all, r, m, e).map((s) => s.key))].sort();
  assert.deepEqual(keys(view.school, extras), ["crdc", "edfacts", "hs-profile", "nces-ccd", "state-ca"]);
  assert.deepEqual(keys(row(SPARSE)), ["nces-ccd"]);
  assert.deepEqual(keys(row(PRIVATE)), ["nces-pss"]);
  assert.ok(isHsSuppressed("rigor.ib_enrolled", view.school));
  assert.ok(isHsSuppressed("derived.ib_enrolled_share", view.school), "a share of a suppressed count is suppressed");
  assert.ok(isHsSuppressed("state.math_proficiency", view.school, extras));
});

test("registry: sound, and a stored leaf resolves to its registered ancestor", () => {
  assert.deepEqual(validateHsRegistry(), []);
  assert.equal(registeredHsPathFor("grad_rate.low"), "grad_rate");
  assert.equal(registeredHsPathFor("enrollment.by_race.asian"), "enrollment.by_race");
  assert.equal(registeredHsPathFor("nope.x"), null);
});

/* ------------------------------------------------------------------ */
/* Store (json mode) and HIGH_SCHOOLS_DIR                              */
/* ------------------------------------------------------------------ */

test("HIGH_SCHOOLS_DIR: default data/high-schools; absolute or relative override", () => {
  assert.equal(highSchoolsDir({}, "/repo"), join("/repo", "data", "high-schools"));
  assert.equal(highSchoolsDir({ HIGH_SCHOOLS_DIR: "tests/fixtures/high-schools" }, "/repo"), join("/repo", "tests", "fixtures", "high-schools"));
  assert.equal(highSchoolsDir({ HIGH_SCHOOLS_DIR: FIXTURE }, "/elsewhere"), FIXTURE);
});

test("json store over the fixture: views, private lookups, medians, search, unknown ids", () => {
  const store = createJsonHighSchoolStore(highSchoolsDir({ HIGH_SCHOOLS_DIR: "tests/fixtures/high-schools" }, ROOT));
  const v = store.getHighSchool(RICH)!;
  assert.equal(v.school.name, "Fixture Hills High School");
  assert.ok(v.state_report && v.detail && v.medians && v.meta);
  assert.equal(v.medians!["grad_rate"], 0.9);
  assert.deepEqual(v.school.grad_rate, { value: null, low: 0.9, high: 0.94, cohort: 498 }, "EDFacts range kept as a range");
  const sparse = store.getHighSchool(SPARSE)!;
  assert.equal(sparse.state_report, null);
  assert.equal(sparse.detail, null);
  const priv = store.getHighSchool(PRIVATE)!;
  assert.equal(priv.school.kind, "private");
  assert.equal(priv.school.affiliation, "Nonsectarian");
  assert.equal(store.getHighSchool("060000199999"), null);
  assert.equal(store.getHighSchool("../../etc/passwd"), null);
  assert.equal(store.getStateMedians("tx")!["grad_rate"], 0.92);
  assert.equal(store.searchHighSchools({ q: "ridge" })[0].id, "480000200001");
  assert.equal(createJsonHighSchoolStore(join(FIXTURE, "missing")).getHighSchool(RICH), null, "no data: null, not a crash");
});

test("fixture covers what the UI unit needs", () => {
  const all = rows();
  const rich = all.find((r) => r.id === RICH)!;
  assert.ok(rich.suppressed?.length, "suppressed cells");
  assert.ok(rich.grad_rate && rich.grad_rate.value === null && rich.grad_rate.low !== null, "an EDFacts range");
  assert.ok(all.some((r) => r.kind === "private"));
  assert.ok(new Set(all.map((r) => r.state)).size >= 2, "two states");
  assert.ok(readStateFiles(FIXTURE).length >= 2);
  assert.ok(readHighSchoolData(FIXTURE)!.details.length >= 1);
});

/* ------------------------------------------------------------------ */
/* Validators: the fixture passes; each broken input fails             */
/* ------------------------------------------------------------------ */

test("the fixture passes every check (as check:lineage runs them)", () => {
  const data = readHighSchoolData(FIXTURE)!;
  assert.deepEqual(highSchoolFileProblems(data, { collegeIds: new Set(["110662", "110635", "123961", "243744"]) }), []);
});

function rowProblems(id: string, mutate: (r: HighSchool) => void): string[] {
  const r = row(id);
  mutate(r);
  return validateHighSchoolRow(r);
}

test("validateHighSchoolRow: each rule fails on a broken row", () => {
  assert.deepEqual(validateHighSchoolRow(row(RICH)), []);
  assert.deepEqual(validateHighSchoolRow(row(PRIVATE)), []);
  const cases: [string, string, (r: HighSchool) => void, RegExp][] = [
    ["bad id", RICH, (r) => (r.id = "123"), /not a valid id/],
    ["kind vs id", RICH, (r) => (r.kind = "private"), /kind is private/],
    ["state vs FIPS", RICH, (r) => (r.state = "TX"), /doesn't match the id's FIPS/],
    ["unknown state", PRIVATE, (r) => (r.state = "PR"), /isn't one of the 50 states/],
    ["empty name", RICH, (r) => (r.name = " "), /name is empty/],
    ["zip", RICH, (r) => (r.zip = "9001"), /zip/],
    ["no grade 12", RICH, (r) => (r.grades = { low: "6", high: "8" }), /don't include grade 12/],
    ["bad grade code", RICH, (r) => (r.grades = { low: "9", high: "Z" }), /aren't grade codes/],
    ["unregistered field", RICH, (r) => ((r as unknown as Record<string, unknown>).rank = 1), /rank isn't a registered field/],
    ["fractional count", RICH, (r) => (r.enrollment.total = 10.5), /enrollment.total must be a whole number/],
    ["negative count", RICH, (r) => (r.rigor!.ap_enrolled = -1), /rigor.ap_enrolled must be a whole number/],
    ["bad grade key", RICH, (r) => ((r.enrollment.by_grade as Record<string, number>)["8"] = 10), /only grades 9–12/],
    ["bad race key", RICH, (r) => ((r.enrollment.by_race as Record<string, number>).other = 10), /isn't a race\/ethnicity category/],
    ["share > 1", RICH, (r) => (r.frl_share = 62), /frl_share must be 0–1/],
    ["ratio", RICH, (r) => (r.student_teacher_ratio = 0), /student_teacher_ratio out of range/],
    ["grad exact and range", RICH, (r) => (r.grad_rate!.value = 0.92), /exact \(value\) or a range/],
    ["grad half range", RICH, (r) => (r.grad_rate!.high = null), /needs both low and high/],
    ["grad low > high", RICH, (r) => (r.grad_rate = { value: null, low: 0.95, high: 0.9, cohort: 10 }), /low > high/],
    ["public affiliation", RICH, (r) => (r.affiliation = "Catholic"), /affiliation is for private/],
    ["private district", PRIVATE, (r) => (r.district = { id: "1", name: "X" }), /no district/],
    ["private grad rate", PRIVATE, (r) => (r.grad_rate = { value: 0.9, low: null, high: null, cohort: 50 }), /no federal graduation rate/],
    ["private rigor", PRIVATE, (r) => (r.rigor = { ap_courses: 1, ap_enrolled: null, ap_exam_takers: null, ap_passed_some: null, ib_enrolled: null, dual_enrolled: null, enrollment: null }), /no CRDC rigor/],
    ["suppressed with value", RICH, (r) => (r.suppressed = ["enrollment.total"]), /listed as suppressed but has a value/],
    ["suppressed unregistered", RICH, (r) => (r.suppressed = ["nope"]), /isn't a registered stored field/],
    ["suppressed derived", RICH, (r) => (r.suppressed = ["derived.ap_pass_share"]), /isn't a registered stored field/],
    ["lineage for null", SPARSE, (r) => (r.lineage = { frl_share: { source: "nces-ccd" } }), /which has no value/],
    ["lineage unknown source", RICH, (r) => (r.lineage = { frl_share: { source: "niche" as never } }), /unknown source niche/],
    ["lineage extracted incomplete", RICH, (r) => (r.lineage = { frl_share: { source: "hs-profile", method: "extracted" } }), /lacks quote/],
  ];
  for (const [name, id, mutate, expected] of cases) {
    const problems = rowProblems(id, mutate);
    assert.ok(problems.some((p) => expected.test(p)), `${name}: expected ${expected}, got ${JSON.stringify(problems)}`);
  }
});

test("validateShard: order, duplicates, wrong state, non-canonical rows", () => {
  const shard = readAllShards(FIXTURE).find((s) => s.shard.state === "CA")!.shard;
  assert.deepEqual(validateShard(shard, "CA.json"), []);
  assert.match(validateShard(shard, "TX.json").join("\n"), /file name doesn't match/);
  const reversed = { ...shard, schools: [...shard.schools].reverse() };
  assert.match(validateShard(reversed).join("\n"), /out of order/);
  const dup = { ...shard, schools: [shard.schools[0], shard.schools[0]] };
  assert.match(validateShard(dup).join("\n"), /out of order or repeated/);
  const scrambled = { ...shard, schools: [Object.fromEntries(Object.entries(shard.schools[0]).reverse()) as unknown as HighSchool] };
  assert.match(validateShard(scrambled).join("\n"), /canonical form/);
  const wrong = { ...shard, schools: [{ ...structuredClone(shard.schools.find((r) => r.kind === "private")!), state: "TX" }] };
  assert.match(validateShard(wrong).join("\n"), /is in TX/);
});

test("validateStateFile: each rule fails on a broken file", () => {
  const ca = (): HighSchoolStateFile => structuredClone(stateFiles().find((f) => f.state === "CA")!);
  const ids = new Set(rows().filter((r) => r.state === "CA" && r.kind === "public").map((r) => r.id));
  assert.deepEqual(validateStateFile(ca(), { fileName: "ca.json", ids }), []);
  const cases: [string, (f: HighSchoolStateFile) => void, RegExp][] = [
    ["lowercase state", (f) => (f.state = "ca"), /upper-case USPS/],
    ["wrong source", (f) => (f.sections[0].source = "state-tx"), /a CA file cites state-ca/],
    ["no year", (f) => (f.sections[0].year = ""), /no year/],
    ["bad url", (f) => (f.sections[0].url = "cde.ca.gov"), /url isn't http/],
    ["bad date", (f) => (f.sections[0].retrieved = "Oct 5"), /retrieved isn't YYYY-MM-DD/],
    ["field in two sections", (f) => f.sections[1].fields.push("college_going_rate"), /already in another section/],
    ["unknown field", (f) => f.sections[1].fields.push("sat_mean" as never), /isn't a state report field/],
    ["duplicate key", (f) => (f.sections[1].key = f.sections[0].key), /key missing or repeated/],
    ["percent not share", (f) => (f.schools["060000100003"].college_going_rate = 64), /0–1 share/],
    ["uncited field", (f) => (f.schools["060000100003"].ap_pass_rate = 0.5), /no section citing it/],
    ["suppressed with value", (f) => (f.schools["060000100003"].suppressed = ["ela_proficiency"]), /suppressed but has a value/],
    ["other state's id", (f) => (f.schools["480000200001"] = { college_going_rate: 0.5 }), /is a TX school/],
    ["private id", (f) => (f.schools["A9900001"] = { college_going_rate: 0.5 }), /not a public ncessch/],
    ["not in shard", (f) => (f.schools["060000100099"] = { college_going_rate: 0.5 }), /not in the CA shard/],
  ];
  for (const [name, mutate, expected] of cases) {
    const f = ca();
    mutate(f);
    const problems = validateStateFile(f, { ids });
    assert.ok(problems.some((p) => expected.test(p)), `${name}: expected ${expected}, got ${JSON.stringify(problems)}`);
  }
});

test("validateHighSchoolDetail: each rule fails on a broken file", () => {
  const colleges = new Set(["110662", "110635", "123961", "243744"]);
  assert.deepEqual(validateHighSchoolDetail(detail(), { fileName: "060000100001.json", schoolIds: new Set([RICH]), collegeIds: colleges }), []);
  const cases: [string, (d: HighSchoolDetail) => void, RegExp][] = [
    ["bad id", (d) => (d.id = "x"), /not a valid high school id/],
    ["unknown school", (d) => (d.id = "060000100099"), /no high school row/],
    ["profile url", (d) => (d.profile.url = "profile.pdf"), /profile.url/],
    ["profile date", (d) => (d.profile.retrieved = "2026"), /profile.retrieved/],
    ["edition", (d) => (d.profile.edition = ""), /edition is empty/],
    ["class size", (d) => (d.class_size = { v: 0, quote: "x" }), /class_size must be/],
    ["class size quote", (d) => (d.class_size!.quote = ""), /class_size has no quote/],
    ["gpa kind", (d) => (d.gpa_scale!.kind = "letter" as never), /gpa_scale.kind/],
    ["gpa quote", (d) => (d.gpa_scale!.quote = ""), /gpa_scale has no quote/],
    ["distribution sum", (d) => (d.gpa_distribution![0].share = 0.5), /sums to/],
    ["distribution share", (d) => (d.gpa_distribution![0].share = 21), /share must be 0–1/],
    ["empty course", (d) => d.ap_courses!.push(" "), /ap_courses has an empty entry/],
    ["sat range", (d) => (d.scores!.sat_mid50 = [1320, 1080]), /sat_mid50/],
    ["act range", (d) => (d.scores!.act_mid50 = [21, 40]), /act_mid50/],
    ["count > class", (d) => (d.matriculation!.entries[0].count = 600), /exceeds class size/],
    ["bad unit_id", (d) => (d.matriculation!.entries[0].unit_id = "UCLA"), /isn't an IPEDS id/],
    ["unknown college", (d) => (d.matriculation!.entries[0].unit_id = "999999"), /isn't in data\/schools.json/],
    ["empty name", (d) => (d.matriculation!.entries[0].name = ""), /has no name/],
  ];
  for (const [name, mutate, expected] of cases) {
    const d = detail();
    mutate(d);
    const problems = validateHighSchoolDetail(d, { schoolIds: new Set([RICH]), collegeIds: colleges });
    assert.ok(problems.some((p) => expected.test(p)), `${name}: expected ${expected}, got ${JSON.stringify(problems)}`);
  }
});

test("validateHighSchoolMeta: counts, vintages, sources the rows cite", () => {
  const all = rows();
  assert.deepEqual(validateHighSchoolMeta(meta(), all), []);
  const m1 = meta();
  m1.counts.public += 1;
  assert.match(validateHighSchoolMeta(m1, all).join("\n"), /counts say/);
  const m2 = meta();
  delete (m2.vintages as Record<string, unknown>).crdc;
  assert.match(validateHighSchoolMeta(m2, all).join("\n"), /vintages.crdc missing/);
  const m3 = meta();
  delete m3.sources["nces-pss"];
  assert.match(validateHighSchoolMeta(m3, all).join("\n"), /rows cite nces-pss/);
  const m4 = meta();
  m4.sources.crdc!.url = "nope";
  assert.match(validateHighSchoolMeta(m4, all).join("\n"), /source crdc needs/);
  const m5 = meta();
  m5.counts.byState.CA = 1;
  assert.match(validateHighSchoolMeta(m5, all).join("\n"), /byState/);
});

test("highSchoolFileProblems: a broken shard, state file, or detail file fails the whole check", () => {
  const fresh = () => structuredClone(readHighSchoolData(FIXTURE)!);
  const d1 = fresh();
  d1.shards[0].shard.schools[0].frl_share = 7;
  assert.match(highSchoolFileProblems(d1).join("\n"), /frl_share must be 0–1/);
  const d2 = fresh();
  d2.stateFiles[0].data.sections[0].url = "x";
  assert.match(highSchoolFileProblems(d2).join("\n"), /url isn't http/);
  const d3 = fresh();
  d3.details[0].data.gpa_distribution = [{ band: "all", share: 0.5 }];
  assert.match(highSchoolFileProblems(d3).join("\n"), /sums to/);
  const d4 = fresh();
  d4.medians = null;
  assert.match(highSchoolFileProblems(d4).join("\n"), /medians.json is missing/);
  const d5 = fresh();
  d5.shards.push({ file: "CA2.json", shard: d5.shards[0].shard });
  assert.match(highSchoolFileProblems(d5).join("\n"), /more than one shard/);
});

test("glossary: every high school term the UI uses exists", () => {
  for (const t of [
    "ncessch",
    "adjusted-cohort-graduation-rate",
    "ap-access",
    "college-going-rate",
    "school-profile",
    "weighted-gpa",
    "title-i",
    "free-reduced-lunch",
    "dual-enrollment",
    "chronic-absence",
    "state-proficiency",
    "student-teacher-ratio",
    "clearinghouse-persistence",
    "hs-state-median",
    "suppressed-for-privacy",
  ]) {
    assert.ok(t in GLOSSARY, `glossary term ${t}`);
    for (const r of (GLOSSARY as Record<string, { related?: string[] }>)[t].related ?? []) assert.ok(r in GLOSSARY, `${t} relates to unknown term ${r}`);
  }
});
