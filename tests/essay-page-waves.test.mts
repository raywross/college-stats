/**
 * /advisor/essays/[id] on essay_bundle() and /api/me on me_bundle() (specs/serving-architecture.md; specs/product/
 * essays/workspace.md "Where it lives"): the draft read from the bundle equals the draft read table by table; the notes
 * the page hands the panel are shaped exactly as the review route's GET shapes them, and the panel then skips its
 * fetch; the page starts the bundle and the prompts' overrides before it awaits the viewer; /api/me answers from the
 * bundle and keeps its four-call fallback. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { essayReadFromBundle, readEssayTables, type EssayRead } from "../lib/essays/essay-read.ts";
import { assemble, reviewsFromBundle, type NoteRow, type ReviewRow } from "../lib/essays/review-rows.ts";
import type { EssayBundle } from "../lib/bundle-read.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ */
/* Fixture rows                                                         */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
const ESSAY = "00000000-0000-4000-8000-0000000000e1";
const BASE = "00000000-0000-4000-8000-0000000000b1";
const STUDENT = "00000000-0000-4000-8000-0000000000a1";
const MOM = "00000000-0000-4000-8000-0000000000d1";
const COUNSELOR = "00000000-0000-4000-8000-0000000000c1";

const essayRow = { id: ESSAY, student_id: STUDENT, prompt_ref: "common_app:1", title: "Mine", count_kind: "words", count: 4, limit_max: 650, limit_min: 250, status: "draft", kind: "personal", base_id: BASE, created: "2026-10-01T00:00:00Z", updated: "2026-10-05T00:00:00Z", body: "One two three four" };
const TABLES: Record<string, Row[]> = {
  essays: [
    essayRow,
    { id: BASE, student_id: STUDENT, title: "The first", updated: "2026-10-03T00:00:00Z", base_id: null },
    { id: "v1", student_id: STUDENT, title: "Copy A", updated: "2026-10-04T00:00:00Z", base_id: ESSAY },
    { id: "v2", student_id: STUDENT, title: "Copy B", updated: "2026-10-04T00:00:00Z", base_id: ESSAY },
  ],
  essay_versions: [
    { id: "ver1", essay_id: ESSAY, count: 2, source: "typed", label: null, created: "2026-10-01T00:00:00Z" },
    { id: "ver3", essay_id: ESSAY, count: 4, source: "pasted", label: "Notes asked for", created: "2026-10-05T00:00:00Z" },
    { id: "ver2", essay_id: ESSAY, count: 3, source: "typed", label: null, created: "2026-10-03T00:00:00Z" },
  ],
  essay_links: [
    { essay_id: ESSAY, prompt_ref: "college:110635:0", created: "2026-10-02T00:00:00Z" },
    { essay_id: ESSAY, prompt_ref: "college:166027:1", created: "2026-10-02T00:00:00Z" },
  ],
  essay_comments: [
    { id: "c2", essay_id: ESSAY, version_id: null, author_id: COUNSELOR, author_role: "counselor", anchor: null, body: "Hm", created: "2026-10-04T00:00:00Z", resolved_at: null },
    { id: "c1", essay_id: ESSAY, version_id: "ver2", author_id: MOM, author_role: "guardian", anchor: null, body: "Nice", created: "2026-10-03T00:00:00Z", resolved_at: null },
    { id: "c3", essay_id: ESSAY, version_id: null, author_id: null, author_role: "guardian", anchor: null, body: "Gone", created: "2026-10-04T12:00:00Z", resolved_at: "2026-10-05T00:00:00Z" },
  ],
  essay_suggestions: [
    { id: "s1", essay_id: ESSAY, base_version_id: "ver2", base_body: "One two three", author_id: MOM, author_role: "guardian", proposed_body: "One two", note: null, status: "open", decisions: null, created: "2026-10-03T00:00:00Z", updated: "2026-10-03T00:00:00Z", decided_at: null },
    { id: "s2", essay_id: ESSAY, base_version_id: null, base_body: "One", author_id: MOM, author_role: "guardian", proposed_body: "Uno", note: "x", status: "withdrawn", decisions: {}, created: "2026-10-04T00:00:00Z", updated: "2026-10-04T00:00:00Z", decided_at: null },
    { id: "s3", essay_id: ESSAY, base_version_id: "ver3", base_body: "One two three four", author_id: COUNSELOR, author_role: "counselor", proposed_body: "One two three five", note: null, status: "decided", decisions: { "0": "accepted" }, created: "2026-10-05T00:00:00Z", updated: "2026-10-05T00:00:00Z", decided_at: "2026-10-06T00:00:00Z" },
  ],
};
// The mother's profile is readable; the counselor's isn't (namesFor answers only what row-level security lets through).
const NAMES: Record<string, string | null> = { [MOM]: "Dana" };

/** A Supabase stand-in for the read's query shapes: eq, neq, order, limit, maybeSingle, and a head count. */
function fakeClient() {
  const calls: string[] = [];
  const from = (table: string) => {
    let rows = [...(TABLES[table] ?? [])];
    let head = false;
    let single = false;
    let columns: string[] = [];
    const q = {
      select(cols: string, opts?: { count?: string; head?: boolean }) {
        columns = cols.split(",").map((c) => c.trim());
        head = opts?.head === true;
        return q;
      },
      eq(col: string, v: unknown) {
        rows = rows.filter((r) => r[col] === v);
        return q;
      },
      neq(col: string, v: unknown) {
        rows = rows.filter((r) => r[col] !== v);
        return q;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        const dir = opts?.ascending === false ? -1 : 1;
        rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * dir);
        return q;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return q;
      },
      maybeSingle() {
        single = true;
        return q;
      },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        calls.push(table);
        const pick = (r: Row) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]));
        const value = head ? { data: null, error: null, count: rows.length } : single ? { data: rows[0] ? pick(rows[0]) : null, error: null } : { data: rows.map(pick), error: null };
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return q;
  };
  return { client: { from } as never, calls };
}

/** What essay_bundle() returns for these rows (the SQL's orders and author names; tests/essay-me-bundles.test.mts
 * proves the function against the database). */
function bundleFor(): EssayBundle {
  const name = (id: unknown) => (typeof id === "string" ? (NAMES[id] ?? null) : null);
  const byCreated = (a: Row, b: Row) => String(a.created).localeCompare(String(b.created));
  return {
    essay: essayRow as EssayBundle["essay"],
    versions: [...TABLES.essay_versions].sort(byCreated).reverse() as unknown as EssayBundle["versions"],
    // Links by created, then prompt_ref (the table read never ordered them).
    links: [...TABLES.essay_links].sort((a, b) => byCreated(a, b) || String(a.prompt_ref).localeCompare(String(b.prompt_ref))) as unknown as EssayBundle["links"],
    comments: [...TABLES.essay_comments].sort(byCreated).map((c) => ({ ...c, author_name: name(c.author_id) })) as EssayBundle["comments"],
    suggestions: TABLES.essay_suggestions
      .filter((s) => s.status !== "withdrawn")
      .sort(byCreated)
      .reverse()
      .map((s) => ({ ...s, author_name: name(s.author_id) })) as EssayBundle["suggestions"],
    base: { id: BASE, title: "The first", updated: "2026-10-03T00:00:00Z" },
    variants: 2,
    reviews: [],
    list_unit_ids: ["110635", "166027"],
  };
}

const sortedLinks = (r: EssayRead) => (r.kind === "ready" ? [...r.links].sort((a, b) => a.prompt_ref.localeCompare(b.prompt_ref)) : []);
const withoutExtras = (r: EssayRead) => {
  if (r.kind !== "ready") return r;
  const rest: Partial<typeof r> = { ...r };
  delete rest.reviews;
  delete rest.list_unit_ids;
  delete rest.links;
  return rest;
};

/* ------------------------------------------------------------------ */
/* The draft: bundle versus tables                                      */
/* ------------------------------------------------------------------ */

test("readEssay from essay_bundle() equals readEssay table by table (same rows, same names, decisions defaulted)", async () => {
  const { client, calls } = fakeClient();
  const fromTables = await readEssayTables(client, ESSAY, async (ids) => Object.fromEntries(ids.filter((id) => id in NAMES).map((id) => [id, NAMES[id]])));
  const fromBundle = essayReadFromBundle(bundleFor());
  assert.equal(fromTables.kind, "ready");
  assert.deepEqual(withoutExtras(fromBundle), withoutExtras(fromTables));
  // Links: the same rows; the bundle orders them, the table read never did, so order isn't compared.
  assert.deepEqual(sortedLinks(fromBundle), sortedLinks(fromTables));
  // The fixture exercises what matters: a withdrawn suggestion dropped, null decisions read as {}, an unreadable author.
  assert.ok(fromBundle.kind === "ready");
  assert.deepEqual(
    fromBundle.suggestions.map((s) => s.id),
    ["s3", "s1"],
  );
  assert.deepEqual(fromBundle.suggestions[1].decisions, {});
  assert.equal(fromBundle.comments.find((c) => c.id === "c2")?.author_name, null);
  assert.equal(fromBundle.comments.find((c) => c.id === "c1")?.author_name, "Dana");
  // Only the bundle carries the page's extras.
  assert.deepEqual(fromBundle.list_unit_ids, ["110635", "166027"]);
  assert.deepEqual(fromBundle.reviews, []);
  assert.ok(fromTables.kind === "ready" && fromTables.reviews === undefined && fromTables.list_unit_ids === undefined);
  // The fallback is the old shape: the row, then six reads together.
  assert.equal(calls[0], "essays");
  assert.equal(calls.length, 7);
});

test("readEssay's fallback answers not-found for a missing row and setup-missing without the table", async () => {
  const { client } = fakeClient();
  assert.deepEqual(await readEssayTables(client, "00000000-0000-4000-8000-000000000999", async () => ({})), { kind: "not-found" });
  const missing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }) }) }) }) } as never;
  assert.deepEqual(await readEssayTables(missing, ESSAY, async () => ({})), { kind: "setup-missing" });
});

test("an empty bundle part reads as empty, never as a crash", () => {
  const b = { ...bundleFor(), versions: null, links: null, comments: null, suggestions: null, reviews: null, list_unit_ids: null, base: null } as unknown as EssayBundle;
  const r = essayReadFromBundle(b);
  assert.ok(r.kind === "ready");
  assert.deepEqual([r.versions, r.links, r.comments, r.suggestions, r.reviews, r.list_unit_ids, r.base], [[], [], [], [], [], [], null]);
});

/* ------------------------------------------------------------------ */
/* The notes: one shaping for the route and the page                    */
/* ------------------------------------------------------------------ */

const reviewRows: ReviewRow[] = [
  { id: "r2", version_id: "ver3", created: "2026-10-05T00:00:00Z", outcome: "notes", method: "reader-v1" },
  { id: "r1", version_id: "ver2", created: "2026-10-03T00:00:00Z", outcome: "none", method: "reader-v1" },
];
const note = (id: string, review_id: string, position: number): NoteRow => ({ id, review_id, position, category: "mechanics", span: { quote: "two", prefix: "One ", suffix: " three" } as unknown as NoteRow["span"], observation: `o${id}`, why: "w", source: null, ask: "a?", fix: null, state: "open" });
// The table read answers notes in no particular order.
const noteRows: NoteRow[] = [note("n3", "r2", 2), note("n1", "r2", 0), note("n2", "r2", 1)];

test("the page's reviews (from the bundle) and the route's GET build identical StoredReviews", () => {
  const fromRoute = assemble(reviewRows, noteRows);
  // essay_bundle() nests each review's notes, by position, each still carrying review_id and position.
  const nested = reviewRows.map((r) => ({ ...r, notes: noteRows.filter((n) => n.review_id === r.id).sort((a, b) => a.position - b.position) }));
  const fromBundle = reviewsFromBundle(nested);
  assert.deepEqual(fromBundle, fromRoute);
  assert.deepEqual(
    fromRoute[0].notes.map((n) => n.id),
    ["n1", "n2", "n3"],
  );
  assert.ok(!("review_id" in fromRoute[0].notes[0]) && !("position" in fromRoute[0].notes[0]), "the note's review id and position drop");
  assert.deepEqual(fromRoute[1].notes, []);
  assert.deepEqual(Object.keys(fromRoute[0]).sort(), ["created", "id", "method", "notes", "outcome", "version_id"]);
});

test("the review route shapes its GET with the shared assemble()", () => {
  const route = read("app/api/essays/review/route.ts");
  assert.match(route, /import \{ assemble, NOTE_COLUMNS, REVIEW_COLUMNS[^}]*\} from "@\/lib\/essays\/review-rows"/);
  assert.doesNotMatch(route, /function assemble\(/, "one shaping, not two");
});

test("Notes with `initial` starts ready and its mount effect returns before fetching", () => {
  const src = read("components/essays/Notes.tsx");
  assert.match(src, /initial\?: StoredReview\[\]/);
  assert.match(src, /useState<Load>\(initial \? \{ kind: "ready", reviews: initial \} : \{ kind: "loading" \}\)/);
  const effect = src.slice(src.indexOf("useEffect(() => {"));
  const guard = effect.indexOf("if (hasInitial) return;");
  assert.ok(guard > 0 && guard < effect.indexOf("fetch(`/api/essays/review?essayId="), "the guard comes before the GET");
  const page = read("app/advisor/essays/[id]/page.tsx");
  assert.match(page, /<Notes key=\{essay\.id\} essayId=\{essay\.id\} canRequest=\{canWrite\} initial=\{read\.reviews\} \/>/);
});

/* ------------------------------------------------------------------ */
/* The page's waves                                                     */
/* ------------------------------------------------------------------ */

test("the essay page starts the essay bundle and the prompt lookup before it awaits the viewer", () => {
  const src = read("app/advisor/essays/[id]/page.tsx");
  const body = src.slice(src.indexOf("async function render("));
  const viewer = body.indexOf("essaysViewer(sp.for)");
  const bundle = body.indexOf("essayBundleFor(id)");
  const lookup = body.indexOf("promptLookup()");
  assert.ok(bundle > 0 && bundle < viewer, "the bundle starts first");
  assert.ok(lookup > 0 && lookup < viewer, "the overrides start beside it");
  assert.equal(body.slice(0, bundle).match(/\bawait\b/g), null, "nothing is awaited before the bundle starts");
  // planColleges takes the read's ids, and the lookup is the one started early (not a second call).
  assert.match(body, /planColleges\(essay\.student_id, read\.list_unit_ids\), lookupP\]/);
  assert.equal(body.match(/promptLookup\(\)/g)?.length, 1);
});

test("readEssay tries the bundle first, falls back to the tables, and keeps the access log for a non-student", () => {
  const src = read("lib/essays/load.ts");
  const fn = src.slice(src.indexOf("export async function readEssay("), src.indexOf("export async function readVersionBody"));
  assert.match(fn, /const bundle = await essayBundleFor\(id\);/);
  assert.match(fn, /bundle \? essayReadFromBundle\(bundle\) : await readEssayTables\(await createServerSupabase\(\), id, namesFor\)/);
  assert.match(fn, /viewer\.role !== "student"\) void scheduleStudentReadLog\(read\.essay\.student_id, "essays"\)/);
  // The bundle waits for a signed-in user (the function is closed to anon) and never throws.
  const pre = src.slice(src.indexOf("export function essayBundleFor("));
  assert.match(pre, /getUser\(\)\s*\.then\(\(user\) => \(user \? essayBundle\(id\) : null\)\)\s*\.catch\(\(\) => null\)/);
  // planColleges reads no table when the ids came with the bundle.
  const pc = src.slice(src.indexOf("export async function planColleges("));
  assert.ok(pc.indexOf("if (!ids)") < pc.indexOf("myLists("));
});

/* ------------------------------------------------------------------ */
/* /api/me                                                              */
/* ------------------------------------------------------------------ */

test("/api/me answers from me_bundle() when it answers, and keeps the four calls as its fallback", () => {
  const src = read("app/api/me/route.ts");
  assert.match(src, /import \{ meBundle, type MeBundle \} from "@\/lib\/bundles";/);
  const get = src.slice(src.indexOf("export async function GET()"));
  const bundle = get.indexOf("await meBundle()");
  assert.ok(bundle > get.indexOf("await getUser()"), "after the sign-in check (the function is closed to anon)");
  assert.ok(bundle < get.indexOf("Promise.all(["), "before the fallback's reads");
  assert.match(get, /if \(bundle\) return Response\.json\(fromBundle\(bundle, user\)/);
  for (const call of ["readProfileRow()", "myOrganization()", 'rpc("is_admin_any_aal")', "householdChildren()"]) assert.ok(get.includes(call), `fallback keeps ${call}`);
  // A paused profile is signed out on both paths; the role and the state's shape come from the same rule.
  const from = src.slice(src.indexOf("function fromBundle("), src.indexOf("export async function GET()"));
  assert.match(from, /suspended_at \?\? null\) !== null\) return signedOut\(true\)/);
  assert.match(from, /meRoleOf\(\{ org: b\.org === true, roleHint, children: children\.length \}\)/);
  assert.match(from, /\): MeState \{/);
});
