/**
 * Common App build (U4; common-app-build/brief.md, specs/data-expansion/common-app.md): the planner's hooks into
 * the Requirements Grid — `deadlineFor`'s grid-first precedence, the requirements list's new lines (platform,
 * essays, recommendations, fee waiver), `platformsFor`'s membership gate, and rounds offered from the grid.
 * Pure; no I/O. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deadlineFor, type DeadlineGrid } from "../lib/list-rules.ts";
import { requirementsFor, platformsFor } from "../lib/planner/requirements.ts";
import { isOffered, lastCycleNote, roundDates, roundsOffered, type RoundsSchool } from "../lib/planner/rounds.ts";
import { applyDate } from "../lib/planner/generators/college.ts";
import type { PlanItem, PlanSchool } from "../lib/planner/types.ts";
import type { SchoolApply } from "../lib/common-app/types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const NO_DEADLINES: DeadlineGrid = { ed: null, ed2: null, ea: null, ea2: null, rea: null, regular: null };

const member = (over: Partial<SchoolApply> = {}): SchoolApply => ({
  common_app: { member: true, member_id: "9999", slug: "example-college", cycle: "2026-27", updated: "2026-09-25" },
  deadlines: NO_DEADLINES,
  fee: { us: null, international: null },
  fee_waiver: null,
  essay_required: null,
  courses_grades_required: null,
  writing_supplement: null,
  portfolio: null,
  test_policy: null,
  recommendations: null,
  school_type: null,
  saves_forms: null,
  ...over,
});

const item = (over: Partial<PlanItem> = {}): PlanItem =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    list_id: "00000000-0000-4000-8000-000000000000",
    unit_id: "100",
    category: "target",
    status: "applying",
    outcome: null,
    round: null,
    position: 0,
    added_by: null,
    added_at: "2026-10-01",
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

/** A member college with a full grid row: every early round offered, with ISO dates. */
function memberSchool(over: Partial<PlanSchool> = {}): PlanSchool {
  return {
    unit_id: "100",
    name: "Example College",
    city: "Anytown",
    state: "NY",
    admitRate: 0.2,
    admitRateCite: null,
    avgCost: 30000,
    avgCostCite: null,
    sticker: null,
    distanceMiles: null,
    links: null,
    social: null,
    profile: {
      factors: { interest: null, interview: null },
      early_decision: { offered: true, first: { closing: { month: 11, day: 1 }, notification: { month: 12, day: 15 } }, other: { closing: { month: 1, day: 5 }, notification: null }, applicants: 500, admitted: 150 },
      early_action: { offered: true, closing: { month: 11, day: 1 }, notification: null, restrictive: false },
    },
    logistics: {
      cycle: "Fall 2027",
      edition: "2025-26",
      fee: { waiver: null, online_same: null, online_waiver: null },
      regular_closing: { month: 1, day: 1 },
      priority_date: null,
      other_terms: null,
      notification: null,
      reply: null,
      housing_deposit: null,
      deferred_admission: null,
    },
    aid: null,
    testPolicy: null,
    applicationFee: null,
    acceptsApCredit: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    type: "private-nonprofit",
    edTotals: null,
    satRange: null,
    actRange: null,
    gpaAverage: null,
    standing: { admitRate: 0.2, sat: null, act: null, gpaAverage: null, gpa: null, testPolicy: null },
    poolSchool: {} as PlanSchool["poolSchool"],
    apply: member(),
    ...over,
  } as PlanSchool;
}

/** A non-member college: no `apply` block at all. */
function nonMemberSchool(over: Partial<PlanSchool> = {}): PlanSchool {
  return memberSchool({ apply: null, ...over });
}

/* ------------------------------------------------------------------ */
/* deadlineFor: grid > CDS > student                                   */
/* ------------------------------------------------------------------ */

test("deadlineFor: the grid's own ISO date wins over the CDS month/day", () => {
  const grid: DeadlineGrid = { ...NO_DEADLINES, ed: "2026-11-01", regular: "2027-01-05" };
  const logistics = { regular_closing: { month: 2, day: 1 } }; // CDS says Feb 1; the grid says Jan 5.
  const resolved = deadlineFor("rd", logistics, null, 2026, { text: null, date: null }, { deadlines: grid });
  assert.deepEqual(resolved, { date: "2027-01-05", text: null, source: "common-app" });

  const edResolved = deadlineFor("ed", null, null, 2026, { text: null, date: null }, { deadlines: grid });
  assert.deepEqual(edResolved, { date: "2026-11-01", text: null, source: "common-app" });
});

test("deadlineFor: a round the grid doesn't offer falls through to the CDS date", () => {
  const grid: DeadlineGrid = { ...NO_DEADLINES, regular: "2027-01-05" }; // no ed date in the grid
  const admissionProfile = { early_decision: { first: { closing: { month: 11, day: 1 } } } };
  const resolved = deadlineFor("ed", null, admissionProfile, 2026, { text: null, date: null }, { deadlines: grid });
  assert.deepEqual(resolved, { date: "2026-11-01", text: null, source: "reported" });
});

test("deadlineFor: 'rolling' in the grid is a word, not a date, and beats the CDS date", () => {
  const grid: DeadlineGrid = { ...NO_DEADLINES, regular: "rolling" };
  const logistics = { regular_closing: { month: 2, day: 1 } };
  const resolved = deadlineFor("rd", logistics, null, 2026, { text: null, date: null }, { deadlines: grid });
  assert.deepEqual(resolved, { date: null, text: "Rolling", source: "common-app" });
  // The rolling round itself also resolves to the word.
  const rollingRound = deadlineFor("rolling", logistics, null, 2026, { text: null, date: null }, { deadlines: grid });
  assert.deepEqual(rollingRound, { date: null, text: "Rolling", source: "common-app" });
});

test("deadlineFor: without a grid block (a non-member, or no apply argument), the CDS date still resolves as before", () => {
  const logistics = { regular_closing: { month: 2, day: 1 } };
  const resolved = deadlineFor("rd", logistics, null, 2026, { text: null, date: null });
  assert.deepEqual(resolved, { date: "2027-02-01", text: null, source: "reported" });
});

test("deadlineFor: the student's override is the last resort, after the grid and the CDS", () => {
  const resolved = deadlineFor("rd", null, null, 2026, { text: "Check their site", date: null }, { deadlines: NO_DEADLINES });
  assert.deepEqual(resolved, { date: null, text: "Check their site", source: "student" });
});

test("deadlineFor: 'ea' resolves against the grid's REA column when that's the college's only early-action round, and vice versa", () => {
  const reaOnly: DeadlineGrid = { ...NO_DEADLINES, rea: "2026-11-01" };
  assert.equal(deadlineFor("ea", null, null, 2026, { text: null, date: null }, { deadlines: reaOnly }).date, "2026-11-01");

  const eaOnly: DeadlineGrid = { ...NO_DEADLINES, ea: "2026-11-01" };
  assert.equal(deadlineFor("rea", null, null, 2026, { text: null, date: null }, { deadlines: eaOnly }).date, "2026-11-01");
});

/* ------------------------------------------------------------------ */
/* applyDate (generators/college.ts): the Submit move uses the grid's date too                                       */
/* ------------------------------------------------------------------ */

test("applyDate: the grid's date drives the apply task when the college has one", () => {
  const school = memberSchool({ apply: member({ deadlines: { ...NO_DEADLINES, ed: "2026-11-01" } }) });
  const apply = applyDate(school, "ed");
  assert.equal(apply?.date, "2026-11-01");
  assert.equal(apply?.field, "apply.deadlines");
});

test("applyDate: without a grid date for the round, the CDS date still drives the apply task", () => {
  const school = memberSchool(); // apply has no deadlines; profile has ED closing Nov 1
  const apply = applyDate(school, "ed");
  assert.equal(apply?.date, "2026-11-01");
  assert.notEqual(apply?.field, "apply.deadlines");
});

test("applyDate: a junior reading this year's grid gets next year's date, marked last cycle (the Next steps bug of 2026-10-29)", () => {
  // Class of 2028 in October 2026: the 2026-27 grid's ED date is the current seniors' Nov 1, not hers.
  const junior = memberSchool({ cycleStartYear: 2027, apply: member({ deadlines: { ...NO_DEADLINES, ed: "2026-11-01", regular: "2027-01-05" } }) });
  const ed = applyDate(junior, "ed");
  assert.equal(ed?.date, "2027-11-01", "a year on, in senior fall for the class of 2028");
  assert.equal(ed?.field, "apply.deadlines");
  assert.equal(ed?.edition, "2026-27", "the grid's own cycle stays the edition, so the task reads 'last cycle; confirm on the college's page'");
  assert.equal(applyDate(junior, "rd")?.date, "2028-01-05");
  // A sophomore: two years on. A senior in the grid's cycle: as printed.
  assert.equal(applyDate(memberSchool({ ...junior, cycleStartYear: 2028 }), "ed")?.date, "2028-11-01");
  assert.equal(applyDate(memberSchool({ ...junior, cycleStartYear: 2026 }), "ed")?.date, "2026-11-01");
  // The CDS path already did this (resolveDay against the student's cycle); the two sources now agree for a junior.
  const cdsJunior = memberSchool({ cycleStartYear: 2027, apply: member() });
  assert.equal(applyDate(cdsJunior, "ed")?.date, "2027-11-01");
});

/* ------------------------------------------------------------------ */
/* requirementsFor: new lines on a member and a non-member                                                            */
/* ------------------------------------------------------------------ */

test("requirementsFor: a member's essays line states the personal essay, writing supplement, and Courses & Grades facts", () => {
  const school = memberSchool({ apply: member({ essay_required: true, writing_supplement: true, courses_grades_required: true }) });
  const essays = requirementsFor(item(), school, null).find((r) => r.key === "essays")!;
  assert.match(essays.text, /Personal essay required/);
  assert.match(essays.text, /writing supplement is required/);
  assert.match(essays.text, /Courses & Grades required/);
  assert.equal(essays.published, true);
});

test("requirementsFor: the 2026-27 grid never marks a writing supplement, so a false value stays unmentioned (no 'supplement not required')", () => {
  const school = memberSchool({ apply: member({ essay_required: true, writing_supplement: false, courses_grades_required: false }) });
  const essays = requirementsFor(item(), school, null).find((r) => r.key === "essays")!;
  assert.match(essays.text, /Personal essay required/);
  assert.doesNotMatch(essays.text, /writing supplement/i);
  assert.doesNotMatch(essays.text, /Courses & Grades/i);
});

test("requirementsFor: the recommendations line reads the grid's teacher/other evaluations, counselor recommendation, and mid-year report", () => {
  const school = memberSchool({ apply: member({ recommendations: { teacher: 2, other: 0, counselor: true, mid_year_report: true } }) });
  const recs = requirementsFor(item(), school, null).find((r) => r.key === "recommendations")!;
  assert.equal(recs.text, "Two teacher evaluations, a counselor recommendation, and a mid-year report.");
  assert.equal(recs.cite, "apply.recommendations");
  assert.equal(recs.published, true);
});

test("requirementsFor: the recommendations line is unpublished for a college with no grid row", () => {
  const recs = requirementsFor(item(), nonMemberSchool(), null).find((r) => r.key === "recommendations")!;
  assert.equal(recs.published, false);
  assert.match(recs.text, /hasn't published/);
});

test("requirementsFor: the fee line adds the grid's fee-waiver wording", () => {
  const accepted = memberSchool({ apply: member({ fee_waiver: "accepted" }) });
  assert.match(requirementsFor(item(), accepted, null).find((r) => r.key === "fee")!.text, /Takes the Common App fee waiver\./);

  const usOnly = memberSchool({ apply: member({ fee_waiver: "us_only" }) });
  assert.match(requirementsFor(item(), usOnly, null).find((r) => r.key === "fee")!.text, /U\.S\. applicants only/);

  const notAccepted = memberSchool({ apply: member({ fee_waiver: "not_accepted" }) });
  assert.match(requirementsFor(item(), notAccepted, null).find((r) => r.key === "fee")!.text, /Doesn't take the Common App fee waiver\./);
});

test("requirementsFor: the platform line says 'Takes the Common App' for a member with no platform picked yet; a non-member still says 'Not set yet.'", () => {
  const platformMember = requirementsFor(item(), memberSchool(), null).find((r) => r.key === "platform")!;
  assert.equal(platformMember.text, "Takes the Common App.");
  assert.equal(platformMember.cite, "apply.common_app");

  const platformNonMember = requirementsFor(item(), nonMemberSchool(), null).find((r) => r.key === "platform")!;
  assert.equal(platformNonMember.text, "Not set yet.");

  // Once the student picks a platform, their own pick wins even at a member college.
  const picked = requirementsFor(item({ application_platform: "own" }), memberSchool(), null).find((r) => r.key === "platform")!;
  assert.equal(picked.text, "The college's own application");
});

/* ------------------------------------------------------------------ */
/* platformsFor: member / non-member / UC / Texas                                                                     */
/* ------------------------------------------------------------------ */

test("platformsFor: the Common App is offered only to a member, the Coalition form only to a college on Scoir's list", () => {
  assert.deepEqual(platformsFor(memberSchool()), ["common_app", "own", "other"]);
  assert.deepEqual(platformsFor(nonMemberSchool()), ["own", "other"]);
  // No apply block at all (a plain object, as an older caller might pass): same as a non-member.
  assert.deepEqual(platformsFor({ state: "NY", type: "private-nonprofit", name: "Example College", links: null }), ["own", "other"]);
  // Coalition application (specs/data-expansion/coalition-app.md): on Scoir's list, member or not.
  const viaScoir = { member: true as const, via_scoir: true, retrieved: "2026-10-28" };
  assert.deepEqual(platformsFor({ ...memberSchool(), coalition: viaScoir }), ["common_app", "coalition", "own", "other"]);
  assert.deepEqual(platformsFor({ ...nonMemberSchool(), coalition: viaScoir }), ["coalition", "own", "other"]);
  assert.deepEqual(platformsFor({ ...nonMemberSchool(), coalition: { ...viaScoir, via_scoir: false } }), ["own", "other"]);
});

test("platformsFor: the University of California takes only its own application, member or not", () => {
  const uc = memberSchool({ state: "CA", name: "University of California-Irvine" });
  assert.deepEqual(platformsFor(uc), ["uc", "other"]);
});

test("platformsFor: a Texas public member gets ApplyTexas alongside the Common App", () => {
  const texas = memberSchool({ state: "TX", type: "public", name: "The University of Texas at Dallas" });
  assert.deepEqual(platformsFor(texas), ["common_app", "apply_texas", "own", "other"]);
});

/* ------------------------------------------------------------------ */
/* Rounds offered from the grid                                                                                       */
/* ------------------------------------------------------------------ */

test("roundDates: the grid's ISO date comes first, cited to apply.deadlines, with the grid's cycle as the edition; rolling and notifications stay with the CDS", () => {
  const base: RoundsSchool = {
    unit_id: "100",
    name: "Example",
    profile: { early_decision: { offered: true, first: { closing: { month: 11, day: 15 }, notification: { month: 12, day: 15 } }, other: { closing: null, notification: null }, applicants: null, admitted: null } },
    logistics: { edition: "2025-26", regular_closing: { month: 1, day: 15 }, priority_date: { month: 12, day: 1 }, notification: { kind: "rolling", rolling_from: { month: 10, day: 1 }, by_date: null, other_date: null, other_text: null }, reply: null, housing_deposit: null, deferred_admission: null } as unknown as RoundsSchool["logistics"],
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    admitRate: null,
    avgCost: null,
    links: null,
    apply: member({ deadlines: { ...NO_DEADLINES, ed: "2026-11-01", regular: "2027-01-01" } }),
  };
  // ED: the grid's date (not the CDS November 15), the CDS notification, the grid's cycle, this cycle.
  const ed = roundDates(base, "ed");
  assert.deepEqual(ed.closing, { iso: "2026-11-01", field: "apply.deadlines" });
  assert.equal(ed.notification?.iso, "2026-12-15");
  assert.equal(ed.edition, "2026–27");
  assert.equal(ed.lastCycle, false);
  // RD likewise; the signed-out plan and every other roundDates reader now see the grid's regular deadline.
  assert.deepEqual(roundDates(base, "rd").closing, { iso: "2027-01-01", field: "apply.deadlines" });
  // A round the grid leaves blank falls through to the CDS exactly as before.
  assert.equal(roundDates(base, "ed2").closing, null);
  // A rolling regular round has no closing date in the grid: the CDS priority date still answers for "rolling".
  const rolling: RoundsSchool = { ...base, apply: member({ deadlines: { ...NO_DEADLINES, regular: "rolling" } }) };
  assert.equal(roundDates(rolling, "rd").closing?.iso, "2027-01-15", "the CDS regular closing, since the grid gives no date");
  assert.equal(roundDates(rolling, "rolling").closing?.field, "reported.admissions_logistics.priority_date");
  // A student in the 2027–28 cycle reading the 2026-27 grid: the date a year on, last cycle, worded like a CDS edition.
  const later = roundDates({ ...base, cycleStartYear: 2027 }, "ed");
  assert.deepEqual(later.closing, { iso: "2027-11-01", field: "apply.deadlines" }, "the grid's Nov 1 in the student's own cycle");
  assert.equal(later.notification?.iso, "2027-12-15", "the CDS notification was already resolved in the student's cycle");
  assert.equal(later.lastCycle, true);
  assert.equal(lastCycleNote(later, 2027), "2026–27 dates; the college hasn't published 2027–28");
  // No grid row at all: unchanged.
  assert.equal(roundDates({ ...base, apply: null }, "ed").closing?.field, "reported.admission_profile.early_decision.first.closing");
});

test("isOffered: the grid's own deadlines decide when the college has a grid row, even against a different CDS answer", () => {
  // The CDS record says no ED; the grid (the newer, member-specific source) says otherwise.
  const school: RoundsSchool = {
    unit_id: "100",
    name: "Example",
    profile: { early_decision: { offered: false, first: { closing: null, notification: null }, other: { closing: null, notification: null }, applicants: null, admitted: null } },
    logistics: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    admitRate: null,
    avgCost: null,
    links: null,
    apply: member({ deadlines: { ...NO_DEADLINES, ed: "2026-11-01" } }),
  };
  assert.equal(isOffered(school, "ed"), true);
});

test("isOffered: a blank grid cell is a real 'not offered', not 'unpublished', when the college has a grid row", () => {
  const school: RoundsSchool = {
    unit_id: "100",
    name: "Example",
    profile: { early_decision: { offered: true, first: { closing: { month: 11, day: 1 }, notification: null }, other: { closing: null, notification: null }, applicants: null, admitted: null } },
    logistics: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    admitRate: null,
    avgCost: null,
    links: null,
    apply: member({ deadlines: NO_DEADLINES }), // every column blank: the grid says no early rounds at all
  };
  assert.equal(isOffered(school, "ed"), false);
});

test("isOffered: without a grid row at all, the CDS record still decides (unaffected)", () => {
  const school: RoundsSchool = {
    unit_id: "100",
    name: "Example",
    profile: { early_decision: { offered: true, first: { closing: { month: 11, day: 1 }, notification: null }, other: { closing: null, notification: null }, applicants: null, admitted: null } },
    logistics: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    admitRate: null,
    avgCost: null,
    links: null,
    apply: null,
  };
  assert.equal(isOffered(school, "ed"), true);
});

test("isOffered: the grid's EA II column counts toward 'ea' (the site has no separate round for it)", () => {
  const school: RoundsSchool = {
    unit_id: "100",
    name: "Example",
    profile: null,
    logistics: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    admitRate: null,
    avgCost: null,
    links: null,
    apply: member({ deadlines: { ...NO_DEADLINES, ea2: "2027-01-01" } }),
  };
  assert.equal(isOffered(school, "ea"), true);
});

test("isOffered: a rolling-only grid regular column makes 'rd' false and 'rolling' true", () => {
  const school: RoundsSchool = {
    unit_id: "100",
    name: "Example",
    profile: null,
    logistics: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    admitRate: null,
    avgCost: null,
    links: null,
    apply: member({ deadlines: { ...NO_DEADLINES, regular: "rolling" } }),
  };
  assert.equal(isOffered(school, "rolling"), true);
  assert.equal(isOffered(school, "rd"), false);
});

test("roundsOffered: a grid row alone makes the college 'published', even with no CDS record", () => {
  const school: RoundsSchool = {
    unit_id: "100",
    name: "Example",
    profile: null,
    logistics: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {},
    admitRate: null,
    avgCost: null,
    links: null,
    apply: member({ deadlines: { ...NO_DEADLINES, ed: "2026-11-01", regular: "2027-01-01" } }),
  };
  const offered = roundsOffered(school);
  assert.equal(offered.published, true);
  assert.deepEqual(offered.offered, ["ed", "rd"]);
});
