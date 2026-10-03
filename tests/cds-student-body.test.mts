/**
 * CDS student body and outcomes (specs/data-expansion/cds-student-body-and-outcomes.md): the section-B checks and value
 * set (lib/cds/student-body.ts) on the four real 2025–26 template-workbook records, the newest groups
 * (lib/newest-groups.ts: apply, restore, the lineage guard's rules 1–9), the merge into the committed dataset, history's
 * rule 1 against the kept federal values, and the diversity indicator's end fall. Each guard is also shown failing
 * on a hand-broken input. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, LineageRecord, School } from "../lib/types";
import type { CdsCode, CollegeRecord, DocumentRecord } from "../lib/cds-sections.ts";
import { checkB1, checkB2, checkGrid, checkRetention, parseRate, studentBodyFromRecord } from "../lib/cds/student-body.ts";
import { NEWEST_GROUPS, applyNewestGroups, federalYears, restoreNewestGroups, type FoundValues } from "../lib/newest-groups.ts";
import { restoreFederal } from "../lib/newest.ts";
import { lineageFor, lineageForPatch, validateOverrides, validateSchool } from "../lib/lineage.ts";
import { stripReported } from "../lib/reported-merge.ts";
import { detailText, indicatorOf } from "../lib/indicators.ts";
import { lastYear, type HistoryMeta, type SchoolHistory } from "../lib/history.ts";
import { lastPointMismatches } from "../scripts/history/build.mts";
import { gradByGroupMismatches } from "../scripts/history/graduation-groups.mts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const byId = (id: string) => structuredClone(schools.find((s) => s.unit_id === id)!);
const records = new Map(readRecords(join(ROOT, "data", "cds-records")).map((r) => [r.unit_id, r]));
const VANDERBILT = "221999";
const CORNELL = "190415";
const WM = "231624";
const ILLINOIS = "145637";
const doc = (id: string): DocumentRecord => structuredClone(records.get(id)!.documents[0]);
const years = federalYears(meta);
/** The federal baseline every check compares with. */
const baseline = (id: string) => restoreFederal(stripReported(byId(id)));
const setCell = (d: DocumentRecord, code: string, v: number) => {
  d.items[code as CdsCode] = { ...d.items[code as CdsCode], v, status: "passed" };
};

/* ------------------------------------------------------------------ */
/* 1. Checks and values from the four real records                     */
/* ------------------------------------------------------------------ */

test("parseRate reads every percent form colleges print, and a bare 1 only when the counts confirm it", () => {
  assert.equal(parseRate(0.886), 0.886);
  assert.equal(parseRate("88.6%"), 0.886);
  assert.equal(parseRate(88.6), 0.886);
  assert.equal(parseRate(63.73), 0.6373);
  assert.equal(parseRate("91%"), 0.91);
  assert.equal(parseRate(1), null);
  assert.equal(parseRate(1, 1), 1);
  assert.equal(parseRate(""), null);
  assert.equal(parseRate(140), null);
});

test("B1: Vanderbilt's rows add up; one changed cell fails rows-add-up", () => {
  const ok = checkB1(doc(VANDERBILT));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.values?.total, 7355);
  assert.equal(ok.values?.firstTime, 1635);
  const broken = doc(VANDERBILT);
  setCell(broken, "B.101", 760); // within ±1 is allowed (rounding); 8 students off is not
  assert.ok(checkB1(broken).problems.some((p) => p.check === "rows-add-up"));
});

test("B2: Illinois's column 3 fails column-3-not-all-undergrads while column 2 passes and publishes", () => {
  const d = doc(ILLINOIS);
  // The committed record already carries the checks track's verdict on column 3 (lib/cds-checks.ts marks B.221–B.230
  // failed); clear it so this module's own check is the one under test.
  for (const [code, it] of Object.entries(d.items)) {
    if (/^B\.2(2\d|30)$/.test(code) && it.status === "failed") Object.assign(it, { status: "passed", failures: undefined });
  }
  const r = checkB2(d, checkB1(d).values);
  assert.deepEqual(r.problems.map((p) => [p.group, p.check]), [["B2.all", "column-3-not-all-undergrads"]]);
  assert.ok(r.shares);
  assert.ok(Math.abs(Object.values(r.shares!).reduce((a, b) => a + b, 0) - 1) < 0.001);
  const found = studentBodyFromRecord(records.get(ILLINOIS)!, baseline(ILLINOIS)).found;
  assert.deepEqual(found.groups.race?.values["demographics.racial_diversity"], r.shares);
  // A column 2 that doesn't match B1's degree-seeking total publishes nothing from B2.
  const bad = doc(ILLINOIS);
  setCell(bad, "B.220", 30000);
  assert.ok(checkB2(bad, checkB1(bad).values).problems.some((p) => p.check === "column-2-not-degree-seeking"));
});

test("B22: Vanderbilt's 0.97 in the cohort cell fails count-not-integer; Cornell's counts give the rate", () => {
  const v = checkRetention(doc(VANDERBILT));
  assert.equal(v.value, null);
  assert.ok(v.problems.some((p) => p.check === "count-not-integer"));
  const c = checkRetention(doc(CORNELL));
  assert.deepEqual(c.problems, []);
  assert.deepEqual(c.value, { rate: 0.9782, cohort: 3525, retained: 3448, method: "derived" });
  // A stated rate that disagrees with the counts by more than half a point fails.
  const bad = doc(CORNELL);
  setCell(bad, "B.2203", 0.95);
  assert.ok(checkRetention(bad).problems.some((p) => p.check === "rate-mismatch"));
});

test("B4–B11: Vanderbilt's previous grid matches its IPEDS GR class; a perturbed one fails previous-cohort-disagrees", () => {
  const fed = baseline(VANDERBILT).outcomes;
  const r = checkGrid(doc(VANDERBILT), fed);
  assert.ok(!r.problems.some((p) => p.check === "previous-cohort-disagrees"));
  const broken = doc(VANDERBILT);
  setCell(broken, "B.509", 200); // previous grid, Pell final cohort (was 244 = IPEDS GR)
  setCell(broken, "B.501", 203);
  setCell(broken, "B.512", 1550);
  setCell(broken, "B.504", 1557);
  assert.ok(checkGrid(broken, fed).problems.some((p) => p.check === "previous-cohort-disagrees"));
});

test("B4–B11: the subsidized-loan group of 29 has no rates (cohort kept); 4 ≤ 5 ≤ 6 years", () => {
  const r = checkGrid(doc(VANDERBILT)); // no federal comparison: the arithmetic and values only
  assert.deepEqual(r.problems, []);
  assert.equal(r.value!.cohorts.loan_no_pell, 29);
  assert.equal(r.value!.six.loan_no_pell, null);
  assert.equal(r.value!.within_4.loan_no_pell, null);
  for (const g of ["pell", "no_pell_no_loan", "total"] as const) {
    const v = r.value!;
    assert.ok(v.within_4[g]! <= v.within_5[g]! && v.within_5[g]! <= v.six[g]!, g);
  }
  // Negative completers (an order failure) fail the grid.
  const bad = doc(CORNELL);
  setCell(bad, "B.417", -1);
  setCell(bad, "B.420", 228);
  setCell(bad, "B.425", 430);
  assert.equal(checkGrid(bad).value, null);
});

test("B4–B11: a current grid equal to the previous one holds the previous cohort, so it's not newer and replaces nothing", () => {
  const d = doc(WM);
  for (let i = 0; i < 32; i++) d.items[`B.${401 + i}` as CdsCode] = { ...d.items[`B.${501 + i}` as CdsCode] };
  const fed = baseline(WM);
  const r = checkGrid(d, fed.outcomes);
  assert.equal(r.value?.holdsPrevious, true);
  assert.equal(r.value?.entering_year, years.graduation);
  const rec: CollegeRecord = { unit_id: WM, documents: [d] };
  const found = studentBodyFromRecord(rec, fed).found;
  const applied = applyNewestGroups(fed, { groups: { graduation: found.groups.graduation } }, years);
  assert.strictEqual(applied, fed);
});

test("the value sets of the four colleges: what passes and what goes to review", () => {
  const got = Object.fromEntries([VANDERBILT, CORNELL, WM, ILLINOIS].map((id) => [id, Object.keys(studentBodyFromRecord(records.get(id)!, baseline(id)).found.groups).sort()]));
  assert.deepEqual(got, {
    [VANDERBILT]: ["enrollment", "race"], // B22 count-not-integer; Pell cohort 270 vs federal 244 (> 10%): review
    [CORNELL]: ["enrollment", "graduation", "race", "retention"],
    [WM]: ["enrollment", "race", "retention"], // loan group cohort 178 vs federal 229: review
    [ILLINOIS]: ["enrollment", "race", "retention"], // Pell cohort 2,160 vs federal 1,913: review
  });
  const v = studentBodyFromRecord(records.get(VANDERBILT)!, baseline(VANDERBILT)).found.groups.enrollment!;
  assert.deepEqual(v.values, { "demographics.undergrad_enrollment": 7355, "demographics.men_share": 0.4714, "demographics.women_share": 0.5286, "demographics.part_time_share": 0.0068 });
  assert.equal(v.lineage["demographics.undergrad_enrollment"]?.year, "Fall 2025");
  assert.equal(v.lineage["demographics.undergrad_enrollment"]?.edition, "2025–26");
});

/* ------------------------------------------------------------------ */
/* 2. The newest groups: apply and restore                             */
/* ------------------------------------------------------------------ */

const rec = (year: string): LineageRecord => ({ source: "college-site", method: "derived", year, edition: "2025–26", url: "https://example.edu/cds.xlsx", retrieved: "2026-10-03", quote: "Total | 1" });

/** Every group found, one year newer than federal (or `delta` years). */
function foundFor(s: School, delta = 1): FoundValues {
  const y = (k: keyof typeof years) => years[k]! + delta;
  return {
    groups: {
      enrollment: { key: "enrollment", year: y("enrollment"), values: { "demographics.undergrad_enrollment": 1000, "demographics.men_share": 0.4, "demographics.women_share": 0.6, "demographics.part_time_share": 0.01 }, lineage: Object.fromEntries(NEWEST_GROUPS[0].targets.map((t) => [t, rec(`Fall ${y("enrollment")}`)])) },
      race: { key: "race", year: y("race"), values: { "demographics.racial_diversity": { asian: 0.1, black: 0.1, hispanic: 0.1, white: 0.5, two_or_more: 0.1, international: 0.05, other: 0.05 } }, lineage: { "demographics.racial_diversity": rec(`Fall ${y("race")}`) } },
      retention: { key: "retention", year: y("retention"), values: { "outcomes.retention_rate": 0.9 }, lineage: { "outcomes.retention_rate": rec(`Entered fall ${y("retention")}`) } },
      graduation: {
        key: "graduation",
        year: y("graduation"),
        values: { "outcomes.grad_cohorts": { pell: 100, loan_no_pell: 20, no_pell_no_loan: 300, total: 420 }, "outcomes.grad_rate_pell": 0.8, "outcomes.grad_rate_loan_no_pell": null, "outcomes.grad_rate_no_pell_no_loan": 0.9, "outcomes.grad_rate_ftft": 0.87 },
        lineage: { "outcomes.grad_cohorts": rec(`Entered fall ${y("graduation")}`) },
      },
    },
    graduation: { value: { entering_year: y("graduation"), within_4: { pell: 0.6, loan_no_pell: null, no_pell_no_loan: 0.7, total: 0.68 }, within_5: { pell: 0.75, loan_no_pell: null, no_pell_no_loan: 0.85, total: 0.82 } }, lineage: rec(`Entered fall ${y("graduation")}`) },
  };
}

/** A federal-only college (no lineage at all). */
const plain = () => restoreFederal(stripReported(structuredClone(schools.find((s) => !s.lineage && s.outcomes?.grad_cohorts && s.demographics.racial_diversity)!)));

test("each group replaces when newer, keeping the federal values; the school passes the lineage check", () => {
  const before = plain();
  const s = applyNewestGroups(before, foundFor(before), years);
  assert.equal(s.demographics.undergrad_enrollment, 1000);
  assert.equal(s.demographics.federal?.undergrad_enrollment, before.demographics.undergrad_enrollment);
  assert.equal(s.demographics.federal?.year, years.enrollment);
  assert.equal(s.outcomes?.retention_rate, 0.9);
  assert.deepEqual(s.outcomes?.federal?.retention, { entering_year: years.retention, retention_rate: before.outcomes!.retention_rate });
  assert.equal(s.outcomes?.grad_rate_pell, 0.8);
  assert.equal(s.outcomes?.federal?.graduation?.grad_rate_pell, before.outcomes!.grad_rate_pell ?? null);
  assert.equal(s.reported?.outcomes?.graduation?.within_4.pell, 0.6);
  assert.deepEqual(validateSchool(s, meta), []);
});

test("a tie goes to federal: a CDS year equal to the federal year replaces nothing", () => {
  const before = plain();
  const f = foundFor(before, 0);
  delete f.graduation;
  assert.strictEqual(applyNewestGroups(before, f, years), before);
});

test("atomic: a group missing one target's value replaces none of them", () => {
  const before = plain();
  const f = foundFor(before);
  delete f.groups.enrollment!.values["demographics.part_time_share"];
  const s = applyNewestGroups(before, f, years);
  assert.equal(s.demographics.undergrad_enrollment, before.demographics.undergrad_enrollment);
  assert.equal(s.demographics.men_share, before.demographics.men_share);
  assert.equal(s.demographics.racial_diversity?.white, 0.5, "race is its own group and still replaces");
});

test("a target with an existing lineage record (a value from anywhere but federal) is left alone", () => {
  const before = plain();
  before.lineage = { "outcomes.retention_rate": { source: "cds", year: "2024-25", url: "https://example.edu/cds.xlsx" } };
  const s = applyNewestGroups(before, foundFor(before), years);
  assert.equal(s.outcomes?.retention_rate, before.outcomes!.retention_rate);
  assert.equal(s.outcomes?.federal?.retention, undefined);
});

test("restoreFederal (and restoreNewestGroups) put back exactly what was there, byte for byte; applying twice changes nothing", () => {
  const before = plain();
  const s = applyNewestGroups(before, foundFor(before), years);
  assert.equal(JSON.stringify(restoreNewestGroups(s)), JSON.stringify(before));
  assert.equal(JSON.stringify(restoreFederal(s)), JSON.stringify(before));
  assert.strictEqual(applyNewestGroups(s, foundFor(before), years), s);
  // The real colleges too: restoring a merged college gives its committed federal baseline.
  for (const id of [VANDERBILT, CORNELL, WM, ILLINOIS]) {
    const merged = byId(id);
    assert.ok(merged.demographics.federal, id);
    const r = restoreNewestGroups(merged);
    assert.equal(r.demographics.undergrad_enrollment, merged.demographics.federal!.undergrad_enrollment);
    // deepEqual, not a string comparison: the committed college also carries the wave-4 blocks the later record steps
    // add (lib/reported-merge.ts RECORD_STEPS), so re-applying the groups alone moves keys without changing values.
    assert.deepEqual(applyNewestGroups(r, studentBodyFromRecord(records.get(id)!, restoreFederal(r)).found, years), merged, id);
  }
});

/* ------------------------------------------------------------------ */
/* 3. The lineage guard, rules 1–9, and citations                      */
/* ------------------------------------------------------------------ */

const applied = () => {
  const b = plain();
  return applyNewestGroups(b, foundFor(b), years);
};
const errs = (s: School) => validateSchool(s, meta).join("\n");

test("rule 1: a college-cited target is extracted or derived and names its document and edition", () => {
  const s = applied();
  s.lineage!["demographics.men_share"] = { ...s.lineage!["demographics.men_share"]!, method: "reported" };
  assert.match(errs(s), /men_share cites the college's document, so it must be extracted or derived/);
  const t = applied();
  delete t.lineage!["outcomes.retention_rate"]!.edition;
  assert.match(errs(t), /retention_rate cites the college's document but lacks quote, url, retrieved, year, or edition/);
});

test("rule 2: a college-cited target needs its container", () => {
  const s = applied();
  delete s.outcomes!.federal!.retention;
  assert.match(errs(s), /retention values cite the college's document, but outcomes\.federal\.retention doesn't keep/);
});

test("rule 3: the college's year must be newer than the federal year it replaced", () => {
  const s = applied();
  s.demographics.federal!.year = years.enrollment! + 1;
  assert.match(errs(s), /enrollment from the college \(Fall \d{4}\) isn't newer than the federal year/);
});

test("rule 4: a group is replaced whole, with one year (a mixed graduation group fails)", () => {
  const s = applied();
  s.lineage!["outcomes.grad_rate_pell"] = { source: "ipeds-gr" };
  assert.match(errs(s), /graduation is replaced in part/);
  const t = applied();
  t.lineage!["demographics.part_time_share"] = { ...t.lineage!["demographics.part_time_share"]!, year: "Fall 2031" };
  assert.match(errs(t), /enrollment values describe different years/);
});

test("rule 5: a value that differs from its kept federal value must be cited to the college", () => {
  const s = applied();
  for (const t of NEWEST_GROUPS[2].targets) delete s.lineage![t];
  assert.match(errs(s), /outcomes\.retention_rate differs from outcomes\.federal\.retention\.retention_rate but isn't cited/);
});

test("rule 6: no container without a replacement", () => {
  const s = plain();
  s.outcomes!.federal = { retention: { entering_year: years.retention, retention_rate: s.outcomes!.retention_rate } };
  assert.match(errs(s), /outcomes\.federal\.retention is kept, but the retention rate wasn't replaced/);
});

test("rule 7: men and women from the college add up to 1", () => {
  const s = applied();
  s.demographics.women_share = 0.5;
  assert.match(errs(s), /men_share \+ women_share from the college must add to 1/);
});

test("rule 8: the 4- and 5-year shares describe the class of the six-year rates beside them", () => {
  const s = applied();
  s.reported!.outcomes!.graduation!.entering_year = years.graduation!;
  assert.match(errs(s), /reported\.outcomes\.graduation describes the class that entered in/);
});

test("rule 9: an override can't set a newest group's path; check:lineage's override check fails", () => {
  const patch = { cds: { edition: "2024-25", url: "https://example.edu/cds.xlsx" }, demographics: { racial_diversity: { asian: 0.2, white: 0.8 } } };
  assert.throws(() => lineageForPatch("1", patch), /comes from the college's CDS record/);
  assert.match(validateOverrides({ "1": patch }).join("\n"), /demographics\.racial_diversity/);
  assert.deepEqual(validateOverrides(JSON.parse(readFileSync(join(ROOT, "data", "overrides.json"), "utf8"))), []);
});

test("citations: race's replaced value is the federal object with its fall; graduation rates cite the anchor's edition", () => {
  const s = byId(CORNELL);
  const race = lineageFor("demographics.racial_diversity", s, meta);
  assert.equal(race.key, "college-site");
  assert.equal(race.sourceKind, "cds");
  assert.equal(race.cdsEdition, "2025–26");
  assert.deepEqual(race.replaces, { value: s.demographics.federal!.racial_diversity, year: `Fall ${s.demographics.federal!.year}` });
  const pell = lineageFor("outcomes.grad_rate_pell", s, meta);
  assert.equal(pell.key, "college-site");
  assert.equal(pell.cdsEdition, "2025–26");
  assert.deepEqual(pell.replaces, { value: s.outcomes!.federal!.graduation!.grad_rate_pell, year: meta.vintages["ipeds-gr"] });
  // The 4-year shares and a value calculated from a replaced group name the same document.
  assert.equal(lineageFor("reported.outcomes.graduation", s, meta).cdsEdition, "2025–26");
  assert.equal(lineageFor("derived.diversity_index", byId(VANDERBILT), meta).sourceKind, "cds");
  assert.equal(lineageFor("derived.diversity_index", byId(VANDERBILT), meta).replaces, undefined);
  // Illinois's newer admit rate is from its class profile, but its enrollment is from its CDS.
  assert.equal(lineageFor("demographics.undergrad_enrollment", byId(ILLINOIS), meta).sourceKind, "cds");
  // A federal value names no replacement.
  assert.equal(lineageFor("outcomes.retention_rate", byId(VANDERBILT), meta).replaces, undefined);
  assert.equal(lineageFor("outcomes.retention_rate", byId(VANDERBILT), meta).year, meta.vintages["scorecard-retention"]);
});

/* ------------------------------------------------------------------ */
/* 4. The merge and the former overrides                               */
/* ------------------------------------------------------------------ */

test("the 8 former override colleges have federal enrollment and race baselines; the records replace them where newer", () => {
  const overrides = JSON.parse(readFileSync(join(ROOT, "data", "overrides.json"), "utf8")) as Record<string, Record<string, unknown>>;
  const ids = Object.keys(overrides).filter((k) => !k.startsWith("_"));
  assert.equal(ids.length, 8);
  for (const id of ids) {
    assert.equal(overrides[id].demographics, undefined, id);
    const s = byId(id);
    for (const p of ["demographics.undergrad_enrollment", "demographics.racial_diversity"] as const) {
      const src = s.lineage?.[p]?.source;
      assert.ok(src === undefined || src === "college-site", `${id} ${p}: ${src}`);
    }
  }
  const c = byId(CORNELL);
  assert.equal(c.demographics.undergrad_enrollment, 15979); // B1 degree-seeking, not B.176's 16,138
  assert.equal(c.demographics.federal?.year, years.enrollment);
});

test("import-cds no longer writes B1/B2", () => {
  const src = readFileSync(join(ROOT, "scripts", "import-cds.mts"), "utf8");
  assert.doesNotMatch(src, /patch\.demographics|racial_diversity|undergrad_enrollment/);
});

/* ------------------------------------------------------------------ */
/* 5. History: rule 1 against the kept federal values                  */
/* ------------------------------------------------------------------ */

test("history rule 1 compares a replaced college's men_share and grad_rate_pell with the kept federal values", () => {
  const HISTORY = join(ROOT, "data", "history");
  const hmeta: HistoryMeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8"));
  const shard = (id: string): SchoolHistory => JSON.parse(readFileSync(join(HISTORY, "schools", `${id}.json`), "utf8"));
  const c = byId(CORNELL);
  const histories = new Map([[CORNELL, shard(CORNELL)]]);
  const only = (l: string[], key: string) => l.filter((m) => m.includes(` ${key}:`));
  assert.deepEqual(only(lastPointMismatches([c], histories, hmeta.latest), "men_share"), []);
  // The newest class any college's history reaches is the one the snapshot's federal file describes.
  const all = new Map(readdirSync(join(HISTORY, "schools")).slice(0, 300).map((f) => [f.replace(/\.json$/, ""), shard(f.replace(/\.json$/, ""))]));
  all.set(CORNELL, shard(CORNELL));
  assert.equal(lastYear(shard(CORNELL).series.grad_rate_pell!), hmeta.latest.cohort);
  assert.deepEqual(gradByGroupMismatches([c], all), []);
  // Compare with the shown (CDS) value instead and rule 1 fails: the kept value is what's checked.
  const shown = structuredClone(c);
  shown.demographics.federal!.men_share = shown.demographics.men_share!;
  assert.equal(only(lastPointMismatches([shown], histories, hmeta.latest), "men_share").length, 1);
  const shownGrad = structuredClone(c);
  shownGrad.outcomes!.federal!.graduation!.grad_rate_pell = shownGrad.outcomes!.grad_rate_pell!;
  assert.ok(gradByGroupMismatches([shownGrad], all).some((m) => m.includes("grad_rate_pell")));
});

/* ------------------------------------------------------------------ */
/* 6. The diversity indicator names its end fall                       */
/* ------------------------------------------------------------------ */

test("the diversity detail names its end fall only when demographics.federal exists", () => {
  const s = schools.find((x) => x.trends?.diversity && x.demographics.federal)!;
  const i = indicatorOf(s, "diversity")!;
  assert.match(detailText(i), new RegExp(`\\(to fall ${s.demographics.federal!.year}\\)$`));
  const plainSchool = schools.find((x) => x.trends?.diversity && !x.demographics.federal)!;
  assert.doesNotMatch(detailText(indicatorOf(plainSchool, "diversity")!), /to fall/);
});
