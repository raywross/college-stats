/**
 * Row-level security for the essay workspace (supabase/migrations/20261029120000_essays.sql;
 * specs/product/essays/workspace.md "The model": "student drafts only," and parents review and comment), against real
 * Postgres (PGlite + the auth stub, tests/helpers/pg-auth.mts). A student writes; a guardian in the household reads
 * everything and comments, but a write to a draft is refused; a student or guardian elsewhere sees nothing; versions
 * are insert-only; 200 drafts at most; a comment's author is always the caller. The last tests break a policy and
 * show the checks catch it. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedAsUser, asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const MIGRATIONS = ["20261005120000_accounts.sql", "20261029120000_essays.sql"];

interface World {
  db: AuthDb;
  alice: string; // student
  mom: string; // guardian, view only
  dad: string; // guardian, can_edit
  eve: string; // guardian in another household
  bob: string; // a student in another household
  aliceStudent: string;
  bobStudent: string;
  essay: string; // Alice's draft, with a version, a link, and her own comment
  version: string;
}

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const r = await rows;
  assert.equal(r.length, 1, `expected one row, got ${r.length}`);
  return r[0];
}

async function world(): Promise<World> {
  const db = await createAuthDb(MIGRATIONS);
  const alice = await createUser(db, { email: "alice@example.com", birthYear: 2009, roleHint: "student", displayName: "Alice" });
  const mom = await createUser(db, { email: "mom@example.com", birthYear: 1978, roleHint: "guardian", displayName: "Mom" });
  const dad = await createUser(db, { email: "dad@example.com", birthYear: 1976, roleHint: "guardian", displayName: "Dad" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });
  const bob = await createUser(db, { email: "bob@example.com", birthYear: 2009, roleHint: "student" });

  const { id: aliceStudent } = await one(asUser<{ id: string }>(db, alice, "insert into public.students (user_id, display_name) values ($1, 'Alice') returning id", [alice]));
  const { id: bobStudent } = await one(asUser<{ id: string }>(db, bob, "insert into public.students (user_id, display_name) values ($1, 'Bob') returning id", [bob]));

  const { id: household } = await one(asUser<{ id: string }>(db, mom, "insert into public.households (name) values ('The Smiths') returning id"));
  await asUser(db, mom, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [household, mom]);
  const momInv = await one(asUser<{ inv: { token: string } }>(db, mom, "select public.create_invitation($1, 'alice@example.com', 'student') as inv", [household]));
  await asUser(db, alice, "select public.accept_invitation($1)", [momInv.inv.token]);
  const dadInv = await one(asUser<{ inv: { token: string } }>(db, alice, "select public.create_invitation($1, 'dad@example.com', 'guardian', null, true) as inv", [household]));
  await asUser(db, dad, "select public.accept_invitation($1)", [dadInv.inv.token]);

  const { id: eveHousehold } = await one(asUser<{ id: string }>(db, eve, "insert into public.households (name) values ('Eve''s') returning id"));
  await asUser(db, eve, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [eveHousehold, eve]);

  const { id: essay } = await one(
    asUser<{ id: string }>(db, alice, "insert into public.essays (student_id, prompt_ref, title, body, count, kind, limit_max, limit_min) values ($1, 'platform:common_app:main', 'Main', 'My first draft.', 3, 'personal', 650, 250) returning id", [aliceStudent]),
  );
  const { id: version } = await one(asUser<{ id: string }>(db, alice, "insert into public.essay_versions (essay_id, body, count, source) values ($1, 'My first draft.', 3, 'typed') returning id", [essay]));
  await asUser(db, alice, "insert into public.essay_links (essay_id, prompt_ref) values ($1, 'college:198419:2026-27:1')", [essay]);
  await asUser(db, alice, "insert into public.essay_comments (essay_id, body) values ($1, 'Note to self')", [essay]);

  return { db, alice, mom, dad, eve, bob, aliceStudent, bobStudent, essay, version };
}

const count = async (db: AuthDb, user: string, table: string, essay: string) =>
  (await asUser(db, user, `select 1 from public.${table} where ${table === "essays" ? "id" : "essay_id"} = $1`, [essay])).length;

/* ------------------------------------------------------------------ */
/* The student                                                         */
/* ------------------------------------------------------------------ */

test("the student writes, edits, versions, links, comments, resolves, and deletes their own drafts", async () => {
  const { db, alice, essay } = await world();
  assert.equal(await affectedAsUser(db, alice, "update public.essays set body = 'Second draft here.', count = 3, status = 'ready' where id = $1", [essay]), 1);
  const row = await one(asUser<{ body: string; status: string }>(db, alice, "select body, status from public.essays where id = $1", [essay]));
  assert.deepEqual(row, { body: "Second draft here.", status: "ready" });
  for (const t of ["essay_versions", "essay_links", "essay_comments"]) assert.equal(await count(db, alice, t, essay), 1, t);
  const c = await one(asUser<{ id: string; author_role: string }>(db, alice, "select id, author_role from public.essay_comments where essay_id = $1", [essay]));
  assert.equal(c.author_role, "student");
  assert.equal(await affectedAsUser(db, alice, "update public.essay_comments set resolved_at = now() where id = $1", [c.id]), 1);
  assert.equal(await affectedAsUser(db, alice, "delete from public.essay_links where essay_id = $1", [essay]), 1);
  assert.equal(await affectedAsUser(db, alice, "delete from public.essays where id = $1", [essay]), 1);
  assert.equal(await count(db, alice, "essay_versions", essay), 0, "deleting the draft removes its versions");
});

test("a draft never changes owner, and a base must be the same student's", async () => {
  const { db, alice, bob, aliceStudent, bobStudent, essay } = await world();
  await asUser(db, alice, "update public.essays set student_id = $2 where id = $1", [essay, bobStudent]);
  const owner = await one(asUser<{ student_id: string }>(db, alice, "select student_id from public.essays where id = $1", [essay]));
  assert.equal(owner.student_id, aliceStudent, "the trigger keeps the owner");
  await assert.rejects(asUser(db, bob, "insert into public.essays (student_id, prompt_ref, base_id) values ($1, 'free', $2)", [bobStudent, essay]), /essay_base/);
  const v = await one(asUser<{ id: string; base_id: string }>(db, alice, "insert into public.essays (student_id, prompt_ref, base_id, kind) values ($1, 'college:199847:2026-27:1', $2, 'why_us') returning id, base_id", [aliceStudent, essay]));
  assert.equal(v.base_id, essay);
});

test("versions are insert-only: not even the student changes or removes one", async () => {
  const { db, alice, version } = await world();
  await assert.rejects(asUser(db, alice, "update public.essay_versions set body = 'rewritten' where id = $1", [version]), /permission denied/);
  await assert.rejects(asUser(db, alice, "delete from public.essay_versions where id = $1", [version]), /permission denied/);
});

test("200 drafts per student, then the database refuses the next", async () => {
  const { db, alice, aliceStudent } = await world();
  // 199 more beside the world's one, inserted as the owner of the database (setup only).
  await db.query("insert into public.essays (student_id, prompt_ref) select $1, 'free' from generate_series(1, 199)", [aliceStudent]);
  await assert.rejects(asUser(db, alice, "insert into public.essays (student_id, prompt_ref) values ($1, 'free')", [aliceStudent]), /essay_limit/);
});

/* ------------------------------------------------------------------ */
/* A guardian in the household                                         */
/* ------------------------------------------------------------------ */

test("a guardian in the household reads every draft, version, link, and comment, view-only or with edit access", async () => {
  const { db, mom, dad, essay } = await world();
  for (const g of [mom, dad]) {
    for (const t of ["essays", "essay_versions", "essay_links", "essay_comments"]) assert.equal(await count(db, g, t, essay), 1, t);
    const body = await one(asUser<{ body: string }>(db, g, "select body from public.essays where id = $1", [essay]));
    assert.equal(body.body, "My first draft.");
  }
});

test("a guardian comments (as themself, whatever they claim), but a write to the draft is refused, even with edit access", async () => {
  const { db, alice, mom, dad, aliceStudent, essay, version } = await world();
  const c = await one(asUser<{ author_id: string; author_role: string; resolved_at: string | null }>(db, mom, "insert into public.essay_comments (essay_id, version_id, body, author_id, author_role, anchor, resolved_at) values ($1, $2, 'Lovely opening.', $3, 'student', '{\"paragraph\":0,\"start\":0,\"end\":2}', now()) returning author_id, author_role, resolved_at", [essay, version, alice]));
  assert.deepEqual(c, { author_id: mom, author_role: "guardian", resolved_at: null });

  for (const g of [mom, dad]) {
    assert.equal(await affectedAsUser(db, g, "update public.essays set body = 'A parent helping' where id = $1", [essay]), 0, "update");
    assert.equal(await affectedAsUser(db, g, "delete from public.essays where id = $1", [essay]), 0, "delete");
    await assert.rejects(asUser(db, g, "insert into public.essays (student_id, prompt_ref) values ($1, 'free')", [aliceStudent]), /row-level security/, "insert");
    await assert.rejects(asUser(db, g, "insert into public.essay_versions (essay_id, body, source) values ($1, 'x', 'typed')", [essay]), /row-level security/, "version");
    await assert.rejects(asUser(db, g, "insert into public.essay_links (essay_id, prompt_ref) values ($1, 'free')", [essay]), /row-level security/, "link");
    assert.equal(await affectedAsUser(db, g, "update public.essay_comments set resolved_at = now() where essay_id = $1", [essay]), 0, "only the student resolves");
  }
  const body = await one(asUser<{ body: string }>(db, alice, "select body from public.essays where id = $1", [essay]));
  assert.equal(body.body, "My first draft.");
});

test("a comment's text never changes; its author removes it; nobody else does", async () => {
  const { db, alice, mom, dad, essay } = await world();
  const { id } = await one(asUser<{ id: string }>(db, mom, "insert into public.essay_comments (essay_id, body) values ($1, 'Try a stronger verb here?') returning id", [essay]));
  await assert.rejects(asUser(db, alice, "update public.essay_comments set body = 'edited' where id = $1", [id]), /permission denied/);
  assert.equal(await affectedAsUser(db, dad, "delete from public.essay_comments where id = $1", [id]), 0);
  assert.equal(await affectedAsUser(db, alice, "delete from public.essay_comments where id = $1", [id]), 0, "not even the student removes a parent's comment");
  assert.equal(await affectedAsUser(db, mom, "delete from public.essay_comments where id = $1", [id]), 1);
});

test("leaving the household ends a guardian's reading at once", async () => {
  const { db, mom, essay } = await world();
  assert.equal(await count(db, mom, "essays", essay), 1);
  await asUser(db, mom, "delete from public.household_members where user_id = $1", [mom]);
  for (const t of ["essays", "essay_versions", "essay_comments"]) assert.equal(await count(db, mom, t, essay), 0, t);
});

/* ------------------------------------------------------------------ */
/* Everyone else                                                       */
/* ------------------------------------------------------------------ */

test("a student in another household and a guardian elsewhere see nothing and can't comment", async () => {
  const { db, eve, bob, aliceStudent, essay } = await world();
  for (const u of [eve, bob]) {
    for (const t of ["essays", "essay_versions", "essay_links", "essay_comments"]) assert.equal(await count(db, u, t, essay), 0, t);
    assert.deepEqual(await asUser(db, u, "select id from public.essays where student_id = $1", [aliceStudent]), []);
    await assert.rejects(asUser(db, u, "insert into public.essay_comments (essay_id, body) values ($1, 'hi')", [essay]), /row-level security/);
    await assert.rejects(asUser(db, u, "insert into public.essays (student_id, prompt_ref) values ($1, 'free')", [aliceStudent]), /row-level security/);
    assert.equal(await affectedAsUser(db, u, "update public.essays set body = 'x' where id = $1", [essay]), 0);
  }
});

test("signed out, nothing: the tables are never served to anon", async () => {
  const { db, essay } = await world();
  await assert.rejects(asUser(db, null as unknown as string, "select id from public.essays where id = $1", [essay]), /permission denied/);
});

test("a managed student (no account) has no drafts: the guardian who manages them can't write one", async () => {
  const { db, mom } = await world();
  const { id: managed } = await one(asUser<{ id: string }>(db, mom, "insert into public.students (managed_by, display_name) values ($1, 'Kid') returning id", [mom]));
  await assert.rejects(asUser(db, mom, "insert into public.essays (student_id, prompt_ref) values ($1, 'free')", [managed]), /row-level security/);
});

/* ------------------------------------------------------------------ */
/* The checks above must fail when a policy is broken                  */
/* ------------------------------------------------------------------ */

test("guard: with row-level security off, the outsider check catches the leak", async () => {
  const { db, eve, essay } = await world();
  await db.exec("alter table public.essays disable row level security");
  assert.equal(await count(db, eve, "essays", essay), 1, "the outsider assertion would now fail because the row leaked");
});

test("guard: an update policy on can_edit_student lets the editing guardian rewrite the draft", async () => {
  const { db, dad, essay } = await world();
  await db.exec(`
    drop policy "Essays: student edits" on public.essays;
    create policy "broken" on public.essays for update to authenticated using (public.can_edit_student(student_id)) with check (public.can_edit_student(student_id));
  `);
  assert.equal(await affectedAsUser(db, dad, "update public.essays set body = 'Dad was here' where id = $1", [essay]), 1, "the guardian-write-refused assertion would now fail");
});

test("guard: without the author trigger, a guardian could sign a comment as the student", async () => {
  const { db, alice, mom, essay } = await world();
  await db.exec("drop trigger essay_comments_set_author on public.essay_comments");
  const c = await one(asUser<{ author_id: string }>(db, mom, "insert into public.essay_comments (essay_id, body, author_id, author_role) values ($1, 'x', $2, 'student') returning author_id", [essay, alice]));
  assert.equal(c.author_id, alice, "the author assertion would now fail");
});
