/**
 * The pool's rate (specs/chances/base-rates.md; lib/chances/pool-rate.ts): the order of precedence (campus guarantee >
 * major > residency > overall), a program that applies and one missing a field ("you may qualify", never assumed),
 * system vs campus scope, a major rate beside residency without multiplying them, GPA and "either" rules, the
 * early-decision fact, every line rendering and citing a registered field, the per-program citation, and the
 * guaranteed-admission check's new rules (each broken on purpose). Programs and units are the curated files' own
 * entries; the colleges' rates are fixed fixture numbers so the examples stay pinned. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, ReportedResidencyAdmissions, School } from "../lib/types";
import { poolRateFor, programLabel, programStatus, type PoolSchool, type PoolStudent } from "../lib/chances/pool-rate.ts";
import { programById, programsFor, validateGuaranteed, type GuaranteedFile } from "../lib/chances/guaranteed.ts";
import { noteText } from "../lib/chances/notes.ts";
import { isFieldPath } from "../lib/fields.ts";
import { guaranteedProgramCitation, lineageFor } from "../lib/lineage.ts";

const ROOT = join(import.meta.dirname, "..");
const readJson = <T,>(...p: string[]): T => JSON.parse(readFileSync(join(ROOT, ...p), "utf8")) as T;
const schools = readJson<School[]>("data", "schools.json");
const meta = readJson<DatasetMeta>("data", "meta.json");
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const student = (o: Partial<PoolStudent> = {}): PoolStudent => ({ state: null, classRankPercentile: null, gpa: null, majors: [], round: null, ...o });
const counts = (applicants: number, admitted: number) => ({ applicants, admitted, enrolled: Math.round(admitted / 3) });
const grid = (inState: [number, number], outState: [number, number], intl: [number, number]): ReportedResidencyAdmissions => ({
  entering_term: "Fall 2025",
  year: 2025,
  edition: "2025-26",
  in_state: counts(...inState),
  out_of_state: counts(...outState),
  international: counts(...intl),
  unknown: counts(0, 0),
  total: counts(inState[0] + outState[0] + intl[0], inState[1] + outState[1] + intl[1]),
});
/** A real college's identity with fixed rates: overall `rate` (cited "Fall 2025"), and an optional residency grid. */
function college(id: string, rate: number | null, residency?: ReportedResidencyAdmissions): PoolSchool {
  const s = clone(byId.get(id)!);
  return {
    unit_id: s.unit_id,
    name: s.name,
    location: s.location,
    admissions: { ...s.admissions, acceptance_rate: rate },
    reported: { ...(s.reported ?? {}), admissions_by_residency: residency },
    lineage: { ...(s.lineage ?? {}), "admissions.acceptance_rate": { source: "ipeds-adm", year: "Fall 2025" } },
  } as PoolSchool;
}
const keys = (r: { notes: { key: string }[] }) => r.notes.map((n) => n.key);
const texts = (r: { notes: { key: string; values: Record<string, string | number> }[] }) => r.notes.map((n) => noteText(n));

/* ---- Order of precedence ---- */

test("overall, then residency (in-state, out-of-state, international) when the grid and the state are known", () => {
  // Purdue-like: 43% overall, 71% from Indiana, 44% from other states, 30% international.
  const purdue = college("243780", 0.43, grid([12000, 8520], [59000, 25960], [16000, 4800]));
  const none = poolRateFor(student(), purdue);
  assert.equal(none.kind, "overall");
  assert.equal(none.rate, 0.43);
  assert.equal(none.field, "admissions.acceptance_rate");
  assert.equal(none.edition, "Fall 2025");
  assert.deepEqual(texts(none), ["43% of applicants were admitted (Fall 2025)."]);

  const hoosier = poolRateFor(student({ state: "IN" }), purdue);
  assert.equal(hoosier.kind, "residency");
  assert.equal(hoosier.rate, 0.71);
  assert.equal(hoosier.label, "in-state rate");
  assert.equal(hoosier.field, "derived.admit_rate_in_state");
  assert.equal(hoosier.edition, "Fall 2025");
  assert.deepEqual(texts(hoosier), ["Applicants from Indiana were admitted at 71% (Fall 2025)."]);

  const buckeye = poolRateFor(student({ state: "OH" }), purdue);
  assert.equal(buckeye.rate, 0.44);
  assert.equal(buckeye.label, "out-of-state rate");
  assert.deepEqual(texts(buckeye), ["Applicants from outside Indiana were admitted at 44% (Fall 2025)."]);

  const abroad = poolRateFor(student({ state: "OUTSIDE_US" }), purdue);
  assert.equal(abroad.field, "derived.admit_rate_international");
  assert.equal(abroad.rate, 0.3);

  // No grid: the overall rate, whatever the state.
  assert.equal(poolRateFor(student({ state: "IN" }), college("243780", 0.43)).kind, "overall");
  // No rate at all (open admission or unreported): kind overall, rate null, nothing to cite.
  const open = poolRateFor(student(), college("243780", null));
  assert.equal(open.rate, null);
  assert.deepEqual(open.notes, []);
  assert.deepEqual(open.facts, []);
  // Without a lineage record or a default year, the line is undated rather than guessed.
  const undated = college("243780", 0.43);
  delete (undated.lineage as Record<string, unknown>)["admissions.acceptance_rate"];
  assert.equal(poolRateFor(student(), undated).notes[0].key, "pool.overall_undated");
  assert.equal(poolRateFor(student(), undated, { overallYear: "Fall 2024" }).notes[0].values.year, "Fall 2024");
});

test("a campus guarantee outranks every rate; the guarantee never includes the major, and says so where the major admits separately", () => {
  const ut = college("228778", 0.27, grid([40000, 12000], [20000, 2000], [5000, 500]));
  const r = poolRateFor(student({ state: "TX", classRankPercentile: 4, majors: ["14"] }), ut);
  assert.equal(r.kind, "guaranteed");
  assert.equal(r.rate, null);
  assert.equal(r.label, "guaranteed");
  assert.equal(r.programId, "tx-auto-ut-austin-2027");
  assert.equal(r.scope, "campus");
  assert.equal(r.field, "reference.guaranteed_admission.rule");
  assert.equal(r.edition, "Fall 2027");
  assert.deepEqual(keys(r), ["pool.guaranteed", "pool.major_not_guaranteed"]);
  assert.equal(texts(r)[0], "Guaranteed for you: Texas automatic admission (top 5%).");
  assert.equal(texts(r)[1], "Automatic admission to The University of Texas at Austin doesn't include a major; Cockrell School of Engineering admits separately.");
  // Undeclared (no unit admits separately for English here): only the guarantee.
  assert.deepEqual(keys(poolRateFor(student({ state: "TX", classRankPercentile: 4, majors: ["23"] }), ut)), ["pool.guaranteed"]);
});

test("a program applies only on fields the student gave: a missing rank or state is a 'may qualify' line, never assumed", () => {
  const ut = college("228778", 0.27, grid([40000, 12000], [20000, 2000], [5000, 500]));
  const noRank = poolRateFor(student({ state: "TX" }), ut);
  assert.equal(noRank.kind, "residency");
  assert.equal(noRank.rate, 0.3);
  assert.deepEqual(keys(noRank), ["pool.residency_in", "pool.may_qualify"]);
  assert.equal(texts(noRank)[1], "You may qualify for Texas automatic admission if you're in the top 5% of your class.");
  assert.deepEqual(noRank.programs.map((c) => [c.program.id, c.status, c.missing]), [["tx-auto-ut-austin-2027", "may_qualify", ["class_rank"]]]);

  // Rank given but no state: still only "may qualify" (the program is for Texas students).
  const noState = poolRateFor(student({ classRankPercentile: 3 }), ut);
  assert.equal(noState.kind, "overall");
  assert.deepEqual(noState.programs[0].missing, ["state"]);
  assert.ok(keys(noState).includes("pool.may_qualify"));

  // Another state's student: not eligible, no line. A Texan outside the cut: not met, no line.
  assert.deepEqual(poolRateFor(student({ state: "OK", classRankPercentile: 1 }), ut).programs[0].status, "not_eligible");
  const outside = poolRateFor(student({ state: "TX", classRankPercentile: 8 }), ut);
  assert.equal(outside.programs[0].status, "not_met");
  assert.deepEqual(keys(outside), ["pool.residency_in"]);
  // The same 8% is inside Texas A&M's top-10% rule.
  const tamu = poolRateFor(student({ state: "TX", classRankPercentile: 8 }), college("228723", 0.57));
  assert.equal(tamu.kind, "guaranteed");
  assert.equal(tamu.programId, "tx-auto-top10-2027");
  assert.equal(texts(tamu)[0], "Guaranteed for you: Texas automatic admission (top 10%).");
});

test("a system-scope program (UC's ELC) is a line, never the campus's rate or a guarantee at it", () => {
  const berkeley = college("110635", 0.11, grid([80000, 9600], [40000, 3200], [13000, 1000]));
  const top5 = poolRateFor(student({ state: "CA", classRankPercentile: 5 }), berkeley);
  assert.equal(top5.kind, "residency");
  assert.equal(top5.rate, 0.12);
  assert.equal(top5.programs[0].status, "applies");
  assert.deepEqual(keys(top5), ["pool.residency_in", "pool.system_scope"]);
  assert.equal(texts(top5)[1], "UC Eligibility in the Local Context guarantees a place in the University of California system, not at a campus you choose.");
  assert.ok(top5.facts.includes("reference.guaranteed_admission.scope"));
  // Rank unknown: may qualify, plus what it guarantees. Every UC campus carries the same line.
  const unknown = poolRateFor(student({ state: "CA" }), berkeley);
  assert.deepEqual(keys(unknown), ["pool.residency_in", "pool.may_qualify", "pool.system_scope"]);
  for (const id of ["110644", "110653", "110662", "445188", "110671", "110680", "110705", "110714"]) {
    assert.ok(programsFor(id).some((p) => p.id === "uc-elc-2027" && p.scope === "system"), id);
  }
});

test("a major's published rate beats residency, and residency is named beside it in words: never multiplied", () => {
  const illinois = college("145637", 0.37, grid([30000, 13500], [40000, 12000], [13000, 3500]));
  const r = poolRateFor(student({ state: "IL", majors: ["14"] }), illinois);
  assert.equal(r.kind, "major");
  assert.equal(r.rate, 0.212);
  assert.equal(r.label, "rate for your major");
  assert.equal(r.field, "reported.major_admission.admit_rate");
  assert.equal(r.edition, "Fall 2025");
  assert.deepEqual(keys(r), ["pool.major_rate", "pool.residency_in"]);
  assert.equal(texts(r)[0], "Grainger College of Engineering admitted 21% of its applicants (Fall 2025).");
  assert.equal(texts(r)[1], "Applicants from Illinois were admitted at 45% (Fall 2025).");
  // A major with no published rate (English) falls through to residency.
  assert.equal(poolRateFor(student({ state: "IL", majors: ["23"] }), illinois).kind, "residency");
  // Only the first intended major counts.
  assert.equal(poolRateFor(student({ state: "IL", majors: ["23", "14"] }), illinois).kind, "residency");
});

test("GPA rules and 'either' rules: Idaho's two tiers and Arizona's top 25% or a 3.0", () => {
  const isu = college("142276", 0.99);
  const tier = poolRateFor(student({ state: "ID", gpa: 2.5 }), isu);
  assert.equal(tier.kind, "guaranteed");
  assert.equal(tier.programId, "id-direct-admission-isu-lcsc-2027");
  assert.equal(texts(tier)[0], "Guaranteed for you: Idaho Direct Admissions (a 2.25 GPA).");
  // The 3.0 tier applies first where both do.
  assert.equal(poolRateFor(student({ state: "ID", gpa: 3.4 }), isu).programId, "id-direct-admission-all-2027");
  // GPA unknown: one "may qualify" line per program name, the easier tier.
  const noGpa = poolRateFor(student({ state: "ID" }), isu);
  assert.deepEqual(keys(noGpa), ["pool.overall", "pool.may_qualify_gpa"]);
  assert.equal(texts(noGpa)[1], "You may qualify for Idaho Direct Admissions with a GPA of 2.25 or higher.");
  // Boise State has only the 3.0 tier.
  assert.equal(poolRateFor(student({ state: "ID", gpa: 2.5 }), college("142115", 0.87)).kind, "overall");

  const ua = programById("az-assured-ua-2027")!;
  assert.equal(programStatus(ua, { state: "AZ", classRankPercentile: 30, gpa: 3.2 }).status, "applies");
  assert.equal(programStatus(ua, { state: "AZ", classRankPercentile: 20, gpa: null }).status, "applies");
  assert.deepEqual(programStatus(ua, { state: "AZ", classRankPercentile: 30, gpa: null }), { program: ua, status: "may_qualify", missing: ["gpa"] });
  assert.equal(programStatus(ua, { state: "AZ", classRankPercentile: 30, gpa: 2.8 }).status, "not_met");
  assert.equal(programLabel(ua), "University of Arizona assured admission (top 25% or a 3.0 GPA)");
  const may = poolRateFor(student({ state: "AZ", classRankPercentile: 30 }), college("104179", 0.86));
  assert.equal(texts(may)[1], "You may qualify for University of Arizona assured admission if you're in the top 25% of your class or have a GPA of 3.0 or higher.");
  // An "all" rule with both thresholds needs each.
  const both = { ...ua, rule: { ...ua.rule, match: "all" as const } };
  assert.equal(programStatus(both, { state: "AZ", classRankPercentile: 20, gpa: 2.8 }).status, "not_met");
  assert.equal(programStatus(both, { state: "AZ", classRankPercentile: 20, gpa: 3.1 }).status, "applies");
});

test("early decision is a fact beside the pool, for an ED student at a college with the CDS counts, never the pool's rate", () => {
  const s = college("243780", 0.2);
  const url = "https://example.edu/cds.pdf";
  s.admissions = { ...s.admissions, applicants: 10000, admitted: 2000 };
  s.reported = { ...s.reported, admission_profile: { ...(s.reported?.admission_profile ?? {}), early_decision: { offered: true, applicants: 1000, admitted: 400 } } } as PoolSchool["reported"];
  s.lineage = {
    ...s.lineage,
    "admissions.applicants": { source: "college-site", url, year: "Fall 2025" },
    "admissions.admitted": { source: "college-site", url, year: "Fall 2025" },
    "reported.admission_profile.early_decision.applicants": { source: "college-site", url, year: "Fall 2025" },
  } as PoolSchool["lineage"];
  const ed = poolRateFor(student({ round: "ed" }), s);
  assert.equal(ed.kind, "overall");
  assert.equal(ed.rate, 0.2);
  assert.deepEqual(keys(ed), ["pool.overall", "pool.ed_fact"]);
  assert.match(texts(ed)[1], /^Early decision admitted 40% here against 20% overall \(Fall 2025\)/);
  assert.ok(ed.facts.includes("derived.ed_admit_rate"));
  assert.deepEqual(keys(poolRateFor(student({ round: "ea" }), s)), ["pool.overall"]);
});

test("every line renders from the catalog and cites a registered field; facts list them", () => {
  const cases: [PoolStudent, PoolSchool][] = [
    [student({ state: "TX", classRankPercentile: 4, majors: ["14"] }), college("228778", 0.27)],
    [student({ state: "CA" }), college("110635", 0.11, grid([80000, 9600], [40000, 3200], [13000, 1000]))],
    [student({ state: "IL", majors: ["14"] }), college("145637", 0.37, grid([30000, 13500], [40000, 12000], [13000, 3500]))],
    [student({ state: "ID" }), college("142276", 0.99)],
    [student({ state: "AZ", classRankPercentile: 30 }), college("104179", 0.86)],
  ];
  for (const [st, sc] of cases) {
    const r = poolRateFor(st, sc);
    assert.ok(isFieldPath(r.field), r.field);
    for (const n of r.notes) {
      const t = noteText(n);
      assert.ok(t.length > 0 && !/undefined|\$\{|NaN/.test(t), `${n.key}: ${t}`);
      assert.ok(n.cite && isFieldPath(n.cite), `${n.key} cites ${n.cite}`);
      assert.ok(r.facts.includes(n.cite!), n.key);
    }
  }
});

/* ---- Citations ---- */

test("each displayed fact cites its own curated entry: the program shown (not just the college's first), and a printed major rate", () => {
  const tier = programById("id-direct-admission-isu-lcsc-2027")!;
  const c = guaranteedProgramCitation("reference.guaranteed_admission.rule", tier)!;
  assert.equal(c.quote, tier.source.quote);
  assert.equal(c.source.url, tier.source.url);
  assert.equal(c.source.year, "Fall 2027");
  assert.equal(guaranteedProgramCitation("admissions.acceptance_rate", tier), null);

  const illinois = byId.get("145637")!;
  const cited = lineageFor("reported.major_admission.admit_rate", illinois, meta);
  assert.equal(cited.url, "https://www.admissions.illinois.edu/Apply/Freshman/admit-rate");
  assert.equal(cited.year, "Fall 2025");
  assert.equal(cited.quote, "Grainger College of Engineering: 21.2%");
});

/* ---- The guaranteed-admission check's added rules ---- */

test("the guaranteed-admission check refuses an 'any' rule without two thresholds, a system without its name, and a GPA not in the quote", () => {
  const file = readJson<GuaranteedFile>("data", "guaranteed-admission.json");
  const today = new Date("2026-10-11T00:00:00Z");
  assert.deepEqual(validateGuaranteed(file, today), []);
  const ua = clone(file.programs.find((p) => p.id === "az-assured-ua-2027")!);
  const elc = clone(file.programs.find((p) => p.id === "uc-elc-2027")!);
  const idaho = clone(file.programs.find((p) => p.id === "id-direct-admission-all-2027")!);
  const run = (p: unknown) => validateGuaranteed({ ...file, programs: [p] } as GuaranteedFile, today);
  const cases: [string, unknown, RegExp][] = [
    ["any with one threshold", { ...ua, rule: { ...ua.rule, gpa_min: null } }, /needs both a rank and a GPA threshold/],
    ["unknown match", { ...ua, rule: { ...ua.rule, match: "either" } }, /rule.match must be/],
    ["system without its name", { ...elc, system_name: undefined }, /names its system/],
    ["GPA not in the quote", { ...idaho, rule: { ...idaho.rule, gpa_min: 3.2 } }, /GPA threshold \(3.2\) doesn't appear/],
  ];
  for (const [what, p, re] of cases) {
    const errors = run(p);
    assert.ok(errors.some((e) => re.test(e)), `${what}: ${errors.join("; ")}`);
  }
});

test("pool-rate.ts and major-review.ts stay client-safe: no server-only import, no method module", () => {
  for (const f of ["lib/chances/pool-rate.ts", "lib/chances/major-review.ts"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!/import\s+["']server-only["']/.test(src), f);
    assert.ok(!/from "\.\/(model|estimate|rigor-rules)(\.ts)?"/.test(src), f);
  }
});
