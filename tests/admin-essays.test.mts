/**
 * The admin Essays section (specs/product/essays/sources.md "The hand read", "The admin side"; owner 2026-10-30: the
 * database is the source of truth): the status counts and the hand-read checklist rule, the reads of `list_items` and
 * `essay_prompt_overrides`, the form's draft-to-record rules, the Save and Delete Server Actions against a fake Supabase
 * client (the rpc names and arguments, the refusals in plain words, nothing sent before the checks pass, revalidation),
 * both pages server-rendered (the checklist rows, the search box, the form prefilled from the saved row, Delete only
 * with a row), the form's structure (44px targets, nothing wider than a phone), and the Essays section in the rail.
 * Each guard is shown failing when its rule is broken. No network, no database. `npm test`.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
// Inside the repository so a transpiled page's bare imports ("react", "lucide-react") resolve from node_modules.
mkdirSync(join(ROOT, "node_modules", ".cache"), { recursive: true });
const tmp = mkdtempSync(join(ROOT, "node_modules", ".cache", "admin-essays-"));
// Node strips types only outside node_modules: broken copies of .ts modules go here.
const tsTmp = mkdtempSync(join(tmpdir(), "admin-essays-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(tsTmp, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Next.js stand-ins                                                   */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
const NOT_FOUND = "const e=new Error('NEXT_HTTP_ERROR_FALLBACK;404');e.digest='NEXT_HTTP_ERROR_FALLBACK;404';throw e";
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  "next/navigation": `export function notFound(){${NOT_FOUND}} export function redirect(u){const e=new Error('NEXT_REDIRECT');e.digest='NEXT_REDIRECT;replace;'+u+';307;';throw e}`,
  "next/server": "export async function connection(){}",
  "next/cache": "export function refresh(){globalThis.__world.revalidated.push('refresh')} export function revalidatePath(p,t){globalThis.__world.revalidated.push(t?p+' '+t:p)}",
  "@/lib/admin/auth":
    "export async function adminState(){globalThis.__world.calls.push('adminState'); return globalThis.__world.admin?{kind:'admin',userId:'admin-1'}:{kind:'not-admin'}} export async function requireAdmin(){globalThis.__world.calls.push('requireAdmin'); if(!globalThis.__world.admin){" +
    NOT_FOUND +
    "} return {userId:'admin-1'}}",
  "@/lib/admin/people": "export async function adminSupabase(){globalThis.__world.calls.push('adminSupabase'); return globalThis.__world.client}",
  "@/lib/data": "export async function getData(){return globalThis.__world.data}",
  // lib/admin/essays.ts reaches the admin's session through a relative dynamic import.
  "../supabase-server": "export function supabaseAuthEnv(){return globalThis.__world.signIn} export async function createServerSupabase(){return globalThis.__world.client}",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return stub(STUBS[specifier]);
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

/* ------------------------------------------------------------------ */
/* A fake world: the dataset, the admin, Supabase                      */
/* ------------------------------------------------------------------ */

type School = import("../lib/types.ts").School;
type ConfirmedRecord = import("../lib/essay-prompts/confirmed.ts").ConfirmedRecord;

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
interface FakeTables {
  list_items?: Record<string, unknown>[];
  essay_prompt_overrides?: Record<string, unknown>[];
}
interface World {
  admin: boolean;
  signIn: boolean;
  calls: string[];
  revalidated: string[];
  rpcCalls: RpcCall[];
  rpcError: { message: string } | null;
  tables: FakeTables;
  tableError: string | null;
  client: unknown;
  data: unknown;
}

/** A Supabase client over in-memory tables: select/eq/order/range/maybeSingle, and rpc recording its calls. */
function fakeClient(w: () => World) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      w().rpcCalls.push({ fn, args });
      return { data: null, error: w().rpcError };
    },
    from(table: string) {
      return {
        select() {
          const filters: [string, unknown][] = [];
          let range: [number, number] | null = null;
          const run = () => {
            if (w().tableError) return { data: null, error: { message: w().tableError! } };
            let rows = (w().tables[table as keyof FakeTables] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
            if (range) rows = rows.slice(range[0], range[1] + 1);
            return { data: rows, error: null };
          };
          const q = {
            eq(c: string, v: unknown) {
              filters.push([c, v]);
              return q;
            },
            order() {
              return q;
            },
            range(a: number, b: number) {
              range = [a, b];
              return q;
            },
            async maybeSingle() {
              const r = run();
              return { data: r.data?.[0] ?? null, error: r.error };
            },
            then<T>(resolve: (v: ReturnType<typeof run>) => T) {
              return Promise.resolve(run()).then(resolve);
            },
          };
          return q;
        },
      };
    },
  };
}

function school(unit: string, name: string, essays?: School["essays"], extra: Partial<School> = {}): School {
  return { unit_id: unit, name, location: { city: "Town", state: "OH" }, essays, ...extra } as unknown as School;
}
const ESSAYS = {
  published: { cycle: "2026-27", status: "published", source_url: "https://a.edu/essays", retrieved: "2026-10-20", prompts: [{ id: "1:2026-27:1" }] },
  refers: { cycle: "2026-27", status: "refers_to_form", source_url: "https://b.edu/apply", retrieved: "2026-10-20", prompts: [] },
  none: { cycle: "2026-27", status: "none", source_url: "https://c.edu/apply", retrieved: "2026-10-20", prompts: [] },
} as unknown as Record<string, School["essays"]>;

const SCHOOLS: School[] = [
  school("100001", "Alpha University", ESSAYS.published),
  school("100002", "Bravo College", ESSAYS.refers, {
    apply: { common_app: { member: true } } as unknown as School["apply"],
    lineage: { essays: { source: "college-site", method: "extracted", year: "2026-27", quote: "Answer the Bravo questions in the Common App." } } as unknown as School["lineage"],
  }),
  school("100003", "Charlie Institute", ESSAYS.none),
  school("100004", "Delta State", undefined),
  school("100005", "Echo University", ESSAYS.refers),
  school("100006", "Foxtrot College", undefined),
];
const LIST_ITEMS = [
  { id: "i1", list_id: "L1", unit_id: "100001" },
  { id: "i2", list_id: "L1", unit_id: "100002" },
  { id: "i3", list_id: "L2", unit_id: "100002" },
  { id: "i4", list_id: "L2", unit_id: "100002" }, // the same list twice counts once
  { id: "i5", list_id: "L3", unit_id: "100003" },
  { id: "i6", list_id: "L3", unit_id: "100004" },
  { id: "i7", list_id: "L4", unit_id: "100005" },
];

function dataset(schools: School[]) {
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  return {
    getAllSchools: () => schools,
    getSchoolById: (id: string) => byId.get(id) ?? null,
    searchSchools: (q: string) => schools.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())).map((s) => ({ id: s.unit_id, name: s.name, city: "Town", state: "OH" })),
  };
}

const world = {} as World;
(globalThis as unknown as { __world: World }).__world = world;
function reset(over: Partial<World> = {}) {
  Object.assign(world, {
    admin: true,
    signIn: true,
    calls: [],
    revalidated: [],
    rpcCalls: [],
    rpcError: null,
    tables: { list_items: LIST_ITEMS, essay_prompt_overrides: [] },
    tableError: null,
    client: fakeClient(() => world),
    data: dataset(SCHOOLS),
    ...over,
  });
}
reset();

globalThis.fetch = (() => {
  throw new Error("network call in a test");
}) as typeof fetch;

const essays = await import("../lib/admin/essays.ts");
const form = await import("../lib/admin/essays-form.ts");
const confirmed = await import("../lib/essay-prompts/confirmed.ts");
const consoleLib = await import("../lib/admin/console.ts");
const { currentCycle } = await import("../lib/planner/cycle.ts");

const TODAY = new Date().toISOString().slice(0, 10);
const CYCLE = currentCycle(TODAY);
const is404 = (e: unknown) => (e as { digest?: string })?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";

/** A saved hand read for Echo, as the table holds it. */
function savedRecord(over: Partial<ConfirmedRecord> = {}): ConfirmedRecord {
  return {
    unit_id: "100005",
    name: "Echo University",
    cycle: CYCLE,
    status: "published",
    confidence: "confirmed",
    source: "form-by-hand",
    form: "common_app",
    read_on: TODAY,
    reader: "RR",
    prompts: [
      { id: `100005:${CYCLE}:1`, text: "Why do you want to study at Echo University?", kind: "why_us", limit: { kind: "words", max: 250 }, required: true, applies_to: "all", quote: "Why do you want to study at Echo University?" },
      { id: `100005:${CYCLE}:2`, text: "Tell us about a community you belong to.", kind: "short_answer", limit: { kind: "characters", max: 800, min: 200 }, required: false, applies_to: "all", quote: "Tell us about a community you belong to." },
      { id: `100005:${CYCLE}:3`, text: "Describe a book that changed your mind.", kind: "short_answer", limit: null, required: false, applies_to: { program: "Honors College" }, quote: "Describe a book that changed your mind." },
    ],
    choose: { n: 1, of: 2, quote: "Choose 1 of these 2." },
    note: "Honors prompt is separate",
    ...over,
  };
}
const overrideRow = (r: ConfirmedRecord) => ({ unit_id: r.unit_id, cycle: r.cycle, status: r.status, read_on: r.read_on, reader: r.reader, record: r });

/* ------------------------------------------------------------------ */
/* Status, counts, the checklist                                       */
/* ------------------------------------------------------------------ */

const LISTS = new Map([
  ["100001", 1],
  ["100002", 2],
  ["100003", 1],
  ["100004", 1],
  ["100005", 1],
]);

test("essayStatus: the dataset's block, a confirmed block, or a saved row (which wins)", () => {
  assert.equal(essays.essayStatus(SCHOOLS[0]), "published");
  assert.equal(essays.essayStatus(SCHOOLS[1]), "refers_to_form");
  assert.equal(essays.essayStatus(SCHOOLS[2]), "none");
  assert.equal(essays.essayStatus(SCHOOLS[3]), "not_read");
  assert.equal(essays.essayStatus(school("1", "X", { ...ESSAYS.published!, confidence: "confirmed", read_on: "2026-10-30" })), "confirmed");
  const rows = new Map([["100005", overrideRow(savedRecord())]]);
  assert.equal(essays.essayStatus(SCHOOLS[4], rows), "confirmed");
  assert.deepEqual(essays.statusCounts(SCHOOLS, rows), { published: 1, confirmed: 1, refers_to_form: 1, none: 1, not_read: 2 });
  assert.deepEqual(essays.statusCounts(SCHOOLS), { published: 1, confirmed: 0, refers_to_form: 2, none: 1, not_read: 2 });
});

type ChecklistFn = typeof essays.handReadChecklist;

/** The checklist rule as one check over a checklist function, so a broken one can be shown failing. */
function checklistProblems(fn: ChecklistFn): string[] {
  const out: string[] = [];
  const units = (rows: ReturnType<ChecklistFn>) => rows.map((r) => r.unitId);
  const plain = fn(SCHOOLS, LISTS);
  if (!units(plain).includes("100002")) out.push("a listed college with refers_to_form is missing");
  if (!units(plain).includes("100003")) out.push("a listed college with none is missing");
  if (!units(plain).includes("100004")) out.push("a listed college never read is missing");
  if (units(plain).includes("100001")) out.push("a published college is listed");
  if (units(plain).includes("100006")) out.push("a college on no list is listed");
  const rows = new Map([["100005", overrideRow(savedRecord())]]);
  if (units(fn(SCHOOLS, LISTS, rows)).includes("100005")) out.push("a college with a saved row is listed");
  if (units(plain)[0] !== "100002") out.push("the most-listed college isn't first");
  if (plain.find((r) => r.unitId === "100002")?.lists !== 2) out.push("the list count is wrong");
  return out;
}

test("the checklist: listed colleges whose block is absent, refers_to_form, or none, without a saved row; most-listed first", () => {
  assert.deepEqual(checklistProblems(essays.handReadChecklist), []);
  assert.deepEqual(
    essays.handReadChecklist(SCHOOLS, LISTS).map((r) => [r.unitId, r.status, r.lists]),
    [
      ["100002", "refers_to_form", 2],
      ["100003", "none", 1],
      ["100004", "not_read", 1],
      ["100005", "refers_to_form", 1],
    ],
  );
});

test("the checklist check fails when the rule is broken", () => {
  const ignoresLists: ChecklistFn = (schools, _lists, rows) => essays.handReadChecklist(schools, new Map(schools.map((s) => [s.unit_id, 1])), rows);
  assert.ok(checklistProblems(ignoresLists).includes("a college on no list is listed"));
  const ignoresRows: ChecklistFn = (schools, lists) => essays.handReadChecklist(schools, lists);
  assert.ok(checklistProblems(ignoresRows).includes("a college with a saved row is listed"));
  const everyStatus: ChecklistFn = (schools, lists) =>
    schools.filter((s) => (lists.get(s.unit_id) ?? 0) > 0).map((s) => ({ unitId: s.unit_id, name: s.name, status: essays.essayStatus(s), lists: lists.get(s.unit_id)! }));
  assert.ok(checklistProblems(everyStatus).includes("a published college is listed"));
});

test("handReadDone lists saved rows and confirmed blocks, newest read first", () => {
  const rows = new Map([["100005", overrideRow(savedRecord({ read_on: "2026-10-29" }))]]);
  const withBlock = [...SCHOOLS, school("100007", "Golf College", { ...ESSAYS.published!, confidence: "confirmed", form: "uc", read_on: "2026-10-01" })];
  assert.deepEqual(
    essays.handReadDone(withBlock, LISTS, rows).map((r) => [r.unitId, r.readOn, r.form, r.lists]),
    [
      ["100005", "2026-10-29", "common_app", 1],
      ["100007", "2026-10-01", "uc", 0],
    ],
  );
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

test("listsByUnit counts distinct lists per college, pages through, and is null when the read fails or isn't configured", async () => {
  reset();
  const counts = await essays.listsByUnit({ client: async () => world.client as never });
  assert.deepEqual(Object.fromEntries(counts!), { "100001": 1, "100002": 2, "100003": 1, "100004": 1, "100005": 1 });
  const many = Array.from({ length: 2500 }, (_, i) => ({ id: `x${i}`, list_id: `L${i}`, unit_id: "100002" }));
  reset({ tables: { list_items: many } });
  assert.equal((await essays.listsByUnit({ client: async () => world.client as never }))!.get("100002"), 2500, "every page is read");
  reset({ tableError: "permission denied" });
  assert.equal(await essays.listsByUnit({ client: async () => world.client as never }), null);
  assert.equal(await essays.listsByUnit({ client: async () => null }), null);
});

test("overrideFor and overridesForCycle read the saved rows for the open cycle; unreadable is not the same as none", async () => {
  const r = savedRecord();
  reset({ tables: { essay_prompt_overrides: [overrideRow(r), overrideRow(savedRecord({ cycle: "2025-26" }))] } });
  const c = { client: async () => world.client as never };
  const one = await essays.overrideFor("100005", CYCLE, c);
  assert.ok(one.ok && one.row?.record.note === "Honors prompt is separate");
  assert.deepEqual(await essays.overrideFor("100002", CYCLE, c), { ok: true, row: null });
  assert.deepEqual([...(await essays.overridesForCycle(CYCLE, c))!.keys()], ["100005"], "only the open cycle's rows");
  reset({ tableError: 'relation "public.essay_prompt_overrides" does not exist' });
  assert.deepEqual(await essays.overrideFor("100005", CYCLE, c), { ok: false });
  assert.equal(await essays.overridesForCycle(CYCLE, c), null);
});

/* ------------------------------------------------------------------ */
/* The draft and the record                                            */
/* ------------------------------------------------------------------ */

const ECHO = { unit_id: "100005", name: "Echo University" };

test("recordFromDraft: ids in the form's order, each quote the question's own text, choose over the unrequired rows; a saved record round-trips", () => {
  const r = savedRecord();
  const back = form.recordFromDraft(form.draftFromRecord(r), ECHO);
  assert.deepEqual(back, r);
  assert.deepEqual(confirmed.validateConfirmed(back), []);
  assert.deepEqual(form.draftProblems(form.draftFromRecord(r), ECHO, { openCycle: CYCLE, today: TODAY }), []);
  const d = form.draftFromRecord(r);
  d.rows.reverse();
  const moved = form.recordFromDraft(d, ECHO);
  assert.deepEqual(moved.prompts.map((p) => p.id), [1, 2, 3].map((n) => `100005:${CYCLE}:${n}`));
  assert.equal(moved.prompts[0].text, "Describe a book that changed your mind.");
  assert.ok(moved.prompts.every((p) => p.quote === p.text));
  const none = form.recordFromDraft({ ...form.draftFromRecord(r), status: "none" }, ECHO);
  assert.deepEqual([none.prompts, none.choose], [[], undefined], "none carries no questions and no choice group");
});

test("draftProblems: blanks, the open cycle, a future date, and validateConfirmed's rules, each naming its row", () => {
  const base = form.draftFromRecord(savedRecord());
  const ctx = { openCycle: CYCLE, today: TODAY };
  const blankMax = { ...base, rows: base.rows.map((row, i) => (i === 1 ? { ...row, max: "" } : row)) };
  assert.deepEqual(form.draftProblems(blankMax, ECHO, ctx), ["prompt 2: enter the limit's maximum, or choose No limit"]);
  assert.deepEqual([...form.rowsWithProblems(form.draftProblems(blankMax, ECHO, ctx))], [1]);
  assert.match(form.draftProblems({ ...base, cycle: "2020-21" }, ECHO, ctx).join("\n"), /the cycle must be the open one/);
  assert.match(form.draftProblems({ ...base, readOn: "2999-01-01" }, ECHO, ctx).join("\n"), /can't be after today/);
  assert.match(form.draftProblems({ ...base, reader: "" }, ECHO, ctx).join("\n"), /initials/);
  assert.match(form.draftProblems({ ...base, rows: [] }, ECHO, ctx).join("\n"), /none are entered/);
  assert.match(form.draftProblems({ ...base, choose: { on: true, n: "2" } }, ECHO, ctx).join("\n"), /isn't a choice/);
  const program = { ...base, rows: base.rows.map((row, i) => (i === 2 ? { ...row, program: " " } : row)) };
  assert.match(form.draftProblems(program, ECHO, ctx).join("\n"), /prompt 3: applies to a program, but names none/);
});

test("parseDraft refuses anything that isn't the form's shape", () => {
  const good = form.draftFromRecord(savedRecord());
  assert.deepEqual(form.parseDraft(JSON.parse(JSON.stringify(good))), good);
  assert.equal(form.parseDraft(null), null);
  assert.equal(form.parseDraft({ ...good, form: "scoir" }), null);
  assert.equal(form.parseDraft({ ...good, status: "refers_to_form" }), null);
  assert.equal(form.parseDraft({ ...good, rows: [{ ...good.rows[0], kind: "poem" }] }), null);
  assert.equal(form.parseDraft({ ...good, rows: [{ ...good.rows[0], required: "yes" }] }), null);
  assert.equal(form.parseDraft({ ...good, rows: Array.from({ length: 41 }, () => good.rows[0]) }), null);
});

test("splitPastedPrompts fills one row per paragraph, numbers and bullets dropped", () => {
  assert.deepEqual(confirmed.splitPastedPrompts("1. Why Echo?\nTell us more.\n\n\n2) A community you belong to.\n\n• A book"), ["Why Echo? Tell us more.", "A community you belong to.", "A book"]);
});

/* ------------------------------------------------------------------ */
/* The Server Actions                                                  */
/* ------------------------------------------------------------------ */

const actions = (await import("../lib/admin/essays-actions.ts")) as typeof import("../lib/admin/essays-actions.ts");
const IDLE = consoleLib.IDLE;

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const saveForm = (draft: unknown, unit = "100005") => fd({ unit, draft: JSON.stringify(draft) });

test("Save writes the row with admin_set_essay_prompts on the admin's session: the rebuilt record, the dataset's name, revalidated", async () => {
  reset();
  const draft = form.draftFromRecord(savedRecord());
  const state = await actions.saveEssayPrompts(IDLE, saveForm(draft));
  assert.deepEqual(state, { status: "done", message: "Saved. Live on the advisor now; the public college page updates at the next data build." });
  assert.equal(world.calls[0], "adminState", "the admin check runs first");
  assert.equal(world.rpcCalls.length, 1);
  const [call] = world.rpcCalls;
  assert.equal(call.fn, "admin_set_essay_prompts");
  assert.deepEqual(Object.keys(call.args).sort(), ["p_cycle", "p_record", "p_unit"]);
  assert.equal(call.args.p_unit, "100005");
  assert.equal(call.args.p_cycle, CYCLE);
  assert.deepEqual(call.args.p_record, savedRecord(), "the record the function stores is the hand read, with ids and quotes rebuilt");
  assert.deepEqual(world.revalidated, ["/advisor layout", "/admin/essays", "/admin/essays/100005"]);
});

test("Save never trusts the form for the college: the name comes from the dataset, an unknown unit is refused", async () => {
  reset({ data: dataset([school("100005", "Echo University (renamed)")]) });
  await actions.saveEssayPrompts(IDLE, saveForm(form.draftFromRecord(savedRecord())));
  assert.equal((world.rpcCalls[0].args.p_record as ConfirmedRecord).name, "Echo University (renamed)");
  reset();
  const bad = await actions.saveEssayPrompts(IDLE, saveForm(form.draftFromRecord(savedRecord()), "999999"));
  assert.deepEqual(bad, { status: "error", message: consoleLib.BAD_FORM_MESSAGE });
  for (const f of [fd({ unit: "100005", draft: "{not json" }), fd({ unit: "abc", draft: "{}" }), fd({ unit: "100005" }), saveForm({ rows: "x" })]) {
    assert.equal((await actions.saveEssayPrompts(IDLE, f)).status, "error");
  }
  assert.equal(world.rpcCalls.length, 0, "nothing is sent for a bad form");
});

test("Save shows the form's problems and sends nothing until they're fixed", async () => {
  reset();
  const draft = { ...form.draftFromRecord(savedRecord()), reader: "" };
  const state = await actions.saveEssayPrompts(IDLE, saveForm(draft));
  assert.equal(state.status, "error");
  assert.match((state as { message: string }).message, /^Check the form: .*initials/);
  const stale = await actions.saveEssayPrompts(IDLE, saveForm({ ...form.draftFromRecord(savedRecord()), cycle: "2020-21" }));
  assert.match((stale as { message: string }).message, /the cycle must be the open one/);
  assert.equal(world.rpcCalls.length, 0);
});

test("Save and Delete need an admin: anyone else gets the session-ended message and nothing is sent", async () => {
  reset({ admin: false });
  assert.deepEqual(await actions.saveEssayPrompts(IDLE, saveForm(form.draftFromRecord(savedRecord()))), { status: "error", message: consoleLib.SESSION_ENDED_MESSAGE });
  assert.deepEqual(await actions.deleteEssayPrompts(IDLE, fd({ unit: "100005", cycle: CYCLE, confirm: "delete" })), { status: "error", message: consoleLib.SESSION_ENDED_MESSAGE });
  assert.equal(world.rpcCalls.length, 0);
});

test("the database's refusals come back in plain words", async () => {
  const draft = form.draftFromRecord(savedRecord());
  for (const [key, words] of Object.entries(essays.ESSAY_SAVE_ERRORS)) {
    reset({ rpcError: { message: key } });
    const state = await actions.saveEssayPrompts(IDLE, saveForm(draft));
    assert.deepEqual(state, { status: "error", message: words }, key);
    assert.doesNotMatch(words, /_/, `${key}: no code in the words`);
  }
  assert.deepEqual(Object.keys(essays.ESSAY_SAVE_ERRORS).sort(), ["admin only", "invalid_read_on", "invalid_record", "invalid_status", "no_prompts", "record_mismatch"]);
  reset({ rpcError: { message: "connection reset" } });
  assert.deepEqual(await actions.saveEssayPrompts(IDLE, saveForm(draft)), { status: "error", message: consoleLib.ADMIN_FAILED });
  assert.deepEqual(world.revalidated, [], "nothing is revalidated after a refusal");
});

test("every refusal key the console maps is one the migration raises", () => {
  const sql = read("supabase/migrations/20261030150000_essay_prompt_overrides.sql");
  for (const key of Object.keys(essays.ESSAY_SAVE_ERRORS)) assert.ok(sql.includes(`'${key}'`), key);
  assert.match(sql, /create function public\.admin_set_essay_prompts\(p_unit text, p_cycle text, p_record jsonb\)/);
  assert.match(sql, /create function public\.admin_delete_essay_prompts\(p_unit text, p_cycle text\)/);
});

test("Delete needs the typed word, then calls admin_delete_essay_prompts and revalidates", async () => {
  reset();
  const unconfirmed = await actions.deleteEssayPrompts(IDLE, fd({ unit: "100005", cycle: CYCLE, confirm: "yes" }));
  assert.deepEqual(unconfirmed, { status: "error", message: 'Type "delete" to confirm.' });
  assert.equal(world.rpcCalls.length, 0);
  assert.equal((await actions.deleteEssayPrompts(IDLE, fd({ unit: "100005", cycle: "next year", confirm: "delete" }))).status, "error");
  const done = await actions.deleteEssayPrompts(IDLE, fd({ unit: "100005", cycle: CYCLE, confirm: " Delete " }));
  assert.equal(done.status, "done");
  assert.deepEqual(world.rpcCalls, [{ fn: "admin_delete_essay_prompts", args: { p_unit: "100005", p_cycle: CYCLE } }]);
  assert.deepEqual(world.revalidated, ["/advisor layout", "/admin/essays", "/admin/essays/100005"]);
  reset({ rpcError: { message: "admin only" } });
  assert.deepEqual(await actions.deleteEssayPrompts(IDLE, fd({ unit: "100005", cycle: CYCLE, confirm: "delete" })), { status: "error", message: essays.ESSAY_SAVE_ERRORS["admin only"] });
});

/** Exported actions whose body doesn't `return withAdmin(` (tests/admin-console-ui.test.mts's rule for app/admin). */
function unguardedActions(src: string): string[] {
  const parts = src.split(/^export async function /m).slice(1);
  return parts.filter((p) => !/return withAdmin\(/.test(p.slice(0, p.indexOf("\n}\n") + 3))).map((p) => p.slice(0, p.indexOf("(")));
}

test("lib/admin/essays-actions.ts is a 'use server' module that exports only Server Actions, each on withAdmin()", () => {
  const src = read("lib/admin/essays-actions.ts");
  assert.match(src, /^"use server";/);
  assert.deepEqual(unguardedActions(src), []);
  assert.deepEqual([...src.matchAll(/^export (?!async function )/gm)], [], "nothing but async functions is exported");
  const broken = src.replace('return withAdmin("essay prompts delete", async (ctx) => {', "return (async (ctx: any) => {");
  assert.deepEqual(unguardedActions(broken), ["deleteEssayPrompts"], "the guard catches an action that skips withAdmin()");
});

/** The module with one snippet replaced, loaded from the temp folder. */
async function loadWith(rel: string, snippet: string, replacement: string, name: string) {
  const source = read(rel);
  assert.ok(source.includes(snippet), `${name}: the snippet is in the source`);
  const file = join(tsTmp, name);
  writeFileSync(file, source.replace(snippet, replacement));
  return import(pathToFileURL(file).href);
}

test("the 'nothing sent until the checks pass' test fails when the action skips them", async () => {
  const broken = (await loadWith("lib/admin/essays-actions.ts", "if (problems.length) return", "if (false) return", "actions-unchecked.mts")) as typeof actions;
  reset();
  await broken.saveEssayPrompts(IDLE, saveForm({ ...form.draftFromRecord(savedRecord()), reader: "" }));
  assert.equal(world.rpcCalls.length, 1, "the broken copy sends an invalid record, so the test above would fail");
});

/* ------------------------------------------------------------------ */
/* The pages                                                           */
/* ------------------------------------------------------------------ */

const reactUrl = pathToFileURL(nodeModule.createRequire(import.meta.url).resolve("react")).href;
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(reactUrl)};\nexport default ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);`);

/** A component stand-in: `<div data-stub="Name" data-props="{…}">` with its props as JSON (functions as "fn"). */
function stubModule(name: string, names: string[]): string {
  const file = join(tmp, `stub-${name}.mjs`);
  writeFileSync(
    file,
    `import React from ${JSON.stringify(reactUrl)};
const make = (n) => ({ children, ...props }) => React.createElement("div", { "data-stub": n, "data-props": JSON.stringify(props, (k, v) => typeof v === "function" ? "fn" : (v && v.$$typeof ? "element" : v)) }, children);
${names.map((n) => `export const ${n} = make(${JSON.stringify(n)});`).join("\n")}\n`,
  );
  return pathToFileURL(file).href;
}

/** Transpiles a page or component; with `stubComponents`, its `@/components` imports become stand-ins. */
async function loadTsx(rel: string, stubComponents = true): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  let n = 0;
  let code = outputText.replace(/from "next\/link"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "link.mjs")).href)}`);
  if (stubComponents) {
    code = code.replace(/import \{([^}]*)\} from "(@\/components\/[^"]+)";/g, (_m, names: string, spec: string) => {
      const list = names.split(",").map((s) => s.trim().split(" as ").pop()!.trim()).filter(Boolean);
      return `import {${names}} from ${JSON.stringify(stubModule(`${rel.replace(/[^a-z]/gi, "_")}${n++}-${spec.split("/").pop()}`, list))};`;
    });
  }
  const file = join(tmp, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}
const html = (el: ReactElement) => renderToStaticMarkup(el);
const stubsIn = (markup: string) =>
  [...markup.matchAll(/data-stub="(\w+)" data-props="([^"]*)"/g)].map((m) => ({ name: m[1], props: JSON.parse(m[2].replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&")) as Record<string, unknown> }));

type ListPage = (p: { searchParams: Promise<Record<string, string | undefined>> }) => Promise<ReactElement>;
type UnitPage = (p: { params: Promise<{ unit: string }> }) => Promise<ReactElement>;
const listPage = (await loadTsx("app/admin/essays/page.tsx")).default as ListPage;
const unitPage = (await loadTsx("app/admin/essays/[unit]/page.tsx")).default as UnitPage;

test("the Essays page: counts by status, the checklist with 'Enter the questions' links, a search box, and requireAdmin first", async () => {
  reset({ tables: { list_items: LIST_ITEMS, essay_prompt_overrides: [overrideRow(savedRecord())] } });
  const markup = html(await listPage({ searchParams: Promise.resolve({}) }));
  assert.equal(world.calls[0], "requireAdmin");
  for (const s of essays.ESSAY_STATUSES) assert.match(markup, new RegExp(`data-status="${s}"`));
  assert.match(markup, /data-status="confirmed"><span[^>]*>1<\/span>/, "the saved row counts as confirmed at once");
  const checklist = markup.match(/aria-label="Colleges to read by hand">([\s\S]*?)<\/ul>/)![1];
  assert.deepEqual([...checklist.matchAll(/data-unit="(\d+)"/g)].map((m) => m[1]), ["100002", "100003", "100004"], "Echo has a saved row, so it's off the list");
  assert.match(checklist, /Bravo College[\s\S]*?Refers to the form · on 2 lists[\s\S]*?<a href="\/admin\/essays\/100002"[^>]*>Enter the questions<\/a>/);
  const search = stubsIn(markup).find((s) => s.name === "AdminSearch");
  assert.equal(search?.props.action, "/admin/essays");
  assert.match(markup, /aria-label="Colleges read by hand"[\s\S]*Echo University/);
  assert.doesNotMatch(markup, /scrape|\bAI\b/i);
  reset({ admin: false });
  await assert.rejects(listPage({ searchParams: Promise.resolve({}) }), is404);
});

test("the Essays page: search results link to the form, an exact unit id opens it, and no lists means no checklist", async () => {
  reset();
  const markup = html(await listPage({ searchParams: Promise.resolve({ q: "echo" }) }));
  assert.match(markup, /aria-label="Search results"[\s\S]*?<a href="\/admin\/essays\/100005"[\s\S]*?Echo University/);
  await assert.rejects(listPage({ searchParams: Promise.resolve({ q: "100003" }) }), (e: unknown) => String((e as { digest?: string }).digest).includes("/admin/essays/100003"));
  reset({ tableError: "permission denied" });
  const none = html(await listPage({ searchParams: Promise.resolve({}) }));
  assert.match(none, /Families&#x27; lists can&#x27;t be read on this deployment/);
  assert.doesNotMatch(none, /Colleges to read by hand/);
});

test("the college's form page: what the reader found, the form prefilled from the saved row, and Delete only with a row", async () => {
  const r = savedRecord({ unit_id: "100002", name: "Bravo College", prompts: savedRecord().prompts.map((p, i) => ({ ...p, id: `100002:${CYCLE}:${i + 1}` })) });
  reset({ tables: { essay_prompt_overrides: [overrideRow(r)] } });
  const markup = html(await unitPage({ params: Promise.resolve({ unit: "100002" }) }));
  assert.equal(world.calls[0], "requireAdmin");
  assert.match(markup, /Refers to the form/);
  assert.match(markup, /Answer the Bravo questions in the Common App\./, "the reader's quote, so the person knows what they override");
  const stubs = stubsIn(markup);
  const formStub = stubs.find((s) => s.name === "EssayPromptsForm")!;
  assert.equal(formStub.props.action, "fn");
  assert.equal(formStub.props.unitId, "100002");
  assert.equal(formStub.props.openCycle, CYCLE);
  assert.deepEqual(formStub.props.initial, JSON.parse(JSON.stringify(form.draftFromRecord(r))), "prefilled from the saved row");
  const del = stubs.find((s) => s.name === "AdminForm")!;
  assert.deepEqual([del.props.trigger, del.props.hidden, del.props.typed], ["Delete", { unit: "100002", cycle: CYCLE }, { expected: "delete" }]);
  assert.match(markup, /Saved: Common App, read/);
});

test("the form page with no saved row starts on the open cycle, today, and the college's form; unreadable rows show no form", async () => {
  reset();
  const markup = html(await unitPage({ params: Promise.resolve({ unit: "100002" }) }));
  const stubs = stubsIn(markup);
  const initial = stubs.find((s) => s.name === "EssayPromptsForm")!.props.initial as { cycle: string; form: string; readOn: string; reader: string };
  assert.deepEqual([initial.cycle, initial.form, initial.readOn, initial.reader], [CYCLE, "common_app", TODAY, ""], "Bravo is a Common App member");
  assert.equal(stubs.filter((s) => s.name === "AdminForm").length, 0, "nothing to delete");
  const own = html(await unitPage({ params: Promise.resolve({ unit: "100004" }) }));
  assert.equal((stubsIn(own).find((s) => s.name === "EssayPromptsForm")!.props.initial as { form: string }).form, "own");
  reset({ tableError: "relation does not exist" });
  const unreadable = html(await unitPage({ params: Promise.resolve({ unit: "100002" }) }));
  assert.equal(stubsIn(unreadable).filter((s) => s.name === "EssayPromptsForm").length, 0);
  assert.match(unreadable, /the form isn&#x27;t shown/);
  reset();
  await assert.rejects(unitPage({ params: Promise.resolve({ unit: "abc" }) }), is404);
  await assert.rejects(unitPage({ params: Promise.resolve({ unit: "999999" }) }), is404);
  reset({ admin: false });
  await assert.rejects(unitPage({ params: Promise.resolve({ unit: "100002" }) }), is404);
});

/* ------------------------------------------------------------------ */
/* The form's structure                                                */
/* ------------------------------------------------------------------ */

const { EssayPromptsForm } = (await loadTsx("components/admin/EssayPromptsForm.tsx", false)) as { EssayPromptsForm: (p: Record<string, unknown>) => ReactElement };
const formHtml = (initial: unknown) =>
  html(createElement(EssayPromptsForm, { action: async () => IDLE, unitId: "100005", name: "Echo University", initial, openCycle: CYCLE, today: TODAY }));

/** Controls under 44px: every button, select, and text input needs h-11, size-11, or min-h-11; checkboxes sit in a min-h-11 label. */
function smallTargets(markup: string): string[] {
  const out: string[] = [];
  for (const m of markup.matchAll(/<(button|select|textarea|input)\b([^>]*)>/g)) {
    const [tag, attrs] = [m[1], m[2]];
    if (/type="hidden"/.test(attrs)) continue;
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? "";
    if (/type="(checkbox|radio)"/.test(attrs)) {
      const before = markup.slice(0, m.index);
      const label = before.slice(before.lastIndexOf("<label"));
      if (!/class="[^"]*min-h-11/.test(label)) out.push(`${tag} ${attrs.slice(0, 60)}`);
      continue;
    }
    if (tag === "textarea") continue; // several rows tall
    if (!/\b(h-11|size-11|min-h-11)\b/.test(cls)) out.push(`${tag} ${attrs.slice(0, 60)}`);
  }
  return out;
}

/** Anything that would push a 390px screen sideways: fixed widths over 22rem, or no-wrap rows. */
function wideAt390(markup: string): string[] {
  return [...markup.matchAll(/class="([^"]*)"/g)].map((m) => m[1]).filter((c) => /\b(w|min-w)-\[(\d+)(px|rem)\]/.test(c) || /\bwhitespace-nowrap\b/.test(c) || /\bw-(9[6-9]|[1-9]\d{2,})\b/.test(c));
}

test("the form: the read's fields, the status choice, the paste box, rows with every field and their controls, and Save", () => {
  const markup = formHtml(form.draftFromRecord(savedRecord()));
  for (const label of ["Cycle", "Form", "Read on", "Reader&#x27;s initials", "The form asks these questions", "No college questions beyond the platform&#x27;s", "Paste the questions, one per paragraph", "Kind", "Limit", "Max", "Min (optional)", "Required", "Applies to", "Program", "Choose n of these", "A note (optional, kept with the record)"]) {
    assert.ok(markup.includes(label), label);
  }
  assert.equal((markup.match(/data-row="/g) ?? []).length, 3, "one card per question");
  for (const n of [1, 2, 3]) {
    assert.match(markup, new RegExp(`aria-label="Move question ${n} up"`));
    assert.match(markup, new RegExp(`aria-label="Move question ${n} down"`));
    assert.match(markup, new RegExp(`aria-label="Remove question ${n}"`));
  }
  assert.match(markup, /Add a question/);
  for (const f of ["common_app", "coalition", "apply_texas", "uc", "own"]) assert.match(markup, new RegExp(`<option value="${f}"`));
  for (const l of ["words", "characters", "none"]) assert.match(markup, new RegExp(`<option value="${l}"`));
  assert.match(markup, /<input type="hidden" name="unit" value="100005"\/>/);
  const draft = JSON.parse(markup.match(/name="draft" value="([^"]*)"/)![1].replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&"));
  assert.deepEqual(draft, form.draftFromRecord(savedRecord()), "the draft travels as JSON");
  assert.match(markup, /<button type="submit"[^>]*>Save<\/button>/);
  assert.doesNotMatch(markup, /Fix these before saving/, "problems show after the first try, not on load");
  assert.doesNotMatch(markup, /scrape|\bAI\b/i);
  const none = formHtml({ ...form.draftFromRecord(savedRecord()), status: "none" });
  assert.doesNotMatch(none, /Paste the questions|data-row=/, "no rows when the form shows no college questions");
});

test("the form keeps 44px targets and fits a 390px screen; the checks fail when the rules are broken", () => {
  const markup = formHtml(form.draftFromRecord(savedRecord()));
  assert.deepEqual(smallTargets(markup), []);
  assert.deepEqual(wideAt390(markup), []);
  assert.ok(smallTargets(markup.replace(/h-11 w-full/, "h-9 w-full")).length > 0, "a 36px input is caught");
  assert.ok(smallTargets(markup.replace(/size-11/, "size-8")).length > 0, "a small icon button is caught");
  assert.ok(wideAt390(markup.replace(/class="space-y-5"/, 'class="space-y-5 min-w-[480px]"')).length > 0, "a fixed 480px width is caught");
});

test("the client form imports no server code", () => {
  const src = read("components/admin/EssayPromptsForm.tsx");
  assert.match(src, /^"use client";/);
  const imports = src.split("\n").filter((l) => /^import /.test(l) && !/^import type /.test(l));
  const forbidden = /@\/lib\/(github-app|admin\/essays-actions|admin\/people|admin\/auth|admin\/console-actions|data)\b|@\/lib\/admin\/essays"/;
  assert.deepEqual(imports.filter((l) => forbidden.test(l)), []);
  assert.ok(forbidden.test('import { listsByUnit } from "@/lib/admin/essays";'), "the check catches the server-side module");
});

/* ------------------------------------------------------------------ */
/* The rail                                                            */
/* ------------------------------------------------------------------ */

test("the rail shows Essays after Operations, highlights it under /admin/essays, and its phone strip scrolls instead of the page", () => {
  const labels = consoleLib.ADMIN_SECTIONS.map((s) => s.label);
  assert.equal(labels.indexOf("Essays"), labels.indexOf("Operations") + 1);
  const section = consoleLib.ADMIN_SECTIONS.find((s) => s.key === "essays")!;
  assert.deepEqual([section.href, section.hint], ["/admin/essays", "Prompts read from the form"]);
  assert.equal(consoleLib.activeSection("/admin/essays"), "essays");
  assert.equal(consoleLib.activeSection("/admin/essays/100005"), "essays");
  const rail = read("components/admin/AdminRail.tsx");
  const stripScrolls = (src: string) => /<ul className="[^"]*\boverflow-x-auto\b/.test(src) && /<li key=\{s\.key\} className="[^"]*max-lg:shrink-0/.test(src) && /min-h-11/.test(src);
  assert.ok(stripScrolls(rail), "seven sections at 390px: the strip scrolls sideways inside itself, each link 44px tall");
  assert.equal(stripScrolls(rail.replace("overflow-x-auto", "flex-wrap")), false, "the check fails when the strip stops scrolling");
});
