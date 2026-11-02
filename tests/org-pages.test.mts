/**
 * The counselor portal's pages, rendered (specs/product/counselor-portal.md "The counselor's pages", "A student",
 * "Asking a student for something", "Members and settings"): components/org/** transpiled and rendered with
 * react-dom/server from fixtures, with Server Actions, links, and the high school picker stubbed. Covered: the start
 * form with the free line, the empty caseload with the join code, a caseload with signals and an invited student, the
 * student page's banner and four panels, the ask notice, and the members page for an owner and a counselor. Plus the
 * rules that hold across the pages (structural): noindex on every /org page, the portal's reads use the counselor's
 * own session and never an estimate, and the ask notice sits at the top of Next steps. No network, no database.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import { caseloadCounts, caseloadRows, invitedStudents, type CaseloadItem, type CaseloadStudent, type CaseloadTask } from "../lib/org-caseload.ts";
import type { OpenOrgAsk, OrgAsk, OrgNote, Organization, OrgRosterRow } from "../lib/org-rules.ts";
import { emptyProfile } from "../lib/student-profile.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ */
/* Rendering components without a build step                          */
/* ------------------------------------------------------------------ */

mkdirSync(join(ROOT, "node_modules", ".cache"), { recursive: true });
const tmp = mkdtempSync(join(ROOT, "node_modules", ".cache", "org-pages-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const stub = (name: string, code: string) => {
  writeFileSync(join(tmp, name), code);
  return pathToFileURL(join(tmp, name)).href;
};
const STUBS: Record<string, string> = {
  "@/components/ui/info-tip": stub("info-tip.mjs", `import React from "react";\nexport const Term = ({ term, children }) => React.createElement("span", { "data-term": term }, children);`),
  "next/link": stub("link.mjs", `import React from "react";\nexport default ({ href, children, className }) => React.createElement("a", { href, className }, children);`),
  "@/components/high-schools/HighSchoolPicker": stub("picker.mjs", `import React from "react";\nexport const HighSchoolPicker = ({ idName }) => React.createElement("input", { name: idName, "data-picker": "1" });`),
  "@/app/org/actions": stub(
    "org-actions.mjs",
    ["createOrganization", "updateOrganization", "regenerateJoinCode", "setMemberRole", "removeMember", "leaveOrganization", "deleteOrganization", "inviteStudents", "resendStudentInvitation", "cancelOrgInvitation", "inviteCounselor", "askStudent", "completeAsk", "addOrgNote", "deleteOrgNote"]
      .map((n) => `export async function ${n}() { return { status: "idle" }; }`)
      .join("\n"),
  ),
  "@/app/household/actions": stub("household-actions.mjs", ["copyInvitationLink", "inviteManagedStudent", "resendInvitation"].map((n) => `export async function ${n}() { return { status: "idle" }; }`).join("\n")),
};

const loaded = new Map<string, string>();
function transpile(rel: string): string {
  const done = loaded.get(rel);
  if (done) return done;
  const { outputText } = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const code = outputText
    .replace(/from "([^"]+)"/g, (m, spec: string) => (STUBS[spec] ? `from ${JSON.stringify(STUBS[spec])}` : m))
    .replace(/from "@\/(components\/[^"]+)"/g, (_m, p: string) => `from ${JSON.stringify(transpile(`${p}.tsx`))}`)
    .replace(/from "@\/(lib\/[^"]+)"/g, (_m, p: string) => `from ${JSON.stringify(pathToFileURL(join(ROOT, `${p}.ts`)).href)}`);
  const file = join(tmp, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, code);
  const url = pathToFileURL(file).href;
  loaded.set(rel, url);
  return url;
}
type Component = (p: Record<string, unknown>) => ReactElement;
const load = async (rel: string) => (await import(transpile(rel))) as Record<string, Component>;
const render = (El: Component, props: Record<string, unknown>) => renderToStaticMarkup(createElement(El, props));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const TODAY = "2026-11-01";
const SCHOOLS = { u1: { name: "Michigan" }, u2: { name: "Ohio State" } };
const item = (id: string, unit_id: string, over: Partial<CaseloadItem> = {}): CaseloadItem => ({
  id, unit_id, category: "target", status: "considering", outcome: null, round: "rd", position: 0, enrolling: false, visited_on: null, dream: false,
  added_at: "2026-09-01T12:00:00Z", committed_on: null, withdrawn_on: null, deadline_date: null, deadline_text: null, ...over,
});
const task = (id: string, over: Partial<CaseloadTask> = {}): CaseloadTask =>
  ({ id, item_id: null, kind: "own", title: "A step", due_on: null, window_start: null, window_end: null, done_at: null, dismissed: false, snoozed_until: null, orphaned: false, source: "cycle", created_at: "2026-09-01T12:00:00Z", position: 0, ...over }) as CaseloadTask;
const profile = emptyProfile();
profile.basics.highSchool = "Central High";
const jordan: CaseloadStudent = {
  studentId: "6f1e2d3c-0000-4000-8000-000000000001", name: "Jordan Lee", gradYear: 2027, canEdit: true, hasAccount: true, profile,
  items: [item("i1", "u1", { category: "reach", status: "applying", round: "ed" }), item("i2", "u2", { status: "applied", round: "ea", position: 1 })],
  tasks: [task("t1", { item_id: "i2", title: "Send test scores", due_on: "2026-10-20" }), task("t2", { item_id: "i1", title: "Submit", due_on: "2026-11-03" })],
  visits: [], essays: [{ id: "e1", updated: "2026-10-31T12:00:00Z" }],
};
const rows = caseloadRows({ students: [jordan], schools: SCHOOLS, status: { [jordan.studentId]: "preview" }, today: TODAY });
const roster = [
  { status: "invited", grant_id: null, student_id: null, display_name: "Sam Ortiz", grad_year: 2028, can_edit: null, granted_at: null, source: null, has_account: null, invitation_id: "inv1", email: "sam@example.com", expires_at: "2026-12-01T12:00:00Z", token: "b".repeat(64) },
] as OrgRosterRow[];
const invited = invitedStudents(roster, "https://quad.test", TODAY);

const views = {
  start: await load("components/org/StartOrgForm.tsx"),
  caseload: await load("components/org/CaseloadView.tsx"),
  student: await load("components/org/StudentView.tsx"),
  notice: await load("components/org/AskNoticeList.tsx"),
  members: await load("components/org/MembersView.tsx"),
  banner: await load("components/account/ViewerBanner.tsx"),
};

/* ------------------------------------------------------------------ */
/* Renders                                                             */
/* ------------------------------------------------------------------ */

test("the start form: name, the two kinds, website, and the free line", () => {
  const t = text(render(views.start.StartOrgForm, {}));
  assert.match(t, /Start your organization/);
  assert.match(t, /Quad is free for counselors and consultants\. Your students’ families decide whether to buy the advisor; you never pay, and you never sell\./);
  assert.match(t, /I’m an independent consultant/);
  assert.match(t, /I work at a school/);
  assert.match(t, /Website \(optional\)/);
});

test("the start form and the counselor banner carry the glossary's organization and access terms", () => {
  const start = render(views.start.StartOrgForm, {});
  assert.match(start, /<span data-term="counselor-organization">organization<\/span>/);
  const banner = render(views.banner.ViewerBanner, { relation: "counselor", studentName: "Jordan", canEdit: true });
  assert.match(banner, /<span data-term="counselor-access">counselor<\/span>/);
});

test("an empty caseload: the join code to share and Add students", () => {
  const html = render(views.caseload.CaseloadView, { rows: [], counts: caseloadCounts([], 0), invited: [], joinCode: "RAVENA", joinLink: "https://quad.test/join/RAVENA" });
  const t = text(html);
  assert.match(t, /Bring in your first students/);
  assert.match(t, /QUAD-RAVENA/);
  assert.match(html, /value="https:\/\/quad\.test\/join\/RAVENA"/);
  assert.match(html, /href="\/org\/students\/new"/);
});

test("a caseload with signals: the counts line, the row's facts, the chips, Export, and the invited student", () => {
  const html = render(views.caseload.CaseloadView, { rows, counts: caseloadCounts(rows, invited.length), invited, joinCode: "RAVENA", joinLink: "https://quad.test/join/RAVENA" });
  const t = text(html);
  assert.match(t, /1 student · 1 senior · 1 with no Likely · 1 deadline this week · 1 invited/);
  assert.match(t, /Jordan Lee/);
  assert.match(t, /Preview/);
  assert.match(t, /Class of 2027/);
  assert.match(t, /1 of 14/);
  assert.match(t, /2 colleges · no Likely yet/);
  assert.match(t, /1 of 2 in/);
  assert.match(t, /Ohio State, Oct 20 \(EA\)/);
  assert.match(t, /Overdue step/);
  assert.match(t, /No Likely/);
  assert.match(html, /title="Missing: Grades, Test score, AP courses/);
  assert.match(html, /href="\/org\/students\/6f1e2d3c-0000-4000-8000-000000000001"/);
  assert.match(html, /href="\/org\/export"/);
  assert.match(t, /Sam Ortiz/);
  assert.match(t, /Invited · link works until Dec 1/);
  assert.match(t, /Copy link/);
  assert.match(t, /Send again/);
  assert.match(t, /Cancel/);
  assert.doesNotMatch(t, /\$\d|price|subscri/i, "nothing about money beyond the status chip");
});

test("the student page: the counselor's banner, the summary, signals, and the four panels", () => {
  const notes: OrgNote[] = [{ id: "n1", org_id: "o1", student_id: jordan.studentId, author_id: "me", author_name: "Ms. Rivera", body: "Met Tuesday.", created: "2026-10-30T12:00:00Z", updated: "2026-10-30T12:00:00Z" }];
  const asks: OrgAsk[] = [
    { id: "a1", org_id: "o1", student_id: jordan.studentId, kind: "record_section", section: "grades", note: null, created_by: "me", created: "2026-10-27T15:00:00Z", done_at: null, seen_at: null },
    { id: "a2", org_id: "o1", student_id: jordan.studentId, kind: "custom", section: null, note: "Bring your activities list", created_by: "me", created: "2026-10-27T15:00:00Z", done_at: "2026-10-29T15:00:00Z", seen_at: null },
  ];
  const html = render(views.student.StudentView, { orgId: "o1", row: rows[0], student: jordan, schools: SCHOOLS, notes, asks, viewerId: "me", today: TODAY, now: new Date("2026-11-01T12:00:00Z") });
  const t = text(html);
  assert.match(t, /Viewing as a counselor · You can edit Jordan’s information\. Jordan can see when you view it\./);
  assert.match(t, /Building the list · Add 1 more · next: Ohio State, Oct 20 \(EA\)/);
  assert.match(t, /Ohio State's "Send test scores" was due Oct 20/);
  for (const h of ["Record", "Advisor", "Notes"]) assert.match(html, new RegExp(`<h2[^>]*>${h}</h2>`));
  assert.match(html, /<h2[^>]*><span data-term="ask">Asks<\/span><\/h2>/, "the Asks panel title carries the glossary term");
  assert.match(t, /Ask Jordan/);
  assert.match(t, /Asked Tuesday/, "an open ask on Grades shows when it was asked, not a second button");
  assert.match(html, /href="\/household\/6f1e2d3c-0000-4000-8000-000000000001\/record"/);
  assert.match(html, /href="\/advisor\?for=6f1e2d3c-0000-4000-8000-000000000001"/);
  assert.match(html, /href="\/advisor\/print\?for=6f1e2d3c-0000-4000-8000-000000000001"/);
  assert.match(html, /href="\/advisor\?for=6f1e2d3c-0000-4000-8000-000000000001&amp;tab=essays"/);
  assert.match(t, /Essays \(1\)/);
  assert.match(t, /Met Tuesday\./);
  assert.match(t, /Ms\. Rivera · Oct 30|Ms\. Rivera · Fri/);
  assert.match(t, /Delete/, "the author can delete their own note");
  assert.match(t, /Bring your activities list Asked Tue · Done Thu/);
  assert.doesNotMatch(t, /3\.\d\d|GPA/, "never a GPA");
});

test("the ask notice: the family's words, a link to the step, and Done for a custom ask", () => {
  const base = { org_id: "o1", org_name: "Rivera Advising", asked_by_name: "Ms. Rivera", created: "2026-10-30T12:00:00Z", seen_at: null };
  const asks: OpenOrgAsk[] = [
    { ...base, id: "a1", kind: "record_section", section: "test", note: null },
    { ...base, id: "a2", kind: "list", section: null, note: null },
    { ...base, id: "a3", kind: "custom", section: null, note: "Send me your activities list" },
  ];
  const html = render(views.notice.AskNoticeList, { asks, person: null, canAct: true });
  const t = text(html);
  assert.match(t, /Ms\. Rivera asked you to add a test score or target\. Add it/);
  assert.match(t, /Ms\. Rivera asked you to add your first colleges\. Add colleges/);
  assert.match(t, /Ms\. Rivera asked: “Send me your activities list” Done/);
  assert.match(html, /href="\/advisor\?record=1&amp;step=1&amp;back=plan"/);
  assert.match(html, /href="\/advisor\?tab=colleges"/);
  // A parent sees the same, with the student's ?for= in the links.
  assert.match(render(views.notice.AskNoticeList, { asks, person: "kid-1", canAct: true }), /href="\/advisor\?for=kid-1&amp;record=1&amp;step=1&amp;back=plan"/);
  assert.equal(render(views.notice.AskNoticeList, { asks: [], person: null, canAct: true }), "");
});

const org: Organization = {
  id: "o1", name: "Rivera Advising", kind: "iec", ncessch: null, website: "rivera.test", join_code: "RAVENA", created: "2026-10-01T00:00:00Z", my_role: "owner",
  members: [
    { member_id: "m1", user_id: "me", display_name: "Ms. Rivera", role: "owner", is_me: true, joined: "2026-10-01T00:00:00Z" },
    { member_id: "m2", user_id: "lee", display_name: "Mr. Lee", role: "counselor", is_me: false, joined: "2026-10-02T00:00:00Z" },
  ],
};

test("the members page: an owner edits, regenerates, sets roles, invites, and can delete; a counselor reads and can leave", () => {
  const owner = text(render(views.members.MembersView, { org, joinLink: "https://quad.test/join/RAVENA", highSchoolName: null }));
  for (const s of ["QUAD-RAVENA", "Regenerate", "Ms. Rivera (you)", "Mr. Lee", "Make owner", "Make counselor", "Remove", "Invite a counselor", "Leave the organization", "Delete organization", "Save"]) assert.ok(owner.includes(s), s);
  const counselor = text(render(views.members.MembersView, { org: { ...org, my_role: "counselor" }, joinLink: "https://quad.test/join/RAVENA", highSchoolName: null }));
  assert.ok(counselor.includes("QUAD-RAVENA") && counselor.includes("Leave the organization"));
  for (const s of ["Regenerate", "Make owner", "Remove", "Invite a counselor", "Delete organization", "Save"]) assert.ok(!counselor.includes(s), `a counselor sees no ${s}`);
});

/* ------------------------------------------------------------------ */
/* The rules across the pages (structural)                            */
/* ------------------------------------------------------------------ */

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const rel = `${dir}/${f}`;
    return statSync(join(ROOT, rel)).isDirectory() ? files(rel, ext) : ext.test(f) ? [rel] : [];
  });
}

/** Every /org page sets robots index: false. */
function pagesWithoutNoindex(sources: Record<string, string>): string[] {
  return Object.entries(sources)
    .filter(([, src]) => !/robots:\s*\{\s*index:\s*false/.test(src))
    .map(([f]) => f);
}

test("noindex on every /org page", () => {
  const pages = Object.fromEntries(files("app/org", /^page\.tsx$/).map((f) => [f, read(f)]));
  assert.ok(Object.keys(pages).length >= 4);
  assert.deepEqual(pagesWithoutNoindex(pages), []);
  // guard: a page without it is caught.
  assert.deepEqual(pagesWithoutNoindex({ "app/org/x/page.tsx": `export const metadata = { title: "X" };` }), ["app/org/x/page.tsx"]);
});

/** Server reads that would see more than the counselor's session: the service role, the admin client, an estimate. */
const WIDER = /supabaseClient\(|adminSupabase|@\/lib\/chances\/(estimate|model)|serviceRole/;

test("the portal reads with the counselor's own session and never runs an estimate", () => {
  const sources = [...files("app/org", /\.tsx?$/), ...files("components/org", /\.tsx?$/), "lib/orgs.ts", "lib/org-caseload.ts"].filter((f) => f !== "app/org/actions.ts");
  const offenders = sources.filter((f) => WIDER.test(read(f)));
  assert.deepEqual(offenders.map((f) => relative(ROOT, join(ROOT, f))), []);
  // The one service-role read: the student's email for the ask's one email, after org_ask proved the grant.
  const actions = read("app/org/actions.ts");
  assert.equal((actions.match(/supabaseClient\(/g) ?? []).length, 1);
  assert.match(actions, /async function studentEmail[\s\S]*?auth\.admin\.getUserById/);
  // guard: the pattern catches a service-role read.
  assert.ok(WIDER.test(`const c = supabaseClient("publish");`));
});

test("the ask notice sits at the top of Next steps, for the family and not a counselor", () => {
  const tabs = read("components/planner/PlanTabs.tsx");
  assert.match(tabs, /tab === "next" && <AskNotice ctx=\{ctx\} \/>\}\s*\{tab === "next" && <NextSteps/);
  assert.match(read("components/org/AskNotice.tsx"), /ctx\.viewer\.isCounselor\) return null/);
});

test("the caseload's export never carries a GPA or a score column", () => {
  const src = read("lib/org-caseload.ts");
  const cols = /CASELOAD_CSV_COLUMNS = \[([^\]]+)\]/.exec(src)?.[1] ?? "";
  assert.ok(cols.length > 0);
  assert.doesNotMatch(cols, /gpa|sat|act|score/i);
});
