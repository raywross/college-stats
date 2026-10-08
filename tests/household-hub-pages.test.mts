/**
 * The household hub's pages, pure parts (lib/household-hub.ts): reading the Add someone form, the invitation and
 * welcome links, the roster's status line, and the /account summary line. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chipActive,
  chipCaption,
  chipName,
  hubLanding,
  personActions,
  defaultAddRole,
  defaultHouseholdName,
  invitationLink,
  inviteRedirectTo,
  ownPersonPath,
  parseAddPerson,
  parseWelcome,
  requestOrigin,
  rosterLine,
  statusLabel,
  welcomePath,
} from "../lib/household-hub.ts";
import { HOUSEHOLD_ERRORS, type RosterMember } from "../lib/household-rules.ts";
import { safeNextPath } from "../lib/accounts.ts";
import { showCategoryHeaders } from "../lib/list-rules.ts";

const HH = "6f1c2a9e-4b7d-4c1e-9a2b-3d4e5f6a7b8c";
const INV = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function form(fields: Record<string, string>) {
  const m = new Map(Object.entries(fields));
  return { get: (name: string) => (m.has(name) ? m.get(name)! : null) };
}

function ok(fields: Record<string, string>, viewerEmail: string | null = null) {
  const r = parseAddPerson(form(fields), viewerEmail);
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

function err(fields: Record<string, string>, viewerEmail: string | null = null): string {
  const r = parseAddPerson(form(fields), viewerEmail);
  assert.ok(!r.ok, "expected a refusal");
  return r.message;
}

/* ------------------------------------------------------------------ */
/* Add someone                                                         */
/* ------------------------------------------------------------------ */

test("a guardian needs a first name and an email; the name joins first and last", () => {
  const v = ok({ household: HH, role: "guardian", first_name: "  Tracy ", last_name: "Ross", email: "Tracy@Example.com" });
  assert.equal(v.household, HH);
  assert.equal(v.role, "guardian");
  assert.equal(v.displayName, "Tracy Ross");
  assert.equal(v.firstName, "Tracy");
  assert.equal(v.email, "tracy@example.com");
  assert.equal(v.gradYear, null);
  assert.match(err({ household: HH, role: "guardian", first_name: "Tracy" }), /email/);
  assert.match(err({ household: HH, role: "guardian", email: "t@example.com" }), /first name/);
  assert.equal(err({ household: HH, role: "guardian", first_name: "T", email: "not-an-email" }), HOUSEHOLD_ERRORS.invalid_email);
});

test("a student's email is optional: without one it's a managed record; grad year only for students", () => {
  const managed = ok({ household: HH, role: "student", first_name: "Alex", grad_year: "2028" });
  assert.equal(managed.email, null);
  assert.equal(managed.gradYear, 2028);
  assert.equal(managed.displayName, "Alex");
  const invited = ok({ household: HH, role: "student", first_name: "Alex", email: "alex@example.com", grad_year: "" });
  assert.equal(invited.email, "alex@example.com");
  assert.equal(invited.gradYear, null);
  // A grad year sent with a guardian is ignored, not refused.
  assert.equal(ok({ household: HH, role: "guardian", first_name: "T", email: "t@example.com", grad_year: "2028" }).gradYear, null);
  assert.equal(err({ household: HH, role: "student", first_name: "Alex", grad_year: "28" }), HOUSEHOLD_ERRORS.invalid_grad_year);
  assert.equal(err({ household: HH, role: "student", first_name: "Alex", grad_year: "1999" }), HOUSEHOLD_ERRORS.invalid_grad_year);
});

test("the role must be one of the two", () => {
  assert.match(err({ household: HH, first_name: "A", email: "a@example.com" }), /parent or guardian, or a student/);
  assert.match(err({ household: HH, role: "counselor", first_name: "A", email: "a@example.com" }), /parent or guardian, or a student/);
});

test("phones are stored as E.164; a bad one is refused, an empty one is null", () => {
  assert.equal(ok({ household: HH, role: "guardian", first_name: "T", email: "t@example.com", phone: "(615) 555-0100" }).phone, "+16155550100");
  assert.equal(ok({ household: HH, role: "guardian", first_name: "T", email: "t@example.com", phone: "+44 20 7946 0958" }).phone, "+442079460958");
  assert.equal(ok({ household: HH, role: "guardian", first_name: "T", email: "t@example.com", phone: "  " }).phone, null);
  assert.equal(err({ household: HH, role: "guardian", first_name: "T", email: "t@example.com", phone: "555-0100" }), HOUSEHOLD_ERRORS.invalid_phone);
});

test("edit access is only for a guardian, and only when ticked", () => {
  assert.equal(ok({ household: HH, role: "guardian", first_name: "T", email: "t@example.com", can_edit: "on" }).canEdit, true);
  assert.equal(ok({ household: HH, role: "guardian", first_name: "T", email: "t@example.com" }).canEdit, false);
  assert.equal(ok({ household: HH, role: "student", first_name: "A", can_edit: "on" }).canEdit, false);
});

test("inviting your own email is refused before the database is asked", () => {
  assert.equal(err({ household: HH, role: "guardian", first_name: "T", email: "Me@Example.com" }, "me@example.com"), HOUSEHOLD_ERRORS.invite_self);
});

test("no household yet: a household name is required, and the viewer's side comes along", () => {
  const v = ok({ household: "", household_name: "The Ross household", my_role: "guardian", role: "student", first_name: "Alex" });
  assert.equal(v.household, null);
  assert.equal(v.householdName, "The Ross household");
  assert.equal(v.myRole, "guardian");
  assert.equal(err({ household: "", household_name: " ", role: "guardian", first_name: "T", email: "t@example.com" }), HOUSEHOLD_ERRORS.invalid_name);
  // Someone starting a household as the student adds a parent, never another student.
  assert.equal(err({ household: "", household_name: "Ours", my_role: "student", role: "student", first_name: "Sam" }), HOUSEHOLD_ERRORS.only_guardians_add_students);
  assert.equal(ok({ household: "", household_name: "Ours", my_role: "student", role: "guardian", first_name: "Mom", email: "m@example.com" }).myRole, "student");
  // A household id that isn't one is refused rather than sent on.
  assert.match(err({ household: "abc", role: "guardian", first_name: "T", email: "t@example.com" }), /household/);
});

test("the household-name field is prefilled from a name with two words or more", () => {
  assert.equal(defaultHouseholdName("Tracy Ross"), "The Ross household");
  assert.equal(defaultHouseholdName("  Mary Ann  de la Cruz "), "The Cruz household");
  assert.equal(defaultHouseholdName("Tracy"), "");
  assert.equal(defaultHouseholdName(null), "");
});

test("the role question starts on a student for a guardian and on a parent for a student", () => {
  assert.equal(defaultAddRole({ guardian: {}, student: null }), "student");
  assert.equal(defaultAddRole({ guardian: null, student: {} }), "guardian");
  assert.equal(defaultAddRole(null, "guardian"), "student");
  assert.equal(defaultAddRole(null, "student"), "guardian");
});

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

test("the invitation link is always this site's seven-day /invite/<token>", () => {
  const token = "a".repeat(64);
  assert.equal(invitationLink("https://quad.example", token), `https://quad.example/invite/${token}`);
  assert.equal(invitationLink("https://quad.example/", token), `https://quad.example/invite/${token}`);
});

test("the origin comes from the Origin header, else the forwarded host", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  assert.equal(requestOrigin(h({ origin: "https://quad.example", host: "x" })), "https://quad.example");
  assert.equal(requestOrigin(h({ "x-forwarded-proto": "https", "x-forwarded-host": "quad.example" })), "https://quad.example");
  assert.equal(requestOrigin(h({ host: "localhost:3001" })), "http://localhost:3001");
  // A junk Origin isn't trusted as is.
  assert.equal(requestOrigin(h({ origin: "null", host: "localhost:3001" })), "http://localhost:3001");
});

test("the sign-in link lands on /auth/confirm, which moves on to the password step", () => {
  assert.equal(welcomePath(INV), `/account/password?welcome=${INV}`);
  assert.equal(welcomePath(null), "/account/password?welcome=1");
  assert.equal(welcomePath("not-an-id"), "/account/password?welcome=1");
  const to = new URL(inviteRedirectTo("https://quad.example", INV));
  assert.equal(to.origin + to.pathname, "https://quad.example/auth/confirm");
  // /auth/confirm reads ?next= through safeNextPath; the welcome step must survive it intact.
  assert.equal(safeNextPath(to.searchParams.get("next")), `/account/password?welcome=${INV}`);
  assert.equal(safeNextPath(new URL(inviteRedirectTo("https://quad.example")).searchParams.get("next")), "/account/password?welcome=1");
});

test("the password page's welcome value: an id, 1, or nothing", () => {
  assert.deepEqual(parseWelcome(INV), { invitation: INV });
  assert.deepEqual(parseWelcome(INV.toUpperCase()), { invitation: INV });
  assert.deepEqual(parseWelcome("1"), { invitation: null });
  assert.deepEqual(parseWelcome([INV, "1"]), { invitation: INV });
  assert.equal(parseWelcome(undefined), null);
  assert.equal(parseWelcome(""), null);
  assert.equal(parseWelcome("yes"), null);
});

test("a person's own page is their student record's, else their user id's", () => {
  assert.equal(ownPersonPath("s1", "u1"), "/household/s1");
  assert.equal(ownPersonPath(null, "u1"), "/household/u1");
});

/* ------------------------------------------------------------------ */
/* Roster                                                              */
/* ------------------------------------------------------------------ */

function row(over: Partial<RosterMember>): RosterMember {
  return {
    member_id: "m",
    role: "student",
    user_id: null,
    student_id: "s",
    display_name: "Alex",
    can_edit: false,
    managed: false,
    managed_by_me: false,
    is_me: false,
    joined: "2026-10-01T00:00:00Z",
    status: "active",
    invitation_id: null,
    expires_at: null,
    grad_year: null,
    phone: null,
    email: null,
    ...over,
  };
}

test("status chips: Invited with its expiry, Expired, No account yet, nothing for an active member", () => {
  assert.equal(statusLabel(row({ status: "invited", expires_at: "2026-10-13T16:00:00Z" }), "America/New_York"), "Invited · expires Oct 13");
  assert.equal(statusLabel(row({ status: "invited", expires_at: null })), "Invited");
  assert.equal(statusLabel(row({ status: "expired", expires_at: "2026-10-01T00:00:00Z" })), "Expired");
  assert.equal(statusLabel(row({ status: "managed" })), "No account yet");
  assert.equal(statusLabel(row({ status: "active" })), null);
});

test("the /account summary lists names only, with (you) and (invited)", () => {
  const line = rosterLine([
    row({ display_name: "Alex" }),
    row({ role: "guardian", display_name: "Tracy", is_me: true }),
    row({ role: "guardian", member_id: null, display_name: "Jordan", status: "invited" }),
    row({ role: "guardian", member_id: null, display_name: null, status: "expired" }),
  ]);
  assert.equal(line, "Alex · Tracy (you) · Jordan (invited) · A guardian (invitation expired)");
  assert.ok(!line.includes("@"));
});

/* ------------------------------------------------------------------ */
/* The one-screen layout (household-hub.md "Redesign (2026-10-06)")    */
/* ------------------------------------------------------------------ */

test("a chip shows the first name and a tiny role or status caption", () => {
  assert.equal(chipName(row({ display_name: "Alex Ross" })), "Alex");
  assert.equal(chipName(row({ role: "guardian", display_name: null })), "A");
  assert.equal(chipCaption(row({ grad_year: 2028 })), "Student · Class of 2028");
  assert.equal(chipCaption(row({})), "Student");
  assert.equal(chipCaption(row({ grad_year: 2028, is_me: true })), "You · Class of 2028");
  assert.equal(chipCaption(row({ role: "guardian" })), "Guardian");
  assert.equal(chipCaption(row({ role: "guardian", is_me: true })), "You · Guardian");
  assert.equal(chipCaption(row({ status: "invited", grad_year: 2028 })), "Invited");
  assert.equal(chipCaption(row({ status: "expired" })), "Invite expired");
  assert.equal(chipCaption(row({ status: "managed" })), "No account yet");
  assert.equal(chipCaption(row({ status: "managed", grad_year: 2029 })), "No account yet · 2029");
});

test("a chip is active on its person's page and every page under it, and nowhere else", () => {
  assert.ok(chipActive("/household/s1", "/household/s1"));
  assert.ok(chipActive("/household/s1/numbers", "/household/s1"));
  assert.ok(chipActive("/household/s1/lists/l2", "/household/s1"));
  assert.ok(!chipActive("/household/s10", "/household/s1"));
  assert.ok(!chipActive("/household", "/household/s1"));
  assert.ok(!chipActive("/household/s1", null));
});

test("/household lands on the viewer's own page, else the first student's, else nowhere", () => {
  const alex = row({ student_id: "s-alex", display_name: "Alex" });
  const tracy = row({ role: "guardian", student_id: null, user_id: "u-tracy", is_me: true });
  assert.equal(hubLanding([]), null);
  assert.equal(hubLanding([{ members: [alex, tracy] }]), "/household/u-tracy");
  // A student's own page is their record's, even when they're a guardian too (ownPersonPath's rule).
  const selfStudent = row({ student_id: "s-me", is_me: true });
  assert.equal(hubLanding([{ members: [alex, tracy, selfStudent] }]), "/household/s-me");
  // No row of the viewer's own with a page: the first student.
  assert.equal(hubLanding([{ members: [row({ role: "guardian", user_id: "u-x" }), alex] }]), "/household/s-alex");
  // A pending guardian invitation isn't a page.
  assert.equal(hubLanding([{ members: [row({ role: "guardian", member_id: null, student_id: null, user_id: null, status: "invited", is_me: false })] }]), null);
});

test("the ⋯ menu offers what the database would allow, in a fixed order", () => {
  const me = row({ role: "guardian", user_id: "u-me", student_id: null, is_me: true, member_id: "m-me" });
  const viewer = { guardian: me, student: null };
  const managed = row({ student_id: "s1", status: "managed", managed: true, managed_by_me: true, member_id: "m-s1" });
  const members = [me, managed];
  const opts = { householdId: HH, isSelf: false };
  assert.deepEqual(personActions(viewer, managed, members, opts), ["invite", "remove"]);
  // A managed student's hand-over waiting: copy, send again, cancel; no second invite.
  const handover = { ...managed, status: "invited" as const, invitation_id: INV };
  assert.deepEqual(personActions(viewer, handover, [me, handover], opts), ["copy-link", "send-again", "cancel-invite", "remove"]);
  // Your own page: edit your profile and leave; never remove yourself.
  assert.deepEqual(personActions(viewer, me, members, { householdId: HH, isSelf: true }), ["edit-profile", "leave"]);
  // A guardian with edit access may always give it up on their own page.
  const meEditing = { ...me, can_edit: true };
  assert.deepEqual(personActions({ guardian: meEditing, student: null }, meEditing, [meEditing, managed], { householdId: HH, isSelf: true }), ["view-only", "edit-profile", "leave"]);
  // Another guardian, when every student is a managed record you made: you decide their edit access.
  const other = row({ role: "guardian", user_id: "u-o", student_id: null, member_id: "m-o" });
  assert.deepEqual(personActions(viewer, other, [me, managed, other], opts), ["allow-edit", "remove"]);
  assert.deepEqual(personActions(viewer, { ...other, can_edit: true }, [me, managed, other], opts), ["view-only", "remove"]);
  // A student viewer: grants edit access, removes nobody.
  const student = row({ student_id: "s-me", is_me: true, member_id: "m-st" });
  assert.deepEqual(personActions({ guardian: null, student }, other, [student, other], opts), ["allow-edit"]);
  // The solo view (no household, no row): only Edit your profile.
  assert.deepEqual(personActions({ guardian: null, student: null }, null, [], { householdId: "", isSelf: true }), ["edit-profile"]);
});

test("a list of only unsorted colleges shows no category header", () => {
  assert.equal(showCategoryHeaders([]), false);
  assert.equal(showCategoryHeaders([{ category: "unsorted" }, { category: "unsorted" }]), false);
  assert.equal(showCategoryHeaders([{ category: "unsorted" }, { category: "reach" }]), true);
});

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

/** An import of the invite function's client, or a call to it. */
const CALLS_INVITE_FUNCTION = /from\s+["']@\/lib\/invite-function["']|\binviteUser\(/;

test("addPerson never calls the invite function: invitations go out as /invite/<token> only", () => {
  // Its sign-in link lasts about an hour and each new one cancels the last, so it's minted only when the link is opened.
  const src = readFileSync(new URL("../app/household/actions.ts", import.meta.url), "utf8");
  assert.ok(!CALLS_INVITE_FUNCTION.test(src), "app/household/actions.ts must not call the invite Edge Function");
  assert.match(src, /invitationLink\(/);
  // The invite page's Continue is where the function is called.
  const invite = readFileSync(new URL("../app/invite/[token]/actions.ts", import.meta.url), "utf8");
  assert.match(invite, /inviteUser\(\{ token, redirectTo: inviteRedirectTo\(/);
});

test("guard: the invite-function check catches an import or a call", () => {
  assert.ok(CALLS_INVITE_FUNCTION.test('import { inviteUser } from "@/lib/invite-function";'));
  assert.ok(CALLS_INVITE_FUNCTION.test("const r = await inviteUser({ token, redirectTo });"));
  assert.ok(!CALLS_INVITE_FUNCTION.test("// the invite page calls the function (lib/invite-function.ts) at click time"));
});
