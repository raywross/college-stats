/**
 * essay_bundle(p_essay) and me_bundle() (supabase/migrations/20261108130000_essay_and_me_bundles.sql) against real
 * Postgres (PGlite + the auth stub, every migration in order). essay_bundle() equals the per-table reads it replaces
 * (lib/essays/load.ts readEssay and planColleges, app/api/essays/review/route.ts readReviews: same rows, same order)
 * for the student, an editing guardian, a view-only guardian, a counselor with a grant, and an outsider (who gets null);
 * me_bundle() equals the profile read, my_organization(), is_admin_any_aal(), and lib/households.ts householdChildren()'s
 * rule run over the viewer bundle (lib/accounts.ts resolveStudentAccess), for everyone. Both are security invoker and
 * closed to anon; the migration re-runs cleanly; guard tests break a rule on purpose and show the comparison fail.
 * `npm test`.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { AUTH_STUB_SQL, createUser, type AuthDb } from "./helpers/pg-auth.mts";
import { resolveStudentAccess, type CounselorGrant, type HouseholdMember, type StudentRecord } from "../lib/accounts.ts";
import type { RosterMember } from "../lib/household-rules.ts";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const MIGRATION = "20261108130000_essay_and_me_bundles.sql";
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const SQL = readFileSync(join(DIR, MIGRATION), "utf8");

/** One statement as `who` (authenticated) or, with null, as anon. */
async function as<T = Record<string, unknown>>(db: AuthDb, who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    const role = who ? "authenticated" : "anon";
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who ? { sub: who, role, aal: "aal2" } : { role })]);
    await tx.exec(`set local role ${role}`);
    return (await tx.query<T>(sql, params)).rows;
  });
}
async function val<T>(db: AuthDb, who: string | null, expr: string, params: unknown[] = []): Promise<T> {
  const rows = await as<{ v: T }>(db, who, `select ${expr} as v`, params);
  assert.equal(rows.length, 1);
  return rows[0].v;
}
/** A table read as PostgREST returns it (rows as JSON), so it compares with the bundle's JSON directly. */
const rowsAs = <T = Record<string, unknown>,>(db: AuthDb, who: string, sql: string, params: unknown[] = []) =>
  val<T[]>(db, who, `coalesce((select jsonb_agg(to_jsonb(t)) from (${sql}) t), '[]'::jsonb)`, params);

async function boot(files: string[]): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of files) await db.exec(readFileSync(join(DIR, name), "utf8"));
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

/**
 * The world. The Smiths: Mom (edits; has a student record of her own on the roster; manages Ben, on the roster, and
 * Zed, left off every roster), Dad (view only), Alice (her own account). Mom was invited to the Olsens' and never
 * accepted (Olly is theirs). Mom also runs a counselor office with grants to Cora (no household of Mom's) and to Alice
 * (still the family's). Rivera, a counselor with a grant to Alice; Eve outside with her own student record; Quinn, an
 * admin. Rows are written as the superuser with triggers off.
 */
async function seed(db: AuthDb) {
  const u = (name: string, roleHint: string) => createUser(db, { email: `${name}@example.com`, birthYear: 1980, roleHint, displayName: name[0].toUpperCase() + name.slice(1) });
  const mom = await u("mom", "guardian");
  const dad = await u("dad", "guardian");
  const alice = await u("alice", "student");
  const olly = await u("olly", "student");
  const olsen = await u("olsen", "guardian");
  const cora = await u("cora", "student");
  const eve = await u("eve", "student");
  const rivera = await u("rivera", "counselor");
  const quinn = await u("quinn", "guardian");
  const id = () => randomUUID();
  const S = { alice: id(), ben: id(), zed: id(), momSelf: id(), olly: id(), cora: id(), eve: id() };
  const H = { smiths: id(), olsens: id(), eve: id() };
  const O = { mom: id(), rivera: id() };
  const L = { aliceIdeas: id(), alice: id(), benA: id(), benB: id(), eve: id() };
  const E = { alice: id(), aliceBase: id(), aliceVariant: id(), ben: id(), eve: id(), empty: id() };
  const q = (sql: string, params: unknown[] = []) => db.query(sql, params);
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1) + minutes * 60_000).toISOString();

  await db.exec("set session_replication_role = replica");
  for (const [sid, user, managed, name] of [
    [S.alice, alice, null, "Alice"],
    [S.ben, null, mom, "Ben"],
    [S.zed, null, mom, "Zed"],
    [S.momSelf, mom, null, "Mom (me)"],
    [S.olly, olly, null, "Olly"],
    [S.cora, cora, null, "Cora"],
    [S.eve, eve, null, "Eve"],
  ] as const) {
    await q("insert into public.students (id, user_id, managed_by, display_name, grad_year, created) values ($1, $2, $3, $4, 2027, $5)", [sid, user, managed, name, at(0)]);
  }
  await q("insert into public.households (id, name, created_by, created) values ($1, 'Smiths', $2, $3), ($4, 'Olsens', $5, $6), ($7, 'Eve', $8, $3)", [
    H.smiths, mom, at(1), H.olsens, olsen, at(2), H.eve, eve,
  ]);
  const member = (h: string, role: "guardian" | "student", who: { user?: string; student?: string }, opts: { status?: string; canEdit?: boolean; at?: string; accepted?: string | null } = {}) =>
    q("insert into public.household_members (household_id, user_id, student_id, role, status, can_edit, created, accepted_at) values ($1, $2, $3, $4, $5, $6, $7, $8)", [
      h, who.user ?? null, who.student ?? null, role, opts.status ?? "active", opts.canEdit ?? false, opts.at ?? at(10), opts.accepted === undefined ? (opts.at ?? at(10)) : opts.accepted,
    ]);
  await member(H.smiths, "guardian", { user: mom }, { canEdit: true });
  await member(H.smiths, "guardian", { user: dad });
  // Joined order on the roster: Ben (created, never accepted: a managed record), then Alice, then Mom's own record.
  await member(H.smiths, "student", { student: S.ben }, { at: at(11), accepted: null });
  await member(H.smiths, "student", { student: S.alice }, { at: at(5), accepted: at(12) });
  await member(H.smiths, "student", { student: S.momSelf }, { at: at(13) });
  await member(H.olsens, "guardian", { user: olsen });
  await member(H.olsens, "guardian", { user: mom }, { status: "invited", accepted: null });
  await member(H.olsens, "student", { student: S.olly });
  await member(H.eve, "student", { student: S.eve });
  for (const [oid, owner, code] of [[O.mom, mom, "MOMSS"], [O.rivera, rivera, "RIVERA"]] as const) {
    await q("insert into public.organizations (id, name, kind, join_code, created_by) values ($1, $2, 'iec', $3, $4)", [oid, `${code} Advising`, code, owner]);
    await q("insert into public.org_members (org_id, user_id, role) values ($1, $2, 'owner')", [oid, owner]);
  }
  await q("insert into public.org_students (org_id, student_id, source, can_edit, granted_by, granted_at) values ($1, $2, 'code', false, $3, $4), ($1, $5, 'code', false, $6, $4), ($7, $5, 'code', true, $6, $4)", [
    O.mom, S.cora, cora, at(3), S.alice, alice, O.rivera,
  ]);
  await q("insert into public.admins (user_id, note) values ($1, 'owner')", [quinn]);

  // Lists: Alice's non-default list is older than her default; Ben has two non-default lists (the first by created wins).
  for (const [lid, sid, def, name, created] of [
    [L.aliceIdeas, S.alice, false, "Ideas", at(1)],
    [L.alice, S.alice, true, "My list", at(2)],
    [L.benB, S.ben, false, "Second", at(4)],
    [L.benA, S.ben, false, "First", at(3)],
    [L.eve, S.eve, true, "My list", at(1)],
  ] as const) {
    await q("insert into public.lists (id, student_id, is_default, name, created) values ($1, $2, $3, $4, $5)", [lid, sid, def, name, created]);
  }
  for (const [lid, unit, pos] of [
    [L.alice, "204796", 1],
    [L.alice, "170976", 0],
    [L.alice, "243744", 2],
    [L.aliceIdeas, "110635", 0],
    [L.benA, "166027", 0],
    [L.benB, "130794", 0],
    [L.eve, "243780", 0],
  ] as const) {
    await q("insert into public.list_items (list_id, unit_id, position, category, status) values ($1, $2, $3, 'reach', 'applying')", [lid, unit, pos]);
  }

  // Essays: Alice's main (copied from her base, with a variant copied from it), Ben's, Eve's, and one with nothing.
  for (const [eid, sid, base, title] of [
    [E.aliceBase, S.alice, null, "Base"],
    [E.alice, S.alice, E.aliceBase, "Main"],
    [E.aliceVariant, S.alice, E.alice, "Variant"],
    [E.ben, S.ben, null, "Ben's"],
    [E.eve, S.eve, null, "Eve's"],
    [E.empty, S.alice, null, "Empty"],
  ] as const) {
    await q("insert into public.essays (id, student_id, base_id, title, body, count, limit_max, created, updated) values ($1, $2, $3, $4, 'A draft.', 2, 650, $5, $6)", [eid, sid, base, title, at(20), at(30)]);
  }
  for (const eid of [E.alice, E.ben, E.eve]) {
    // 103 versions on Alice's main (the cap is 100), two on the others; two share a timestamp (the id breaks the tie).
    const n = eid === E.alice ? 103 : 2;
    const versions: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await q("insert into public.essay_versions (essay_id, body, count, source, label, created) values ($1, $2, 2, 'typed', $3, $4) returning id", [eid, `v${i}`, i % 3 === 0 ? "Kept" : null, at(40 + Math.min(i, n - 2))]);
      versions.push((r.rows[0] as { id: string }).id);
    }
    const v = versions.at(-1)!;
    for (const [ref, c] of [["platform:common_app:main", 50], ["college:170976:1", 49], ["college:204796:1", 50]] as const) {
      await q("insert into public.essay_links (essay_id, prompt_ref, created) values ($1, $2, $3)", [eid, ref, at(c)]);
    }
    for (const [who, role, body, c, resolved] of [
      [mom, "guardian", "Nice", 60, null],
      [rivera, "counselor", "Tighten", 61, at(70)],
      [alice, "student", "Thanks", 61, null],
      [null, "guardian", "From a deleted account", 62, null],
    ] as const) {
      await q("insert into public.essay_comments (essay_id, version_id, author_id, author_role, anchor, body, created, resolved_at) values ($1, $2, $3, $4, $5, $6, $7, $8)", [
        eid, v, who, role, JSON.stringify({ paragraph: 0, start: 0, end: 4 }), body, at(c), resolved,
      ]);
    }
    for (const [who, role, status, c] of [
      [mom, "guardian", "open", 80],
      [dad, "guardian", "withdrawn", 81],
      [rivera, "counselor", "decided", 79],
      [null, "guardian", "decided", 80],
    ] as const) {
      await q("insert into public.essay_suggestions (essay_id, base_version_id, base_body, author_id, author_role, proposed_body, status, decisions, created, updated) values ($1, $2, 'A draft.', $3, $4, 'Better.', $5, $6, $7, $7)", [
        eid, v, who, role, status, JSON.stringify(status === "decided" ? { "0:1": "accepted" } : {}), at(c),
      ]);
    }
    // Twelve reviews on Alice's main (the cap is ten), one on the others; notes out of position order.
    const reviews = eid === E.alice ? 12 : 1;
    for (let i = 0; i < reviews; i++) {
      const r = await q("insert into public.essay_reviews (essay_id, version_id, method, model, outcome, created) values ($1, $2, 'rubric-1', 'model', 'notes', $3) returning id", [eid, versions[i % versions.length], at(90 + Math.min(i, 10))]);
      const rid = (r.rows[0] as { id: string }).id;
      for (const [pos, cat, fix] of [[2, "voice", null], [0, "mechanics", "its"], [1, "specific", null]] as const) {
        await q("insert into public.essay_notes (review_id, position, category, span, observation, why, ask, fix, state) values ($1, $2, $3, $4, 'o', 'w', 'a', $5, $6)", [
          rid, pos, cat, pos === 1 ? null : JSON.stringify({ paragraph: 0, start: 0, end: 3 }), fix, pos === 2 ? "done" : "open",
        ]);
      }
    }
  }
  await db.exec("set session_replication_role = origin");
  return { mom, dad, alice, olly, olsen, cora, eve, rivera, quinn, S, H, O, L, E };
}

type Seed = Awaited<ReturnType<typeof seed>>;

let world: Promise<{ db: AuthDb; w: Seed }> | null = null;
function get() {
  world ??= (async () => {
    const db = await boot(ALL);
    return { db, w: await seed(db) };
  })();
  return world;
}
after(async () => {
  if (world) await (await world).db.close();
});

const people = (w: Seed) => ({ alice: w.alice, mom: w.mom, dad: w.dad, rivera: w.rivera, eve: w.eve, olly: w.olly, olsen: w.olsen, cora: w.cora, quinn: w.quinn });

/* ------------------------------------------------------------------ */
/* essay_bundle()                                                      */
/* ------------------------------------------------------------------ */

const ESSAY_COLUMNS = "id, student_id, prompt_ref, title, count_kind, count, limit_max, limit_min, status, kind, base_id, created, updated, body";
const SUGGESTION_COLUMNS = "id, essay_id, base_version_id, base_body, author_id, author_role, proposed_body, note, status, decisions, created, updated, decided_at";
const NOTE_COLUMNS = "id, review_id, position, category, span, observation, why, source, ask, fix, state";
const REVIEW_COLUMNS = "id, version_id, created, outcome, method";

type Row = Record<string, unknown>;

/** readEssay(), readReviews(), and planColleges()'s table reads, one by one, as `who`; null when the essay isn't readable. */
async function essayByTables(db: AuthDb, who: string, essayId: string) {
  const essay = (await rowsAs(db, who, `select ${ESSAY_COLUMNS} from public.essays where id = $1`, [essayId]))[0] ?? null;
  if (!essay) return null;
  const versions = await rowsAs(db, who, "select id, essay_id, count, source, label, created from public.essay_versions where essay_id = $1 order by created desc, id limit 100", [essayId]);
  const links = await rowsAs(db, who, "select essay_id, prompt_ref, created from public.essay_links where essay_id = $1 order by created, prompt_ref", [essayId]);
  const comments = await rowsAs(db, who, "select id, essay_id, version_id, author_id, author_role, anchor, body, created, resolved_at from public.essay_comments where essay_id = $1 order by created, id", [essayId]);
  const suggestions = await rowsAs(db, who, `select ${SUGGESTION_COLUMNS} from public.essay_suggestions where essay_id = $1 and status <> 'withdrawn' order by created desc, id`, [essayId]);
  const base = essay.base_id ? ((await rowsAs(db, who, "select id, title, updated from public.essays where id = $1", [essay.base_id]))[0] ?? null) : null;
  const variants = Number(await val<number>(db, who, "(select count(*) from public.essays where base_id = $1)", [essayId]));
  // namesFor(): profiles by id, under row-level security.
  const authors = [...new Set([...comments, ...suggestions].map((c) => c.author_id).filter((v): v is string => typeof v === "string"))];
  const names = Object.fromEntries((await rowsAs<{ id: string; display_name: string | null }>(db, who, "select id, display_name from public.profiles where id = any($1::uuid[])", [authors])).map((p) => [p.id, p.display_name]));
  const named = (r: Row): Row & { author_name: string | null } => ({ ...r, author_name: r.author_id ? (names[r.author_id as string] ?? null) : null });
  // readReviews(): newest ten, their notes by position (with the review id and position kept).
  const reviewRows = await rowsAs(db, who, `select ${REVIEW_COLUMNS} from public.essay_reviews where essay_id = $1 order by created desc, id limit 10`, [essayId]);
  const notes = await rowsAs<Row & { review_id: string; position: number; id: string }>(db, who, `select ${NOTE_COLUMNS} from public.essay_notes where review_id = any($1::uuid[])`, [reviewRows.map((r) => r.id)]);
  const reviews = reviewRows.map((r) => ({ ...r, notes: notes.filter((n) => n.review_id === r.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)) }));
  // planColleges(): the student's lists, default first then by created; the default, else the first; its items by position.
  const lists = await rowsAs<{ id: string; is_default: boolean }>(db, who, "select id, is_default from public.lists where student_id = $1 order by is_default desc, created, id", [essay.student_id]);
  const list = lists.find((l) => l.is_default) ?? lists[0];
  const units = list ? (await rowsAs<{ unit_id: string }>(db, who, "select unit_id from public.list_items where list_id = $1 order by position, id", [list.id])).map((i) => i.unit_id) : [];
  return { essay, versions, links, comments: comments.map(named), suggestions: suggestions.map(named), base, variants, reviews, list_unit_ids: units };
}

type Bundle = Awaited<ReturnType<typeof essayByTables>> & {};

test("essay_bundle() equals readEssay's, readReviews', and planColleges' table reads, for every person and essay", async () => {
  const { db, w } = await get();
  let compared = 0;
  for (const [name, who] of Object.entries(people(w))) {
    for (const [ename, eid] of Object.entries(w.E)) {
      assert.deepEqual(await val(db, who, "public.essay_bundle($1)", [eid]), await essayByTables(db, who, eid), `${name} on ${ename}`);
      compared++;
    }
    assert.equal(await val(db, who, "public.essay_bundle($1)", [randomUUID()]), null, `${name}: an essay that isn't there`);
  }
  assert.equal(compared, 9 * 6);
});

test("essay_bundle(): who reads what (the student, both guardians, the counselor alike; the outsider nothing)", async () => {
  const { db, w } = await get();
  const alice = await val<Bundle>(db, w.alice, "public.essay_bundle($1)", [w.E.alice]);
  const mom = await val<Bundle>(db, w.mom, "public.essay_bundle($1)", [w.E.alice]);
  // The rows are the same for everyone who may read the essay; only the author names differ, as namesFor()'s profile
  // read does today (profiles row-level security: neither the student nor the other guardian reads Mom's profile).
  const unnamed = (b: Bundle) => ({ ...b, comments: b.comments.map((c) => ({ ...c, author_name: undefined })), suggestions: b.suggestions.map((x) => ({ ...x, author_name: undefined })) });
  for (const who of [w.mom, w.dad, w.rivera]) assert.deepEqual(unnamed(await val<Bundle>(db, who, "public.essay_bundle($1)", [w.E.alice])), unnamed(alice), "the student, an editing and a view-only guardian, and a counselor read the same rows");
  for (const who of [w.eve, w.olly, w.olsen, w.cora, w.quinn]) assert.equal(await val(db, who, "public.essay_bundle($1)", [w.E.alice]), null);
  assert.equal(await val(db, w.rivera, "public.essay_bundle($1)", [w.E.ben]), null, "Rivera's grant is Alice's, not Ben's");
  assert.notEqual(await val(db, w.dad, "public.essay_bundle($1)", [w.E.ben]), null, "Dad reads the managed child's essay");

  // The shapes the page needs, checked by hand once.
  assert.equal(alice.versions.length, 100, "at most 100 versions");
  assert.equal(alice.reviews.length, 10, "at most 10 reviews");
  assert.deepEqual(alice.reviews[0].notes.map((n) => (n as { position: number }).position), [0, 1, 2], "notes by position");
  assert.deepEqual(alice.links.map((l) => l.prompt_ref), ["college:170976:1", "college:204796:1", "platform:common_app:main"]);
  const bodies = alice.comments.map((c) => c.body as string);
  assert.deepEqual([bodies[0], [...bodies.slice(1, 3)].sort(), bodies[3]], ["Nice", ["Thanks", "Tighten"], "From a deleted account"], "by created (the tie by id)");
  assert.equal(mom.comments[0].author_name, "Mom", "Mom reads her own name");
  assert.equal(alice.comments[3].author_name, null, "no author, no name");
  assert.deepEqual(alice.suggestions.map((s) => s.status).sort(), ["decided", "decided", "open"], "withdrawn left out");
  assert.deepEqual(alice.base, { id: w.E.aliceBase, title: "Base", updated: (alice.base as { updated: string }).updated });
  assert.equal(alice.variants, 1);
  assert.deepEqual(alice.list_unit_ids, ["170976", "204796", "243744"], "the default list, by position");
  const ben = await val<Bundle>(db, w.mom, "public.essay_bundle($1)", [w.E.ben]);
  assert.deepEqual(ben.list_unit_ids, ["166027"], "no default: the first list by created");
  const empty = await val<Bundle>(db, w.alice, "public.essay_bundle($1)", [w.E.empty]);
  assert.deepEqual([empty.versions, empty.links, empty.comments, empty.suggestions, empty.reviews, empty.base, empty.variants], [[], [], [], [], [], null, 0]);
});

/* ------------------------------------------------------------------ */
/* me_bundle()                                                         */
/* ------------------------------------------------------------------ */

interface ViewerBundleJson {
  students: StudentRecord[];
  members: HouseholdMember[];
  households: { id: string; created: string; members: RosterMember[] }[];
  grants: CounselorGrant[];
}

/** /api/me's four calls as `who`: the profile row, my_organization(), is_admin_any_aal(), householdChildren() sorted as the route sorts. */
async function meByCalls(db: AuthDb, who: string) {
  const profile = (await rowsAs(db, who, "select display_name, role_hint, suspended_at from public.profiles where id = $1", [who]))[0] ?? null;
  const org = (await val<unknown>(db, who, "public.my_organization()")) !== null;
  const admin = await val<boolean>(db, who, "public.is_admin_any_aal()");
  // householdChildren(): studentsICanSee() (resolveStudentAccess over the viewer bundle) ∩ the rosters of myHouseholds().
  const vb = await val<ViewerBundleJson>(db, who, "public.viewer_bundle()");
  const access = resolveStudentAccess(who, vb.students, vb.members, vb.grants);
  const joined = new Map<string, string>();
  for (const m of vb.households.filter((h) => h.members.some((x) => x.is_me)).flatMap((h) => h.members)) {
    if (m.role === "student" && m.student_id && !joined.has(m.student_id)) joined.set(m.student_id, m.joined);
  }
  const children = access
    .flatMap((a) => (a.relation === "guardian" && joined.has(a.student.id) ? [{ id: a.student.id, name: a.student.display_name, joined: joined.get(a.student.id)! }] : []))
    .sort((a, b) => a.joined.localeCompare(b.joined) || a.id.localeCompare(b.id));
  return { profile, org, admin, children };
}

type Me = Awaited<ReturnType<typeof meByCalls>>;

test("me_bundle() equals /api/me's four calls (householdChildren's rule over the viewer bundle), for every person", async () => {
  const { db, w } = await get();
  for (const [name, who] of Object.entries(people(w))) {
    assert.deepEqual(await val(db, who, "public.me_bundle()"), await meByCalls(db, who), name);
  }
});

test("me_bundle().children: the guardian's students on a roster of hers, by joined; not her own, not one off every roster, not a pending household's, not a counselor-only student", async () => {
  const { db, w } = await get();
  const mom = await val<Me>(db, w.mom, "public.me_bundle()");
  assert.deepEqual(mom.children.map((c) => c.name), ["Ben", "Alice"], "Ben joined first (created, never accepted), Alice when she accepted");
  const ids = mom.children.map((c) => c.id);
  assert.ok(!ids.includes(w.S.momSelf), "her own student record");
  assert.ok(!ids.includes(w.S.zed), "a managed record on no roster");
  assert.ok(!ids.includes(w.S.olly), "a household where her membership is only invited");
  assert.ok(!ids.includes(w.S.cora), "a student only on her office's grant");
  assert.ok(ids.includes(w.S.alice), "a student also on her office's grant still counts as the family's");
  assert.deepEqual([mom.org, mom.admin, mom.profile?.display_name], [true, false, "Mom"]);
  const dad = await val<Me>(db, w.dad, "public.me_bundle()");
  assert.deepEqual(dad.children.map((c) => c.name), ["Ben", "Alice", "Mom (me)"], "a view-only guardian has the same children, and Mom's own record is Dad's child");
  assert.equal(dad.org, false);
  for (const who of [w.alice, w.rivera, w.eve, w.olly, w.cora]) assert.deepEqual((await val<Me>(db, who, "public.me_bundle()")).children, []);
  assert.equal((await val<Me>(db, w.rivera, "public.me_bundle()")).org, true);
  assert.equal((await val<Me>(db, w.quinn, "public.me_bundle()")).admin, true);
});

test("me_bundle(): a paused profile says so (the route answers signed out)", async () => {
  const { db, w } = await get();
  await onCopy(db, async (copy) => {
    await copy.query("update public.profiles set suspended_at = now() where id = $1", [w.dad]);
    const dad = await val<Me>(copy, w.dad, "public.me_bundle()");
    assert.notEqual(dad.profile?.suspended_at, null);
    assert.deepEqual(dad, await meByCalls(copy, w.dad));
  });
});

/* ------------------------------------------------------------------ */
/* Security and re-running                                             */
/* ------------------------------------------------------------------ */

test("both are security invoker, closed to anon, open to signed-in users", async () => {
  const { db, w } = await get();
  const rows = (await db.query<{ name: string; definer: boolean; anon: boolean; auth: boolean; path: string[] | null }>(
    `select p.proname as name, p.prosecdef as definer, has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth, p.proconfig as path
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('essay_bundle', 'me_bundle') order by 1`,
  )).rows;
  assert.deepEqual(rows, [
    { name: "essay_bundle", definer: false, anon: false, auth: true, path: ['search_path=""'] },
    { name: "me_bundle", definer: false, anon: false, auth: true, path: ['search_path=""'] },
  ]);
  await assert.rejects(as(db, null, "select public.essay_bundle($1)", [w.E.alice]), /permission denied/);
  await assert.rejects(as(db, null, "select public.me_bundle()"), /permission denied/);
});

test("the migration re-runs cleanly (create or replace)", async () => {
  const { db, w } = await get();
  await onCopy(db, async (again) => {
    await again.exec(SQL);
    assert.deepEqual(await val(again, w.mom, "public.me_bundle()"), await val(db, w.mom, "public.me_bundle()"));
  });
});

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

/** Runs `body` on a copy of the world's database, closed afterwards even when an assertion fails (an open copy keeps the run alive). */
async function onCopy(db: AuthDb, body: (copy: AuthDb) => Promise<void>): Promise<void> {
  const copy = (await db.clone()) as AuthDb;
  try {
    await body(copy);
  } finally {
    await copy.close();
  }
}

/** One function's text in the migration, from its `create or replace` to the next `until` after it. */
function fnSql(name: string, until: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}`);
  const end = SQL.indexOf(until, start);
  assert.ok(start >= 0 && end > start, `${name} in the migration`);
  return SQL.slice(start, end);
}

test("guard: a definer essay_bundle() hands the outsider the essay, and the comparison catches it", async () => {
  const { db, w } = await get();
  await onCopy(db, async (copy) => {
    await copy.exec(fnSql("essay_bundle", "/* ----").replace("security invoker", "security definer"));
    assert.notEqual(await val(copy, w.eve, "public.essay_bundle($1)", [w.E.alice]), null);
    assert.notDeepEqual(await val(copy, w.eve, "public.essay_bundle($1)", [w.E.alice]), await essayByTables(copy, w.eve, w.E.alice));
  });
});

test("guard: an essay_bundle() without the review cap differs from the table reads", async () => {
  const { db, w } = await get();
  await onCopy(db, async (copy) => {
    await copy.exec(fnSql("essay_bundle", "/* ----").replace("limit 10\n      ) r", ") r"));
    assert.equal((await val<Bundle>(copy, w.alice, "public.essay_bundle($1)", [w.E.alice])).reviews.length, 12);
    assert.notDeepEqual(await val(copy, w.alice, "public.essay_bundle($1)", [w.E.alice]), await essayByTables(copy, w.alice, w.E.alice));
  });
});

test("guard: a me_bundle() without the own-record rule lists Mom's own student record, and the comparison catches it", async () => {
  const { db, w } = await get();
  await onCopy(db, async (copy) => {
    await copy.exec(fnSql("me_bundle", "revoke execute on function public.essay_bundle").replace("and s.user_id is distinct from v_uid", ""));
    const mom = await val<Me>(copy, w.mom, "public.me_bundle()");
    assert.ok(mom.children.some((c) => c.id === w.S.momSelf));
    assert.notDeepEqual(mom, await meByCalls(copy, w.mom));
  });
});

test("guard: a me_bundle() that takes every visible student, roster or not, lists the managed record off every roster", async () => {
  const { db, w } = await get();
  await onCopy(db, async (copy) => {
    await copy.exec(fnSql("me_bundle", "revoke execute on function public.essay_bundle").replace("join rostered ro on ro.student_id = s.id", "left join rostered ro on ro.student_id = s.id"));
    const mom = await val<Me>(copy, w.mom, "public.me_bundle()");
    assert.ok(mom.children.some((c) => c.id === w.S.zed));
    assert.notDeepEqual(mom, await meByCalls(copy, w.mom));
  });
});

test("guard: a me_bundle() that ignores the counselor grants lists Cora", async () => {
  const { db, w } = await get();
  await onCopy(db, async (copy) => {
    // Put Cora on a roster Mom is in as a student member only (so she isn't the family's), then drop the grant rule.
    await copy.exec("set session_replication_role = replica");
    await copy.query("insert into public.household_members (household_id, student_id, role, status) values ($1, $2, 'student', 'active')", [w.H.eve, w.S.cora]);
    await copy.query("insert into public.household_members (household_id, student_id, role, status) values ($1, $2, 'student', 'active')", [w.H.eve, w.S.momSelf]);
    await copy.exec("set session_replication_role = origin");
    assert.deepEqual(await val(copy, w.mom, "public.me_bundle()"), await meByCalls(copy, w.mom), "intact, the rule holds with Cora on a roster of Mom's");
    assert.ok(!(await val<Me>(copy, w.mom, "public.me_bundle()")).children.some((c) => c.id === w.S.cora));
    await copy.exec(fnSql("me_bundle", "revoke execute on function public.essay_bundle").replace("or s.id not in (select gr.student_id from granted gr)", "or true"));
    const mom = await val<Me>(copy, w.mom, "public.me_bundle()");
    assert.ok(mom.children.some((c) => c.id === w.S.cora));
    assert.notDeepEqual(mom, await meByCalls(copy, w.mom));
  });
});

/* ------------------------------------------------------------------ */
/* The types                                                           */
/* ------------------------------------------------------------------ */

test("lib/bundle-read.ts names both functions and exports their shapes", () => {
  const types = readFileSync(join(import.meta.dirname, "..", "lib", "bundle-read.ts"), "utf8");
  assert.match(types, /"essay_bundle" \| "me_bundle"/);
  for (const name of ["EssayBundle", "MeBundle"]) assert.match(types, new RegExp(`export interface ${name} \\{`));
  for (const key of ["essay", "versions", "links", "comments", "suggestions", "base", "variants", "reviews", "list_unit_ids"]) {
    assert.match(types.slice(types.indexOf("export interface EssayBundle")), new RegExp(`\\n  ${key}: `), key);
  }
});
