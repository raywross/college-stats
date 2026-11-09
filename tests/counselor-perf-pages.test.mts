/**
 * The counselor pages on one bundle each (specs/product/counselor-portal.md "The counselor's pages: /org"; the
 * counselor performance build, U2): the caseload and a student's page assembled from org_caseload_bundle() /
 * org_student_bundle() equal what the table reads assemble from the same rows; the pretend day comes from the bundle
 * as plannerTodayOverride parses it; the pages start their bundle before the sign-in check and are timed; the header
 * isn't asked again on a plain caseload visit; /api/me reads the profile row, not the account. No network, no
 * database. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleCaseloadStudents,
  caseloadFromBundle,
  namedNotes,
  studentFromBundle,
  type CaseloadEssayRow,
  type CaseloadItem,
  type CaseloadListRow,
  type CaseloadProfileRow,
  type CaseloadTask,
} from "../lib/org-caseload.ts";
import type { OrgCaseloadBundle, OrgStudentBundle } from "../lib/bundle-read.ts";
import type { OrgAsk, OrgRosterRow, Organization } from "../lib/org-rules.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function item(id: string, unit_id: string): CaseloadItem {
  return {
    id, unit_id, category: "target", status: "considering", outcome: null, round: "rd", position: 0, enrolling: false, visited_on: null, dream: false,
    added_at: "2026-09-01T12:00:00Z", committed_on: null, withdrawn_on: null, deadline_date: null, deadline_text: null,
  } as CaseloadItem;
}
function task(id: string, due_on: string | null = null): CaseloadTask {
  return {
    id, item_id: null, kind: "own", title: "A step", due_on, window_start: null, window_end: null, done_at: null, dismissed: false,
    snoozed_until: null, orphaned: false, source: "cycle", created_at: "2026-09-01T12:00:00Z", position: 0,
  } as CaseloadTask;
}
function rosterRow(over: Partial<OrgRosterRow>): OrgRosterRow {
  return {
    status: "active", grant_id: null, student_id: null, display_name: null, grad_year: null, can_edit: true, granted_at: null, source: "invite",
    has_account: true, invitation_id: null, email: null, expires_at: null, token: null, ...over,
  };
}

const ORG: Organization = {
  id: "o1", name: "North High counseling", kind: "school", ncessch: null, website: null, join_code: "ABCD2345", created: "2026-10-01T00:00:00Z", my_role: "owner",
  members: [
    { member_id: "m1", user_id: "u-maria", display_name: "Maria", role: "owner", is_me: true, joined: "2026-10-01T00:00:00Z" },
    { member_id: "m2", user_id: "u-li", display_name: null, role: "counselor", is_me: false, joined: "2026-10-02T00:00:00Z" },
  ],
} as Organization;

const ROSTER: OrgRosterRow[] = [
  rosterRow({ student_id: "s1", display_name: "Jordan", grad_year: 2027, grant_id: "g1" }),
  rosterRow({ student_id: "s2", display_name: "Avery", grad_year: null, can_edit: false, has_account: false, grant_id: "g2" }),
  rosterRow({ status: "invited", display_name: "Sam", email: "sam@example.com", invitation_id: "inv1", token: "tok", expires_at: "2026-12-01T00:00:00Z" }),
];
const PROFILES: CaseloadProfileRow[] = [{ student_id: "s1", data: { basics: { gradYear: 2027 }, story: { narrative: "private", updatedAt: "2026-10-01T00:00:00.000Z" } } }];
const LISTS: CaseloadListRow[] = [
  {
    id: "l1",
    student_id: "s1",
    list_items: [{ ...item("i1", "100654"), plan_visits: [{ item_id: "i1", on_date: "2026-10-01", created_at: "2026-09-01T00:00:00Z", updated_at: null }] }],
    plan_tasks: [task("t1", "2026-11-20"), task("t2")],
  },
];
const ESSAYS: CaseloadEssayRow[] = [
  { id: "e1", student_id: "s1", updated: "2026-10-01T00:00:00Z" },
  { id: "e2", student_id: "s1", updated: "2026-10-05T00:00:00Z" },
];

/** What the bundle carries, as JSON would bring it back. */
const caseloadBundle = (today: unknown): OrgCaseloadBundle => structuredClone({ org: ORG, roster: ROSTER, today, profiles: PROFILES, lists: LISTS, essays: ESSAYS });

/* ------------------------------------------------------------------ */
/* The two paths assemble the same page                                */
/* ------------------------------------------------------------------ */

test("the caseload from org_caseload_bundle() is what the table reads assemble from the same rows", () => {
  const fromBundle = caseloadFromBundle(caseloadBundle(null), "2026-11-08", "preview");
  // The table path (lib/orgs.ts caseloadStudents): the roster, then the three reads, joined by assembleCaseloadStudents.
  const fromTables = assembleCaseloadStudents(ROSTER, { profiles: PROFILES, lists: LISTS, essays: ESSAYS });
  assert.deepEqual(fromBundle.students, fromTables);
  assert.deepEqual(fromBundle.students.map((s) => s.studentId), ["s1", "s2"], "live students only, in roster order");
  assert.deepEqual(fromBundle.roster, ROSTER, "every roster row stays for the invited list");
  assert.equal(fromBundle.org.id, "o1");
  assert.ok(!JSON.stringify(fromBundle.students).includes("private"), "the story's text never reaches a counselor on either path");
  // guard: a bundle that dropped a student's list would not match.
  const broken = caseloadFromBundle({ ...caseloadBundle(null), lists: [] }, "2026-11-08", "preview");
  assert.notDeepEqual(broken.students, fromTables);
});

test("the bundle's pretend day is the planner's today off production, and ignored in production", () => {
  const set = caseloadFromBundle(caseloadBundle("2027-03-15"), "2026-11-08", "preview");
  assert.deepEqual([set.today, set.pretendDay], ["2027-03-15", "2027-03-15"]);
  const unset = caseloadFromBundle(caseloadBundle(null), "2026-11-08", "preview");
  assert.deepEqual([unset.today, unset.pretendDay], ["2026-11-08", null]);
  const prod = caseloadFromBundle(caseloadBundle("2027-03-15"), "2026-11-08", "production");
  assert.deepEqual([prod.today, prod.pretendDay], ["2026-11-08", null], "never honored in production");
  const malformed = caseloadFromBundle(caseloadBundle("2027-02-30"), "2026-11-08", "preview");
  assert.equal(malformed.today, "2026-11-08");
});

const NOTES: OrgStudentBundle["notes"] = [
  { id: "n2", org_id: "o1", student_id: "s1", author_id: "u-li", body: "Second", created: "2026-10-03T00:00:00Z", updated: "2026-10-03T00:00:00Z" },
  { id: "n1", org_id: "o1", student_id: "s1", author_id: "u-maria", body: "First", created: "2026-10-02T00:00:00Z", updated: "2026-10-02T00:00:00Z" },
  { id: "n0", org_id: "o1", student_id: "s1", author_id: "u-gone", body: "Left", created: "2026-10-01T00:00:00Z", updated: "2026-10-01T00:00:00Z" },
];
const ASKS: OrgAsk[] = [
  { id: "a1", org_id: "o1", student_id: "s1", kind: "record_section", section: "grades", note: null, created_by: "u-maria", created: "2026-10-04T00:00:00Z", done_at: null, seen_at: null },
];

test("a student's page from org_student_bundle() is the caseload's student, with the notes named as orgNotes names them", () => {
  const b: OrgStudentBundle = structuredClone({ org: ORG, today: null, entry: ROSTER[0], profile: PROFILES[0], list: LISTS[0], essays: ESSAYS, notes: NOTES, asks: ASKS });
  const page = studentFromBundle(b, "2026-11-08", "preview");
  const [fromTables] = assembleCaseloadStudents([ROSTER[0]], { profiles: PROFILES, lists: LISTS, essays: ESSAYS });
  assert.deepEqual(page.student, fromTables);
  assert.deepEqual(page.notes.map((n) => [n.id, n.author_name]), [["n2", null], ["n1", "Maria"], ["n0", null]], "a member without a name, or who left, reads as null");
  assert.deepEqual(page.notes, namedNotes(ORG, "o1", NOTES), "the same naming the table path uses");
  assert.deepEqual(page.asks, ASKS);
  assert.equal(page.today, "2026-11-08");
  // A student with no rows reads as empty, not missing (the page shows them).
  const bare = studentFromBundle({ ...b, profile: null, list: null, essays: [], notes: [], asks: [] }, "2026-11-08", "preview");
  assert.deepEqual([bare.student?.profile, bare.student?.items, bare.student?.essays], [null, [], []]);
  // Not on the caseload: entry null, nothing else (the page 404s).
  const off = studentFromBundle({ org: ORG, today: "2027-01-10", entry: null, profile: null, list: null, essays: [], notes: [], asks: [] }, "2026-11-08", "preview");
  assert.deepEqual([off.entry, off.student, off.notes, off.asks, off.today], [null, null, [], [], "2027-01-10"]);
});

test("namedNotes names nobody from another organization's members", () => {
  assert.deepEqual(namedNotes(ORG, "o-other", NOTES).map((n) => n.author_name), [null, null, null]);
  assert.deepEqual(namedNotes(null, "o1", NOTES).map((n) => n.author_name), [null, null, null]);
});

/* ------------------------------------------------------------------ */
/* The pages (source rules)                                            */
/* ------------------------------------------------------------------ */

const TIMED: [string, string][] = [
  ["app/org/page.tsx", "/org"],
  ["app/org/students/[id]/page.tsx", "/org/students/[id]"],
  ["app/org/export/route.ts", "/org/export"],
  ["app/advisor/essays/[id]/page.tsx", "/advisor/essays/[id]"],
];

/** Whether a route's source imports withTiming and wraps its work with `label`. */
function timedAs(src: string, label: string): boolean {
  return /import \{[^}]*\bwithTiming\b[^}]*\} from "@\/lib\/timing-server"/.test(src) && src.includes(`withTiming(${JSON.stringify(label)},`);
}

test("the four routes are timed under their labels", () => {
  for (const [file, label] of TIMED) assert.ok(timedAs(read(file), label), `${file} should call withTiming("${label}", …)`);
  // guard: an import without the call, or the wrong label, is caught.
  assert.ok(!timedAs(`import { withTiming } from "@/lib/timing-server";\nexport default () => render();`, "/org"));
  assert.ok(!timedAs(`import { withTiming } from "@/lib/timing-server";\nwithTiming("/orgs", f);`, "/org"));
});

test("the essay page's timing covers the viewer and the draft, each as an essay span", () => {
  const src = read("app/advisor/essays/[id]/page.tsx");
  // The whole render (which starts with essaysViewer and readEssay) runs inside the wrap.
  assert.match(src, /withTiming\("\/advisor\/essays\/\[id\]", \(\) => render\(/);
  assert.match(src, /span\("essay viewer", \(\) => essaysViewer\(/);
  assert.match(src, /span\("essay read", \(\) => readEssay\(/);
});

test("each counselor page starts its one bundle before the sign-in check and keeps every check", () => {
  const caseload = read("app/org/page.tsx");
  const student = read("app/org/students/[id]/page.tsx");
  const exp = read("app/org/export/route.ts");
  const before = (src: string, a: string, b: string) => src.indexOf(a) >= 0 && src.indexOf(b) >= 0 && src.indexOf(a) < src.indexOf(b);
  assert.ok(before(caseload, "caseloadData()", "await requireUser("), "/org");
  assert.ok(before(student, "studentData(id)", "await requireUser("), "/org/students/[id]");
  assert.ok(before(exp, "caseloadData()", "await getAccount()"), "/org/export");
  // None of them makes the reads the bundle replaced.
  for (const src of [caseload, student, exp]) assert.doesNotMatch(src, /\b(myOrganization|orgRoster|caseloadStudents|caseloadEntry|orgNotes|orgAsks|plannerToday)\(/);
  // The checks the pages made before: the deleted account, the start form, the 404s, the access log and canEdit.
  assert.match(caseload, /deleted_at\) redirect\("\/account"\)/);
  assert.match(caseload, /<StartOrgForm \/>/);
  assert.match(student, /if \(!data\) redirect\("\/org"\)/);
  assert.match(student, /if \(!data\.entry \|\| !access\) notFound\(\)/);
  assert.match(student, /openStudentAs\(id, "student_profiles"\)/);
  assert.match(student, /canEdit: access\.canEdit/);
  // The caseload's pretend-today line takes the bundle's day instead of reading the setting again.
  assert.match(caseload, /<PretendTodayBanner day=\{pretendDay\} \/>/);
});

test("the bundle reads ask nothing signed out and fall back to the table reads when the bundle isn't there", () => {
  const src = read("lib/orgs.ts");
  assert.match(src, /async function loadBundle[\s\S]*?if \(!\(await getUser\(\)\)\) return null;[\s\S]*?callBundle/);
  for (const fn of ["caseloadData", "studentData"]) {
    const body = new RegExp(`export const ${fn} = cache\\([\\s\\S]*?\\n\\}\\);`).exec(src)?.[0] ?? "";
    assert.ok(body, fn);
    assert.match(body, /r\.kind === "ok"/, `${fn} uses the bundle when it answered`);
    assert.match(body, /myOrganization\(\)/, `${fn} falls back to the table reads`);
    assert.match(body, /plannerToday\(\)/, `${fn}'s fallback keeps plannerToday()`);
  }
  assert.match(read("lib/org-caseload.ts"), /parseTodaySetting\(b\.today/);
});

/* ------------------------------------------------------------------ */
/* The header                                                          */
/* ------------------------------------------------------------------ */

test("RefreshHeader asks /api/me again only when the header's answer disagrees with the page", () => {
  const src = read("components/org/RefreshHeader.tsx");
  assert.match(src, /const me = useMe\(\);/);
  assert.match(src, /me !== null && me\.signedIn && me\.org !== org/);
  assert.match(src, /if \(stale\) refreshMe\(\)/);
  assert.ok(src.indexOf("useMe()") < src.indexOf("refreshMe()"), "reads the header's state before refreshing");
  // /org tells it what it knows; /household refreshes on every arrival, as before.
  const page = read("app/org/page.tsx");
  assert.match(page, /<RefreshHeader org=\{false\} \/>/);
  assert.match(page, /<RefreshHeader org \/>/);
  assert.match(read("app/household/layout.tsx"), /<RefreshHeader \/>/);
});

test("/api/me reads the profile row, not the account, and answers a paused profile as signed out", () => {
  const src = read("app/api/me/route.ts");
  assert.doesNotMatch(src, /\bgetAccount\b/);
  assert.match(src, /readProfileRow\(\)/);
  assert.match(src, /if \(profile\.paused\) return answer\(signedOut\(true\), headers\)/);
  const auth = read("lib/auth.ts");
  assert.match(auth, /export async function readProfileRow\(\)[\s\S]*?\$\{PROFILE_COLUMNS\}, suspended_at[\s\S]*?isMissingSuspension/);
});
