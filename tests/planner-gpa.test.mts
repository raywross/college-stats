/**
 * The plan's GPA (specs/planner/redesign/gpa.md; lib/planner/gpa-model.ts, standing.ts, student-profile.ts): the
 * model's fit and guard, the college's GPA source order, the range comparison, every sentence, and the student's
 * range. Pure, plus one read of data/schools.json for the real fit. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bandMean,
  collegeGpa,
  compareGpaRanges,
  fitGpaModel,
  GPA_MODEL_GUARD,
  gpaCites,
  gpaModelFormula,
  predictGpa,
  satMidpoint,
  trainingRow,
  trainingRows,
  type GpaModel,
  type GpaRow,
} from "../lib/planner/gpa-model.ts";
import { STANDING, standingFor, type StandingSchool, type StandingStudent } from "../lib/planner/standing.ts";
import { emptyProfile, planGpaLabel, planGpaRange, unweightedGpa4, type GpaScale } from "../lib/student-profile.ts";
import type { GpaBands, School } from "../lib/types.ts";

/* Fixtures */

/** A deterministic spread of colleges: SAT 1000–1500, admit rate 10%–95%. */
function synthetic(n: number, coef: [number, number, number], noise: (i: number) => number): GpaRow[] {
  return Array.from({ length: n }, (_, i) => {
    const sat = 1000 + ((i * 137) % 500);
    const rate = 0.1 + ((i * 61) % 85) / 100;
    return { sat, rate, gpa: coef[0] + coef[1] * (sat / 100) + coef[2] * rate + noise(i) };
  });
}

const MODEL: GpaModel = { coef: [3.0, 0.067, -0.35], n: 36, meanError: 0.1, p90Error: 0.18 };

type GpaBlock = NonNullable<NonNullable<NonNullable<School["reported"]>["admission_profile"]>["gpa"]>;
const bands9 = (...shares: number[]) => shares as GpaBands;
/** A college with optional SAT sections, ACT, admit rate, and C11/C12 GPA. */
function college(o: { sat?: [number, number]; act?: [number, number]; rate?: number | null; gpa?: Partial<GpaBlock> } = {}): School {
  const half = o.sat ? ([o.sat[0] / 2, o.sat[1] / 2] as [number, number]) : null;
  return {
    admissions: { sat_reading_25_75: half, sat_math_25_75: half, act_composite_25_75: o.act ?? null, acceptance_rate: o.rate === undefined ? 0.5 : o.rate },
    reported: o.gpa
      ? { admission_profile: { gpa: { average: null, scale: "not_stated", submitted_share: null, bands: { all: null, with_test: null, without_test: null }, ...o.gpa } } }
      : undefined,
    lineage: {},
  } as unknown as School;
}

/* The model */

test("the fit recovers the coefficients of synthetic data", () => {
  const rows = synthetic(40, [3.0, 0.067, -0.35], (i) => ((i % 5) - 2) * 0.01);
  const m = fitGpaModel(rows);
  assert.ok(m);
  assert.ok(Math.abs(m.coef[0] - 3.0) < 0.05, `intercept ${m.coef[0]}`);
  assert.ok(Math.abs(m.coef[1] - 0.067) < 0.005, `SAT ${m.coef[1]}`);
  assert.ok(Math.abs(m.coef[2] + 0.35) < 0.03, `admit rate ${m.coef[2]}`);
  assert.equal(m.n, 40);
  assert.ok(m.meanError < 0.03 && m.p90Error < 0.04);
  // Exact data: no miss at all.
  const exact = fitGpaModel(synthetic(30, [2.5, 0.08, -0.2], () => 0))!;
  assert.ok(exact.p90Error < 1e-9);
  assert.ok(Math.abs(predictGpa(exact, 1300, 0.4) - (2.5 + 0.08 * 13 - 0.2 * 0.4)) < 1e-9);
});

test("predictions are clamped to 2.0–4.0", () => {
  assert.equal(predictGpa(MODEL, 2400, 0), 4);
  assert.equal(predictGpa(MODEL, 0, 5), 2);
});

test("the guard: fewer than 25 rows, or a 90th-percentile miss above 0.25, gives no model", () => {
  assert.deepEqual(GPA_MODEL_GUARD, { minRows: 25, maxP90: 0.25 });
  const clean = (n: number) => synthetic(n, [3.0, 0.067, -0.35], (i) => ((i % 3) - 1) * 0.01);
  assert.equal(fitGpaModel(clean(24)), null, "24 rows");
  assert.ok(fitGpaModel(clean(25)), "25 rows");
  const noisy = synthetic(40, [3.0, 0.067, -0.35], (i) => (i % 2 ? 0.6 : -0.6) * ((i % 7) / 6));
  assert.equal(fitGpaModel(noisy), null, "a large miss");
  // Breaking the guard on purpose lets both through, so it is the guard (not the fit) that refuses them.
  const open = { minRows: 0, maxP90: Infinity };
  assert.ok(fitGpaModel(clean(24), open));
  const loose = fitGpaModel(noisy, open);
  assert.ok(loose && loose.p90Error > GPA_MODEL_GUARD.maxP90);
});

test("the real dataset: the model passes its guard and never trains on weighted reporters", () => {
  const schools = JSON.parse(readFileSync(new URL("../data/schools.json", import.meta.url), "utf8")) as School[];
  const rows = trainingRows(schools);
  const m = fitGpaModel(rows);
  assert.ok(m, "the guard refused the real fit");
  assert.ok(m.n >= 25, `n = ${m.n}`);
  assert.ok(m.p90Error <= 0.25, `p90 = ${m.p90Error}`);
  const weighted = schools.filter((s) => {
    const g = s.reported?.admission_profile?.gpa;
    return g && (g.scale === "weighted" || (g.average ?? 0) > 4);
  });
  assert.ok(weighted.length > 0, "the dataset has weighted reporters to exclude");
  for (const s of weighted) assert.equal(trainingRow(s), null, `${s.name} is weighted but trains the model`);
  // Every training row is a college whose own GPA is a usable average or band mean.
  for (const s of schools) {
    const row = trainingRow(s);
    if (row) assert.ok(["reported", "bands"].includes(collegeGpa(s, m).kind), s.name);
  }
});

test("bandMean: band midpoints over the shares' total; the 'all' column, else 'with test'; half-blank is no mean", () => {
  const all = bands9(0.5, 0.5, 0, 0, 0, 0, 0, 0, 0);
  assert.equal(bandMean({ all, with_test: null }), (4.0 + 3.875) / 2);
  assert.equal(bandMean({ all: null, with_test: bands9(0, 0, 1, 0, 0, 0, 0, 0, 0) }), 3.625);
  assert.equal(bandMean({ all: bands9(0, 0, 0, 0, 0.25, 0.25, 0, 0, 0), with_test: null }), (3.125 + 2.75) / 2, "divided by the shares' total");
  assert.equal(bandMean({ all: bands9(0.2, 0.2, 0, 0, 0, 0, 0, 0, 0), with_test: null }), null);
  assert.equal(bandMean({ all: bands9(0.2, 0.2, 0, 0, 0, 0, 0, 0, 0), with_test: bands9(0, 0, 0, 1, 0, 0, 0, 0, 0) }), 3.375);
  assert.equal(bandMean(null), null);
});

test("satMidpoint: the SAT total's middle, else the ACT's through the concordance", () => {
  assert.equal(satMidpoint(college({ sat: [1200, 1400] })), 1300);
  assert.equal(satMidpoint(college({ act: [28, 32] })), 1370); // ACT 30
  assert.equal(satMidpoint(college({ act: [28, 31] })), (1340 + 1370) / 2); // 29.5: between ACT 29 and 30
  assert.equal(satMidpoint(college({})), null);
});

/* The college's GPA, source order */

test("collegeGpa: reported, then bands, then the bounded estimate, then the estimate, then none", () => {
  const bands = { all: bands9(0, 0.5, 0.5, 0, 0, 0, 0, 0, 0), with_test: null, without_test: null };
  const scores = { sat: [1200, 1400] as [number, number], rate: 0.5 };
  const est = predictGpa(MODEL, 1300, 0.5);

  // 1. Unweighted, or not stated and at most 4.0: the value as a point.
  assert.deepEqual(collegeGpa(college({ ...scores, gpa: { average: 3.88, scale: "unweighted", bands } }), MODEL), { kind: "reported", range: [3.88, 3.88], point: 3.88, weighted: null, n: null });
  assert.equal(collegeGpa(college({ gpa: { average: 3.6, scale: "not_stated" } }), MODEL).kind, "reported");

  // 2. No usable average, bands present, not weighted: the band mean ± 0.05.
  const b = collegeGpa(college({ ...scores, gpa: { average: null, bands } }), MODEL);
  assert.equal(b.kind, "bands");
  assert.equal(b.point, 3.75);
  assert.deepEqual(b.range!.map((x) => +x.toFixed(4)), [3.7, 3.8]);

  // 3. Marked weighted (or above 4.0): the estimate, cut to [w − 1, min(4, w)]; the weighted bands are never read.
  const w = collegeGpa(college({ ...scores, gpa: { average: 4.17, scale: "weighted", bands } }), MODEL);
  assert.equal(w.kind, "estimated");
  assert.equal(w.weighted, 4.17);
  assert.equal(w.n, MODEL.n);
  assert.ok(w.range![0] >= 3.17 - 1e-9 && w.range![1] <= 4, "inside the weighted bound");
  assert.equal(collegeGpa(college({ ...scores, gpa: { average: 4.3, scale: "not_stated" } }), MODEL).weighted, 4.3, "above 4.0 is weighted");
  // A low weighted average cuts the estimate's top: unweighted can't be above the weighted.
  const low = collegeGpa(college({ sat: [1400, 1500], rate: 0.2, gpa: { average: 3.5, scale: "weighted" } }), MODEL);
  assert.ok(low.range![1] <= 3.5 + 1e-9 && low.point! <= 3.5 + 1e-9);

  // 4. No CDS GPA: the estimate ± the model's 90th-percentile miss.
  const e = collegeGpa(college(scores), MODEL);
  assert.equal(e.kind, "estimated");
  assert.equal(e.point, est);
  assert.deepEqual(e.range, [est - MODEL.p90Error, est + MODEL.p90Error]);
  assert.equal(e.weighted, null);

  // 5. None: no model (the guard refused it), no scores, or no admit rate.
  assert.equal(collegeGpa(college(scores), null).kind, "none");
  assert.equal(collegeGpa(college({ rate: 0.5 }), MODEL).kind, "none");
  assert.equal(collegeGpa(college({ sat: [1200, 1400], rate: null }), MODEL).kind, "none");
  const wNone = collegeGpa(college({ gpa: { average: 4.4, scale: "weighted" } }), MODEL);
  assert.deepEqual([wNone.kind, wNone.weighted], ["none", 4.4], "weighted with nothing to estimate from");
});

test("gpaCites: the field each source's sentence cites; an estimate carries the fitted formula", () => {
  const cite = (path: string) => ({ path, formula: "registry" });
  const c = college({ sat: [1200, 1400], rate: 0.5 });
  assert.deepEqual(Object.keys(gpaCites(c, collegeGpa(c, MODEL), MODEL, cite)), ["derived.gpa_estimate"]);
  const formula = (gpaCites(c, collegeGpa(c, MODEL), MODEL, cite)["derived.gpa_estimate"] as { formula: string }).formula;
  assert.equal(formula, gpaModelFormula(MODEL));
  assert.match(formula, /3\.00 \+ 0\.067 × \(SAT midpoint ÷ 100\) − 0\.35 × admit rate/);
  assert.match(formula, /36 colleges/);
  assert.match(formula, /0\.10 .*0\.18/);
  const r = college({ gpa: { average: 3.7 } });
  assert.deepEqual(Object.keys(gpaCites(r, collegeGpa(r, MODEL), MODEL, cite)), ["reported.admission_profile.gpa.average"]);
  const b = college({ gpa: { bands: { all: bands9(1, 0, 0, 0, 0, 0, 0, 0, 0), with_test: null, without_test: null } } });
  assert.deepEqual(Object.keys(gpaCites(b, collegeGpa(b, MODEL), MODEL, cite)), ["derived.gpa_band_mean"]);
  assert.deepEqual(gpaCites(college({}), collegeGpa(college({}), MODEL), MODEL, cite), {});
});

/* Comparing two ranges */

test("compareGpaRanges: above, below, in, and can't tell", () => {
  const band = STANDING.gpaBand;
  assert.equal(compareGpaRanges([3.9, 3.9], [3.6, 3.7], band), "above");
  assert.equal(compareGpaRanges([3.3, 3.3], [3.5, 3.6], band), "below");
  assert.equal(compareGpaRanges([3.8, 3.8], [3.7, 3.9], band), "in");
  assert.equal(compareGpaRanges([3.4, 4.0], [3.7, 3.9], band), null, "a weighted student's range spans the college's");
  assert.equal(compareGpaRanges([3.4, 4.0], [3.0, 3.1], band), "above", "even the low end clears it");
});

test("for two points the range comparison is the original rule exactly", () => {
  const original = (s: number, c: number) => {
    const d = s - c;
    return d > STANDING.gpaBand ? "above" : d < -STANDING.gpaBand ? "below" : "in";
  };
  for (let s = 2.0; s <= 4.0001; s += 0.01) {
    for (let c = 2.5; c <= 4.0001; c += 0.01) {
      const sv = +s.toFixed(2);
      const cv = +c.toFixed(2);
      assert.equal(compareGpaRanges([sv, sv], [cv, cv], STANDING.gpaBand), original(sv, cv), `${sv} vs ${cv}`);
    }
  }
  // And through standingFor: a point range and a reported point give what gpaAverage alone gives.
  const base: StandingSchool = { admitRate: 0.45, sat: [1280, 1450], act: null, gpaAverage: 3.75, testPolicy: "considered" };
  for (const g of [3.4, 3.59, 3.6, 3.75, 3.9, 3.91, 4.0]) {
    const before = standingFor({ gpa: g, test: { kind: "sat", score: 1300 } }, base);
    const after = standingFor(
      { gpa: g, gpaRange: [g, g], test: { kind: "sat", score: 1300 } },
      { ...base, gpa: collegeGpa(college({ gpa: { average: 3.75, scale: "unweighted" } }), MODEL) },
    );
    assert.equal(after.gpa, before.gpa, `GPA ${g}`);
    assert.equal(after.fit, before.fit, `GPA ${g}`);
  }
});

/* The sentences */

const noTest: Pick<StandingStudent, "test"> = { test: null };
const satStudent = (gpa: number, extra: Partial<StandingStudent> = {}): StandingStudent => ({ gpa, test: { kind: "sat", score: 1300 }, ...extra });
const at = (gpa: StandingSchool["gpa"], over: Partial<StandingSchool> = {}): StandingSchool => ({ admitRate: 0.5, sat: [1200, 1400], act: null, gpaAverage: null, gpa, testPolicy: "required", ...over });
const kindOf = (kind: "reported" | "bands" | "estimated", range: [number, number], point: number, weighted: number | null = null) => ({ kind, range, point, weighted, n: kind === "estimated" ? 36 : null });

test("sentence: reported", () => {
  const r = standingFor(satStudent(3.82), at(kindOf("reported", [3.88, 3.88], 3.88)));
  assert.equal(r.gpaNote?.text, "Your GPA (3.82) is close to the 3.88 average of enrolled students.");
  assert.equal(r.gpaNote?.cite, "reported.admission_profile.gpa.average");
});

test("sentence: bands", () => {
  // gpa.md's example reads 3.82, but against 3.60–3.70 that lands between "in" and "above" (can't tell); 3.92 is above.
  const r = standingFor(satStudent(3.92), at(kindOf("bands", [3.6, 3.7], 3.65)));
  assert.equal(r.gpaNote?.text, "Your GPA (3.92) is above the 3.65 average of enrolled students, figured from the college's GPA ranges.");
  assert.equal(r.gpaNote?.cite, "derived.gpa_band_mean");
});

test("sentence: estimated", () => {
  const r = standingFor(satStudent(3.82), at(kindOf("estimated", [3.7, 3.9], 3.8)));
  assert.equal(
    r.gpaNote?.text,
    "Your GPA (3.82) is close to the 3.7–3.9 typical of colleges with similar test scores and admit rates. This college doesn't publish an unweighted average, so this is an estimate.",
  );
  assert.equal(r.gpaNote?.cite, "derived.gpa_estimate");
});

test("sentence: weighted, bounded", () => {
  const r = standingFor(satStudent(3.82), at(kindOf("estimated", [3.7, 3.9], 3.8, 4.17)));
  assert.equal(
    r.gpaNote?.text,
    "Your GPA (3.82) is close to the 3.7–3.9 typical of colleges with similar test scores and admit rates. This college publishes only a weighted average (4.17), so this is an estimate.",
  );
  assert.equal(r.gpaNote?.cite, "derived.gpa_estimate");
});

test("sentence: can't tell, and the score decides", () => {
  const student = satStudent(3.8, { gpaRange: [3.4, 4.0], gpaLabel: "about 3.4–4.0 unweighted (from a weighted 4.4)" });
  const r = standingFor(student, at(kindOf("estimated", [3.7, 3.9], 3.8)));
  assert.equal(r.gpa, null);
  assert.equal(
    r.gpaNote?.text,
    "Your GPA can't be placed against this college's: yours (3.4–4.0) and its estimate (3.7–3.9) overlap too much to say which is higher. Your SAT decides the group here.",
  );
  assert.equal(r.fit, "target", "the SAT (inside) decides");
});

test("sentence: none", () => {
  const none = { kind: "none" as const, range: null, point: null, weighted: null, n: null };
  const r = standingFor(satStudent(3.82), at(none));
  assert.equal(r.gpaNote?.text, "This college doesn't publish a GPA average, and there aren't enough test scores to estimate one, so only your SAT is used.");
  assert.equal(r.gpaNote?.cite, null);
  const alone = standingFor({ gpa: 3.82, ...noTest }, at(none, { sat: null }));
  assert.match(alone.gpaNote!.text, /so your GPA isn't used here\.$/);
  const w = standingFor(satStudent(3.82), at({ ...none, weighted: 4.4 }));
  assert.match(w.gpaNote!.text, /^This college publishes only a weighted average \(4\.4\), which can't be compared with yours/);
});

test("sentence: the student's weighted GPA is shown as its unweighted range", () => {
  const student = satStudent(3.5, { gpaRange: [3.4, 4.0], gpaLabel: "about 3.4–4.0 unweighted (from a weighted 4.4)" });
  const r = standingFor(student, at(kindOf("reported", [3.1, 3.1], 3.1)));
  assert.equal(r.gpaNote?.text, "Your GPA, about 3.4–4.0 unweighted (from a weighted 4.4), is above the 3.10 average of enrolled students.");
});

test("every row whose student has a GPA gets exactly one GPA sentence; none without a GPA", () => {
  const schools: StandingSchool[] = [
    at(kindOf("reported", [3.88, 3.88], 3.88)),
    at(kindOf("bands", [3.6, 3.7], 3.65)),
    at(kindOf("estimated", [3.5, 3.9], 3.7)),
    at({ kind: "none", range: null, point: null, weighted: null, n: null }),
    at(undefined, { admitRate: null }),
    at(undefined, { admitRate: 0.05, gpaAverage: 3.9 }),
    at(undefined, { testPolicy: "not-considered" }),
  ];
  const gpaSentence = /GPA|grade/;
  for (const s of schools) {
    const r = standingFor(satStudent(3.82), s);
    assert.ok(r.gpaNote);
    assert.equal(r.reasons.filter((x) => gpaSentence.test(x) || x.startsWith("This college doesn't publish a GPA")).length, 1, JSON.stringify(r.reasons));
    assert.equal(r.reasons.at(-1), r.gpaNote.text, "the GPA sentence ends the reasons");
    assert.equal(standingFor({ gpa: null, test: { kind: "sat", score: 1300 } }, s).gpaNote, null);
  }
});

/* The student's range */

const academics = (gpa: number | null, gpaScale: GpaScale) => ({ ...emptyProfile(), academics: { ...emptyProfile().academics, gpa, gpaScale } });

test("planGpaRange: unweighted, above 4.0 on the 4.0 scale, weighted, 100-point", () => {
  assert.deepEqual(planGpaRange(academics(3.82, "4.0")), [3.82, 3.82]);
  assert.equal(planGpaLabel(academics(3.82, "4.0")), "3.82");
  const over = planGpaRange(academics(4.4, "4.0"))!;
  assert.deepEqual(over.map((x) => +x.toFixed(4)), [3.4, 4.0]);
  assert.equal(planGpaLabel(academics(4.4, "4.0")), "about 3.4–4.0 unweighted (from a weighted 4.4)");
  const w = planGpaRange(academics(4.4, "5.0"))!;
  assert.deepEqual(w.map((x) => +x.toFixed(4)), [3.4, 4.0]);
  assert.deepEqual(planGpaRange(academics(3.6, "5.0"))!.map((x) => +x.toFixed(4)), [2.6, 3.6], "min(4, w) on top");
  assert.deepEqual(planGpaRange(academics(0.5, "5.0")), [0, 0.5], "never below 0");
  assert.deepEqual(planGpaRange(academics(93, "100")), [3.7, 3.7]);
  assert.equal(planGpaLabel(academics(93, "100")), "about 3.7 unweighted (from 93/100)");
  assert.equal(planGpaRange(academics(null, "4.0")), null);
  assert.equal(planGpaRange(null), null);
  // Other tools keep unweightedGpa4.
  assert.equal(unweightedGpa4(4.4, "4.0"), 4.0);
  assert.equal(unweightedGpa4(4.5, "5.0"), 3.6);
});
