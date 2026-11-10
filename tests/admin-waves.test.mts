/**
 * The console pages read in few waves (specs/product/admin-speed.md "Waves"): a wave is an `await` that waits on the
 * one before. Pages can't render under node:test, so these read the source: the college page reads everything after
 * the admin check in one Promise.all; adminPerson, adminStudent, and adminHousehold await only Promise.all waves (and
 * adminStudent one names read); the student page starts the standing estimate beside its other reads, and the
 * estimate reads the student's data through the page's cache()d readers. And every route this build times is
 * labelled by its route pattern, never an id (specs/serving-architecture.md "Timing a request"). Each check is shown
 * failing on a sequential version. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** The text of a function from its declaration to the next top-level declaration. */
function body(src: string, start: string): string {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `found ${start}`);
  const rest = src.slice(i + start.length);
  const end = rest.search(/\n(export |async function |function |const |\/\*\*|\/\* -)/);
  return start + (end < 0 ? rest : rest.slice(0, end));
}

/** Every `await <expression start>` in a piece of code, in order. */
const awaits = (code: string) => [...code.matchAll(/\bawait\s+([\w.]+)/g)].map((m) => m[1]);

/** The awaits a function makes besides its admin check and its Promise.all waves. */
const sequential = (code: string, allowed: readonly string[]) => awaits(code).filter((a) => a !== "Promise.all" && !allowed.includes(a));

test("the college page: the admin check, then one Promise.all with every read", () => {
  const page = body(read("app/admin/data/colleges/[unit]/page.tsx"), "async function renderCollege(");
  const head = page.slice(0, page.indexOf("return ("));
  assert.deepEqual(sequential(head, ["connection", "requireAdmin", "params"]), [], "no read awaited on its own");
  assert.equal(awaits(head).filter((a) => a === "Promise.all").length, 1);
  const all = head.slice(head.indexOf("await Promise.all("));
  for (const read of ["adminCollege(unit)", "collegeViewers(unit)", "collegeHistory(unit)", "readCollegeDocuments(", "collegeInputsFor(unit)"]) assert.ok(all.includes(read), `${read} in the one wave`);
});

test("the guard catches a sequential page", () => {
  const bad = "async function renderCollege() {\n  await requireAdmin();\n  const college = await adminCollege(unit);\n  const looking = await collegeViewers(unit);\n  return (";
  assert.deepEqual(sequential(bad.slice(0, bad.indexOf("return (")), ["connection", "requireAdmin", "params"]), ["adminCollege", "collegeViewers"]);
});

test("adminPerson: four Promise.all waves after the admin check, no read on its own", () => {
  const fn = body(read("lib/admin/people.ts"), "export async function adminPerson(");
  assert.deepEqual(sequential(fn, ["db"]), []);
  assert.equal(awaits(fn).filter((a) => a === "Promise.all").length, 4, "profile + account; own memberships + lists + access; households + members + items; names + students");
  assert.doesNotMatch(fn, /withNames\(|accessFor\(/, "names are read once, for every id at once");
});

test("adminStudent: three Promise.all waves and one names read; adminHousehold: two waves", () => {
  const people = read("lib/admin/people.ts");
  const student = body(people, "export async function adminStudent(");
  assert.deepEqual(sequential(student, ["db"]), ["namesFor"]);
  assert.equal(awaits(student).filter((a) => a === "Promise.all").length, 3);
  for (const shared of ["readStudentRecord(studentId)", "readStudentProfile(studentId)", "readStudentLists(studentId)", "readStudentItems(studentId)", "readStudentVisits(studentId)"]) assert.ok(student.includes(shared), shared);
  const household = body(people, "export async function adminHousehold(");
  assert.deepEqual(sequential(household, ["db"]), []);
  assert.equal(awaits(household).filter((a) => a === "Promise.all").length, 2);
});

test("the student's shared reads are cache()d per request, and the standing panel reads through them", () => {
  const people = read("lib/admin/people.ts");
  for (const name of ["readStudentRecord", "readStudentProfile", "readStudentLists", "readStudentItems", "readStudentVisits"]) assert.match(people, new RegExp(`export const ${name} = cache\\(`), name);
  const standing = read("lib/admin/standing.ts");
  for (const name of ["readStudentRecord(", "readStudentProfile(", "readStudentLists(", "readStudentItems(", "readStudentVisits("]) assert.ok(standing.includes(name), name);
  assert.doesNotMatch(standing, /from\("(students|student_profiles|lists|list_items|plan_visits)"\)/, "no second read of what the page reads");
  // The hooks' columns ride on the shared items read.
  assert.match(people, /ITEM_HOOK_COLUMNS = "followed_networks, info_requested_on, legacy, recruited, legacy_sibling"/);
});

test("the student page writes the access row first, then starts standingForStudent beside its other reads", () => {
  const page = body(read("app/admin/students/[id]/page.tsx"), "async function renderStudent(");
  const log = page.indexOf("await logStudentView(");
  const all = page.indexOf("await Promise.all(");
  assert.ok(log > 0 && all > log, "nothing is read before the access row exists");
  const wave = page.slice(all, page.indexOf("]);", all));
  for (const read of ["adminStudent(id)", "standingForStudent(id)", "studentOrganizationGrants(id)", "getData()"]) assert.ok(wave.includes(read), `${read} in the wave`);
  assert.deepEqual(sequential(page.slice(0, page.indexOf("return (")), ["connection", "requireAdmin", "params", "logStudentView", "searchParams"]), []);
});

test("the person page reads the views, activity, and organization beside adminPerson", () => {
  const page = body(read("app/admin/people/[user]/page.tsx"), "async function renderPerson(");
  const wave = page.slice(page.indexOf("await Promise.all("));
  for (const read of ["adminPerson(user)", "personCollegeViews(user)", "authActivity(user)", "personOrganization(user)"]) assert.ok(wave.includes(read), read);
});

/* withTiming on the routes this build times */

const TIMED: [string, string][] = [
  ["app/admin/data/colleges/[unit]/page.tsx", "/admin/data/colleges/[unit]"],
  ["app/admin/people/[user]/page.tsx", "/admin/people/[user]"],
  ["app/admin/students/[id]/page.tsx", "/admin/students/[id]"],
  ["app/admin/households/[id]/page.tsx", "/admin/households/[id]"],
  ["app/admin/data/page.tsx", "/admin/data"],
  ["app/admin/data/health/page.tsx", "/admin/data/health"],
  ["app/admin/steward/jobs/page.tsx", "/admin/steward/jobs"],
];

/** A label is a route pattern: literal path segments and [param] names, nothing interpolated. */
const isRouteLabel = (label: string) => /^(\/([a-z0-9-]+|\[[a-z]+\]))+$/.test(label) && !/\d{4,}|[0-9a-f]{8}-/.test(label);

test("each timed admin page wraps its data work in withTiming under its route pattern, never an id", () => {
  for (const [file, label] of TIMED) {
    const src = read(file);
    assert.match(src, /import \{ withTiming \} from "@\/lib\/timing-server";/, file);
    const calls = [...src.matchAll(/withTiming\(([^,]+),/g)].map((m) => m[1].trim());
    assert.deepEqual(calls, [JSON.stringify(label)], `${file}: one withTiming, a string literal`);
    assert.ok(isRouteLabel(label), label);
  }
  assert.equal(isRouteLabel("/admin/students/56e84181-28ab-49c1-9eb1-9e1fcb350473"), false, "an id fails");
  assert.equal(isRouteLabel("/admin/data/colleges/166027"), false, "a unit id fails");
  assert.equal(isRouteLabel("`/admin/students/${id}`"), false, "a template fails");
});
