/**
 * The timeline unit (U5; specs/planner/timeline.md): the college and cycle generators, a round change through
 * mergeTasks, last-cycle wording, the calendar feed (titles only), the fold by grade, the digest's plan lines, Your
 * week, and the cycle file. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate as college, applyDate, feeDetail, resolveDay } from "../lib/planner/generators/college.ts";
import { generate as cycleGen, STALE_DAYS } from "../lib/planner/generators/cycle.ts";
import { applyMerge, dateNoteLabel, generateTasks, mergeTasks, taskKey } from "../lib/planner/tasks.ts";
import { gradeOf, loadCycle, validateCycleFile, cycleKeys, type Cycle } from "../lib/planner/cycle.ts";
import { dueSoon, dueTomorrow, feedEvents, foldAfter, isFolded, orphansToShow, outsideTitle, scrubNumbers, splitFold, windowBar, yourWeekDefault, yourWeekOn } from "../lib/planner/timeline.ts";
import { icsCalendar } from "../lib/ics.ts";
import { buildDigest } from "../lib/digest.ts";
import { buildYourWeek } from "../lib/emails/your-week.ts";
import type { GeneratorInput, PlanItem, PlanSchool, PlanTask } from "../lib/planner/types.ts";
import type { StudentProfileData } from "../lib/student-profile.ts";

const ROOT = join(import.meta.dirname, "..");
const LIST = "11111111-1111-4111-8111-111111111111";
const ITEM_A = "22222222-2222-4222-8222-222222222222";
const ITEM_B = "33333333-3333-4333-8333-333333333333";
const TODAY = "2026-10-08";
const NOW = "2026-10-08T12:00:00Z";

const item = (over: Partial<PlanItem> = {}): PlanItem =>
  ({
    id: ITEM_A,
    list_id: LIST,
    unit_id: "100",
    category: "target",
    status: "considering",
    outcome: null,
    round: null,
    position: 0,
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

const cite = (edition: string) => ({ cdsEdition: edition });

/** A college with every date the generators read, from a CDS for the student's own cycle. */
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
      dates: { priority: { month: 2, day: 1 }, deadline: { month: 3, day: 1 }, no_deadline: null, notify_by: null, notify_rolling_from: null, reply_by: null, sor_pct_first_year: null, sor_pct_undergrad: null, housing: null },
      international: null,
      first_years: null,
      institutional_grants: null,
    },
    testPolicy: null,
    cycleStartYear: 2026,
    editionIsLastCycle: false,
    cites: {
      "reported.admission_profile.early_decision.first.closing": cite("2026–27"),
      "reported.admissions_logistics.regular_closing": cite("2026–27"),
    },
    applicationFee: 75,
    ...over,
  } as PlanSchool;
}

/** A college with no published dates at all. */
function emptySchool(): PlanSchool {
  return fullSchool({ unit_id: "200", name: "Quiet College", profile: null, logistics: null, aid: null, cites: {}, applicationFee: null });
}

const cycle2026: Cycle = loadCycle("2026-27");

function input(over: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    list: { id: LIST, student_id: "s1", user_id: null, name: "List", is_default: true, share_enabled: false, created_by: null, created: NOW, sort: null, rounds_plan_accepted_at: null } as GeneratorInput["list"],
    items: [item()],
    schools: { "100": fullSchool() },
    profile: null,
    cycle: cycle2026,
    grade: gradeOf(2027, TODAY),
    today: TODAY,
    visits: [],
    offers: [],
    ...over,
  };
}

const byKind = <T extends { kind: string }>(tasks: T[], kind: string): T[] => tasks.filter((t) => t.kind === kind);

test("resolveDay: July on is the cycle's first year, earlier months its second; impossible dates are null", () => {
  assert.equal(resolveDay({ month: 11, day: 1 }, 2026), "2026-11-01");
  assert.equal(resolveDay({ month: 1, day: 15 }, 2026), "2027-01-15");
  assert.equal(resolveDay({ month: 2, day: 30 }, 2026), null);
  assert.equal(resolveDay({ month: null, day: 1 }, 2026), null);
  assert.equal(resolveDay(null, 2026), null);
});

test("college generator, full data: apply by round with fee and waiver, decision, aid forms, every task cited", () => {
  const tasks = college(input({ items: [item({ round: "ed" })] }));
  const apply = byKind(tasks, "apply")[0];
  assert.equal(apply.key, taskKey(ITEM_A, "apply"));
  assert.equal(apply.title, "Apply (ED I)");
  assert.equal(apply.due_on, "2026-11-01");
  assert.equal(apply.source_field, "reported.admission_profile.early_decision.first.closing");
  assert.equal(apply.source_edition, "2026–27");
  assert.equal(apply.date_note, null);
  assert.match(apply.detail!, /\$75 application fee; fee waivers offered/);

  const decision = byKind(tasks, "decision_expected")[0];
  assert.equal(decision.due_on, "2026-12-15");
  assert.equal(decision.title, "Decision expected (ED I)");

  const aid = byKind(tasks, "aid_forms")[0];
  assert.equal(aid.title, "Aid forms: FAFSA, CSS Profile");
  assert.equal(aid.due_on, "2027-02-01", "the earliest aid date: the priority date");
  assert.equal(aid.assignee, "guardian");
  assert.equal(aid.source_field, "reported.aid.dates");

  assert.equal(byKind(tasks, "reply_by").length, 0, "no reply task before an admit");
  assert.equal(byKind(tasks, "housing_deposit").length, 0, "no housing deposit before enrolling");
  for (const t of tasks) {
    assert.ok(t.source_field, `${t.kind} names its field`);
    assert.ok(t.source_edition, `${t.kind} names its edition`);
    assert.equal(t.source, "college");
  }

  // Each round reads its own field.
  assert.equal(applyDate(fullSchool(), "ea")?.date, "2026-11-15");
  assert.equal(applyDate(fullSchool(), "ed2")?.date, "2027-01-05");
  assert.equal(applyDate(fullSchool(), "rd")?.date, "2027-01-15");
  assert.equal(applyDate(fullSchool(), "rolling")?.date, "2026-12-01");
  assert.equal(applyDate(fullSchool(), null)?.field, "reported.admissions_logistics.regular_closing");
});

test("college generator: reply once admitted, housing deposit once enrolling", () => {
  const tasks = college(input({ items: [item({ round: "rd", outcome: "admitted", enrolling: true })] }));
  const reply = byKind(tasks, "reply_by")[0];
  assert.equal(reply.due_on, "2027-05-01");
  assert.match(reply.detail!, /2 weeks after the admit/);
  const housing = byKind(tasks, "housing_deposit")[0];
  assert.equal(housing.due_on, "2027-05-01");
  assert.equal(housing.detail, "$300 deposit, partly refundable.");
  assert.equal(housing.assignee, "guardian");
});

test("college generator: an ED II college beside an ED I one gets the conditional application, not a plain one", () => {
  const items = [item({ id: ITEM_A, unit_id: "100", round: "ed" }), item({ id: ITEM_B, unit_id: "300", round: "ed2", position: 1 })];
  const schools = { "100": fullSchool(), "300": fullSchool({ unit_id: "300", name: "Tufts" }) };
  const tasks = college(input({ items, schools }));
  const cond = byKind(tasks, "ed2_conditional");
  assert.equal(cond.length, 1);
  assert.equal(cond[0].item_id, ITEM_B);
  assert.equal(cond[0].title, "Apply ED II, only if Michigan isn't a yes (expected Dec 15)");
  assert.equal(cond[0].due_on, "2027-01-05");
  assert.ok(!tasks.some((t) => t.kind === "apply" && t.item_id === ITEM_B));
});

test("college generator, no data: nothing at all; the fee line is null", () => {
  const tasks = college(input({ items: [item({ unit_id: "200", round: "ed", outcome: "admitted", enrolling: true })], schools: { "200": emptySchool() } }));
  assert.deepEqual(tasks, []);
  assert.equal(feeDetail(emptySchool()), null);
  // A college missing from the dataset, and a withdrawn college, get nothing either.
  assert.deepEqual(college(input({ items: [item({ unit_id: "999" })] })), []);
  assert.deepEqual(college(input({ items: [item({ withdrawn_on: "2026-10-01" })] })), []);
});

test("college generator: a date from an earlier cycle's edition says so", () => {
  const school = fullSchool({
    cycleStartYear: 2027,
    editionIsLastCycle: true,
    cites: { "reported.admissions_logistics.regular_closing": cite("2026–27") },
  });
  const tasks = college(input({ schools: { "100": school }, cycle: loadCycle("2027-28") }));
  const apply = byKind(tasks, "apply")[0];
  assert.equal(apply.due_on, "2028-01-15", "resolved against the student's cycle");
  assert.equal(apply.date_note, "last_cycle");
  assert.equal(dateNoteLabel(apply), "Date from the 2026–27 edition: confirm on the college's page");
  // The same edition for the student whose cycle it describes: no note.
  assert.equal(byKind(college(input()), "apply")[0].date_note, null);
});

test("a round change moves the date and keeps the tick (through mergeTasks)", () => {
  const first = generateTasks(input({ items: [item({ round: "rd" })] }));
  const stored = applyMerge(LIST, [], mergeTasks([], first), NOW, (k) => `id:${k}`);
  const key = taskKey(ITEM_A, "apply");
  const ticked = stored.map((t) => (t.key === key ? { ...t, done_at: NOW, done_by: "u1" } : t));
  assert.equal(ticked.find((t) => t.key === key)!.due_on, "2027-01-15");

  const second = generateTasks(input({ items: [item({ round: "ea" })] }));
  const merge = mergeTasks(ticked, second);
  const after = applyMerge(LIST, ticked, merge, NOW);
  const apply = after.find((t) => t.key === key)!;
  assert.equal(apply.due_on, "2026-11-15", "the EA date");
  assert.equal(apply.title, "Apply (EA)");
  assert.equal(apply.done_at, NOW, "the tick stays");
  assert.equal(apply.done_by, "u1");
  assert.equal(mergeTasks(after, second).upserts.length, 0, "running again changes nothing");
});

test("cycle generator: entries that apply, once per student, assignee from the file, windows as windows", () => {
  const tasks = cycleGen(input({ items: [item()], schools: { "100": fullSchool() } }));
  const keys = tasks.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, "one task per entry");
  const fafsa = tasks.find((t) => t.key === taskKey(LIST, "cycle", "fafsa_opens"))!;
  assert.equal(fafsa.due_on, "2026-10-01");
  assert.equal(fafsa.assignee, "guardian");
  assert.equal(fafsa.item_id, null);
  assert.ok(tasks.some((t) => t.key.endsWith(":css_profile_opens")), "the college asks for the CSS Profile");
  const portal = tasks.find((t) => t.key.endsWith(":portal_checks"))!;
  assert.equal(portal.due_on, null);
  assert.ok(portal.window_start && portal.window_end);
  // A test date with a deadline is a registration step due on the deadline.
  const sat = tasks.find((t) => t.key.endsWith(":sat_2026_11"))!;
  assert.equal(sat.title, "Register for the SAT (test day Nov 7)");
  assert.equal(sat.due_on, "2026-10-23");
  // Summer-list entries belong to the offers unit; steps long past aren't generated.
  assert.ok(!tasks.some((t) => t.key.endsWith(":final_transcript")));
  assert.ok(!tasks.some((t) => t.key.endsWith(":ask_recommenders")), `ended more than ${STALE_DAYS} days ago`);
  // A guardian's own list gets no cycle tasks.
  assert.deepEqual(cycleGen(input({ list: { ...input().list, student_id: null } })), []);
});

test("cycle generator: rules that don't hold leave their entries out", () => {
  const school = fullSchool({ aid: null });
  const profile = { tests: { plansTestOptional: true }, basics: { stateOfResidence: "MI" } } as unknown as StudentProfileData;
  const tasks = cycleGen(input({ schools: { "100": school }, profile }));
  assert.ok(!tasks.some((t) => t.key.endsWith(":css_profile_opens")), "no CSS college");
  assert.ok(!tasks.some((t) => /:(sat|act)_/.test(t.key)), "test-optional: no test dates");
  assert.ok(tasks.some((t) => t.key.endsWith(":fafsa_opens")));
});

test("the fold by grade at four dates", () => {
  const t = (due: string) => ({ due_on: due, window_start: null, done_at: null });
  const jan = t("2027-01-15");
  // Class of 2028, junior fall (Oct 2026): 120 days ahead, so mid-January shows and March doesn't.
  assert.equal(gradeOf(2028, "2026-10-08"), "junior_fall");
  assert.equal(isFolded(jan, "junior_fall", "2026-10-08"), false);
  assert.equal(isFolded(t("2027-03-01"), "junior_fall", "2026-10-08"), true);
  // Class of 2027, senior fall: 75 days, so mid-January is "Later" in October and shown in December.
  assert.equal(gradeOf(2027, "2026-10-08"), "senior_fall");
  assert.equal(isFolded(jan, "senior_fall", "2026-10-08"), true);
  assert.equal(isFolded(jan, gradeOf(2027, "2026-12-01"), "2026-12-01"), false);
  // Sophomore: 60 days.
  assert.equal(gradeOf(2029, "2026-10-08"), "earlier");
  assert.equal(foldAfter("earlier", "2026-10-08"), "2026-12-07");
  // In college: nothing folds; done tasks never fold.
  assert.equal(gradeOf(2027, "2027-10-01"), "graduated");
  assert.equal(isFolded(t("2030-01-01"), "graduated", "2027-10-01"), false);
  assert.equal(isFolded({ ...t("2030-01-01"), done_at: NOW }, "senior_fall", TODAY), false);
  const { now, later } = splitFold([jan, t("2026-10-20")], "senior_fall", TODAY);
  assert.equal(now.length, 1);
  assert.equal(later.length, 1);
});

const task = (over: Partial<PlanTask>): PlanTask => ({
  id: `t${Math.random().toString(36).slice(2)}`,
  list_id: LIST,
  item_id: ITEM_A,
  key: null,
  kind: "apply",
  title: "Apply (ED I)",
  detail: "$75 application fee; fee waivers offered.",
  due_on: "2026-10-12",
  window_start: null,
  window_end: null,
  assignee: "student",
  source: "college",
  source_field: null,
  source_edition: null,
  date_note: null,
  done_at: null,
  done_by: null,
  snoozed_until: null,
  dismissed: false,
  orphaned: false,
  position: 0,
  created_by: null,
  created_at: NOW,
  ...over,
});

test("the feed: titles only, never a detail, a note, or a number", () => {
  const tasks = [
    task({ id: "a" }),
    task({ id: "b", item_id: null, kind: "cycle", title: "FAFSA opens", due_on: "2026-10-01", detail: "File early" }),
    task({ id: "c", item_id: null, kind: "own", source: "own", title: "Retake the SAT for a 1500 and send $50", due_on: "2026-11-01" }),
    task({ id: "d", item_id: null, kind: "cycle", title: "Thank your recommenders", due_on: null, window_start: "2026-11-15", window_end: "2027-01-31" }),
    task({ id: "e", dismissed: true }),
  ];
  const visits = [{ id: "v", item_id: ITEM_A, kind: "campus_tour" as const, on_date: "2026-10-20", at_time: "10:00", notes: { free: "Loved the 3.9 GPA vibe" } }];
  const events = feedEvents(tasks, visits, { [ITEM_A]: "Michigan" });
  assert.deepEqual(
    events.map((e) => e.summary),
    ["FAFSA opens", "Michigan: apply (ED I)", "Michigan: campus tour", "Retake the SAT for a and send", "Thank your recommenders (until Jan 31)"],
  );
  const ics = icsCalendar(events, { name: "Quad plan", stamp: NOW });
  assert.ok(!/DESCRIPTION:/.test(ics), "no descriptions");
  assert.ok(!ics.includes("$") && !ics.includes("1500") && !ics.includes("3.9") && !ics.includes("File early"));
});

test("scrubNumbers keeps a date's day and drops every other figure", () => {
  assert.equal(scrubNumbers("Register for the SAT (test day Dec 15)"), "Register for the SAT (test day Dec 15)");
  assert.doesNotMatch(scrubNumbers("Aim for 1450, GPA 3.9, 25% off, $1,200"), /\d|\$|%/);
  assert.equal(outsideTitle({ title: "Apply (ED I)" }, "Michigan"), "Michigan: apply (ED I)");
  assert.equal(outsideTitle({ title: "FAFSA opens" }, null), "FAFSA opens");
});

test("reminders: due soon, due tomorrow (hard deadlines only), orphans worth a line", () => {
  const tasks = [
    task({ id: "a", due_on: "2026-10-09" }),
    task({ id: "b", kind: "cycle", due_on: "2026-10-09" }),
    task({ id: "c", due_on: "2026-10-20" }),
    task({ id: "d", due_on: "2026-10-01" }),
    task({ id: "e", due_on: "2026-10-10", done_at: NOW }),
  ];
  assert.deepEqual(dueSoon(tasks, TODAY).map((t) => t.id).sort(), ["a", "b"]);
  assert.deepEqual(dueTomorrow(tasks, TODAY).map((t) => t.id), ["a"]);
  const orphans = orphansToShow([task({ id: "x", orphaned: true, due_on: "2027-01-05" }), task({ id: "y", orphaned: true, due_on: "2026-01-05" })], TODAY);
  assert.deepEqual(orphans.map((t) => t.id), ["x"], "a past date ages out silently");
});

test("windowBar: months spanned, the bar, and today", () => {
  const bar = windowBar("2026-11-15", "2027-01-31", "2026-12-01");
  assert.deepEqual(bar.months, ["Nov", "Dec", "Jan"]);
  assert.ok(bar.from > 0.1 && bar.from < 0.2);
  assert.equal(bar.to, 1);
  assert.ok(bar.today !== null && bar.today > bar.from);
  assert.equal(windowBar("2026-11-15", "2027-01-31", "2027-03-01").today, null);
});

test("digest: a task due within seven days adds a line; a digest with no changes still isn't sent", () => {
  const changes = [{ publish_id: 1, published_at: NOW, unit_id: "100", field: "admissions.acceptance_rate", kind: "updated", old_value: 0.2, new_value: 0.18, old_year: null, new_year: null, source: null, old_source: null, release: null }];
  const built = buildDigest([{ unit_id: "100", name: "Michigan", changes } as never], { siteUrl: "https://q.example", unsubscribeToken: "x".repeat(40) }, { tasks: [{ title: "Michigan: apply (ED I)", when: "Nov 1" }] });
  assert.ok(built);
  assert.match(built.text, /Coming up on your plan\n\n- Michigan: apply \(ED I\) · Nov 1/);
  assert.match(built.html, /Coming up on your plan/);
  assert.equal(built.tasks.length, 1);
  assert.equal(buildDigest([], { siteUrl: "https://q.example", unsubscribeToken: "x".repeat(40) }, { tasks: [{ title: "A", when: "Nov 1" }] }), null);
});

test("Your week: lines and one link, nothing when nothing is due; the default by grade", () => {
  const base = { firstName: "Alex", siteUrl: "https://q.example", planPath: "/household/s1/plan", unsubscribeToken: "t".repeat(40) };
  assert.equal(buildYourWeek({ ...base, week: [], overdue: null }), null);
  const built = buildYourWeek({
    ...base,
    week: [{ title: "Michigan: apply (ED I)", when: "Nov 1", who: null }, { title: "FAFSA opens", when: "Oct 1", who: "Parent" }],
    overdue: { title: "Tufts: decision expected (EA)", when: "Oct 2", who: null },
  })!;
  assert.match(built.text, /Overdue: Tufts: decision expected \(EA\): Oct 2/);
  assert.match(built.text, /- FAFSA opens: Oct 1 \(Parent\)/);
  assert.match(built.text, /Open your plan: https:\/\/q\.example\/household\/s1\/plan\?utm_source=your-week/);
  assert.equal(built.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(built.unsubscribeHref, /\/unsubscribe\/t+\/week/);
  assert.equal(yourWeekDefault("junior_fall"), false);
  assert.equal(yourWeekDefault("junior_spring"), true);
  assert.equal(yourWeekDefault("senior_fall"), true);
  assert.equal(yourWeekOn(false, "senior_fall"), false);
  assert.equal(yourWeekOn(null, "earlier"), false);
});

test("the cycle file: three cycles, every entry valid, sources on every one, test dates from the publishers", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "data", "application-cycle.json"), "utf8"));
  assert.deepEqual(validateCycleFile(raw), []);
  assert.deepEqual(cycleKeys(), ["2026-27", "2027-28", "2028-29"]);
  for (const key of cycleKeys()) {
    const c = loadCycle(key);
    for (const k of ["ask_recommenders", "personal_essay_draft", "supplements", "portal_checks", "thank_recommenders", "fafsa_opens", "reply_date", "final_transcript"]) {
      assert.ok(c.entries.some((e) => e.key === k), `${key} has ${k}`);
    }
    for (const e of c.entries.filter((x) => /^(sat|act)_/.test(x.key))) {
      assert.match(e.source, /collegeboard\.org|act\.org/);
      assert.equal(e.applies, "plans_tests");
    }
  }
  // A test date with no published registration is labeled projected and has no deadline.
  const projected = loadCycle("2028-29").entries.filter((e) => /^(sat|act)_/.test(e.key));
  assert.ok(projected.length > 0);
  assert.ok(projected.every((e) => e.register_by === undefined && /projected/.test(e.label)));
});
