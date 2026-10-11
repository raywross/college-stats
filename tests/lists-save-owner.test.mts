/**
 * Where "Add to list" saves (lib/lists.ts mySaveTargets, saveOwner; specs/product/household-hub.md, changed
 * 2026-10-11): a guardian with edit access saves to their child's list (one child: straight there; several: they must
 * name one), a guardian without edit access and a student to their own. Found in owner testing: a parent's saves went
 * to a list of their own the plan never shows. Also the plan row's remove control (PlanRow ×, PlanList.handleRemove;
 * specs/planner/redesign/list.md "Removing a college"). Auth and Supabase are stand-ins: every write records the list
 * owner it went to. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";

const ROOT = join(import.meta.dirname, "..");

type Access = { student: { id: string; display_name: string | null; created: string }; relation: "self" | "guardian"; canEdit: boolean };
type Fake = { user: { id: string } | null; access: Access[]; own: { id: string } | null; roster: Record<string, string>; writes: string[] };
const fake: Fake = { user: null, access: [], own: null, roster: {}, writes: [] };
(globalThis as unknown as { __listsFake: Fake }).__listsFake = fake;

// lib/auth.ts and lib/supabase-server.ts need a request; stand-ins read the fake above. A query records
// "<op> <table> <owner column>=<id>" for list lookups and "<op> list_items <list id>" for item writes.
const AUTH = `
const f = () => globalThis.__listsFake;
export const authConfigured = () => true;
export const getUser = async () => f().user;
export const currentStudent = async () => f().own;
export const studentsICanSee = async () => f().access;
`;
// lib/households.ts householdChildren, over the fake's roster (student id → joined date).
const HOUSEHOLDS = `
const f = () => globalThis.__listsFake;
export async function householdChildren() {
  return f().access.filter((a) => a.relation === "guardian" && a.student.id in f().roster).map((a) => ({ access: a, joined: f().roster[a.student.id] }));
}
`;
const SUPABASE = `
const f = () => globalThis.__listsFake;
function query(table) {
  const q = { table, op: "select", filters: {}, rows: null };
  const result = () => {
    if (q.table === "lists") {
      const [col, id] = Object.entries(q.filters).find(([k]) => k === "student_id" || k === "user_id") ?? [];
      f().writes.push(q.op + " lists " + col + "=" + id);
      const row = { id: "list-" + id, student_id: col === "student_id" ? id : null, user_id: col === "user_id" ? id : null, is_default: true };
      return { data: q.single ? row : [row], error: null };
    }
    if (q.op !== "select") f().writes.push(q.op + " list_items " + (q.rows?.list_id ?? q.ins ?? q.filters.list_id));
    return { data: [], error: null };
  };
  const chain = {
    select() { return chain; },
    insert(rows) { q.op = "insert"; q.rows = rows; return chain; },
    delete() { q.op = "delete"; return chain; },
    update() { q.op = "update"; return chain; },
    eq(k, v) { q.filters[k] = v; return chain; },
    in(k, v) { q.ins = v.join(","); return chain; },
    is() { return chain; },
    order() { return chain; },
    limit() { return chain; },
    maybeSingle() { q.single = true; return Promise.resolve(result()); },
    single() { q.single = true; return Promise.resolve(result()); },
    then(res, rej) { return Promise.resolve(result()).then(res, rej); },
  };
  return chain;
}
export async function createServerSupabase() { return { from: query }; }
export function supabaseAuthEnv() { return null; }
`;

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier === "next/server") return { url: "data:text/javascript,export function after(){}", shortCircuit: true };
    if (specifier === "@/lib/auth") return { url: `data:text/javascript,${encodeURIComponent(AUTH)}`, shortCircuit: true };
    if (specifier === "@/lib/households") return { url: `data:text/javascript,${encodeURIComponent(HOUSEHOLDS)}`, shortCircuit: true };
    if (specifier === "@/lib/supabase-server") return { url: `data:text/javascript,${encodeURIComponent(SUPABASE)}`, shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const { addToMyDefaultList, isOnAnyList, mySaveTargets, removeFromMyLists } = await import("../lib/lists.ts");

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const PURDUE = "243780";
const kid = (id: string, name: string, created: string, canEdit = true): Access => ({ student: { id, display_name: name, created }, relation: "guardian", canEdit });

function as(o: Partial<Fake>) {
  fake.user = "user" in o ? (o.user ?? null) : { id: "parent" };
  fake.access = o.access ?? [];
  fake.own = o.own ?? null;
  // Every student is on the household's roster, joined when their record was made, unless the test says otherwise.
  fake.roster = o.roster ?? Object.fromEntries(fake.access.map((a) => [a.student.id, a.student.created]));
  fake.writes = [];
}

test("a guardian with one editable child: Add to list saves to the child's list, never the guardian's own", async () => {
  // The owner's case: a parent whose sign-up left the default "student" role also has an empty record of their own.
  as({ access: [kid("maya", "Maya Ross", "2026-10-01")], own: { id: "parent-own" } });
  assert.deepEqual(await mySaveTargets(), [{ studentId: "maya", name: "Maya Ross" }]);
  assert.deepEqual(await addToMyDefaultList([PURDUE]), { ok: true });
  assert.ok(fake.writes.includes("insert list_items list-maya"), fake.writes.join(" | "));
  assert.ok(!fake.writes.some((w) => w.includes("parent-own")), "nothing touches the parent's own record");
  fake.writes = [];
  await isOnAnyList(PURDUE);
  assert.ok(fake.writes.includes("select lists student_id=maya"), "the check reads the child's lists");
  fake.writes = [];
  assert.deepEqual(await removeFromMyLists(PURDUE), { ok: true });
  assert.ok(fake.writes.includes("delete list_items list-maya"), fake.writes.join(" | "));
});

test("a guardian of several editable children names one; a student it can't edit is refused", async () => {
  as({ access: [kid("sam", "Sam", "2026-10-05"), kid("maya", "Maya", "2026-10-01")] });
  assert.deepEqual((await mySaveTargets()).map((t) => t.studentId), ["maya", "sam"], "in the order they joined");
  assert.deepEqual(await addToMyDefaultList([PURDUE]), { ok: false, message: "Pick whose list to add it to." });
  assert.equal(fake.writes.length, 0, "no guess");
  assert.deepEqual(await addToMyDefaultList([PURDUE], "sam"), { ok: true });
  assert.ok(fake.writes.includes("insert list_items list-sam"));
  fake.writes = [];
  assert.deepEqual(await addToMyDefaultList([PURDUE], "stranger"), { ok: false, message: "You can't change that list." });
  assert.equal(await isOnAnyList(PURDUE, "stranger"), false);
  assert.equal(fake.writes.length, 0);
});

test("a record the guardian made that's no longer in the household is not a target (the owner's \"Maya\" and \"Maya Ross\")", async () => {
  // The parent created "Maya" from Household; Maya later joined with her own account ("Maya Ross"), and the old
  // record stayed readable to the parent (managed_by) but left the household.
  as({ access: [kid("maya-old", "Maya", "2026-10-01"), kid("maya", "Maya Ross", "2026-10-06")], roster: { maya: "2026-10-06" } });
  assert.deepEqual(await mySaveTargets(), [{ studentId: "maya", name: "Maya Ross" }]);
  assert.deepEqual(await addToMyDefaultList([PURDUE]), { ok: true }, "one child left, so no question");
  assert.ok(fake.writes.includes("insert list_items list-maya"), fake.writes.join(" | "));
  assert.deepEqual(await addToMyDefaultList([PURDUE], "maya-old"), { ok: false, message: "You can't change that list." });
  // The plan's switcher reads the same helper.
  const load = read("lib", "planner", "load.ts");
  assert.match(load, /export async function myPlanChildren[\s\S]*?await householdChildren\(\)/);
  assert.doesNotMatch(load.slice(load.indexOf("export async function myPlanChildren")), /^\s*const \[access, households\] = await Promise\.all\(\[studentsICanSee\(\)/m);
});

test("a guardian without edit access, and a student, save to their own list as before", async () => {
  as({ access: [kid("maya", "Maya", "2026-10-01", false)] });
  assert.deepEqual(await mySaveTargets(), []);
  await addToMyDefaultList([PURDUE]);
  assert.ok(fake.writes.includes("insert list_items list-parent"), fake.writes.join(" | "));
  assert.ok(fake.writes.includes("select lists user_id=parent"));

  as({ user: { id: "maya-user" }, own: { id: "maya" }, access: [{ student: { id: "maya", display_name: "Maya", created: "2026-10-01" }, relation: "self", canEdit: true }] });
  assert.deepEqual(await mySaveTargets(), [], "a student's own record isn't a guardian target");
  await addToMyDefaultList([PURDUE]);
  assert.ok(fake.writes.includes("insert list_items list-maya"));

  as({ user: null });
  assert.deepEqual(await mySaveTargets(), []);
  assert.deepEqual(await addToMyDefaultList([PURDUE]), { ok: false, message: "Sign in to save colleges to a list." });
});

test("the plan row: × for editors only, asks first, and the list removes the item and rolls back on a refusal", () => {
  const row = read("components", "planner", "PlanRow.tsx");
  assert.match(row, /\{canEdit && \(\s*<button[\s\S]*?aria-label=\{`Remove \$\{name\} from the list`\}/, "an editor-only × with a name in its label");
  assert.match(row, /window\.confirm\(`Remove \$\{name\} from the list\? Its notes, visits, and any offer go with it\.`\)\) onRemove\(row\)/);
  const list = read("components", "planner", "PlanList.tsx");
  assert.match(list, /async function handleRemove[\s\S]*?removeFromList\(row\.item\.id\)[\s\S]*?setRows\(before\)/);
  assert.match(list, /onRemove=\{handleRemove\}/);
  // A parent's empty list for a child who hasn't joined says why, and where to send the invitation.
  assert.match(list, /ctx\.viewer\.isGuardian && ctx\.student && ctx\.student\.user_id === null[\s\S]*?hasn&apos;t joined your household yet[\s\S]*?href="\/household"/);
});
