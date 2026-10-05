/**
 * Households, pure parts (lib/household-rules.ts, lib/account-export.ts): the UI's mirror of the edit-access and
 * remove rules, access-log grouping, error mapping, the invitation email, and the export registry. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRemove,
  editAccessControl,
  errorMessage,
  groupAccessLog,
  HOUSEHOLD_ERRORS,
  invitationEmail,
  isInvitationToken,
  memberName,
  viewerRoles,
  type RosterMember,
} from "../lib/household-rules.ts";
import { ACCOUNT_EXPORTERS, buildAccountExport, exportFilename, type AccountExporter, type ExportContext } from "../lib/account-export.ts";
import { INVITATION_ERRORS } from "../lib/accounts.ts";

const m = (over: Partial<RosterMember>): RosterMember => ({
  member_id: Math.random().toString(36),
  role: "guardian",
  user_id: null,
  student_id: null,
  display_name: null,
  can_edit: false,
  managed: false,
  managed_by_me: false,
  is_me: false,
  joined: "2026-10-05T00:00:00Z",
  ...over,
});

test("editAccessControl mirrors set_member_can_edit: the student decides; a guardian only over students they manage", () => {
  const dad = m({ display_name: "Dad" });
  const momMe = m({ display_name: "Mom", is_me: true });
  const alice = m({ role: "student", display_name: "Alice" });
  const ben = m({ role: "student", display_name: "Ben", managed: true, managed_by_me: true });

  // Mom (guardian) with a real student in the household: can't grant Dad, can't grant herself, can drop her own.
  let members = [momMe, dad, alice, ben];
  let me = viewerRoles(members);
  assert.deepEqual(editAccessControl(me, dad, members), { grant: false, revoke: false });
  assert.deepEqual(editAccessControl(me, momMe, members), { grant: false, revoke: true });
  assert.deepEqual(editAccessControl(me, alice, members), { grant: false, revoke: false });

  // Only Ben (managed by Mom): Mom decides for Dad.
  members = [momMe, dad, ben];
  me = viewerRoles(members);
  assert.deepEqual(editAccessControl(me, dad, members), { grant: true, revoke: true });

  // No students at all: nobody grants (the first student to join decides).
  members = [momMe, dad];
  assert.deepEqual(editAccessControl(viewerRoles(members), dad, members), { grant: false, revoke: false });

  // Alice herself decides for every guardian.
  const aliceMe = m({ role: "student", display_name: "Alice", is_me: true });
  members = [m({ display_name: "Mom" }), dad, aliceMe];
  assert.deepEqual(editAccessControl(viewerRoles(members), dad, members), { grant: true, revoke: true });
});

test("canRemove: guardians remove others; students and yourself are not removable through it", () => {
  const momMe = m({ is_me: true });
  const alice = m({ role: "student" });
  assert.equal(canRemove(viewerRoles([momMe, alice]), alice), true);
  assert.equal(canRemove(viewerRoles([momMe, alice]), momMe), false);
  const aliceMe = m({ role: "student", is_me: true });
  assert.equal(canRemove(viewerRoles([aliceMe, momMe]), momMe), false);
});

test("memberName never falls back to an email", () => {
  assert.equal(memberName(m({ display_name: "  Dad " })), "Dad");
  assert.equal(memberName(m({})), "A guardian");
  assert.equal(memberName(m({ role: "student" })), "A student");
});

test("groupAccessLog: one line per viewer, thing, and day, newest first", () => {
  const lines = groupAccessLog(
    [
      { at: "2026-10-02T15:00:00Z", table_name: "lists", viewer_id: "mom", viewer_name: "Mom" },
      { at: "2026-10-02T14:00:00Z", table_name: "list_items", viewer_id: "mom", viewer_name: "Mom" },
      { at: "2026-10-03T14:00:00Z", table_name: "student_profiles", viewer_id: "dad", viewer_name: null },
      { at: "2026-10-01T14:00:00Z", table_name: "mystery", viewer_id: "mom", viewer_name: "Mom" },
    ],
    "UTC",
  );
  assert.deepEqual(
    lines.map((l) => [l.viewer, l.what, l.day, l.count]),
    [
      ["A former guardian", "your profile", "Oct 3, 2026", 1],
      ["Mom", "your list", "Oct 2, 2026", 2],
      ["Mom", "your information", "Oct 1, 2026", 1],
    ],
  );
});

test("errorMessage maps every refusal name the SQL raises, and falls back otherwise", () => {
  assert.equal(errorMessage({ message: "only_student_grants_edit" }, HOUSEHOLD_ERRORS, "x"), HOUSEHOLD_ERRORS.only_student_grants_edit);
  assert.equal(errorMessage({ message: 'P0001: invitation_wrong_email' }, INVITATION_ERRORS, "x"), INVITATION_ERRORS.invitation_wrong_email);
  assert.equal(errorMessage({ message: "connection reset" }, HOUSEHOLD_ERRORS, "fallback"), "fallback");
  assert.equal(errorMessage(null, HOUSEHOLD_ERRORS, "fallback"), "fallback");
});

test("isInvitationToken accepts create_invitation's 64 hex characters only", () => {
  assert.equal(isInvitationToken("a".repeat(64)), true);
  for (const bad of ["A".repeat(64), "a".repeat(63), "../account", "", null, 42]) assert.equal(isInvitationToken(bad), false, String(bad));
});

test("invitationEmail escapes names and carries the link in both parts", () => {
  const mail = invitationEmail({ inviter: "<b>Mom</b>", household: "Smith & Co", side: "student", link: "https://x.test/invite/abc", siteName: "Quad", expires: "Oct 12, 2026" });
  assert.match(mail.subject, /<b>Mom<\/b> invited you to the Smith & Co household on Quad/);
  assert.ok(mail.html.includes("&lt;b&gt;Mom&lt;/b&gt;") && !mail.html.includes("<b>Mom</b>"));
  assert.ok(mail.html.includes("Smith &amp; Co"));
  assert.ok(mail.text.includes("https://x.test/invite/abc") && mail.html.includes('href="https://x.test/invite/abc"'));
  assert.ok(!/<img/i.test(mail.html), "no tracking pixels");
});

/* ------------------------------------------------------------------ */
/* Export registry                                                     */
/* ------------------------------------------------------------------ */

const ctx = { supabase: {} as ExportContext["supabase"], userId: "u1", email: "a@example.com", ownStudentId: null, studentIds: [] } satisfies ExportContext;

test("the export registry covers the spec's core tables with unique keys", () => {
  const keys = ACCOUNT_EXPORTERS.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate exporter keys");
  for (const k of ["profile", "students", "households", "memberships", "invitations_sent", "access_log"]) assert.ok(keys.includes(k), k);
  for (const e of ACCOUNT_EXPORTERS) assert.ok(e.description.length > 10, `${e.key} needs a description`);
});

test("buildAccountExport runs every exporter into one document with an index", async () => {
  const exporters: AccountExporter[] = [
    { key: "profile", description: "Your profile.", run: async (c) => ({ id: c.userId }) },
    { key: "lists", description: "Your lists.", run: async () => [{ name: "Main" }] },
  ];
  const doc = await buildAccountExport(ctx, { exporters, now: new Date("2026-10-05T10:00:00Z"), site: "Quad" });
  assert.deepEqual(doc, {
    exported_at: "2026-10-05T10:00:00.000Z",
    site: "Quad",
    contents: { profile: "Your profile.", lists: "Your lists." },
    profile: { id: "u1" },
    lists: [{ name: "Main" }],
  });
  assert.equal(exportFilename("Quad", new Date("2026-10-05T10:00:00Z")), "quad-data-2026-10-05.json");
});

test("guard: duplicate or reserved keys and a failing exporter fail the export (no partial files)", async () => {
  const ok: AccountExporter = { key: "a", description: "A.", run: async () => 1 };
  await assert.rejects(buildAccountExport(ctx, { exporters: [ok, { ...ok }], site: "Quad" }), /two exporters use the key "a"/);
  await assert.rejects(buildAccountExport(ctx, { exporters: [{ ...ok, key: "contents" }], site: "Quad" }), /reserved/);
  const broken: AccountExporter = { key: "b", description: "B.", run: async () => Promise.reject(new Error("export: reading lists failed")) };
  await assert.rejects(buildAccountExport(ctx, { exporters: [ok, broken], site: "Quad" }), /reading lists failed/);
});
