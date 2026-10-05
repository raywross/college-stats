/**
 * LGBTQ+ life, phase 1 (specs/lgbtq-life.md): the another-gender readers, the display rules, the state-law table, the
 * sync's fallback lineage, the rule that these counts are never ranked, filtered, or "Known for", and the stored values.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import {
  FEW_TEXT,
  NOT_COLLECTED_TEXT,
  SMALL_COUNT,
  WITHHELD_TEXT,
  ZERO_TEXT,
  countDisplay,
  countText,
  genderAdmissionsFrom,
  genderFrom,
  hasLgbtq,
  smallCount,
  stateLawFor,
  statusOf,
  validateStateLaws,
  type StateLawTable,
} from "../lib/lgbtq.ts";
import { addLgbtq, type LgbtqInputs } from "../scripts/lib/lgbtq-sync.mts";
import { validateSchool } from "../lib/lineage.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const LAWS: StateLawTable = JSON.parse(readFileSync(join(ROOT, "data", "state-laws.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;

/** A pivoted EF{Y}A row's undergraduate (level 2) cells. */
const ef = (cells: { total?: string; an?: string; xan?: string; un?: string }) => ({
  EFTOTLT_2: cells.total ?? "1000",
  EFGNDRAN_2: cells.an ?? "",
  XEFGNDRAN_2: cells.xan ?? "",
  EFGNDRUN_2: cells.un ?? "",
});

test("blank, 0, and a count each mean something different, read from the value and its imputation flag", () => {
  assert.equal(statusOf("576", "R"), "reported");
  assert.equal(statusOf("0", "R"), "reported");
  assert.equal(statusOf("0", "Z"), "reported", "an implied zero is still a reported 0");
  assert.equal(statusOf("", "A"), "not_collected");
  assert.equal(statusOf("", "S"), "withheld");
  assert.equal(statusOf("", ""), "not_collected", "EF2022A has no flags: blank meant the college couldn't report it");
  assert.equal(statusOf("", "B"), null, "a blank with any other flag can't be told apart, so it isn't shown");
});

test("the fall reader keeps another and unknown gender with the undergraduate total; a missing college is null", () => {
  assert.deepEqual(genderFrom(ef({ total: "33040", an: "576", xan: "R", un: "64" })), { status: "reported", another: 576, unknown: 64, undergrads: 33040 });
  assert.deepEqual(genderFrom(ef({ total: "42444", xan: "A", un: "21" })), { status: "not_collected", another: null, unknown: 21, undergrads: 42444 });
  assert.deepEqual(genderFrom(ef({ total: "8844", xan: "S", un: "0" })), { status: "withheld", another: null, unknown: 0, undergrads: 8844 });
  assert.equal(genderFrom(undefined), null);
  assert.equal(genderFrom({ EFTOTLT_4: "100" }), null, "no undergraduate row");
});

test("the admissions reader takes the applicants cell's flag for all three counts", () => {
  assert.deepEqual(genderAdmissionsFrom({ APPLCNAN: "1189", XAPPLCNAN: "R", ADMSSNAN: "55", ENRLAN: "31" }), { status: "reported", applicants: 1189, admitted: 55, enrolled: 31 });
  assert.deepEqual(genderAdmissionsFrom({ APPLCNAN: "", XAPPLCNAN: "S", ADMSSNAN: "", ENRLAN: "" }), { status: "withheld", applicants: null, admitted: null, enrolled: null });
  assert.deepEqual(genderAdmissionsFrom({ APPLCNAN: "", XAPPLCNAN: "A", ADMSSNAN: "", ENRLAN: "" }), { status: "not_collected", applicants: null, admitted: null, enrolled: null });
  assert.equal(genderAdmissionsFrom(undefined), null);
  assert.equal(genderAdmissionsFrom({ APPLCN: "100" }), null, "a file without the columns (ADM2025 on) gives nothing, not 'not collected'");
});

test("display rules: the spec's sentences, the threshold of 10, and a share only above it", () => {
  assert.equal(countText(countDisplay("not_collected", null)!, "undergraduates"), NOT_COLLECTED_TEXT);
  assert.equal(NOT_COLLECTED_TEXT, "Not collected by this college.");
  assert.equal(countText(countDisplay("reported", 0)!, "undergraduates"), ZERO_TEXT);
  assert.equal(ZERO_TEXT, "0 reported. The college may not record other genders.");
  assert.equal(countText(countDisplay("withheld", null)!, "undergraduates"), WITHHELD_TEXT);
  assert.equal(SMALL_COUNT, 10);
  assert.deepEqual(countDisplay("reported", 9, 1000), { kind: "few" });
  assert.equal(countText({ kind: "few" }, "undergraduates"), `${FEW_TEXT} undergraduates`);
  assert.deepEqual(countDisplay("reported", 10, 1000), { kind: "count", count: 10, share: 0.01 });
  assert.equal(countText(countDisplay("reported", 576, 33040)!, "undergraduates"), "576 undergraduates (1.7%)");
  assert.equal(countText(countDisplay("reported", 1500, 6000)!, "undergraduates"), "1,500 undergraduates (25%)");
  assert.equal(smallCount(null), null);
  assert.equal(smallCount(0), "0");
  assert.equal(smallCount(7), "fewer than 10");
  assert.equal(smallCount(1189), "1,189");
});

test("the state-law table: the real one passes, and each rule fails when broken", () => {
  assert.deepEqual(validateStateLaws(LAWS), []);
  const tx = LAWS.laws.find((l) => l.state === "TX")!;
  assert.equal(tx.statute, "Texas Education Code §51.3525");
  assert.equal(tx.effective, "2024-01-01");
  const broken = (patch: Record<string, unknown>) => validateStateLaws({ ...LAWS, laws: [{ ...tx, ...patch } as typeof tx] });
  assert.equal(broken({ state: "Texas" }).length, 1);
  assert.equal(broken({ applies_to: "all" }).length, 1, "only public colleges so far");
  assert.equal(broken({ summary: "" }).length, 1);
  assert.equal(broken({ summary: `Texas ${"x".repeat(235)}` }).length, 1);
  assert.equal(broken({ effective: "January 1, 2024" }).length, 1);
  assert.equal(broken({ checked: "" }).length, 1, "the statute must have been read on a date");
  assert.equal(broken({ url: "http://example.com" }).length, 1);
  assert.equal(broken({ statute: " " }).length, 1);
  assert.equal(validateStateLaws({ ...LAWS, laws: [tx, tx] }).length, 1, "one law per state");
  assert.equal(validateStateLaws({ ...LAWS, reviewed: "" }).length, 1);
  // Phase 2: every law names its state in both lines, was read on or before the review date, and the table stays sorted.
  assert.equal(broken({ summary: "Utah public colleges may not …" }).length, 1, "a summary under another state's law");
  assert.equal(broken({ checked: "2099-01-01" }).length, 1, "read after the review date");
  assert.equal(validateStateLaws({ ...LAWS, laws: [...LAWS.laws].reverse() }).length, 1, "sorted by state");
});

test("phase 2: each state law in the table, read from the statute (specs/lgbtq-life.md#phase-2-as-built)", () => {
  const byState = new Map(LAWS.laws.map((l) => [l.state, l]));
  assert.deepEqual([...byState.keys()], ["AL", "FL", "IA", "ID", "NC", "OH", "TN", "TX", "UT"]);
  assert.equal(byState.get("AL")!.effective, "2024-10-01");
  assert.equal(byState.get("FL")!.statute, "Florida Statutes §1004.06");
  assert.equal(byState.get("IA")!.statute, "Iowa Code chapter 261J");
  assert.equal(byState.get("ID")!.statute, "Idaho Code §67-5909D");
  assert.equal(byState.get("UT")!.statute, "Utah Code §53H-1-504 (formerly §53B-1-118)");
  for (const l of LAWS.laws) {
    assert.ok(/sexual orientation|gender identity|queer theory/.test(l.summary), `${l.state}: the line says how the law reaches LGBTQ+ programs`);
    assert.ok(l.checked <= LAWS.reviewed && l.effective <= l.checked, `${l.state}: in effect when read`);
  }
});

test("general DEI-office bans (owner decision 2026-10-04): included, and the line says they don't name LGBTQ+ programs", () => {
  const byState = new Map(LAWS.laws.map((l) => [l.state, l]));
  const general = ["NC", "OH", "TN"];
  assert.equal(byState.get("OH")!.statute, "Ohio Revised Code §3345.0217");
  assert.equal(byState.get("OH")!.effective, "2025-06-27");
  assert.equal(byState.get("TN")!.effective, "2025-05-09", "Pub. Ch. 458 took effect when the Governor signed it");
  assert.equal(byState.get("NC")!.statute, "N.C. Gen. Stat. §§116-415 to 116-417");
  assert.equal(byState.get("NC")!.effective, "2026-06-24", "the veto override");
  // Neither direction may be overstated: a general ban says it doesn't name them; a law that names them doesn't say it doesn't.
  for (const l of LAWS.laws) {
    const saysNotNamed = /doesn't (?:define DEI or )?name sexual orientation or gender identity/.test(l.summary);
    assert.equal(saysNotNamed, general.includes(l.state), `${l.state}: ${l.summary}`);
  }
});

test("a state law applies to public colleges in that state only", () => {
  const loc = (state: string) => ({ city: "", state, zip: "", region: "" });
  assert.equal(stateLawFor({ type: "public", location: loc("TX") }, LAWS)?.name, "Texas SB 17 (2023)");
  assert.equal(stateLawFor({ type: "private-nonprofit", location: loc("TX") }, LAWS), null);
  assert.equal(stateLawFor({ type: "public", location: loc("CA") }, LAWS), null);
  assert.ok(!("applies_to" in stateLawFor({ type: "public", location: loc("TX") }, LAWS)!), "the stored value drops the table's selector");
});

test("the sync step cites the older file when NCES no longer collects the count, and the statute for a law", () => {
  const base = { unit_id: "1", name: "Test", type: "public", location: { city: "", state: "TX", zip: "", region: "" } } as unknown as School;
  const inputs = (efFallback: boolean): LgbtqInputs => ({
    ef: { name: "EF2024A", url: "https://nces.ed.gov/EF2024A.zip", year: 2024, rows: new Map([["1", ef({ an: "12", xan: "R", un: "3" })]]) },
    adm: { name: "ADM2024", url: "https://nces.ed.gov/ADM2024.zip", year: 2024, rows: new Map() },
    efFallback,
    admFallback: false,
    laws: LAWS,
  });
  const now = structuredClone(base);
  addLgbtq(now, inputs(false));
  assert.equal(now.lgbtq?.gender?.another, 12);
  assert.equal(now.lineage?.["lgbtq.gender"], undefined, "the newest file: the field's default vintage is right");
  assert.equal(now.lineage?.["lgbtq.state_law"]?.url, LAWS.laws.find((l) => l.state === "TX")!.url);
  const later = structuredClone(base);
  addLgbtq(later, inputs(true));
  assert.deepEqual(later.lineage?.["lgbtq.gender"], { source: "ipeds-ef-a", year: "Fall 2024", url: "https://nces.ed.gov/EF2024A.zip" });
  // Idempotent: a second run writes the same thing.
  const again = structuredClone(later);
  addLgbtq(again, inputs(true));
  assert.deepEqual(again, later);
  // Nothing at all: no block.
  const none = { ...structuredClone(base), unit_id: "2", location: { city: "", state: "CA", zip: "", region: "" } } as School;
  addLgbtq(none, inputs(false));
  assert.equal(none.lgbtq, undefined);
  assert.equal(hasLgbtq(none), false);
});

/** Every .ts/.tsx file under a path. */
function sources(path: string): string[] {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f)).map((f) => join(full, f));
}

/**
 * The spec's rule: these counts are never ranked, averaged, filtered, compared side by side, or turned into a "Known
 * for" chip. The modules that do those things must not read them. (Broken on purpose 2026-10-03: a `lgbtq` reference
 * added to lib/metrics.ts fails this test.)
 */
/**
 * Phase 3 (specs/lgbtq-life.md "Where it appears", 2026-10-04) deliberately lets LGBTQ+ *policy* facts reach
 * Explore and Compare (lib/lgbtq-policy.ts: a listed center, gender-inclusive housing, nondiscrimination covering
 * gender identity) while keeping the gender-identity *counts* (this file's phase 1: another gender, gender unknown)
 * out of them, per the owner's scaling note: "policy facts are allowed there, counts are not." So this guard no
 * longer bans the bare word "lgbtq" (the policy filters and Compare rows need it, e.g. `school.directories?.lgbtq`),
 * only the count-specific symbols and the module that holds them: a file in this list must never import
 * lib/lgbtq.ts (gender, admissions) or name GenderDetail/GenderAdmissions/"another gender".
 */
test("another-gender counts never feed rankings, medians, filters, Compare, or Known for", () => {
  const files = ["lib/metrics.ts", "lib/params.ts", "lib/indicators.ts", "lib/dataset.ts", "lib/compare.ts", "lib/cds/compare-rows.ts", "lib/insights.ts", "lib/compare-topics.ts", "lib/compare-routes.ts", "lib/compare-data.ts", "app/explore", "app/compare", "components/explore", "app/page.tsx"].flatMap(sources);
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    assert.ok(!/another[-_ ]gender|GenderDetail|GenderAdmissions|lib\/lgbtq(?:\.ts)?["']|from ["']\.\.?\/.*\/lgbtq(?:\.ts)?["']/i.test(text), `${f.slice(ROOT.length + 1)} reads the another-gender counts`);
  }
});

test("stored values: every college has a status, blank is never 0, no count under 5 since fall 2023, and lineage checks out", () => {
  const withGender = schools.filter((s) => s.lgbtq?.gender);
  assert.ok(withGender.length > 0.95 * schools.length, `${withGender.length} colleges`);
  for (const s of withGender) {
    const g = s.lgbtq!.gender!;
    if (g.status === "reported") assert.ok(g.another !== null, s.name);
    else assert.equal(g.another, null, `${s.name}: a blank must stay null, never 0`);
    if (g.another !== null && g.another > 0) assert.ok(g.another >= 5, `${s.name}: ${g.another} (NCES has colleges withhold counts under 5)`);
  }
  const statuses = new Set(withGender.map((s) => s.lgbtq!.gender!.status));
  assert.deepEqual([...statuses].sort(), ["not_collected", "reported", "withheld"]);
  // UCLA reports a count; UT Austin doesn't collect it; Harvard records it but withheld its fall 2024 cells.
  assert.equal(byId("110662").lgbtq?.gender?.status, "reported");
  assert.ok((byId("110662").lgbtq?.gender?.another ?? 0) > 100);
  assert.equal(byId("228778").lgbtq?.gender?.status, "not_collected");
  // Texas SB 17: UT Austin (public) has the line; Rice (private) doesn't.
  assert.equal(byId("228778").lgbtq?.state_law?.statute, "Texas Education Code §51.3525");
  assert.equal(byId("227757").lgbtq?.state_law ?? null, null);
  for (const s of schools.filter((x) => x.lgbtq?.state_law)) assert.equal(s.type, "public", s.name);
  assert.ok(meta.sources["state-law"], "the sync adds the state-law source");
  for (const s of schools.filter((x) => x.lgbtq)) assert.deepEqual(validateSchool(s, meta), [], s.name);
  // A state law without its statute citation fails the lineage check.
  const ut = structuredClone(byId("228778"));
  delete ut.lineage!["lgbtq.state_law"];
  assert.equal(validateSchool(ut, meta).length, 1);
});
