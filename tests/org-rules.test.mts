/**
 * The counselor portal's pure rules (lib/org-rules.ts; specs/product/counselor-portal.md): the error sentences cover
 * every code the migration raises, the join-code format and its parsing (the same as the SQL's), links, the limits
 * the SQL holds, and resolveStudentAccess's counselor relation (lib/accounts.ts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  INVITATION_TOKEN_RE,
  JOIN_CODE_RE,
  ORG_ASKS_PER_WEEK,
  ORG_ASK_NOTE_MAX,
  ORG_ERRORS,
  ORG_INVITATION_DAYS,
  ORG_NAME_MAX,
  ORG_NOTE_MAX,
  formatJoinCode,
  isInvitationToken,
  joinHref,
  orgErrorMessage,
  orgStudentHref,
  parseJoinCode,
} from "../lib/org-rules.ts";
import { resolveStudentAccess, type HouseholdMember, type StudentRecord } from "../lib/accounts.ts";
import { groupAccessLog } from "../lib/household-rules.ts";
import {
  CASELOAD_CSV_COLUMNS,
  agoLabel,
  askLabel,
  askSatisfied,
  askSentence,
  askStatusLine,
  asksThisWeek,
  assembleCaseloadStudents,
  caseloadCounts,
  caseloadCsv,
  caseloadRows,
  caseloadSizeBucket,
  filterCaseload,
  invitedStudents,
  nextMoves,
  openAskFor,
  parseStudentLines,
  type CaseloadItem,
  type CaseloadStudent,
  type CaseloadTask,
} from "../lib/org-caseload.ts";
import { emptyProfile, type StudentProfileData } from "../lib/student-profile.ts";
import { ADVISOR_STATUS_LABEL, advisorStatusFor } from "../lib/entitlements.ts";

const SQL = readFileSync(join(import.meta.dirname, "..", "supabase", "migrations", "20261102120000_organizations.sql"), "utf8");

test("ORG_ERRORS has a sentence for every code the migration raises, and the brief's codes are all there", () => {
  const raised = new Set([...SQL.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]));
  raised.delete("join_code_exhausted"); // fifty collisions in a row: never shown
  // The essays triggers this file re-creates keep their own codes (lib/essays handles them).
  for (const code of raised) if (code.startsWith("essay_")) raised.delete(code);
  for (const code of raised) assert.ok(ORG_ERRORS[code], `no sentence for ${code}`);
  for (const code of [
    "already_in_organization", "not_a_member", "owners_only", "last_owner", "no_such_code", "invitation_used",
    "invitation_expired", "invitation_revoked", "not_a_student", "already_on_caseload", "ask_limit", "ask_open", "grant_ended",
  ]) assert.ok(ORG_ERRORS[code], code);
  for (const s of Object.values(ORG_ERRORS)) assert.match(s, /^[A-Z].*[.!]$/, `"${s}" is a sentence`);
});

test("orgErrorMessage: a code, a message containing one, and anything else", () => {
  assert.equal(orgErrorMessage("ask_limit"), ORG_ERRORS.ask_limit);
  assert.equal(orgErrorMessage("ERROR: already_in_organization"), ORG_ERRORS.already_in_organization);
  // The longer code wins over one it contains.
  assert.equal(orgErrorMessage("invitation_wrong_email"), ORG_ERRORS.invitation_wrong_email);
  assert.equal(orgErrorMessage("relation \"x\" does not exist"), "Something went wrong. Try again in a moment.");
  assert.equal(orgErrorMessage(null), "Something went wrong. Try again in a moment.");
});

test("join codes: shown as QUAD-…, parsed however they're typed, letters only", () => {
  assert.equal(formatJoinCode("RIVERA"), "QUAD-RIVERA");
  for (const input of ["RIVERA", "rivera", " quad-rivera ", "QUAD RIVERA", "Quad-Riv era", "QUAD-RIVERA"]) assert.equal(parseJoinCode(input), "RIVERA", input);
  for (const input of ["", "ABC", "TOOLONGG", "QUAD-", "12345", null, 42]) assert.equal(parseJoinCode(input), null, String(input));
  assert.ok(JOIN_CODE_RE.test("BAKOMI") && !JOIN_CODE_RE.test("bakomi"));
  assert.equal(joinHref("RIVERA"), "/join/RIVERA");
  assert.equal(orgStudentHref("abc"), "/org/students/abc");
  const token = "a".repeat(64);
  assert.ok(isInvitationToken(token) && INVITATION_TOKEN_RE.test(token));
  assert.ok(!isInvitationToken("RIVERA") && !isInvitationToken("A".repeat(64)));
});

test("parseJoinCode reads input the way public.org_normalize_code does", async () => {
  const db = await PGlite.create();
  const start = SQL.indexOf("create function public.org_normalize_code");
  await db.exec(SQL.slice(start, SQL.indexOf("$$;", SQL.indexOf("as $$", start)) + 3));
  for (const input of ["rivera", " quad-rivera ", "QUAD RIVERA", "Quad-Riv era", "quadra", "QUAD-", "ab-cd"]) {
    const sql = (await db.query<{ v: string | null }>("select public.org_normalize_code($1) as v", [input])).rows[0].v;
    const ts = parseJoinCode(input);
    assert.equal(ts, sql && JOIN_CODE_RE.test(sql) ? sql : null, input);
  }
  await db.close();
});

test("generated codes are six letters, consonant then vowel, and never read as the QUAD- prefix", async () => {
  const db = await PGlite.create();
  const start = SQL.indexOf("create function public.org_random_code");
  await db.exec(SQL.slice(start, SQL.indexOf("$$;", SQL.indexOf("as $$", start)) + 3));
  const codes = (await db.query<{ c: string }>("select public.org_random_code() as c from generate_series(1, 300)")).rows.map((r) => r.c);
  for (const c of codes) {
    assert.match(c, /^[BCDFGHJKLMNPRSTVWZ][AEIOU][BCDFGHJKLMNPRSTVWZ][AEIOU][BCDFGHJKLMNPRSTVWZ][AEIOU]$/);
    assert.ok(JOIN_CODE_RE.test(c) && !c.startsWith("QUAD"));
  }
  assert.ok(new Set(codes).size > 290, "random enough");
  await db.close();
});

test("the limits match the migration", () => {
  assert.match(SQL, new RegExp(`char_length\\(name\\) between 1 and ${ORG_NAME_MAX}`));
  assert.match(SQL, new RegExp(`now\\(\\) \\+ interval '${ORG_INVITATION_DAYS} days'`));
  assert.match(SQL, new RegExp(`char_length\\(note\\) between 1 and ${ORG_ASK_NOTE_MAX}`));
  assert.match(SQL, new RegExp(`interval '7 days'\\) >= ${ORG_ASKS_PER_WEEK}`));
  assert.match(SQL, new RegExp(`char_length\\(body\\) between 1 and ${ORG_NOTE_MAX}`));
});

/* ------------------------------------------------------------------ */
/* resolveStudentAccess with grants                                    */
/* ------------------------------------------------------------------ */

const student = (id: string, over: Partial<StudentRecord> = {}): StudentRecord => ({
  id, user_id: null, display_name: id, grad_year: 2027, managed_by: null, created: "2026-01-01", deleted_at: null, ...over,
});
const member = (over: Partial<HouseholdMember>): HouseholdMember => ({
  id: Math.random().toString(36), household_id: "h1", user_id: null, student_id: null, role: "student", status: "active",
  invited_email: null, can_edit: false, created: "2026-01-01", accepted_at: null, ...over,
});

test("resolveStudentAccess: counselor rows come after guardian rows, editable by the grant; the family's relation wins", () => {
  const me = "u-me";
  const students = [student("Zoe"), student("Amy"), student("Kid"), student("Me", { user_id: me }), student("Gone", { deleted_at: "2026-02-01" })];
  const members = [member({ role: "guardian", user_id: me, can_edit: false }), member({ student_id: "Kid" })];
  const grants = [
    { org_id: "o1", student_id: "Zoe", can_edit: true },
    { org_id: "o1", student_id: "Amy", can_edit: false },
    { org_id: "o1", student_id: "Kid", can_edit: true },
    { org_id: "o1", student_id: "Gone", can_edit: true },
  ];
  const access = resolveStudentAccess(me, students, members, grants);
  assert.deepEqual(access.map((a) => [a.student.id, a.relation, a.canEdit]), [
    ["Me", "self", true],
    ["Kid", "guardian", false], // a view-only guardian with an editing grant still reads as the guardian
    ["Amy", "counselor", false],
    ["Zoe", "counselor", true],
  ]);
  // Without grants, nothing changes from before counselors existed.
  assert.deepEqual(resolveStudentAccess(me, students, members).map((a) => a.relation), ["self", "guardian", "guardian", "guardian"]);
  // A managed record the counselor also created stays the guardian's.
  const managed = resolveStudentAccess(me, [student("Ben", { managed_by: me })], [], [{ org_id: "o1", student_id: "Ben", can_edit: false }]);
  assert.deepEqual(managed.map((a) => [a.relation, a.canEdit]), [["guardian", true]]);
});

test("groupAccessLog: a counselor without a name reads as a counselor, not a former guardian", () => {
  const lines = groupAccessLog([
    { at: "2026-10-02T15:00:00Z", table_name: "lists", viewer_id: "c", viewer_name: null, viewer_role: "counselor" },
    { at: "2026-10-02T15:00:00Z", table_name: "lists", viewer_id: "g", viewer_name: null, viewer_role: "guardian" },
    { at: "2026-10-02T15:00:00Z", table_name: "lists", viewer_id: "r", viewer_name: "Ms. Rivera", viewer_role: "counselor" },
  ]);
  assert.deepEqual(lines.map((l) => l.viewer).sort(), ["A counselor", "A former guardian", "Ms. Rivera (counselor)"]);
});

/* ------------------------------------------------------------------ */
/* The caseload (U3: lib/org-caseload.ts)                              */
/* ------------------------------------------------------------------ */

const TODAY = "2026-11-01";
const SCHOOLS = { u1: { name: "Michigan" }, u2: { name: "Ohio State" }, u3: { name: "Miami" }, u4: { name: "Purdue" } };

function item(id: string, unit_id: string, over: Partial<CaseloadItem> = {}): CaseloadItem {
  return {
    id, unit_id, category: "target", status: "considering", outcome: null, round: "rd", position: 0, enrolling: false, visited_on: null, dream: false,
    added_at: "2026-09-01T12:00:00Z", committed_on: null, withdrawn_on: null, deadline_date: null, deadline_text: null, ...over,
  };
}
function task(id: string, over: Partial<CaseloadTask> = {}): CaseloadTask {
  return {
    id, item_id: null, kind: "own", title: "A step", due_on: null, window_start: null, window_end: null, done_at: null, dismissed: false,
    snoozed_until: null, orphaned: false, source: "cycle", created_at: "2026-09-01T12:00:00Z", position: 0, ...over,
  } as CaseloadTask;
}
function profileWith(edit: (p: StudentProfileData) => void): StudentProfileData {
  const p = emptyProfile();
  edit(p);
  return p;
}

/** Jordan: a senior applying, an overdue step, no Likely, an ED college with no estimate (never shown: money). */
const jordan: CaseloadStudent = {
  studentId: "s-jordan", name: "Jordan Lee", gradYear: 2027, canEdit: true, hasAccount: true,
  profile: profileWith((p) => {
    p.basics.highSchool = "Central High";
    p.tests.focus = "none";
    p.academics.gpa = 3.91;
    p.tests.satTotal = 1480;
  }),
  items: [
    item("i1", "u1", { category: "reach", status: "applying", round: "ed", position: 0 }),
    item("i2", "u2", { category: "target", status: "applied", round: "ea", position: 1 }),
    item("i3", "u3", { category: "target", status: "considering", round: "rd", position: 2, deadline_date: "2027-02-01" }),
  ],
  tasks: [
    task("t1", { item_id: "i1", title: "Submit the application", due_on: "2026-11-01" }),
    task("t2", { item_id: "i2", title: "Send test scores", due_on: "2026-10-20" }),
    task("t3", { title: "Ask for recommendations", due_on: "2026-10-15", done_at: "2026-10-30T15:00:00Z" }),
  ],
  visits: [{ item_id: "i1", on_date: "2026-10-01", created_at: "2026-09-20T12:00:00Z", updated_at: "2026-09-20T12:00:00Z" }],
  essays: [{ id: "e1", updated: "2026-10-31T23:30:00Z" }],
};
/** Avery: a junior who hasn't started: no record, no list. */
const avery: CaseloadStudent = { studentId: "s-avery", name: "Avery Kim", gradYear: 2028, canEdit: false, hasAccount: false, profile: null, items: [], tasks: [], visits: [], essays: [] };
/** Blake: a senior with one Likely added in August and nothing since. */
const blake: CaseloadStudent = {
  studentId: "s-blake", name: "Blake Ortiz", gradYear: 2027, canEdit: true, hasAccount: true,
  profile: profileWith((p) => { p.basics.highSchool = "Central High"; }),
  items: [item("i4", "u4", { category: "likely", added_at: "2026-08-01T12:00:00Z" })],
  tasks: [], visits: [], essays: [],
};
const STATUS = { "s-jordan": "preview", "s-avery": "preview", "s-blake": "preview" } as const;

test("caseloadRows: every column of a row, from the planner's own functions", () => {
  const rows = caseloadRows({ students: [blake, avery, jordan], schools: SCHOOLS, status: STATUS, today: TODAY });
  // The soonest open deadline first, then by name.
  assert.deepEqual(rows.map((r) => r.name), ["Jordan Lee", "Avery Kim", "Blake Ortiz"]);
  const [j, a, b] = rows;

  assert.equal(j.classOf, "Class of 2027");
  assert.equal(j.grade, "senior_fall");
  assert.equal(j.advisorStatus, "preview");
  assert.equal(j.advisorLabel, "Preview");
  assert.equal(j.record.line, "2 of 14");
  assert.deepEqual(j.record.missing.slice(0, 3), ["grades", "courses", "sports"]);
  assert.equal(j.record.missingLabels[0], "Grades");
  assert.equal(j.list.count, 3);
  assert.equal(j.list.line, "3 colleges · no Likely yet");
  assert.equal(j.list.detail, "1 Reach, 2 Targets, and no Likely yet");
  assert.equal(j.list.gaps[0], "likely_min");
  assert.equal(j.applications, "1 of 2 in");
  assert.deepEqual(j.nextDeadline, { label: "Ohio State, Oct 20 (EA)", date: "2026-10-20", overdue: true });
  assert.equal(j.dueThisWeek, 1);
  assert.deepEqual(j.lastActivity, { at: "2026-10-31T23:30:00Z", label: "Yesterday" });
  assert.deepEqual(j.signals.map((s) => s.id), ["overdue_task", "no_likely"]);
  assert.equal(j.signals[0].text, `Ohio State's "Send test scores" was due Oct 20`);
  assert.equal(j.summary, "Applying · 1 of 2 in · next: Ohio State, Oct 20 (EA)");
  assert.equal(j.needsSomething, true);

  assert.equal(a.record.line, "0 of 14");
  assert.equal(a.list.line, "No colleges yet");
  assert.equal(a.list.detail, null);
  assert.equal(a.applications, null);
  assert.equal(a.nextDeadline, null);
  assert.equal(a.lastActivity.label, "Never opened");
  assert.deepEqual(a.signals, [], "a junior in the fall gets no signals (parents.md)");
  assert.equal(a.needsSomething, true, "an empty record needs something");
  assert.equal(a.canEdit, false);

  assert.equal(b.list.line, "1 college · few Likely or Safe");
  assert.equal(b.lastActivity.label, "3 months ago");
  assert.deepEqual(b.signals.map((s) => s.id), ["no_activity"]);
});

test("caseloadRows: nothing about money or scores (the ED-estimate signal is left out; no GPA or score in a row)", () => {
  const [j] = caseloadRows({ students: [jordan], schools: SCHOOLS, status: STATUS, today: TODAY });
  assert.ok(!j.signals.some((s) => s.id === "ed_no_estimate"));
  const json = JSON.stringify(j);
  assert.ok(!json.includes("3.91") && !json.includes("1480"), "no GPA or score in the row");
});

test("guard: without the filter, the parent's ED-estimate signal would reach a counselor", async () => {
  const { stuckSignals } = await import("../lib/planner/summary.ts");
  const { NO_MONEY } = await import("../lib/planner/rounds.ts");
  const raw = stuckSignals({
    items: jordan.items, tasks: jordan.tasks, visits: jordan.visits.map((v) => ({ created_at: v.created_at, updated_at: v.updated_at ?? v.created_at })), schools: { u1: { name: "Michigan", links: null }, u2: { name: "Ohio State", links: null }, u3: { name: "Miami", links: null } },
    money: NO_MONEY, cycle: { startYear: 2026 }, grade: "senior_fall", today: TODAY,
  });
  assert.ok(raw.some((s) => s.id === "ed_no_estimate"), "the planner's own signal fires for an ED college with no estimate");
});

test("caseloadCounts: the office's line above the rows, zero parts left out", () => {
  const rows = caseloadRows({ students: [blake, avery, jordan], schools: SCHOOLS, status: STATUS, today: TODAY });
  const c = caseloadCounts(rows, 1);
  assert.equal(c.line, "3 students · 2 seniors · 1 junior · 1 with no Likely · 1 deadline this week · 1 invited");
  assert.equal(caseloadCounts([], 0).line, "0 students");
  assert.deepEqual([caseloadSizeBucket(1), caseloadSizeBucket(6), caseloadSizeBucket(100), caseloadSizeBucket(101)], ["1-5", "6-25", "26-100", "100+"]);
});

test("filterCaseload: class year, needs something, and the name search", () => {
  const rows = caseloadRows({ students: [blake, avery, jordan], schools: SCHOOLS, status: STATUS, today: TODAY });
  assert.deepEqual(filterCaseload(rows, { classOf: 2028, needs: false, q: "" }).map((r) => r.name), ["Avery Kim"]);
  assert.deepEqual(filterCaseload(rows, { classOf: null, needs: false, q: "orti" }).map((r) => r.name), ["Blake Ortiz"]);
  const needy = caseloadRows({ students: [{ ...blake, items: [...blake.items], tasks: [task("t9", { done_at: "2026-10-31T12:00:00Z" })], profile: blake.profile }], schools: SCHOOLS, status: STATUS, today: TODAY });
  assert.deepEqual(filterCaseload(needy, { classOf: null, needs: true, q: "" }), [], "a recent step done and a record started: nothing needed");
});

test("caseloadCsv: one row per college per student, an empty list as one row, the list CSV's words, never a GPA or score", () => {
  const csv = caseloadCsv([jordan, avery, blake], SCHOOLS, TODAY);
  const lines = csv.split("\n");
  assert.equal(lines[0], CASELOAD_CSV_COLUMNS.join(","));
  assert.equal(lines[0], "Student,Class of,Record sections filled,College,Level,Status,Round,Deadline,Outcome");
  assert.deepEqual(lines.slice(1), [
    "Avery Kim,2028,0 of 14,,,,,,",
    "Blake Ortiz,2027,1 of 14,Purdue,Likely,Considering,Regular decision,,",
    "Jordan Lee,2027,2 of 14,Michigan,Reach,Applying,Early decision,,",
    "Jordan Lee,2027,2 of 14,Ohio State,Target,Applied,Early action,,",
    "Jordan Lee,2027,2 of 14,Miami,Target,Considering,Regular decision,2027-02-01,",
  ]);
  assert.ok(!csv.includes("3.91") && !csv.includes("1480"));
  // A typed name can't become a spreadsheet formula, and commas are quoted.
  const odd = caseloadCsv([{ ...avery, name: "=HYPERLINK(1)" }, { ...avery, studentId: "x", name: "Lee, Sam" }], SCHOOLS, TODAY);
  assert.match(odd, /\n'=HYPERLINK\(1\),/);
  assert.match(odd, /\n"Lee, Sam",/);
});

test("asks: the family's sentence, the office's label and status, the open one, the weekly count, done by the facts", () => {
  const base = { org_name: "Rivera Advising", asked_by_name: "Ms. Rivera", note: null };
  assert.equal(askSentence({ ...base, kind: "record_section", section: "test" }), "Ms. Rivera asked you to add a test score or target.");
  assert.equal(askSentence({ ...base, kind: "list", section: null }), "Ms. Rivera asked you to add your first colleges.");
  assert.equal(askSentence({ ...base, kind: "custom", section: null, note: "Bring your activities list" }), "Ms. Rivera asked: “Bring your activities list”");
  assert.equal(askSentence({ ...base, asked_by_name: null, kind: "list", section: null }), "Rivera Advising asked you to add your first colleges.");
  assert.equal(askLabel({ kind: "record_section", section: "courses", note: null }), "AP courses");
  // Oct 27 2026 is a Tuesday; Oct 29 a Thursday.
  assert.equal(askStatusLine({ created: "2026-10-27T15:00:00Z", done_at: "2026-10-29T15:00:00Z", seen_at: "2026-10-28T15:00:00Z" }, TODAY), "Asked Tue · Done Thu");
  assert.equal(askStatusLine({ created: "2026-10-02T15:00:00Z", done_at: null, seen_at: "2026-10-03T15:00:00Z" }, TODAY), "Asked Oct 2 · Seen");
  assert.equal(askStatusLine({ created: "2026-11-01T15:00:00Z", done_at: null, seen_at: null }, TODAY), "Asked today");
  const asks = [
    { kind: "record_section" as const, section: "test", done_at: null, created: "2026-10-30T12:00:00Z" },
    { kind: "record_section" as const, section: "grades", done_at: "2026-10-31T12:00:00Z", created: "2026-10-20T12:00:00Z" },
  ];
  assert.equal(openAskFor(asks, "record_section", "test"), asks[0]);
  assert.equal(openAskFor(asks, "record_section", "grades"), null);
  assert.equal(asksThisWeek(asks, new Date("2026-11-01T12:00:00Z")), 1);
  assert.equal(askSatisfied({ kind: "record_section", section: "test" }, { profile: jordan.profile, listCount: 0 }), true);
  assert.equal(askSatisfied({ kind: "record_section", section: "grades" }, { profile: jordan.profile, listCount: 0 }), false);
  assert.equal(askSatisfied({ kind: "list", section: null }, { profile: null, listCount: 2 }), true);
  assert.equal(askSatisfied({ kind: "custom", section: null }, { profile: jordan.profile, listCount: 2 }), false, "a custom ask closes only by Done");
});

test("agoLabel, nextMoves, invitedStudents, parseStudentLines, advisorStatusFor", async () => {
  assert.deepEqual(["2026-11-01T10:00:00Z", "2026-10-29T12:00:00Z", "2026-10-18T12:00:00Z", "2025-06-01T12:00:00Z"].map((d) => agoLabel(d, TODAY)), ["Today", "3 days ago", "2 weeks ago", "Over a year ago"]);
  assert.deepEqual(nextMoves(jordan, SCHOOLS, TODAY), [
    { id: "t2", title: "Ohio State: Send test scores", when: "Oct 20", overdue: true },
    { id: "t1", title: "Michigan: Submit the application", when: "Nov 1", overdue: false },
  ]);
  const roster = [
    { status: "invited", invitation_id: "inv1", display_name: "Sam Ortiz", email: "sam@example.com", expires_at: "2026-12-01T12:00:00Z", token: "a".repeat(64) },
    { status: "expired", invitation_id: "inv2", display_name: null, email: "old@example.com", expires_at: "2026-10-01T12:00:00Z", token: null },
    { status: "active", invitation_id: null, display_name: "Jordan", email: null, expires_at: null, token: null },
  ].map((r) => ({ grant_id: null, student_id: null, grad_year: null, can_edit: null, granted_at: null, source: null, has_account: null, ...r })) as Parameters<typeof invitedStudents>[0];
  assert.deepEqual(invitedStudents(roster, "https://quad.test/", TODAY), [
    { invitationId: "inv1", name: "Sam Ortiz", email: "sam@example.com", status: "invited", line: "Invited · link works until Dec 1", link: `https://quad.test/join/${"a".repeat(64)}` },
    { invitationId: "inv2", name: "old@example.com", email: "old@example.com", status: "expired", line: "Expired Oct 1", link: null },
  ]);
  const parsed = parseStudentLines("Jordan Lee, Jordan@Example.com, 2027\n\nsam@example.com\tSam\nno email here");
  assert.deepEqual(parsed.rows, [
    { firstName: "Jordan", lastName: "Lee", email: "jordan@example.com", gradYear: 2027 },
    { firstName: "Sam", lastName: null, email: "sam@example.com", gradYear: null },
  ]);
  assert.deepEqual(parsed.errors, [{ line: 4, text: "no email here", message: "No email address on this line." }]);
  assert.deepEqual(await advisorStatusFor(["a", "b"]), { a: "preview", b: "preview" });
  assert.equal(ADVISOR_STATUS_LABEL.preview, "Preview");
});

test("assembleCaseloadStudents: the roster's live students joined with the reads; the story never reaches a counselor", () => {
  const roster = [
    { status: "active", student_id: "s1", display_name: "Jordan", grad_year: 2027, can_edit: true, has_account: true },
    { status: "active", student_id: "s2", display_name: "Avery", grad_year: null, can_edit: false, has_account: false },
    { status: "invited", student_id: null, display_name: "Sam", grad_year: null, can_edit: null, has_account: null },
  ] as Parameters<typeof assembleCaseloadStudents>[0];
  const out = assembleCaseloadStudents(roster, {
    profiles: [{ student_id: "s1", data: { basics: { gradYear: 2027 }, story: { narrative: "my private story", updatedAt: "2026-10-01T00:00:00.000Z" } } }],
    lists: [{ id: "l1", student_id: "s1", list_items: [{ ...item("i1", "u1"), plan_visits: [{ item_id: "i1", on_date: "2026-10-01", created_at: "2026-09-01T00:00:00Z", updated_at: null }] }], plan_tasks: [task("t1")] }],
    essays: [{ id: "e1", student_id: "s1", updated: "2026-10-01T00:00:00Z" }, { id: "e2", student_id: "s1", updated: "2026-10-05T00:00:00Z" }],
  });
  assert.deepEqual(out.map((s) => s.studentId), ["s1", "s2"]);
  assert.equal(out[0].items.length, 1);
  assert.ok(!("plan_visits" in out[0].items[0]));
  assert.equal(out[0].visits.length, 1);
  assert.equal(out[0].tasks.length, 1);
  assert.deepEqual(out[0].essays.map((e) => e.id), ["e2", "e1"]);
  assert.ok(!JSON.stringify(out[0].profile).includes("my private story"), "the story's text is redacted for a counselor");
  assert.equal(out[0].profile?.story?.narrative, "", "the narrative is blanked (unredacted, the sanitized profile carries it)");
  assert.deepEqual([out[1].profile, out[1].items, out[1].gradYear, out[1].canEdit], [null, [], null, false]);
});
