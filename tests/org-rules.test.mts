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
