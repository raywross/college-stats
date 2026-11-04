/**
 * The join page and "Your counselors" against real Postgres (PGlite + the auth stub, every migration up to the
 * organizations one; specs/product/counselor-portal.md "How a student joins", "The student's side"). The calls are
 * the ones app/join/[code]/actions.ts and app/account/counselor-actions.ts make, in the same order: the previews the
 * page reads signed out (fed to lib/join-rules.ts joinState), a student joining by code and by invitation for their
 * own record (made first, as currentStudent() does), a guardian joining for a child, the refusals the page turns into
 * plain words, my_counselor_grants() for the student and the parent, Can edit / View only, and End access. `npm test`.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";
import { joinState, type JoinCodePreview, type JoinInvitationPreview } from "../lib/join-rules.ts";
import { ORG_ERRORS, orgErrorMessage, type CounselorGrantView } from "../lib/org-rules.ts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const MIGRATION = "20261102120000_organizations.sql";
const CHAIN = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f <= MIGRATION).sort();

const rpc = async <T,>(db: AuthDb, who: string | null, sql: string, params: unknown[] = []) => {
  const rows = await asUser<{ v: T }>(db, who, `select ${sql} as v`, params);
  assert.equal(rows.length, 1);
  return rows[0].v;
};
/** The sentence the page would show for a refusal. */
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return orgErrorMessage((e as Error).message);
  }
  assert.fail("expected a refusal");
}

/** Mom (guardian) with Ben (managed); Alice (a student, no record yet); Ms. Rivera's office; Eve, nobody's. */
async function build() {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of CHAIN) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");

  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Tracy Smith" });
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice Smith" });
  const rivera = await createUser(db, { email: "rivera@advising.test", birthYear: 1975, roleHint: "counselor", displayName: "Ms. Rivera" });
  const lee = await createUser(db, { email: "lee@advising.test", birthYear: 1985, roleHint: "counselor", displayName: "Mr. Lee" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve Evans" });

  const household = await rpc<string>(db, mom, "public.create_household('The Smiths', 'guardian')");
  const ben = await rpc<string>(db, mom, "public.add_managed_student($1, 'Ben Smith', 2030)", [household]);
  const org = await rpc<string>(db, rivera, "public.create_organization('Rivera Advising', 'iec', null, null)");
  const code = (await db.query<{ join_code: string }>("select join_code from public.organizations where id = $1", [org])).rows[0].join_code;
  return { db, mom, alice, rivera, lee, eve, ben, org, code };
}

let base: ReturnType<typeof build> | null = null;
const opened: AuthDb[] = [];
async function world() {
  base ??= build();
  const b = await base;
  const db = (await b.db.clone()) as AuthDb;
  opened.push(db);
  return { ...b, db };
}
after(async () => {
  for (const db of opened) await db.close();
  if (base) await (await base).db.close();
});

/** What currentStudent() does for a student with no record yet. */
const ownRecord = async (db: AuthDb, user: string) =>
  (await asUser<{ id: string }>(db, user, "insert into public.students (user_id, display_name) values ($1, 'Alice Smith') returning id", [user]))[0].id;
const grants = (db: AuthDb, who: string) => asUser<CounselorGrantView>(db, who, "select * from public.my_counselor_grants()");

test("signed out: the code's preview names the organization and its counselors, and the page asks to sign in", async () => {
  const { db, code } = await world();
  const preview = await rpc<JoinCodePreview | null>(db, null, "public.org_code_preview($1)", [`quad-${code.toLowerCase()}`]);
  assert.equal(preview?.org_name, "Rivera Advising");
  assert.deepEqual(preview?.counselor_names, ["Ms. Rivera"]);
  const state = joinState({ segment: `QUAD-${code}`, codePreview: preview, invitationPreview: null, viewer: null });
  assert.equal(state.kind, "signed_out");
  assert.equal(await rpc(db, null, "public.org_code_preview('ZZZZZZ')"), null, "no such code");
});

test("a student joins by code for their own record, made first; Your counselors lists it; joining again keeps the one grant", async () => {
  const { db, alice, code } = await world();
  assert.equal(await refusal(rpc(db, alice, "public.join_organization($1, null)", [code])), ORG_ERRORS.not_a_student, "no record yet: the page makes it first");
  const record = await ownRecord(db, alice);
  const grant = await rpc<string>(db, alice, "public.join_organization($1, null)", [code]);
  const mine = await grants(db, alice);
  assert.deepEqual(
    mine.map((g) => [g.grant_id, g.org_name, g.counselor_names, g.can_edit, g.student_id]),
    [[grant, "Rivera Advising", ["Ms. Rivera"], true, record]],
  );
  assert.equal(await rpc<string>(db, alice, "public.join_organization($1, null)", [code]), grant, "the existing grant comes back");
});

test("a student accepts an invitation; the link then reads as used", async () => {
  const { db, alice, rivera, org } = await world();
  const inv = await rpc<{ token: string }>(db, rivera, "public.org_invite($1, 'student', 'alice@example.com', 'Alice', 2027)", [org]);
  const pending = await rpc<JoinInvitationPreview>(db, null, "public.org_invitation_preview($1)", [inv.token]);
  assert.equal(pending.state, "pending");
  assert.equal(pending.inviter_name, "Ms. Rivera");
  assert.equal(joinState({ segment: inv.token, codePreview: null, invitationPreview: pending, viewer: { ownStudentId: "x", guardianOf: [] } }).kind, "student");
  await ownRecord(db, alice);
  const grant = await rpc<string>(db, alice, "public.accept_org_invitation($1, null)", [inv.token]);
  assert.equal((await grants(db, alice))[0].grant_id, grant);
  const used = await rpc<JoinInvitationPreview>(db, null, "public.org_invitation_preview($1)", [inv.token]);
  const state = joinState({ segment: inv.token, codePreview: null, invitationPreview: used, viewer: null });
  assert.equal(state.kind === "closed" && state.message, ORG_ERRORS.invitation_used);
  assert.equal(await refusal(rpc(db, alice, "public.accept_org_invitation($1, null)", [inv.token])), ORG_ERRORS.invitation_used);
});

test("a guardian joins for a child they can see; the parent's grants list the child's", async () => {
  const { db, mom, ben, code } = await world();
  assert.equal(await refusal(rpc(db, mom, "public.join_organization($1, null)", [code])), ORG_ERRORS.not_a_student, "a guardian has no record of their own");
  const grant = await rpc<string>(db, mom, "public.join_organization($1, $2)", [code, ben]);
  const mine = await grants(db, mom);
  assert.deepEqual(
    mine.map((g) => [g.grant_id, g.student_id]),
    [[grant, ben]],
  );
});

test("refusals the page shows: a stranger's student, a counselor with no student, an unknown code", async () => {
  const { db, eve, lee, ben, code } = await world();
  assert.equal(await refusal(rpc(db, eve, "public.join_organization($1, $2)", [code, ben])), ORG_ERRORS.not_a_student, "Eve can't grant Ben");
  assert.equal(await refusal(rpc(db, lee, "public.join_organization($1, null)", [code])), ORG_ERRORS.not_a_student);
  assert.equal(await refusal(rpc(db, eve, "public.join_organization('ZZZZZZ', null)")), ORG_ERRORS.no_such_code);
});

test("Can edit / View only and End access: the student or the parent, never the counselor", async () => {
  const { db, mom, rivera, ben, code } = await world();
  const grant = await rpc<string>(db, mom, "public.join_organization($1, $2)", [code, ben]);
  // The counselor can't flip it (the family's grant).
  assert.match(await refusal(rpc(db, rivera, "public.set_org_student_can_edit($1, false)", [grant])), /isn't there anymore|Only the student/);
  await rpc(db, mom, "public.set_org_student_can_edit($1, false)", [grant]);
  assert.equal((await grants(db, mom))[0].can_edit, false, "View only");
  await rpc(db, mom, "public.set_org_student_can_edit($1, true)", [grant]);
  assert.equal((await grants(db, mom))[0].can_edit, true, "Can edit again");
  await rpc(db, mom, "public.end_org_access($1)", [grant]);
  assert.deepEqual(await grants(db, mom), [], "ended: the section has nothing to show");
  assert.equal(await refusal(rpc(db, mom, "public.end_org_access($1)", [grant])), ORG_ERRORS.grant_ended);
  // Joining again makes a new grant.
  assert.notEqual(await rpc<string>(db, mom, "public.join_organization($1, $2)", [code, ben]), grant);
});

test("a counselor's invitation, accepted signed in with the invited email, makes a member", async () => {
  const { db, rivera, lee, eve, org } = await world();
  const inv = await rpc<{ token: string }>(db, rivera, "public.org_invite($1, 'counselor', 'lee@advising.test', 'Mr. Lee', null)", [org]);
  const preview = await rpc<JoinInvitationPreview>(db, null, "public.org_invitation_preview($1)", [inv.token]);
  assert.equal(preview.side, "counselor");
  assert.equal(joinState({ segment: inv.token, codePreview: null, invitationPreview: preview, viewer: { ownStudentId: null, guardianOf: [] } }).kind, "counselor_invite");
  assert.equal(await refusal(rpc(db, eve, "public.accept_org_invitation($1, null)", [inv.token])), ORG_ERRORS.invitation_wrong_email);
  await rpc(db, lee, "public.accept_org_invitation($1, null)", [inv.token]);
  const mine = await rpc<{ members: { display_name: string }[] } | null>(db, lee, "public.my_organization()");
  assert.deepEqual(mine?.members.map((m) => m.display_name).sort(), ["Mr. Lee", "Ms. Rivera"], "/api/me's org flag reads true for Mr. Lee");
  assert.equal(await rpc(db, eve, "public.my_organization()"), null, "and false for Eve");
});
