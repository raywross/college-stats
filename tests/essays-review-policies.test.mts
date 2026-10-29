/**
 * The reader's notes in the database (supabase/migrations/20261029130000_essay_reviews.sql; specs/product/essays/
 * reviewer.md "When it runs and what it keeps"), against real Postgres (PGlite + the auth stub,
 * tests/helpers/pg-auth.mts): only the student records a review, only through record_essay_review; a guardian in the
 * household reads reviews and notes and changes nothing; outsiders and anon see nothing; the caps (five per draft per
 * day, fifty per student per day, sixty per draft per cycle) answer in essay_review_allowance and hold in the record
 * function; only `state` of a note changes. The last tests break a rule and show the checks catch it. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedAsUser, asUser, createAuthDb, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const MIGRATIONS = ["20261005120000_accounts.sql", "20261029120000_essays.sql", "20261029130000_essay_reviews.sql"];

interface World {
  db: AuthDb;
  alice: string;
  mom: string;
  eve: string;
  bob: string;
  aliceStudent: string;
  essay: string;
  essay2: string;
  version: string;
  bobEssay: string;
  bobVersion: string;
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
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian" });
  const bob = await createUser(db, { email: "bob@example.com", birthYear: 2009, roleHint: "student" });
  const { id: aliceStudent } = await one(asUser<{ id: string }>(db, alice, "insert into public.students (user_id, display_name) values ($1, 'Alice') returning id", [alice]));
  const { id: bobStudent } = await one(asUser<{ id: string }>(db, bob, "insert into public.students (user_id, display_name) values ($1, 'Bob') returning id", [bob]));
  const { id: household } = await one(asUser<{ id: string }>(db, mom, "insert into public.households (name) values ('The Smiths') returning id"));
  await asUser(db, mom, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [household, mom]);
  const inv = await one(asUser<{ inv: { token: string } }>(db, mom, "select public.create_invitation($1, 'alice@example.com', 'student') as inv", [household]));
  await asUser(db, alice, "select public.accept_invitation($1)", [inv.inv.token]);
  const { id: eveHousehold } = await one(asUser<{ id: string }>(db, eve, "insert into public.households (name) values ('Eve''s') returning id"));
  await asUser(db, eve, "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'guardian')", [eveHousehold, eve]);

  const draft = async (user: string, student: string) => {
    const { id } = await one(asUser<{ id: string }>(db, user, "insert into public.essays (student_id, prompt_ref, body, count, kind) values ($1, 'platform:common_app:main', 'My draft has words.', 4, 'personal') returning id", [student]));
    const { id: v } = await one(asUser<{ id: string }>(db, user, "insert into public.essay_versions (essay_id, body, count, source) values ($1, 'My draft has words.', 4, 'typed') returning id", [id]));
    return { id, v };
  };
  const a = await draft(alice, aliceStudent);
  const a2 = await draft(alice, aliceStudent);
  const b = await draft(bob, bobStudent);
  return { db, alice, mom, eve, bob, aliceStudent, essay: a.id, essay2: a2.id, version: a.v, bobEssay: b.id, bobVersion: b.v };
}

const NOTE = { category: "mechanics", span: { paragraph: 0, start: 3, end: 8 }, observation: "This word is misspelled.", why: "Errors distract a reader.", source: null, ask: "Did you mean this word?", fix: "draft" };
const ASK = { category: "specific", span: null, observation: "The claim has no example.", why: "Readers look for a moment.", source: "https://writingcenter.unc.edu/tips-and-tools/application-essays/", ask: "What happened that day?", fix: null };

const RECORD = "select public.record_essay_review($1, $2, '2026.10.29.1', 'claude-opus-5', $3, $4::jsonb, $5::jsonb, $6::jsonb) as id";
const record = (db: AuthDb, user: string, essay: string, version: string, notes: unknown[] = [NOTE, ASK], outcome = "notes") =>
  one(asUser<{ id: string }>(db, user, RECORD, [essay, version, outcome, JSON.stringify({ input_tokens: 9000, output_tokens: 3000 }), "[]", JSON.stringify(notes)]));
const allowance = async (db: AuthDb, user: string, essay: string) =>
  (await one(asUser<{ a: { ok: boolean; reason: string | null; draft_day: number; student_day: number; draft_cycle: number } }>(db, user, "select public.essay_review_allowance($1) as a", [essay]))).a;

/** Past reviews written as the database owner (the cap counts, backdated). */
async function pastReviews(db: AuthDb, essay: string, version: string, n: number, ago: string) {
  for (let i = 0; i < n; i++) {
    await db.query(`insert into public.essay_reviews (essay_id, version_id, method, model, created) values ($1, $2, 'm', 'x', now() - $3::interval)`, [essay, version, ago]);
  }
}

/* ------------------------------------------------------------------ */
/* The student                                                         */
/* ------------------------------------------------------------------ */

test("the student records a review with its notes in order, reads them back, and marks one done", async () => {
  const { db, alice, essay, version } = await world();
  const { id } = await record(db, alice, essay, version);
  const review = await one(asUser<{ outcome: string; method: string; model: string; usage: { input_tokens: number } }>(db, alice, "select outcome, method, model, usage from public.essay_reviews where id = $1", [id]));
  assert.deepEqual(review, { outcome: "notes", method: "2026.10.29.1", model: "claude-opus-5", usage: { input_tokens: 9000, output_tokens: 3000 } });
  const notes = await asUser<{ id: string; position: number; category: string; fix: string | null; span: unknown; state: string }>(db, alice, "select id, position, category, fix, span, state from public.essay_notes where review_id = $1 order by position", [id]);
  assert.deepEqual(notes.map((n) => [n.position, n.category, n.fix, n.state]), [[0, "mechanics", "draft", "open"], [1, "specific", null, "open"]]);
  assert.deepEqual(notes[0].span, NOTE.span);
  assert.equal(notes[1].span, null);
  assert.equal(await affectedAsUser(db, alice, "update public.essay_notes set state = 'done' where id = $1", [notes[0].id]), 1);
  await assert.rejects(asUser(db, alice, "update public.essay_notes set observation = 'changed' where id = $1", [notes[0].id]), /permission denied/, "only state changes");
  await assert.rejects(asUser(db, alice, "update public.essay_notes set state = 'gone' where id = $1", [notes[0].id]), /check constraint/);
});

test("a review with no notes (nothing to note, or a refusal) is recorded and counts", async () => {
  const { db, alice, essay, version } = await world();
  await record(db, alice, essay, version, [], "none");
  await record(db, alice, essay, version, [], "refusal");
  assert.equal((await allowance(db, alice, essay)).draft_day, 2);
});

test("nobody writes a review or a note directly; the function is the only way in", async () => {
  const { db, alice, essay, version } = await world();
  await assert.rejects(asUser(db, alice, "insert into public.essay_reviews (essay_id, version_id, method, model) values ($1, $2, 'm', 'x')", [essay, version]), /permission denied/);
  const { id } = await record(db, alice, essay, version);
  await assert.rejects(asUser(db, alice, "insert into public.essay_notes (review_id, category, observation, why, ask) values ($1, 'voice', 'a', 'b', 'c?')", [id]), /permission denied/);
  await assert.rejects(asUser(db, alice, "delete from public.essay_reviews where id = $1", [id]), /permission denied/, "a review can't be deleted to reset the caps");
  await assert.rejects(asUser(db, alice, "update public.essay_reviews set created = now() - interval '2 days' where id = $1", [id]), /permission denied/, "nor backdated");
});

test("the record function checks the version, the note count, and a note's fix", async () => {
  const { db, alice, essay, essay2, version } = await world();
  await assert.rejects(record(db, alice, essay2, version), /essay_review_version/, "a version of another draft");
  await assert.rejects(record(db, alice, essay, version, Array.from({ length: 13 }, () => ASK)), /essay_review_notes/, "thirteen notes");
  await assert.rejects(record(db, alice, essay, version, [{ ...ASK, fix: "a whole new sentence" }]), /essay_notes_check|check constraint/, "a fix on a non-mechanics note");
  await assert.rejects(record(db, alice, essay, version, [{ ...ASK, category: "grade" }]), /check constraint/, "an unknown category");
  assert.equal((await allowance(db, alice, essay)).draft_day, 0, "a refused record leaves nothing behind");
});

/* ------------------------------------------------------------------ */
/* The caps                                                            */
/* ------------------------------------------------------------------ */

test("five reviews per draft per day: the allowance says so and the sixth record is refused", async () => {
  const { db, alice, essay, essay2, version } = await world();
  for (let i = 0; i < 5; i++) {
    assert.equal((await allowance(db, alice, essay)).ok, true, `review ${i + 1}`);
    await record(db, alice, essay, version);
  }
  const a = await allowance(db, alice, essay);
  assert.deepEqual([a.ok, a.reason, a.draft_day], [false, "draft_day", 5]);
  await assert.rejects(record(db, alice, essay, version), /essay_review_cap/);
  assert.equal((await allowance(db, alice, essay2)).ok, true, "another draft still has its own five");
});

test("a day is the last 24 hours: yesterday's reviews no longer count toward today's five", async () => {
  const { db, alice, essay, version } = await world();
  await pastReviews(db, essay, version, 5, "25 hours");
  const a = await allowance(db, alice, essay);
  assert.deepEqual([a.ok, a.draft_day], [true, 0]);
});

test("fifty per student per day, across drafts", async () => {
  const { db, alice, essay, essay2, version } = await world();
  const { id: v2 } = await one(asUser<{ id: string }>(db, alice, "select id from public.essay_versions where essay_id = $1", [essay2]));
  await pastReviews(db, essay2, v2, 50, "1 hour");
  const a = await allowance(db, alice, essay);
  assert.deepEqual([a.ok, a.reason, a.student_day, a.draft_day], [false, "student_day", 50, 0]);
  await assert.rejects(record(db, alice, essay, version), /essay_review_cap/);
});

test("sixty per draft per cycle (from 1 August), whatever the day", async () => {
  const { db, alice, essay, version } = await world();
  const { days } = await one(asUser<{ days: number }>(db, alice, "select extract(day from now() - public.essay_cycle_start(now()))::int as days"));
  if (days < 2) return; // The first day of a cycle: nothing earlier in it to count.
  await pastReviews(db, essay, version, 60, `${Math.min(days, 30) - 1} days`);
  const a = await allowance(db, alice, essay);
  assert.deepEqual([a.ok, a.reason, a.draft_cycle], [false, "draft_cycle", 60]);
});

test("the cycle starts on 1 August", async () => {
  const { db, alice } = await world();
  const rows = await asUser<{ a: string; b: string; c: string }>(db, alice, "select (public.essay_cycle_start('2026-07-31 23:00+00') at time zone 'UTC')::date::text as a, (public.essay_cycle_start('2026-08-01 00:30+00') at time zone 'UTC')::date::text as b, (public.essay_cycle_start('2027-01-15 12:00+00') at time zone 'UTC')::date::text as c");
  assert.deepEqual(rows[0], { a: "2025-08-01", b: "2026-08-01", c: "2026-08-01" });
});

/* ------------------------------------------------------------------ */
/* The guardian and everyone else                                      */
/* ------------------------------------------------------------------ */

test("a guardian in the household reads every review and note, and changes nothing", async () => {
  const { db, alice, mom, essay, version } = await world();
  const { id } = await record(db, alice, essay, version);
  assert.equal((await asUser(db, mom, "select id from public.essay_reviews where essay_id = $1", [essay])).length, 1);
  const notes = await asUser<{ id: string }>(db, mom, "select id from public.essay_notes where review_id = $1", [id]);
  assert.equal(notes.length, 2);
  assert.equal(await affectedAsUser(db, mom, "update public.essay_notes set state = 'ignored' where id = $1", [notes[0].id]), 0, "only the student marks a note");
  await assert.rejects(record(db, mom, essay, version), /essay_review_owner/, "a parent can't ask for a review for the student");
  assert.deepEqual(await allowance(db, mom, essay), { ok: false, reason: "not_yours" });
});

test("outsiders see nothing and can't record; anon is refused outright", async () => {
  const { db, alice, eve, bob, essay, version, bobEssay, bobVersion } = await world();
  const { id } = await record(db, alice, essay, version);
  for (const u of [eve, bob]) {
    assert.equal((await asUser(db, u, "select id from public.essay_reviews where essay_id = $1", [essay])).length, 0);
    assert.equal((await asUser(db, u, "select id from public.essay_notes where review_id = $1", [id])).length, 0);
    await assert.rejects(record(db, u, essay, version), /essay_review_owner/);
  }
  await assert.rejects(record(db, alice, bobEssay, bobVersion), /essay_review_owner/, "Alice can't record on Bob's draft");
  await assert.rejects(asUser(db, null, "select id from public.essay_reviews"), /permission denied/);
  await assert.rejects(asUser(db, null, "select public.essay_review_allowance($1)", [essay]), /permission denied/);
});

/* ------------------------------------------------------------------ */
/* The checks above must fail when a rule is broken                    */
/* ------------------------------------------------------------------ */

test("guard: with the reviews' row-level security off, the outsider check catches the leak", async () => {
  const { db, alice, eve, essay, version } = await world();
  await record(db, alice, essay, version);
  await db.exec("alter table public.essay_reviews disable row level security");
  assert.equal((await asUser(db, eve, "select id from public.essay_reviews where essay_id = $1", [essay])).length, 1, "the outsider assertion would now fail");
});

test("guard: a cap check that counts only the last hour lets the sixth review through", async () => {
  const { db, alice, essay, version } = await world();
  await pastReviews(db, essay, version, 5, "2 hours");
  assert.equal((await allowance(db, alice, essay)).ok, false);
  await db.exec(lastHourAllowanceSql());
  assert.equal((await allowance(db, alice, essay)).ok, true, "the five-a-day assertion would now fail");
});

test("guard: an update policy for guardians lets a parent mark the student's notes", async () => {
  const { db, alice, mom, essay, version } = await world();
  const { id } = await record(db, alice, essay, version);
  await db.exec(`create policy "broken" on public.essay_notes for update to authenticated using (public.can_read_review(review_id)) with check (true)`);
  const [n] = await asUser<{ id: string }>(db, mom, "select id from public.essay_notes where review_id = $1", [id]);
  assert.equal(await affectedAsUser(db, mom, "update public.essay_notes set state = 'ignored' where id = $1", [n.id]), 1, "the guardian assertion would now fail");
});

/** The allowance function rewritten to count only the last hour (a broken cap). */
function lastHourAllowanceSql(): string {
  return `
    create or replace function public.essay_review_allowance(p_essay uuid) returns jsonb
    language plpgsql stable security definer set search_path = '' as $$
    declare v int;
    begin
      select count(*) into v from public.essay_reviews r where r.essay_id = p_essay and r.created > now() - interval '1 hour';
      return jsonb_build_object('ok', v < 5, 'reason', null);
    end; $$;`;
}
