/**
 * How the cost curve is worded (specs/product/cost-by-income.md "Wording", "Tests"; lib/cost-display.ts): figures
 * rounded (incomes to $10K, prices to $1K), ranges for modeled prices, and the guard that no estimated figure renders
 * without the word "estimate" beside it. `npm test`. The guard checks every sentence the curve, slider, facts row,
 * table and card show, across every college and a spread of incomes, and reads the components' sources to make sure
 * they print phrases as given. Each guard has a "guard:" test that feeds it a broken input to show it fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEDERAL_TOP, INCOME_MAX, costCurve, costCurveInput, priceAt, type CostCurve, type PriceKind } from "../lib/cost-curve.ts";
import { meritFor, type MeritInfo } from "../lib/merit.ts";
import {
  ESTIMATE_WORD,
  breakIncomeLabel,
  breakRangeLabel,
  changeNotes,
  chartSummary,
  costFacts,
  describePrice,
  fullPriceField,
  incomeLabel,
  meritFloor,
  meritFloorLabel,
  needAidView,
  partOfCurve,
  phraseHasWord,
  priceLabel,
  priceRangeLabel,
  promiseChartLabel,
  readout,
  roundIncome,
  roundPrice,
  tableRows,
  type Phrase,
} from "../lib/cost-display.ts";
import { DATA_END_MESSAGE, LITTLE_AID_MESSAGE } from "../lib/cost-at-income.ts";
import type { AidPolicy } from "../lib/aid-policies.ts";
import type { School } from "../lib/types.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ------------------------------------------------------------------ */
/* Figures                                                              */
/* ------------------------------------------------------------------ */

test("incomes round to $10K and prices to $1K", () => {
  assert.equal(roundIncome(244_999), 240_000);
  assert.equal(roundIncome(245_000), 250_000);
  assert.equal(roundPrice(38_499), 38_000);
  assert.equal(roundPrice(38_500), 39_000);
  assert.equal(incomeLabel(0), "$0");
  assert.equal(incomeLabel(240_000), "$240K");
  assert.equal(incomeLabel(145_000), "$145K", "the slider's own incomes are shown as chosen");
  assert.equal(incomeLabel(2_500), "$2.5K");
  assert.equal(priceLabel(38_499), "$38K");
  assert.equal(priceLabel(92_400), "$92K");
  assert.equal(priceLabel(640), "$640", "a small price never reads as $0");
  assert.equal(priceRangeLabel(37_600, 47_200), "$38K–$47K");
  assert.equal(priceRangeLabel(37_600, 38_400), "$38K", "ends that round alike are one figure");
  assert.equal(breakIncomeLabel(312_000), "about $310K");
  assert.equal(breakIncomeLabel(450_000), "above $400K", "a break point past the axis says so");
  assert.equal(breakRangeLabel(282_000, 331_000), "$280K–$330K");
});

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */

const PRIVATE = { coa: 88_000, bands: [2_000, 3_000, 6_000, 14_000, 48_000], policy: null, needMet: null, type: "private-nonprofit", tuition: 64_000 };
const curve = costCurve(PRIVATE)!;
const need: MeritInfo = { cls: "need_only", share: 0, avg: null, source: "cds" };
const reported: MeritInfo = { cls: "merit_reported", share: 0.18, avg: 22_000, source: "cds" };
const proxy: MeritInfo = { cls: "merit_proxy", share: 0.12, avg: 15_000, source: "ipeds" };
const school = (type: string): Pick<School, "type" | "cost"> => ({ type, cost: { breakdown: { full_price: 88_000 } } } as unknown as Pick<School, "type" | "cost">);

test("a price is worded by kind: published as is, modeled as 'about' a range with 'estimate'", () => {
  assert.deepEqual(describePrice({ lo: 31_204, hi: 31_204, kind: "published" }), { text: "$31K a year", estimate: false });
  assert.deepEqual(describePrice({ lo: 37_600, hi: 47_200, kind: "estimate" }), { text: "about $38K–$47K a year (estimate)", estimate: true });
  assert.match(describePrice({ lo: 88_000, hi: 88_000, kind: "full_price" }).text, /full price.*estimate/);
  assert.equal(describePrice({ lo: NaN, hi: NaN, kind: "unknown" }).estimate, false);
  assert.ok(!/NaN/.test(describePrice({ lo: NaN, hi: NaN, kind: "unknown" }).text));
});

test("the readout reads 'At $240K: about $38K–$47K a year (estimate)', and never NaN", () => {
  const r = readout(curve, 240_000, true);
  assert.match(r.text, /^At \$240K: about \$\d+K(–\$\d+K)? a year \(estimate\)$|^At \$240K: the full price, about \$88K a year \(estimate\)$/);
  assert.equal(r.estimate, true);
  assert.equal(readout(curve, 50_000, true).text, "At $50K: $6K a year");
  assert.equal(readout(curve, 240_000, false).text, "At $240K: Published data end at $110K", "estimates hidden: the published part only");
  assert.ok(!/NaN/.test(readout(curve, 240_000, false).text));
  assert.equal(readout(curve, 240_000, false).estimate, false);
  assert.equal(readout(curve, 400_000, true).estimate, true, "the full price past the break point is still modeled");
});

test("which part of the curve an income is on", () => {
  assert.match(partOfCurve(curve, 50_000, true).text, /^Published figure.*\$48–75K/);
  assert.match(partOfCurve(curve, 150_000, true).text, /Our estimate/);
  assert.match(partOfCurve(curve, 400_000, true).text, /Past where need-based aid ends \(estimate\)/);
  assert.match(partOfCurve(curve, 150_000, false).text, /Published data end at \$110K/);
});

test("facts: full price, where need-based aid ends, merit; each with its own field to cite", () => {
  const facts = costFacts({ school: school("private-nonprofit"), curve, merit: reported, showEstimates: true });
  assert.deepEqual(facts.map((f) => f.key), ["full_price", "need_aid", "merit"]);
  assert.equal(facts[0].value, "$88,000 a year");
  assert.equal(facts[0].field, "cost.breakdown");
  assert.equal(facts[1].field, "derived.need_aid_break_income");
  assert.match(facts[1].value, /^about \$\d+K$/);
  assert.match(facts[1].sub!, /estimate/);
  assert.equal(facts[1].estimate, true);
  assert.deepEqual([facts[2].value, facts[2].field], ["18% · avg $22K", "derived.merit_class"]);
  assert.match(facts[2].sub!, /without need/);

  const proxyFact = costFacts({ school: school("private-nonprofit"), curve, merit: proxy, showEstimates: true })[2];
  assert.equal(proxyFact.field, "derived.merit_proxy");
  assert.match(proxyFact.sub!, /proxy/, "the proxy is labeled as such");
  assert.equal(costFacts({ school: school("private-nonprofit"), curve, merit: { cls: "unknown", share: null, avg: null, source: null }, showEstimates: true }).length, 2, "unknown merit shows nothing");
  const none = costFacts({ school: school("private-nonprofit"), curve, merit: need, showEstimates: true })[2];
  assert.equal(none.value, "None");
  assert.match(none.sub!, /full price/);
  assert.equal(costFacts({ school: school("private-nonprofit"), curve, merit: { cls: "need_only", share: null, avg: null, source: "policy" }, showEstimates: true })[2].field, "aid_policy.need_only");
  assert.equal(costFacts({ school: school("private-nonprofit"), curve: null, merit: need, showEstimates: true }).length, 0);
  assert.equal(costFacts({ school: school("public"), curve, merit: null, showEstimates: true })[0].label, "Full price, in-state");
});

test("the need-based aid fact by status, and with the pilot's gate closed", () => {
  const needFact = (c: CostCurve, show: boolean) => costFacts({ school: school("private-nonprofit"), curve: c, merit: null, showEstimates: show })[1];
  assert.match(needFact(curve, true).value, /^about \$\d+K$/);
  const closed = needFact(curve, false);
  assert.equal(closed.value, DATA_END_MESSAGE, "the same sentence Compare uses");
  assert.equal(closed.estimate, false);
  assert.ok(!/\$\d+K/.test(closed.value.replace("$110K", "")), "no break point leaks through the gate");
  const little = costCurve({ ...PRIVATE, bands: [2_000, 3_000, 6_000, 14_000, 80_000] })!;
  assert.equal(little.status, "little_above_110k");
  assert.equal(needFact(little, true).value, LITTLE_AID_MESSAGE, "the same sentence Compare uses");
  assert.equal(needFact(little, true).estimate, false);
  assert.equal(needFact(little, true).field, "derived.need_aid_status");
  const ends = costCurve({ ...PRIVATE, bands: [2_000, 3_000, 6_000, 14_000, null] })!;
  assert.equal(needFact(ends, true).value, "Published data end at $110K");
  assert.equal(needAidView(null, true).kind, "data_ends");
});

test("merit floor: the full price minus the average award, labeled with its share, never without an average", () => {
  assert.deepEqual(meritFloor(curve, reported), { price: 66_000, share: 0.18, proxy: false });
  assert.equal(meritFloorLabel(curve, reported), "With an average merit award: $66K · 18% got one");
  assert.match(meritFloorLabel(curve, proxy)!, /proxy: 12% got one/);
  assert.equal(meritFloor(curve, need), null);
  assert.equal(meritFloor(curve, { ...reported, avg: null }), null);
});

test("promise labels: short, with (in-state) where the policy applies to residents only", () => {
  assert.equal(promiseChartLabel({ income: 200_000, kind: "free_tuition", label: "No tuition under $200K" }), "No tuition under $200K");
  assert.equal(promiseChartLabel({ income: 125_000, kind: "free_tuition", label: "No tuition under $125K (in-state)" }), "No tuition under $125K (in-state)");
  assert.equal(promiseChartLabel({ income: 100_000, kind: "no_contribution", label: "x" }), "No family contribution under $100K");
});

const policy = (p: Partial<AidPolicy>): AidPolicy => ({
  unit_id: "x",
  as_of: "2025-26",
  free_tuition_under: null,
  no_contribution_under: null,
  meets_full_need: null,
  no_loans: null,
  need_only: null,
  home_equity: null,
  siblings: null,
  siblings_note: null,
  source: "https://example.edu",
  checked: "2026-01-01",
  verified_via: "page",
  ...p,
});

test("what can change this: home equity, siblings, and divorced parents only where the college says so", () => {
  const keys = (args: Parameters<typeof changeNotes>[0]) => changeNotes(args).map((n) => n.key);
  assert.deepEqual(keys({ name: "X", policy: null, methodology: "federal" }), ["assets"], "the FAFSA ignores home equity: nothing to say");
  assert.deepEqual(keys({ name: "X", policy: null, methodology: null }), ["assets", "home_equity"], "generic where unknown");
  assert.equal(changeNotes({ name: "X", policy: null, methodology: null })[1].field, null, "generic text cites nothing");
  const ignored = changeNotes({ name: "X", policy: policy({ home_equity: "ignored" }), methodology: "institutional" });
  assert.deepEqual(ignored.map((n) => n.key), ["assets", "home_equity", "divorced"]);
  assert.match(ignored[1].text, /doesn't count it/);
  assert.equal(ignored[1].field, "aid_policy.home_equity");
  assert.match(changeNotes({ name: "X", policy: policy({ home_equity: { cap_multiple: 2 } }), methodology: null })[1].text, /up to 2× family income/);
  assert.match(changeNotes({ name: "X", policy: policy({ home_equity: "full" }), methodology: null })[1].text, /counts all of it/);
  const sib = changeNotes({ name: "Duke", policy: policy({ siblings: "reduce", siblings_note: "Parent contribution × 60% per sibling" }), methodology: "institutional" });
  assert.ok(sib.some((n) => n.key === "siblings" && /may lower/.test(n.text) && /× 60% per sibling/.test(n.text) && n.field === "aid_policy.siblings"));
  assert.ok(!keys({ name: "X", policy: policy({ siblings: "none" }), methodology: null }).includes("siblings"), "no sibling rule, no note");
  assert.ok(!keys({ name: "X", policy: null, methodology: "both" }).includes("divorced"), "divorced parents only where the college's own formula decides");
});

test("the full price's field mirrors the curve's input", () => {
  const f = (type: string, cost: unknown) => fullPriceField({ type, cost } as unknown as Pick<School, "type" | "cost">);
  assert.equal(f("public", { sticker: { in_state: 30_000 } }), "cost.sticker");
  assert.equal(f("private-nonprofit", { breakdown: { full_price: 80_000 }, sticker: { in_state: 79_000 } }), "cost.breakdown");
  assert.equal(f("private-nonprofit", { sticker: { in_state: 79_000 } }), "cost.sticker");
  assert.equal(f("private-nonprofit", { cost_of_attendance: 70_000 }), "cost.cost_of_attendance");
});

/* ------------------------------------------------------------------ */
/* Guard: no estimated figure without the word "estimate" beside it    */
/* ------------------------------------------------------------------ */

const INCOMES = [0, 20_000, 40_000, 60_000, 100_000, 110_000, 115_000, 125_000, 150_000, 200_000, 240_000, 300_000, 350_000, INCOME_MAX];
const MODELED: PriceKind[] = ["estimate", "full_price"];
/** Wording the spec rules out: a promise about what the family will pay. */
const PROMISING = /\byou will\b|\byou'll (pay|get)\b|\bwill pay\b|\byou'll be\b/i;

/** Every way a modeled price can reach the page for one college, with the kind the model gave it. */
function phrasesFor(c: CostCurve, merit: MeritInfo, show: boolean, type: string): { what: string; kind: PriceKind | null; phrase: Phrase }[] {
  const out: { what: string; kind: PriceKind | null; phrase: Phrase }[] = [];
  for (const income of INCOMES) {
    const kind = priceAt(c, income, show).kind;
    out.push({ what: `readout at ${income}`, kind, phrase: readout(c, income, show) });
    out.push({ what: `part of curve at ${income}`, kind, phrase: partOfCurve(c, income, show) });
  }
  const rows = tableRows(c, show);
  rows.slice(4).forEach((r, i) => out.push({ what: `table row ${r.income}`, kind: priceAt(c, [150_000, 200_000, 250_000, 300_000, 350_000, INCOME_MAX][i], show).kind, phrase: r.price }));
  rows.slice(0, 4).forEach((r) => out.push({ what: `table row ${r.income}`, kind: "published", phrase: r.price }));
  out.push({ what: "chart summary", kind: needAidView(c, show).kind === "break_point" ? "estimate" : null, phrase: chartSummary(c, merit, show) });
  for (const f of costFacts({ school: school(type), curve: c, merit, showEstimates: show })) {
    out.push({ what: `fact ${f.key}`, kind: f.estimate ? "estimate" : null, phrase: { text: `${f.value} ${f.sub ?? ""}`, estimate: f.estimate } });
  }
  return out;
}

/** What breaks the rule: a modeled figure whose phrase doesn't say so, or a phrase that says so about a published one. */
function estimateProblems(entries: { what: string; kind: PriceKind | null; phrase: Phrase }[]): string[] {
  const problems: string[] = [];
  for (const { what, kind, phrase } of entries) {
    const modeled = kind !== null && MODELED.includes(kind);
    if (modeled && !phrase.estimate) problems.push(`${what}: a ${kind} figure isn't flagged as an estimate: "${phrase.text}"`);
    if (modeled && !new RegExp(ESTIMATE_WORD, "i").test(phrase.text)) problems.push(`${what}: a ${kind} figure renders without "${ESTIMATE_WORD}": "${phrase.text}"`);
    if (!phraseHasWord(phrase)) problems.push(`${what}: flagged estimate without the word: "${phrase.text}"`);
    if (kind === "published" && phrase.estimate) problems.push(`${what}: a published figure is called an estimate: "${phrase.text}"`);
    if (/NaN|undefined|null/.test(phrase.text)) problems.push(`${what}: renders a missing value: "${phrase.text}"`);
    if (PROMISING.test(phrase.text)) problems.push(`${what}: promises a price: "${phrase.text}"`);
  }
  return problems;
}

const withCurves = schools.flatMap((s) => {
  const c = costCurve(costCurveInput(s));
  return c ? [{ s, c, merit: meritFor(s) }] : [];
});

test("guard: every college's curve phrases say 'estimate' beside every modeled figure, with the gate open or closed", () => {
  assert.ok(withCurves.length > 1_000, "the guard runs over the real dataset");
  assert.ok(withCurves.some(({ c }) => c.status === "break_point"), "…including colleges with a break point");
  const problems: string[] = [];
  for (const { s, c, merit } of withCurves)
    for (const show of [true, false]) problems.push(...estimateProblems(phrasesFor(c, merit, show, s.type ?? "")).map((p) => `${s.name} (${show ? "estimates shown" : "gate closed"}): ${p}`));
  assert.deepEqual(problems.slice(0, 5), [], `${problems.length} problems`);
});

test("guard: with the gate closed nothing above $110K carries a price, and no break point is stated", () => {
  const leaks: string[] = [];
  for (const { s, c, merit } of withCurves) {
    for (const income of INCOMES.filter((i) => i > FEDERAL_TOP)) {
      const r = readout(c, income, false);
      if (/\$\d/.test(r.text.replace(/^At \$\d+K: /, "").replaceAll("$110K", ""))) leaks.push(`${s.name}: ${r.text}`);
    }
    const facts = costFacts({ school: school(s.type ?? ""), curve: c, merit, showEstimates: false });
    if (facts.some((f) => f.field === "derived.need_aid_break_income")) leaks.push(`${s.name}: break point shown`);
    if (/estimate/i.test(chartSummary(c, merit, false).text)) leaks.push(`${s.name}: summary mentions an estimate`);
  }
  assert.deepEqual(leaks.slice(0, 5), []);
});

test("guard: the notes and facts never promise a price", () => {
  const texts = [
    ...changeNotes({ name: "X", policy: policy({ home_equity: "full", siblings: "split", siblings_note: "Divided among siblings" }), methodology: "institutional" }).map((n) => n.text),
    ...costFacts({ school: school("private-nonprofit"), curve, merit: reported, showEstimates: true }).flatMap((f) => [f.label, f.value, f.sub ?? ""]),
  ];
  assert.deepEqual(texts.filter((t) => PROMISING.test(t)), []);
});

test("guard: it fails when the word is removed from an estimate phrase", () => {
  const good = phrasesFor(curve, reported, true, "private-nonprofit");
  assert.deepEqual(estimateProblems(good), []);
  const modeled = good.findIndex((e) => e.kind === "estimate" && e.what.startsWith("readout"));
  assert.ok(modeled >= 0);
  const broken = good.map((e, i) => (i === modeled ? { ...e, phrase: { ...e.phrase, text: e.phrase.text.replace(/\s*\(estimate\)/, "") } } : e));
  assert.ok(estimateProblems(broken).length >= 1, "an estimated readout without the word is caught");
  const unflagged = good.map((e, i) => (i === modeled ? { ...e, phrase: { ...e.phrase, estimate: false } } : e));
  assert.ok(estimateProblems(unflagged).length >= 1, "an estimated readout not flagged as one is caught");
  const mislabeled = good.map((e) => (e.kind === "published" ? { ...e, phrase: { text: `${e.phrase.text} (estimate)`, estimate: true } } : e));
  assert.ok(estimateProblems(mislabeled).length >= 1, "a published figure called an estimate is caught");
  const nan = good.map((e, i) => (i === modeled ? { ...e, phrase: { ...e.phrase, text: "At $240K: NaN (estimate)" } } : e));
  assert.ok(estimateProblems(nan).length >= 1, "a missing value is caught");
  const fact = good.findIndex((e) => e.what === "fact need_aid");
  const noFactWord = good.map((e, i) => (i === fact ? { ...e, phrase: { ...e.phrase, text: e.phrase.text.replace(/estimate/g, "guess") } } : e));
  assert.ok(estimateProblems(noFactWord).length >= 1, "a break point without the word is caught");
});

/* ------------------------------------------------------------------ */
/* Guard: the components print phrases as given                         */
/* ------------------------------------------------------------------ */

const COMPONENTS = [
  "components/charts/CostCurve.tsx",
  "components/school/CostAtIncome.tsx",
  "components/school/CostFacts.tsx",
  "components/school/CostByIncome.tsx",
  "components/profile/CostCard.tsx",
] as const;

/** The formatters that turn a modeled figure into text: only lib/cost-display.ts's phrases may use them. */
const RAW_FORMATTERS = /\b(priceRangeLabel|describePrice|roundPrice|breakRangeLabel)\b/;

/** What a component source breaks: formatting a modeled price itself, or dropping the lib's estimate wording. */
function componentProblems(files: { file: string; src: string }[]): string[] {
  const problems: string[] = [];
  for (const { file, src } of files) {
    if (RAW_FORMATTERS.test(src)) problems.push(`${file} formats a modeled figure itself`);
    if (/priceAt\([^)]*\)\.(lo|hi)\b[^;]*\$\{|money(Compact)?\(\s*[a-zA-Z.]*\.(lo|hi|mid)\b/.test(src)) problems.push(`${file} prints an estimated price directly`);
  }
  // The chart and the slider must print the lib's phrases (readout, partOfCurve, tableRows, chartSummary) and carry the word.
  const src = (f: string) => files.find((x) => x.file.endsWith(f))?.src ?? "";
  if (!/readout\(/.test(src("CostCurve.tsx")) || !/tableRows\(/.test(src("CostCurve.tsx")) || !/ESTIMATE_WORD/.test(src("CostCurve.tsx"))) problems.push("CostCurve.tsx doesn't use the lib's readout, table rows, and estimate wording");
  if (!/readout\(/.test(src("CostAtIncome.tsx")) || !/partOfCurve\(/.test(src("CostAtIncome.tsx"))) problems.push("CostAtIncome.tsx doesn't use the lib's readout and part-of-curve sentences");
  if (!/costFacts\(/.test(src("CostFacts.tsx"))) problems.push("CostFacts.tsx doesn't build its facts with costFacts");
  if (!/<CostFacts/.test(src("CostCard.tsx")) || !/<CostCurve/.test(src("CostCard.tsx"))) problems.push("CostCard.tsx doesn't show the mini curve with the three facts");
  return problems;
}

test("guard: the components print the lib's estimate-worded phrases and format no modeled price themselves", () => {
  const files = COMPONENTS.map((file) => ({ file, src: read(file) }));
  assert.deepEqual(componentProblems(files), []);
});

test("guard: it fails when a component formats a modeled price itself or drops the lib's phrases", () => {
  const files = COMPONENTS.map((file) => ({ file, src: read(file) }));
  const patch = (name: string, f: (s: string) => string) => files.map((x) => (x.file.endsWith(name) ? { ...x, src: f(x.src) } : x));
  assert.ok(componentProblems(patch("CostAtIncome.tsx", (s) => `${s}\nconst t = priceRangeLabel(p.lo, p.hi);`)).length >= 1);
  assert.ok(componentProblems(patch("CostCurve.tsx", (s) => `${s}\nconst t = money(price.mid);`)).length >= 1);
  assert.ok(componentProblems(patch("CostCurve.tsx", (s) => s.replaceAll("readout(", "readOutX("))).length >= 1);
  assert.ok(componentProblems(patch("CostCurve.tsx", (s) => s.replaceAll("ESTIMATE_WORD", "THE_WORD"))).length >= 1);
  assert.ok(componentProblems(patch("CostFacts.tsx", (s) => s.replaceAll("costFacts(", "facts("))).length >= 1);
});
