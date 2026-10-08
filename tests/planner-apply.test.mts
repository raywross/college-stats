/**
 * Stage 5, Applications (U6; specs/planner/applications.md): the requirements list for a college with full CDS
 * data and one with none, the `apply` generator's sub-tasks, the shared transcript and Common App essay, the
 * weekly portal check stopping at complete, and the deferral/wait-list follow-ups appearing only once the outcome
 * is recorded. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generate } from "../lib/planner/generators/apply.ts";
import { deadlineRequirement, groupByPlatform, orderForApply, platformsFor, requirementsFor, sendScoreAdvice } from "../lib/planner/requirements.ts";
import { setStatus } from "../lib/list-rules.ts";
import type { GeneratorInput, PlanItem, PlanSchool } from "../lib/planner/types.ts";
import type { StudentProfileData } from "../lib/student-profile.ts";
import { emptyProfile } from "../lib/student-profile.ts";

const LIST = "11111111-1111-4111-8111-111111111111";
const ITEM_A = "22222222-2222-4222-8222-222222222222";
const ITEM_B = "33333333-3333-4333-8333-333333333333";
const TODAY = "2026-10-08";

const item = (over: Partial<PlanItem> = {}): PlanItem =>
  ({
    id: ITEM_A,
    list_id: LIST,
    unit_id: "100",
    category: "target",
    status: "applying",
    outcome: null,
    round: null,
    position: 0,
    added_by: null,
    added_at: TODAY,
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

const cite = (edition: string) => ({ cdsEdition: edition });

/** A college with every field the requirements list and the apply generator read. */
function fullSchool(over: Partial<PlanSchool> = {}): PlanSchool {
  return {
    unit_id: "100",
    name: "Michigan",
    city: "Ann Arbor",
    state: "MI",
    admitRate: 0.18,
    admitRateCite: null,
    avgCost: 20000,
    avgCostCite: null,
    sticker: null,
    distanceMiles: null,
    links: null,
    social: null,
    profile: {
      factors: { interest: "important", interview: "not_considered" },
      early_decision: {
        offered: true,
        first: { closing: { month: 11, day: 1 }, notification: { month: 12, day: 15 } },
        other: { closing: { month: 1, day: 5 }, notification: { month: 2, day: 15 } },
        applicants: 1000,
        admitted: 300,
      },
      early_action: { offered: true, closing: { month: 11, day: 15 }, notification: { month: 1, day: 31 }, restrictive: false },
    },
    logistics: {
      cycle: "Fall 2027",
      edition: "2026-27",
      fee: { waiver: true, online_same: true, online_waiver: true },
      regular_closing: { month: 1, day: 15 },
      priority_date: { month: 12, day: 1 },
      other_terms: null,
      notification: { kind: "by_date", rolling_from: null, by_date: { month: 4, day: 1 }, other_date: null, other_text: null },
      reply: { kind: "may1_or_weeks", date: null, weeks: 2, other_text: null },
      housing_deposit: { due: { month: 5, day: 1 }, amount: 300, refundable: "partial" },
      deferred_admission: null,
    },
    aid: {
      edition: "2026-27",
      aid_year: null,
      methodology: "both",
      forms: { fafsa: true, own_form: false, css_profile: true, state_form: false, noncustodial_profile: false, business_farm_supplement: false, other: null },
      dates: { priority: { month: 2, day: 1 }, deadline: { month: 3, day: 1 }, no_deadline: null, notify_by: null, notify_rolling_from: null, reply_by: null, reply_within_weeks: null },
      international: null,
      first_years: null,
      institutional_grants: null,
    },
    testPolicy: { cycle: 2027, uses_tests: true, sat_or_act: "considered", act_only: null, sat_only: null, policy: "considered" },
    satRange: [1300, 1480],
    actRange: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {
      "reported.admission_profile.early_decision.first.closing": cite("2026–27"),
      "reported.admissions_logistics.regular_closing": cite("2026–27"),
      "reported.admissions_logistics.fee": cite("2026–27"),
      "reported.aid.forms": cite("2026–27"),
      "reported.admission_profile.factors.interest": cite("2026–27"),
      "reported.admission_profile.factors.interview": cite("2026–27"),
      "reported.test_policy": cite("2026–27"),
    },
    applicationFee: 75,
    ...over,
  } as PlanSchool;
}

/** A college with no CDS record at all. */
function emptySchool(): PlanSchool {
  return fullSchool({ unit_id: "200", name: "Quiet College", profile: null, logistics: null, aid: null, testPolicy: null, satRange: null, actRange: null, cites: {}, applicationFee: null });
}

const input = (over: Partial<GeneratorInput> = {}): GeneratorInput => ({
  list: { id: LIST, student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: TODAY, sort: null, rounds_plan_accepted_at: null },
  items: [item()],
  schools: { [item().unit_id]: fullSchool() },
  profile: null,
  cycle: { cycle: "2026-27", startYear: 2026, entries: [] },
  grade: "senior_fall",
  today: TODAY,
  visits: [],
  offers: [],
  ...over,
});

/* ------------------------------------------------------------------ */
/* Requirements                                                        */
/* ------------------------------------------------------------------ */

test("requirementsFor: every line is published for a college with full CDS data", () => {
  const reqs = requirementsFor(item(), fullSchool(), null);
  assert.equal(reqs.length, 8);
  for (const r of reqs) assert.equal(r.published, true, r.key);
  assert.match(reqs.find((r) => r.key === "deadline")!.text, /Apply by Jan 15/);
  assert.match(reqs.find((r) => r.key === "fee")!.text, /\$75/);
  assert.match(reqs.find((r) => r.key === "test_policy")!.text, /Optional for fall 2027/i);
  assert.match(reqs.find((r) => r.key === "aid_forms")!.text, /FAFSA/);
  assert.match(reqs.find((r) => r.key === "interest")!.text, /considers your interest/);
  assert.match(reqs.find((r) => r.key === "interview")!.text, /isn't considered/);
});

test("requirementsFor: a college with no CDS record says the rest isn't published, and falls back to the student's own deadline and the federal fee", () => {
  const noFee = requirementsFor(item(), emptySchool(), null);
  for (const key of ["test_policy", "aid_forms", "interest", "interview"] as const) {
    const r = noFee.find((x) => x.key === key)!;
    assert.equal(r.published, false, key);
    assert.match(r.text, /hasn't published/);
  }
  // No federal fee either here, so it's unpublished too.
  assert.equal(noFee.find((r) => r.key === "fee")!.published, false);
  // No deadline at all: "add your own".
  assert.equal(noFee.find((r) => r.key === "deadline")!.published, false);

  // The student's own date and a federal fee still show.
  const withOwnData = requirementsFor(item({ deadline_date: "2027-02-01" }), emptySchool(), null);
  const deadline = withOwnData.find((r) => r.key === "deadline")!;
  assert.equal(deadline.published, true);
  assert.match(deadline.text, /your date/);

  const noCdsButFederalFee = fullSchool({ profile: null, logistics: null, aid: null, testPolicy: null, cites: {}, applicationFee: 75 });
  const withFederalFee = requirementsFor(item(), noCdsButFederalFee, null);
  assert.equal(withFederalFee.find((r) => r.key === "fee")!.published, true, "the federal application fee still shows with no CDS record");
});

test("deadlineRequirement: the round's label, from the chosen round's own date", () => {
  assert.match(deadlineRequirement(item({ round: "ed" }), fullSchool()).text, /\(ED I\)/);
  assert.match(deadlineRequirement(item({ round: "rd" }), fullSchool()).text, /Jan 15/);
});

test("sendScoreAdvice: only at a test-optional college, and only with a saved score", () => {
  assert.equal(sendScoreAdvice("required", [1300, 1480], null, { sat: 1500, act: null }), null, "required: no advice");
  assert.equal(sendScoreAdvice("considered", [1300, 1480], null, { sat: null, act: null }), null, "no saved score");
  assert.match(sendScoreAdvice("considered", [1300, 1480], null, { sat: 1500, act: null })!, /above this college's middle 50%: consider sending/);
  assert.match(sendScoreAdvice("considered", [1300, 1480], null, { sat: 1200, act: null })!, /below this college's middle 50%/);
  assert.match(sendScoreAdvice("considered", [1300, 1480], null, { sat: 1400, act: null })!, /within this college's middle 50%/);
});

test("orderForApply: the next deadline first, undated colleges last", () => {
  const a = item({ id: ITEM_A, unit_id: "100", round: "rd", position: 0 });
  const b = item({ id: ITEM_B, unit_id: "200", round: null, position: 1 });
  const schools = { "100": fullSchool({ unit_id: "100" }), "200": emptySchool() };
  const ordered = orderForApply([b, a], schools);
  assert.deepEqual(ordered.map((i) => i.id), [ITEM_A, ITEM_B]);
});

test("groupByPlatform: Common App colleges group together", () => {
  const a = item({ id: ITEM_A, application_platform: "common_app" });
  const b = item({ id: ITEM_B, application_platform: "common_app" });
  const groups = groupByPlatform([a, b]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].platform, "common_app");
  assert.equal(groups[0].items.length, 2);
});

/* ------------------------------------------------------------------ */
/* The pure rule markApplied relies on                                 */
/* ------------------------------------------------------------------ */

test("setStatus: moving to applied clears any outcome (the rule store-apply.ts markApplied relies on)", () => {
  assert.deepEqual(setStatus({ status: "applying", outcome: null }, "applied"), { status: "applied", outcome: null });
  assert.deepEqual(setStatus({ status: "decided", outcome: "admitted" }, "applied"), { status: "applied", outcome: null });
});

/* ------------------------------------------------------------------ */
/* The generator                                                       */
/* ------------------------------------------------------------------ */

test("generate: nothing for a college still 'considering'", () => {
  assert.deepEqual(generate(input({ items: [item({ status: "considering" })] })), []);
});

test("generate: the sub-tasks once a college is applying", () => {
  const tasks = generate(input({ items: [item({ recommendations_count: 2, supplements_count: 1 })] }));
  const kinds = tasks.filter((t) => t.item_id === ITEM_A).map((t) => t.kind);
  assert.ok(kinds.includes("fee"));
  assert.ok(kinds.includes("send_scores"));
  assert.ok(kinds.includes("submit"));
  assert.ok(kinds.includes("portal_setup"));
  assert.equal(kinds.filter((k) => k === "recommendation").length, 2);
  assert.equal(kinds.filter((k) => k === "supplement").length, 1);
});

test("generate: the fee task mentions the waiver when the profile says eligible", () => {
  const profile = { ...emptyProfile(), basics: { ...emptyProfile().basics, feeWaiverEligible: true } } as StudentProfileData;
  const tasks = generate(input({ profile }));
  const fee = tasks.find((t) => t.item_id === ITEM_A && t.kind === "fee")!;
  assert.match(fee.title, /waiver/);
  assert.match(fee.detail ?? "", /eligible for a waiver/);
});

test("generate: transcript is one shared task by default, across every college using the default", () => {
  const a = item({ id: ITEM_A, unit_id: "100" });
  const b = item({ id: ITEM_B, unit_id: "100", position: 1 });
  const tasks = generate(input({ items: [a, b] }));
  const shared = tasks.filter((t) => t.kind === "transcript" && t.item_id === null);
  assert.equal(shared.length, 1);
  assert.ok(!tasks.some((t) => t.kind === "transcript" && t.item_id !== null));
});

test("generate: a college with transcript_shared off gets its own transcript task instead", () => {
  const a = item({ id: ITEM_A, transcript_shared: false });
  const tasks = generate(input({ items: [a] }));
  assert.ok(tasks.some((t) => t.kind === "transcript" && t.item_id === ITEM_A));
  assert.ok(!tasks.some((t) => t.kind === "transcript" && t.item_id === null));
});

test("generate: Common App colleges share one personal-essay task", () => {
  const a = item({ id: ITEM_A, application_platform: "common_app" });
  const b = item({ id: ITEM_B, application_platform: "common_app", position: 1 });
  const tasks = generate(input({ items: [a, b] }));
  const shared = tasks.filter((t) => t.kind === "supplement" && t.item_id === null);
  assert.equal(shared.length, 1);
  assert.match(shared[0].detail ?? "", /2 Common App colleges/);
});

test("generate: the portal check runs weekly after applied_on and stops once complete_on is set", () => {
  const applying = generate(input({ items: [item({ status: "applied", applied_on: "2026-09-10" })], today: "2026-10-08" }));
  assert.ok(applying.some((t) => t.kind === "portal_check" && t.item_id === ITEM_A), "open while incomplete");

  const complete = generate(input({ items: [item({ status: "applied", applied_on: "2026-09-10", complete_on: "2026-10-01" })], today: "2026-10-08" }));
  assert.ok(!complete.some((t) => t.kind === "portal_check"), "stops at complete");
});

test("generate: deferred follow-ups appear only once the outcome is recorded", () => {
  const notDeferred = generate(input({ items: [item({ status: "applied", round: "ed" })] }));
  assert.ok(!notDeferred.some((t) => t.kind === "continued_interest"), "no follow-up before a deferral");

  const deferred = generate(input({ items: [item({ status: "applied", round: "ed", outcome: "deferred" })] }));
  assert.ok(deferred.some((t) => t.kind === "continued_interest" && t.item_id === ITEM_A));
});

test("generate: the ED II pointer appears only when an ED II college exists on the list", () => {
  const edOnly = item({ id: ITEM_A, unit_id: "100", round: "ed", status: "applied", outcome: "deferred" });
  const noEd2 = generate(input({ items: [edOnly] }));
  assert.ok(!noEd2.some((t) => t.kind === "continued_interest" && t.key?.endsWith(":ed2")), "no ED II college on the list");

  const ed2School = item({ id: ITEM_B, unit_id: "200", round: "ed2", status: "applying" });
  const withEd2 = generate(input({ items: [edOnly, ed2School], schools: { "100": fullSchool(), "200": fullSchool({ unit_id: "200", name: "Tufts" }) } }));
  const pointer = withEd2.find((t) => t.kind === "continued_interest" && t.key?.endsWith(":ed2"));
  assert.ok(pointer, "points at the ED II college once it exists");
  assert.match(pointer!.title, /Tufts/);
});

test("generate: wait-list tasks appear only once the outcome is waitlisted", () => {
  const notYet = generate(input({ items: [item({ status: "applied" })] }));
  assert.ok(!notYet.some((t) => t.kind === "waitlist_accept" || t.kind === "waitlist_deposit_elsewhere"));

  const waitlisted = generate(input({ items: [item({ status: "decided", outcome: "waitlisted" })] }));
  assert.ok(waitlisted.some((t) => t.kind === "waitlist_accept" && t.item_id === ITEM_A));
  assert.ok(waitlisted.some((t) => t.kind === "waitlist_deposit_elsewhere" && t.item_id === ITEM_A));
  assert.ok(waitlisted.some((t) => t.kind === "continued_interest" && t.item_id === ITEM_A));
});

test("generate: a withdrawn college gets no sub-tasks", () => {
  const tasks = generate(input({ items: [item({ status: "applied", withdrawn_on: "2026-10-01" })] }));
  assert.deepEqual(tasks, []);
});

test("platformsFor offers only the platforms a college can take", () => {
  const school = (over: Partial<Pick<PlanSchool, "state" | "type" | "name" | "links">>) => ({ state: "FL", type: "public" as const, name: "University of Florida", links: null, ...over });
  // Florida's public flagship: no ApplyTexas, no UC application.
  assert.deepEqual(platformsFor(school({})), ["common_app", "coalition", "own", "other"]);
  // A Texas public college gets ApplyTexas; so does anyone whose apply link points there.
  assert.deepEqual(platformsFor(school({ state: "TX", name: "The University of Texas at Austin" })), ["common_app", "coalition", "apply_texas", "own", "other"]);
  assert.ok(platformsFor(school({ links: { apply: "https://www.applytexas.org/" } as PlanSchool["links"] })).includes("apply_texas"));
  // A Texas private college doesn't.
  assert.ok(!platformsFor(school({ state: "TX", type: "private-nonprofit", name: "Rice University" })).includes("apply_texas"));
  // The University of California takes only its own application.
  assert.deepEqual(platformsFor(school({ state: "CA", name: "University of California-Berkeley" })), ["uc", "other"]);
  assert.deepEqual(platformsFor(school({ state: "CA", name: "Stanford University", type: "private-nonprofit" })), ["common_app", "coalition", "own", "other"]);
  // No school at all: the general set.
  assert.deepEqual(platformsFor(null), ["common_app", "coalition", "own", "other"]);
});
