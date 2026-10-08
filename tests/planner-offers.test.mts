/**
 * The offers unit (U7; specs/planner/offers.md): the College Financing Plan mapping, the four-year math, the flags and
 * questions, the loans reference file, the choice's generated tasks (the ED withdraw rule, wait-list decisions, the
 * summer list's keys), sorting, and the appeal line, over three letters entered through the form's normalizer: a
 * standard CFP letter, a messy one, and a New York standard letter. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOANS,
  appealSummary,
  awardYearLabel,
  cfpView,
  dependentLimits,
  fourYears,
  giftInYear,
  growthRate,
  isEnteredOffer,
  monthlyPayment,
  normalizeDraft,
  offerFlags,
  plusLimits,
  questionsToAsk,
  ratesFor,
  repaymentTerm,
  sortOffers,
  validateLoanReference,
  waitListLine,
  waitListOdds,
  type OfferDraft,
  type OfferTrend,
} from "../lib/planner/offers.ts";
import { generate as offersGen, isEdChoice, replyDate } from "../lib/planner/generators/offers.ts";
import { generateTasks, taskKey } from "../lib/planner/tasks.ts";
import { gradeOf, loadCycle } from "../lib/planner/cycle.ts";
import type { GeneratorInput, PlanItem, PlanSchool } from "../lib/planner/types.ts";

const ROOT = join(import.meta.dirname, "..");
const LIST = "11111111-1111-4111-8111-111111111111";
const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const NOW = "2027-04-20T12:00:00Z";
const TODAY = "2027-04-20";

/* ------------------------------------------------------------------ */
/* Fixtures: three letters, each typed into the form                   */
/* ------------------------------------------------------------------ */

/** A standard College Financing Plan letter: every cost line stated, gifts by source, loans separated. */
const CFP_FORM = {
  award_year: "2027",
  letter_date: "2027-03-28",
  coa: { tuition_fees: "60,000", housing_food: "15,000", books: "1,200", transport: "800", personal: "1,000", other: "", total: "78,000", stated_by_college: true },
  gift: [
    { kind: "federal", name: "Federal Pell Grant", amount: "7395", renewable: true, renewal_condition: "FAFSA each year", years: "" },
    { kind: "college_need", name: "University Grant", amount: "$40,000", renewable: true, renewal_condition: "FAFSA and CSS Profile each year", years: "" },
  ],
  work_study: "3,000",
  loans: [
    { kind: "direct_sub", amount: "3500" },
    { kind: "direct_unsub", amount: "2000" },
  ],
};

/** A messy letter: no cost of attendance, a loan listed under "awards", a merit award with no renewal terms, PLUS filling the gap. */
const MESSY_FORM = {
  award_year: 2027,
  letter_date: null,
  coa: {},
  gift: [
    { kind: "college_merit", name: "Presidential Scholarship", amount: "20000", renewable: null },
    { kind: "college_need", name: "Federal Direct Loan", amount: "5500", renewable: null },
    { kind: "college_need", name: "Dean's Scholarship", amount: "4000", renewable: true },
    { kind: "outside", name: "Rotary Club", amount: "2000", renewable: false, years: "1" },
  ],
  work_study: "",
  loans: [
    { kind: "parent_plus", amount: "30000" },
    { kind: "private", amount: "5000" },
  ],
};

/** New York's standard undergraduate award letter: direct and indirect costs, Pell and TAP, a SUNY's own grant. */
const NY_FORM = {
  award_year: "2027",
  letter_date: "2027-03-15",
  coa: { tuition_fees: "10,300", housing_food: "16,200", books: "1,500", transport: "1,100", personal: "1,800", other: "", total: "", stated_by_college: true },
  gift: [
    { kind: "federal", name: "Federal Pell Grant", amount: "7,395", renewable: true },
    { kind: "state", name: "NYS Tuition Assistance Program (TAP)", amount: "5,665", renewable: true, renewal_condition: "Good academic standing; reapply with the FAFSA" },
    { kind: "college_need", name: "SUNY Grant", amount: "2,000", renewable: null },
  ],
  work_study: "1,500",
  loans: [
    { kind: "direct_sub", amount: "3,500" },
    { kind: "direct_unsub", amount: "2,000" },
  ],
};

function draft(form: unknown): OfferDraft {
  const r = normalizeDraft(form);
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.draft;
}

const FALLBACK = { amount: 72000, year: "2025–26" };
const TREND: OfferTrend = { tuition: 0.04, housing: 0.03, fullPrice: 0.035, from: "2019–20", to: "2024–25" };

/* ------------------------------------------------------------------ */
/* The reference file                                                  */
/* ------------------------------------------------------------------ */

test("data/reference/federal-loans.json validates, and every figure has an https source", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "data", "reference", "federal-loans.json"), "utf8"));
  assert.deepEqual(validateLoanReference(raw), []);
  assert.deepEqual(validateLoanReference(LOANS), []);
});

test("guard: the reference check rejects a bad rate, a missing source, a step-down limit, and an open-ended tier list", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "data", "reference", "federal-loans.json"), "utf8"));
  const broken = structuredClone(raw);
  broken.rates[0].undergraduate = 6.52;
  broken.rates[1].source = "http://example.com";
  broken.dependent_limits[0].years[3].total = 1000;
  broken.repayment[0].terms[3].below = 200000;
  const problems = validateLoanReference(broken);
  assert.ok(problems.some((p) => /undergraduate must be a rate/.test(p)));
  assert.ok(problems.some((p) => /source must be an https URL/.test(p)));
  assert.ok(problems.some((p) => /never step down/.test(p)));
  assert.ok(problems.some((p) => /last term must have below: null/.test(p)));
  assert.deepEqual(validateLoanReference({ rates: [] }).length > 0, true);
});

test("rates, limits, and terms by award year: an unannounced year uses the newest published one", () => {
  assert.equal(awardYearLabel(2027), "2027–28");
  assert.equal(ratesFor(2026)!.undergraduate, 0.0652);
  assert.equal(ratesFor(2026)!.parent_plus, 0.0907);
  assert.equal(ratesFor(2026)!.exact, true);
  const later = ratesFor(2027)!;
  assert.equal(later.exact, false);
  assert.equal(later.award_year, 2026);
  assert.equal(ratesFor(2025)!.undergraduate, 0.0639);
  assert.equal(ratesFor(1999), null);
  assert.deepEqual(dependentLimits(2027)!.years.map((y) => y.total), [5500, 6500, 7500, 7500]);
  assert.equal(plusLimits(2027)!.annual, 20000);
  assert.equal(plusLimits(2027)!.aggregate, 65000);
  assert.equal(plusLimits(2025)!.annual, null, "before July 2026: no fixed PLUS limit");
  assert.equal(repaymentTerm(24999, 2027)!.years, 10);
  assert.equal(repaymentTerm(27000, 2027)!.years, 15);
  assert.equal(repaymentTerm(60000, 2027)!.years, 20);
  assert.equal(repaymentTerm(150000, 2027)!.years, 25);
  assert.equal(repaymentTerm(10000, 2025), null, "no tiered rule recorded before July 2026");
  assert.equal(monthlyPayment(10000, 0.05, 10).toFixed(2), "106.07");
  assert.equal(monthlyPayment(0, 0.05, 10), 0);
});

/* ------------------------------------------------------------------ */
/* CFP mapping                                                         */
/* ------------------------------------------------------------------ */

test("CFP letter: the stated cost, gifts by source, net cost, out of pocket, loans by kind", () => {
  const d = draft(CFP_FORM);
  assert.equal(d.award_year, 2027);
  assert.equal(d.coa.tuition_fees, 60000);
  assert.equal(d.gift[1].amount, 40000, "dollar signs and commas are read");
  const v = cfpView(d, FALLBACK);
  assert.equal(v.coa.total, 78000);
  assert.equal(v.coa.source, "letter");
  assert.equal(v.gifts.byKind.federal, 7395);
  assert.equal(v.gifts.byKind.college_need, 40000);
  assert.equal(v.gifts.total, 47395);
  assert.equal(v.netCost, 30605);
  assert.equal(v.workStudy, 3000);
  assert.equal(v.outOfPocket, 27605);
  assert.equal(v.loans.studentFederal, 5500);
  assert.equal(v.loans.notAid, 0);
  const flags = offerFlags(d, v);
  assert.deepEqual(
    flags.map((f) => f.key),
    ["work_study"],
    "a clean letter raises only the work-study note",
  );
});

test("messy letter: the site's full price stands in, flagged with its year; a loan under grants; PLUS and private not aid", () => {
  const d = draft(MESSY_FORM);
  const v = cfpView(d, FALLBACK);
  assert.equal(v.coa.source, "ipeds");
  assert.equal(v.coa.total, 72000);
  assert.equal(v.coa.year, "2025–26");
  assert.equal(v.loans.byKind.parent_plus, 30000);
  assert.equal(v.loans.headline, 0, "PLUS and private stay out of the headline");
  assert.equal(v.loans.notAid, 35000);
  const flags = offerFlags(d, v, "Tulane");
  const keys = flags.map((f) => f.key);
  for (const k of ["coa_missing", "loan_in_gifts", "plus_fills_gap", "private_loan", "renewal_unknown", "first_year_only", "outside_displacement"] as const) {
    assert.ok(keys.includes(k), `flags ${k}`);
  }
  assert.match(flags.find((f) => f.key === "coa_missing")!.line, /full price \(2025–26\)/);
  assert.equal(flags.find((f) => f.key === "loan_in_gifts")!.gift, 1, "points at the gift line");
  assert.match(flags.find((f) => f.key === "outside_displacement")!.line, /Tulane/);
  const questions = questionsToAsk(flags);
  assert.ok(questions.some((q) => /full cost of attendance/.test(q)));
  assert.ok(questions.some((q) => /renew for all four years/.test(q)));
  assert.ok(questions.some((q) => /Parent PLUS/.test(q)));
  assert.equal(new Set(questions).size, questions.length, "each question once");
  // Without a site price either, the cost is unknown and so is the net cost.
  const none = cfpView(d, { amount: null, year: null });
  assert.equal(none.coa.source, "none");
  assert.equal(none.netCost, null);
});

test("New York standard letter through the form: cost from its lines, Pell and TAP, a need grant with no renewal terms", () => {
  const d = draft(NY_FORM);
  const v = cfpView(d, FALLBACK);
  assert.equal(v.coa.source, "letter_parts", "no total typed: the lines add up");
  assert.equal(v.coa.total, 10300 + 16200 + 1500 + 1100 + 1800);
  assert.equal(v.gifts.byKind.state, 5665);
  assert.equal(v.gifts.total, 7395 + 5665 + 2000);
  assert.equal(v.netCost, 30900 - 15060);
  const keys = offerFlags(d, v).map((f) => f.key);
  assert.ok(keys.includes("renewal_unknown"));
  assert.ok(!keys.includes("coa_no_housing"));
  // The same letter without its housing line is understated.
  const noHousing = draft({ ...NY_FORM, coa: { ...NY_FORM.coa, housing_food: "" } });
  assert.ok(offerFlags(noHousing, cfpView(noHousing, FALLBACK)).some((f) => f.key === "coa_no_housing"));
});

test("need-based grant called a scholarship is flagged; the normalizer refuses an empty offer and a bad year", () => {
  const d = draft({ award_year: 2027, gift: [{ kind: "college_need", name: "Opportunity Scholarship", amount: "9000", renewable: true, renewal_condition: "FAFSA" }] });
  assert.ok(offerFlags(d, cfpView(d, FALLBACK)).some((f) => f.key === "need_called_scholarship"));
  assert.equal(normalizeDraft({ award_year: 2027, coa: {}, gift: [], loans: [] }).ok, false);
  assert.equal(normalizeDraft({ award_year: "next year", coa: { total: 1 } }).ok, false);
  const junk = draft({ award_year: 2027, coa: { total: "-5", tuition_fees: "abc", housing_food: "1000" }, gift: [{ kind: "lottery", amount: 5 }], loans: [{ kind: "direct_sub", amount: "0" }] });
  assert.equal(junk.coa.total, null);
  assert.equal(junk.coa.tuition_fees, null);
  assert.deepEqual(junk.gift, []);
  assert.deepEqual(junk.loans, []);
});

/* ------------------------------------------------------------------ */
/* Four years                                                          */
/* ------------------------------------------------------------------ */

test("four years: tuition and housing grow at the college's trend; gifts renew; federal limits step up; 10-year payment", () => {
  const d = draft(CFP_FORM);
  const v = cfpView(d, FALLBACK);
  const f = fourYears(d, v, TREND);
  assert.equal(f.growth, "trend");
  assert.equal(f.years[0].coa, 78000, "year 1 is the letter");
  const y2 = 60000 * 1.04 + 18000 * 1.03;
  assert.ok(Math.abs(f.years[1].coa! - y2) < 0.01, "tuition at 4%, living costs at 3%");
  assert.ok(Math.abs(f.years[3].coa! - (60000 * 1.04 ** 3 + 18000 * 1.03 ** 3)) < 0.01);
  assert.deepEqual(
    f.years.map((y) => y.gift),
    [47395, 47395, 47395, 47395],
  );
  assert.equal(f.bothWays, false);
  assert.deepEqual(
    f.years.map((y) => y.studentFederal),
    [5500, 6500, 7500, 7500],
    "at the year-1 limit, so the loans step up with the limits",
  );
  assert.equal(f.totals.studentFederal, 27000);
  assert.ok(f.student);
  assert.equal(f.student!.termYears, 10);
  assert.equal(f.student!.rate, 0.0652);
  assert.equal(f.student!.rateYear, 2026);
  assert.equal(f.student!.exact, false, "the offer's award year isn't announced yet");
  assert.equal(f.student!.monthly.toFixed(2), "306.85");
  assert.deepEqual({ years: f.student!.tier!.years, monthly: f.student!.tier!.monthly.toFixed(2) }, { years: 15, monthly: "235.50" }, "the tiered term beside it");
  assert.equal(f.parent, null);
  const net = f.years.reduce((a, y) => a + y.net!, 0);
  assert.ok(Math.abs(f.totals.net! - net) < 0.01);
});

test("four years: unknown renewal shown both ways; first-year-only awards; PLUS inside its limits; flat without a trend", () => {
  const d = draft(MESSY_FORM);
  const v = cfpView(d, FALLBACK);
  const f = fourYears(d, v, null);
  assert.equal(f.growth, "flat");
  assert.deepEqual(
    f.years.map((y) => y.coa),
    [72000, 72000, 72000, 72000],
  );
  assert.equal(f.bothWays, true);
  // If renewed: Presidential 20,000 + Direct Loan (as typed) 5,500 + Dean's 4,000 every year; Rotary year 1 only.
  assert.deepEqual(
    f.years.map((y) => y.gift),
    [31500, 29500, 29500, 29500],
  );
  // If not: only Dean's (renewable) after year 1.
  assert.deepEqual(
    f.years.map((y) => y.giftIfNotRenewed),
    [31500, 4000, 4000, 4000],
  );
  assert.ok(f.totals.netIfNotRenewed! > f.totals.net!);
  assert.deepEqual(
    f.years.map((y) => y.parentPlus),
    [20000, 20000, 20000, 5000],
    "$20,000 a year, $65,000 in all",
  );
  assert.equal(f.parent!.rate, 0.0907);
  assert.equal(f.student, null, "no federal student loans, no payment");
  assert.equal(giftInYear({ kind: "outside", name: "", amount: 1, renewable: true, renewal_condition: null, years: 2 }, 3, true), false, "years caps a renewable award");
});

test("four years: below the year-1 limit, federal loans stay level; a letter total alone grows at the full-price trend", () => {
  const d = draft({ award_year: 2027, coa: { total: "50000" }, loans: [{ kind: "direct_unsub", amount: "3000" }] });
  const f = fourYears(d, cfpView(d, FALLBACK), TREND);
  assert.deepEqual(
    f.years.map((y) => y.studentFederal),
    [3000, 3000, 3000, 3000],
  );
  assert.ok(Math.abs(f.years[1].coa! - 50000 * 1.035) < 0.01);
});

test("growthRate: nominal yearly growth over the last five years with values; gaps and short series give none", () => {
  const pts = [2018, 2019, 2020, 2021, 2022, 2023].map((year, i) => ({ year, value: 10000 * 1.05 ** i }));
  const g = growthRate(pts)!;
  assert.ok(Math.abs(g.rate - 0.05) < 1e-9);
  assert.deepEqual([g.from, g.to], [2018, 2023]);
  assert.equal(growthRate([{ year: 2023, value: 1 }]), null);
  assert.equal(growthRate([{ year: 2018, value: 100 }, { year: 2019, value: null }, { year: 2020, value: null }, { year: 2021, value: null }, { year: 2022, value: null }, { year: 2023, value: 120 }]), null, "mostly gaps");
});

/* ------------------------------------------------------------------ */
/* Comparing                                                           */
/* ------------------------------------------------------------------ */

test("sorting names its order and puts unknown values last either way; the appeal line names the better offer", () => {
  const rows = [
    { position: 0, v: 30000 },
    { position: 1, v: null },
    { position: 2, v: 12000 },
  ];
  assert.deepEqual(
    sortOffers(rows, "net", (r) => r.v).map((r) => r.position),
    [2, 0, 1],
  );
  assert.deepEqual(
    sortOffers(rows, "gift", (r) => r.v).map((r) => r.position),
    [0, 2, 1],
  );
  assert.deepEqual(
    sortOffers(rows, "list", (r) => r.v).map((r) => r.position),
    [0, 1, 2],
  );
  const a = cfpView(draft(CFP_FORM), FALLBACK);
  const b = cfpView(draft(NY_FORM), FALLBACK);
  const line = appealSummary({ name: "Binghamton", view: b, awardYear: 2027 }, [{ name: "Cornell", view: a }], 12000)!;
  assert.match(line, /Cornell offered \$32,335 more in grants/);
  assert.match(line, /2027–28/);
  assert.match(line, /about \$12,000 a year/);
  assert.equal(appealSummary({ name: "Cornell", view: a, awardYear: 2027 }, [{ name: "Binghamton", view: b }]), null, "nothing better: no appeal line");
  assert.equal(isEnteredOffer({ confirmed_at: null }), false);
});

test("wait-list history line and odds", () => {
  assert.equal(waitListLine({ offered: 3000, accepted: 1800, admitted: 90 }), "Offered 3,000 a place; 1,800 accepted one; 90 admitted from it");
  assert.equal(waitListLine({ offered: null, accepted: null, admitted: null }), null);
  assert.equal(waitListOdds({ accepted: 1800, admitted: 90 }), 0.05);
  assert.equal(waitListOdds({ accepted: null, admitted: 90 }), null);
});

/* ------------------------------------------------------------------ */
/* The generator                                                       */
/* ------------------------------------------------------------------ */

const item = (n: number, over: Partial<PlanItem> = {}): PlanItem =>
  ({
    id: ID(n),
    list_id: LIST,
    unit_id: String(100 + n),
    category: "target",
    status: "applied",
    outcome: null,
    round: "rd",
    position: n,
    added_by: null,
    added_at: NOW,
    decision_date: null,
    deadline_text: null,
    deadline_date: null,
    enrolling: false,
    updates: true,
    visited_on: null,
    follows_social: false,
    dream: false,
    priority: null,
    followed_networks: [],
    info_requested_on: null,
    application_platform: null,
    applied_on: null,
    complete_on: null,
    portal_url: null,
    committed_on: null,
    withdrawn_on: null,
    recommendations_count: null,
    supplements_count: null,
    transcript_shared: true,
    ...over,
  }) as PlanItem;

const school = (n: number, name: string, reply: PlanSchool["logistics"] extends infer L ? (L extends { reply: infer R } ? R : never) : never = null): PlanSchool =>
  ({
    unit_id: String(100 + n),
    name,
    city: null,
    state: null,
    admitRate: null,
    admitRateCite: null,
    avgCost: null,
    avgCostCite: null,
    sticker: null,
    distanceMiles: null,
    links: null,
    social: null,
    profile: null,
    logistics: reply
      ? { cycle: "Fall 2027", edition: "2026-27", fee: null, regular_closing: null, priority_date: null, other_terms: null, notification: null, reply, housing_deposit: null, deferred_admission: null }
      : null,
    aid: null,
    testPolicy: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: reply ? { "reported.admissions_logistics.reply": { cdsEdition: "2026–27" } } : {},
  }) as PlanSchool;

const SCHOOLS: Record<string, PlanSchool> = {
  "101": school(1, "Michigan", { kind: "may1_or_weeks", date: null, weeks: null, other_text: null }),
  "102": school(2, "Duke", { kind: "fixed_date", date: { month: 5, day: 1 }, weeks: null, other_text: null }),
  "103": school(3, "Rice"),
  "104": school(4, "Emory"),
  "105": school(5, "Tufts"),
  "106": school(6, "Vanderbilt"),
};

function input(items: PlanItem[], over: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "List", is_default: true, share_enabled: false, created_by: null, created: NOW, sort: null, rounds_plan_accepted_at: null } as GeneratorInput["list"],
    items,
    schools: SCHOOLS,
    profile: null,
    cycle: loadCycle("2026-27"),
    grade: gradeOf(2027, TODAY),
    today: TODAY,
    visits: [],
    offers: [],
    ...over,
  };
}

const kinds = (tasks: { kind: string }[], kind: string) => tasks.filter((t) => t.kind === kind);

test("before a choice: Add the aid offer for each admit only; no choice tasks, no summer list", () => {
  const tasks = offersGen(
    input([item(1, { status: "decided", outcome: "admitted" }), item(2, { status: "decided", outcome: "denied" }), item(3, { status: "decided", outcome: "waitlisted" }), item(4)]),
  );
  assert.deepEqual(
    tasks.map((t) => t.key),
    [taskKey(ID(1), "add_offer")],
  );
  assert.equal(tasks[0].due_on, null);
  // Enrolling without a commit date isn't the choice yet.
  assert.equal(kinds(offersGen(input([item(1, { status: "decided", outcome: "admitted", enrolling: true })])), "deposit").length, 0);
});

test("the choice: deposit by the reply date, withdraw the other admits and pending, decide each wait list, the summer list", () => {
  const items = [
    item(1, { status: "decided", outcome: "admitted", enrolling: true, committed_on: "2027-04-20" }),
    item(2, { status: "decided", outcome: "admitted" }),
    item(3, { status: "decided", outcome: "waitlisted" }),
    item(4, { status: "applied" }),
    item(5, { status: "decided", outcome: "denied" }),
    item(6, { status: "considering" }),
  ];
  const tasks = offersGen(input(items));
  const deposit = kinds(tasks, "deposit");
  assert.equal(deposit.length, 1);
  assert.equal(deposit[0].key, taskKey(ID(1), "deposit"));
  assert.equal(deposit[0].title, "Pay the enrollment deposit at Michigan");
  assert.equal(deposit[0].due_on, "2027-05-01", "the reply date the college generator uses (C17, May 1)");
  assert.equal(deposit[0].source_field, "reported.admissions_logistics.reply");
  assert.equal(deposit[0].source_edition, "2026–27");
  assert.equal(deposit[0].assignee, "guardian");
  assert.deepEqual(replyDate(SCHOOLS["101"])!.date, "2027-05-01");

  const withdraw = kinds(tasks, "withdraw");
  assert.deepEqual(
    withdraw.map((t) => t.item_id).sort(),
    [ID(2), ID(4)].sort(),
    "the other admit and the pending application; not the denial, not a college never applied to",
  );
  assert.equal(withdraw.find((t) => t.item_id === ID(2))!.title, "Tell Duke you won't attend");
  assert.match(withdraw.find((t) => t.item_id === ID(2))!.detail!, /frees a place/);
  assert.equal(withdraw.find((t) => t.item_id === ID(2))!.due_on, "2027-05-01", "Duke's own reply date");

  const wl = kinds(tasks, "waitlist_decide");
  assert.equal(wl.length, 1);
  assert.equal(wl[0].key, taskKey(ID(3), "waitlist_decide"));
  assert.equal(wl[0].title, "Stay on Rice's wait list or withdraw?");
  assert.match(wl[0].detail!, /forfeiting the deposit at Michigan/);

  const summer = kinds(tasks, "summer");
  const entries = loadCycle("2026-27").entries.filter((e) => e.applies === "committed");
  assert.ok(entries.length > 0);
  assert.deepEqual(
    summer.map((t) => t.key),
    entries.map((e) => `${LIST}:summer:${e.key}`),
    "keyed {list}:summer:{entry key}",
  );
  assert.ok(summer.every((t) => t.source === "cycle" && t.item_id === ID(1)));
  // Not the college generator's keys: reply_by and housing_deposit stay U5's.
  assert.equal(kinds(tasks, "reply_by").length + kinds(tasks, "housing_deposit").length, 0);
});

test("ED rule: after an early decision admit, every other application is withdrawn, required, wait lists included", () => {
  const items = [
    item(1, { round: "ed", status: "decided", outcome: "admitted", enrolling: true, committed_on: "2026-12-16" }),
    item(2, { status: "applied" }),
    item(3, { status: "decided", outcome: "waitlisted" }),
    item(4, { status: "applying" }),
    item(5, { status: "decided", outcome: "denied" }),
  ];
  assert.equal(isEdChoice(items[0]), true);
  const tasks = offersGen(input(items));
  const withdraw = kinds(tasks, "withdraw");
  assert.deepEqual(
    withdraw.map((t) => t.item_id).sort(),
    [ID(2), ID(3), ID(4)].sort(),
  );
  assert.ok(withdraw.every((t) => t.title.startsWith("ED is binding: withdraw your application to")));
  assert.ok(withdraw.every((t) => t.due_on === "2026-12-16"), "now: the day of the choice");
  assert.equal(kinds(tasks, "waitlist_decide").length, 0, "no wait-list choice after ED");
  // An RD admit chosen: no required wording.
  const rd = offersGen(input([item(1, { status: "decided", outcome: "admitted", enrolling: true, committed_on: "2027-04-20" }), item(2, { status: "applied" })]));
  assert.ok(kinds(rd, "withdraw").every((t) => !t.title.startsWith("ED is binding")));
});

test("withdrawn colleges keep their withdraw task (a tick doesn't orphan it); a guardian's own list gets nothing", () => {
  const items = [item(1, { status: "decided", outcome: "admitted", enrolling: true, committed_on: "2027-04-20" }), item(2, { status: "decided", outcome: "admitted", withdrawn_on: "2027-04-21" })];
  assert.equal(kinds(offersGen(input(items)), "withdraw").length, 1);
  const guardian = input(items, { list: { ...input([]).list, student_id: null, user_id: "u1" } as GeneratorInput["list"] });
  assert.deepEqual(offersGen(guardian), []);
});

test("through generateTasks: the offers module doesn't collide with the college generator's reply_by key", () => {
  const items = [item(1, { status: "decided", outcome: "admitted", enrolling: true, committed_on: "2027-04-20" })];
  const all = generateTasks(input(items));
  assert.equal(all.filter((t) => t.key === taskKey(ID(1), "reply_by")).length, 1);
  assert.equal(all.filter((t) => t.key === taskKey(ID(1), "deposit")).length, 1);
  assert.equal(new Set(all.map((t) => t.key)).size, all.length);
});
