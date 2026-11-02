/**
 * The counselor as a viewer (specs/product/counselor-portal.md "A student", "The student's side", "Rules";
 * specs/planner/parents.md "What a parent sees"): a counselor is someone other than the student, like a parent, but
 * never a parent. Covered here:
 * - lib/viewer-relation.ts: the two questions (`isViewer`, `isParent`) and the role words telemetry carries.
 * - The banner's words for a parent and a counselor (ViewerBanner, rendered for real with react-dom/server), and
 *   GuardianBanner still saying the parent's.
 * - The caseload strip on a counselor's person pages (CaseloadStrip): "Caseload" to /org and the one student.
 * - What a counselor never receives: the story's text (profileForViewer), the story in the intake's draft, the AP
 *   privacy switch (mergeCoursesForSave), each with the old guardian-only rule shown leaking for a counselor.
 * - The pages' wiring (structural): /advisor?for= opens for a counselor with the banner and "Back to caseload", no
 *   switcher; the guides, print, and essays pages take the counselor's `?for=`; the hub's layouts; the planner's
 *   parent-only sites stay parent-only.
 * - A sweep of app/, components/, and lib/ for `relation === "guardian"` (and `!==`, and the essays' `viewer.role`)
 *   used where the meaning is "not the student": every comparison left is listed below with its reason.
 * No network, no database. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import { isParent, isViewer, planViewerRole, viewerRole } from "../lib/viewer-relation.ts";
import { emptyProfile, profileForViewer, redactStoryForGuardian, type StudentProfileData } from "../lib/student-profile.ts";
import { draftFromProfile } from "../lib/planner/intake.ts";
import { mergeCoursesForSave } from "../lib/chances/courses.ts";
import { CASELOAD_HREF, orgStudentHref } from "../lib/org-hrefs.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ */
/* Rendering components without a build step                          */
/* ------------------------------------------------------------------ */

// Inside the repository so a transpiled component's bare imports ("react", "lucide-react") resolve from node_modules.
mkdirSync(join(ROOT, "node_modules", ".cache"), { recursive: true });
const tmp = mkdtempSync(join(ROOT, "node_modules", ".cache", "viewer-relation-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

writeFileSync(
  join(tmp, "info-tip.mjs"),
  `import React from "react";
export const Term = ({ term, children }) => React.createElement("span", { "data-term": term }, children);`,
);
writeFileSync(join(tmp, "link.mjs"), `import React from "react";\nexport default ({ href, children, className, ...rest }) => React.createElement("a", { href, className, "aria-current": rest["aria-current"] }, children);`);

const loaded = new Map<string, string>();
/** Transpiles a component (and the components it imports) to an .mjs beside the stubs; `@/lib/…` points at the real file. */
function transpile(rel: string): string {
  const done = loaded.get(rel);
  if (done) return done;
  const { outputText } = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const code = outputText
    .replace(/from "@\/components\/ui\/info-tip"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "info-tip.mjs")).href)}`)
    .replace(/from "next\/link"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "link.mjs")).href)}`)
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
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");

/* ------------------------------------------------------------------ */
/* The two questions                                                   */
/* ------------------------------------------------------------------ */

test("a counselor is a viewer but never a parent; the role words follow", () => {
  assert.equal(isViewer("self"), false);
  assert.equal(isViewer("guardian"), true);
  assert.equal(isViewer("counselor"), true);
  assert.equal(isParent("guardian"), true);
  assert.equal(isParent("counselor"), false);
  assert.equal(isParent("self"), false);
  assert.deepEqual([viewerRole("self"), viewerRole("guardian"), viewerRole("counselor")], ["student", "guardian", "counselor"]);
  assert.equal(planViewerRole({ relation: "household" }), "guardian");
  assert.equal(planViewerRole({ relation: "counselor" }), "counselor");
});

test("the caseload links: /org and /org/students/<id>", () => {
  assert.equal(CASELOAD_HREF, "/org");
  assert.equal(orgStudentHref("6f1e2d3c-0000-4000-8000-000000000001"), "/org/students/6f1e2d3c-0000-4000-8000-000000000001");
});

/* ------------------------------------------------------------------ */
/* The banner                                                          */
/* ------------------------------------------------------------------ */

const banner = await load("components/account/ViewerBanner.tsx");
const guardianBanner = await load("components/account/GuardianBanner.tsx");
const strip = await load("components/account/CaseloadStrip.tsx");

test("the banner's words for a counselor: edit or look, and that the student sees the visit", () => {
  const edit = text(render(banner.ViewerBanner, { relation: "counselor", studentName: "Jordan", canEdit: true }));
  assert.equal(edit, "Viewing as a counselor · You can edit Jordan’s information. Jordan can see when you view it.");
  const look = text(render(banner.ViewerBanner, { relation: "counselor", studentName: "Jordan", canEdit: false }));
  assert.equal(look, "Viewing as a counselor · You can look but not change Jordan’s information. Jordan can see when you view it.");
  const unnamed = text(render(banner.ViewerBanner, { relation: "counselor", studentName: null, canEdit: false }));
  assert.equal(unnamed, "Viewing as a counselor · You can look but not change this student’s information. The student can see when you view it.");
});

test("the banner's words for a parent are unchanged, and GuardianBanner is the parent's banner", () => {
  const html = render(banner.ViewerBanner, { relation: "guardian", studentName: "Maya", canEdit: true });
  assert.equal(text(html), "Viewing as a guardian · You can edit Maya’s information. Maya can see when you view it.");
  assert.match(html, /data-term="guardian"/, "the parent's role word links the glossary");
  assert.match(html, /role="note"/);
  const old = render(guardianBanner.GuardianBanner, { studentName: "Maya", canEdit: false });
  assert.equal(text(old), "Viewing as a guardian · You can look but not change Maya’s information. Maya can see when you view it.");
  // The rule broken: a banner that always says "guardian" would tell a counselor they're a parent.
  const counselorHtml = text(render(banner.ViewerBanner, { relation: "counselor", studentName: "Maya", canEdit: true }));
  assert.doesNotMatch(counselorHtml, /guardian/);
});

/* ------------------------------------------------------------------ */
/* The caseload strip                                                  */
/* ------------------------------------------------------------------ */

test("a counselor's person pages: Caseload to /org and a strip of just that student", () => {
  const html = render(strip.CaseloadStrip, { studentId: "s-1", name: "Jordan Lee", gradYear: 2028 });
  assert.match(html, /<a href="\/org"[^>]*>.*Caseload<\/a>/);
  assert.match(html, /<a href="\/household\/s-1"[^>]*aria-current="page"/);
  assert.match(text(html), /Jordan/);
  assert.match(text(html), /Student · Class of 2028/);
  assert.doesNotMatch(text(html), /Lee|seats|Add|Invite|Household/, "first name only, and nothing of a household");
  assert.equal((html.match(/<li/g) ?? []).length, 2, "Caseload and the one student");
});

/* ------------------------------------------------------------------ */
/* What a counselor never receives                                     */
/* ------------------------------------------------------------------ */

const SECRET = "I fix bikes for my neighbors on Saturdays. ".repeat(8);
const withStory: StudentProfileData = { ...emptyProfile(), story: { narrative: SECRET, updatedAt: "2026-10-01T00:00:00Z" } };

test("the story's text never reaches a counselor; only whether it's written", () => {
  assert.equal(profileForViewer(withStory, "self").story?.narrative, SECRET);
  for (const relation of ["guardian", "counselor"] as const) {
    const seen = profileForViewer(withStory, relation).story;
    assert.equal(seen?.narrative, "", relation);
    assert.equal(seen?.written, true, relation);
  }
  // The rule broken (the guardian-only test it replaced): a counselor would get the text.
  const before = (d: StudentProfileData, r: string) => (r !== "guardian" ? d : { ...d, story: redactStoryForGuardian(d.story) });
  assert.equal(before(withStory, "counselor").story?.narrative, SECRET);
});

test("the intake's draft carries no story for a counselor, so their save keeps the stored one", () => {
  assert.equal(draftFromProfile(withStory, 2028, "2026-11-01", { relation: "self" }).story, SECRET);
  assert.equal(draftFromProfile(withStory, 2028, "2026-11-01", { relation: "guardian" }).story, null);
  assert.equal(draftFromProfile(withStory, 2028, "2026-11-01", { relation: "counselor" }).story, null);
  assert.equal(draftFromProfile(null, 2028, "2026-11-01", { relation: "counselor" }).story, null);
  assert.equal(draftFromProfile(null, 2028, "2026-11-01", {}).story, "");
});

test("only the student sets the AP privacy switch; a counselor's save keeps it", () => {
  const saved = { courses: [], apExamsPrivate: true };
  const incoming = { courses: [], apExamsPrivate: false };
  assert.equal(mergeCoursesForSave(saved, incoming, "self").apExamsPrivate, false);
  assert.equal(mergeCoursesForSave(saved, incoming, "guardian").apExamsPrivate, true);
  assert.equal(mergeCoursesForSave(saved, incoming, "counselor").apExamsPrivate, true);
});

/* ------------------------------------------------------------------ */
/* The pages' wiring                                                   */
/* ------------------------------------------------------------------ */

test("/advisor?for= opens for a counselor: banner, Back to caseload, one student, the counselor's frame", () => {
  const src = read("app/advisor/page.tsx");
  const fn = src.slice(src.indexOf("async function counselorPlan("), src.indexOf("export default async function PlanPage"));
  assert.ok(fn.length > 0);
  assert.match(fn, /<ViewerBanner relation="counselor"/);
  assert.match(fn, /href=\{orgStudentHref\(id\)\}[\s\S]*?Back to caseload/);
  assert.match(fn, /<PlanPeople people=\{\[person\]\}/, "the people line of just this student: no child switcher");
  assert.match(fn, /relation="counselor"/);
  assert.match(fn, /essaysFor\(loaded, opts\.tab, "counselor"\)/);
  // Checked before the household's viewer, so a caseload student never falls through to "No student yet".
  assert.ok(src.indexOf("await counselorAccessFor(forParam)") < src.indexOf("const viewer = await planViewer()"));
});

test("the guides, print, and essays pages take a counselor's ?for= before the household's", () => {
  for (const [file, call] of [
    ["app/advisor/guide/[slug]/page.tsx", "counselorAccessFor(sp.for)"],
    ["app/advisor/print/page.tsx", "counselorAccessFor(forId)"],
    ["lib/essays/load.ts", "counselorAccessFor(forParam)"],
  ] as const) {
    const src = read(file);
    assert.ok(src.includes(call), file);
    assert.ok(src.indexOf(call) < src.indexOf("await planViewer()"), `${file}: the counselor first`);
  }
  for (const file of ["app/advisor/guide/[slug]/page.tsx", "app/advisor/print/page.tsx", "app/advisor/essays/[id]/page.tsx", "app/advisor/essays/package/[unit]/page.tsx"]) {
    assert.match(read(file), /<ViewerBanner relation="counselor"/, file);
  }
  const load = read("lib/planner/load.ts");
  assert.match(load, /return access\?\.relation === "counselor" \? access : null;/, "only a counselor grant takes this path");
});

test("the plan's viewer: isCounselor beside isGuardian, the read logged for both, no first-run intake for a counselor", () => {
  const load = read("lib/planner/load.ts");
  assert.match(load, /isGuardian: isParent\(relation\),\s*isCounselor: relation === "counselor",/);
  assert.match(load, /if \(relation !== "self"\) await scheduleStudentReadLog\(student\.id, "plan_tasks"\);/);
  const frame = read("components/planner/PlanFrame.tsx");
  assert.match(frame, /const needsIntake = intakeNeeded\(ctx\) && relation !== "counselor";/);
  assert.match(frame, /const viewer = viewerRole\(relation\);/);
  // The ED decision stays the student's (EdSheet, EdDecideCard): not `!isGuardian`, which a counselor would pass.
  for (const file of ["components/planner/EdSheet.tsx", "components/planner/moves/EdDecideCard.tsx"]) {
    assert.match(read(file), /const isStudent = ctx\.viewer\.relation === "self" && ctx\.viewer\.canEdit;/, file);
  }
  assert.match(read("components/planner/guides/StoryGuide.tsx"), /const isGuardian = ctx\.viewer\.relation !== "self";/, "a counselor never gets the story's field");
});

test("parent-only things stay a parent's: the money lane, consent, the household line, the feed, Your part", () => {
  assert.match(read("lib/planner/calendar.ts"), /sub: ctx\.viewer\.isGuardian \? "your part" : "with a parent"/);
  assert.match(read("components/planner/stages/OffersStage.tsx"), /ctx\.viewer\.canEdit && ctx\.viewer\.isGuardian\)/);
  assert.match(read("components/planner/PlanList.tsx"), /ctx\.viewer\.isGuardian && ctx\.student && ctx\.student\.user_id === null/);
  const cal = read("components/planner/FamilyCalendar.tsx");
  assert.match(cal, /viewer === "student" && children\.length === 1 && <AddToCalendar feed=\{\{ kind: "list"/, "no feed for a counselor");
  assert.match(read("lib/planner/store-parents.ts"), /\.filter\(\(s\) => s\.relation !== "counselor"\)/);
  assert.match(read("components/planner/PlanOpened.tsx"), /viewer !== "counselor"\) void recordPlanOpen/, "the header's dot is the family's");
});

test("the household hub for a counselor: no family frame, the caseload strip on a caseload student's pages", () => {
  const layout = read("app/household/layout.tsx");
  assert.match(layout, /counselorOnly = hs\.length === 0 && !own && \(await studentsICanSee\(\)\)\.some\(\(a\) => a\.relation === "counselor"\);/);
  assert.match(layout, /if \(counselorOnly\) return <div[^>]*>\{children\}<\/div>;/);
  const person = read("app/household/[person]/layout.tsx");
  assert.match(person, /person\.access\.relation !== "counselor"\) return children;/);
  assert.match(person, /<CaseloadStrip /);
  const header = read("components/account/PersonHeader.tsx");
  assert.match(header, /person\.access\.relation !== "self" && \(\s*<ViewerBanner relation=\{person\.access\.relation\}/);
  const record = read("app/household/[person]/record/page.tsx");
  assert.match(record, /if \(profile\.relation !== "self"\) await scheduleStudentReadLog/);
  const list = read("components/lists/ListPage.tsx");
  assert.match(list, /guardianOf: access\.relation !== "self" \? \{ relation: access\.relation,/);
});

/* ------------------------------------------------------------------ */
/* The sweep                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every comparison with "guardian" on a viewer's relation (or the essays viewer's role) left in app/, components/,
 * and lib/, by file and the line's code, with why it means "a parent" (or is otherwise not "not the student").
 * Anything else is a site that would leave a counselor out of what a guardian gets: write `relation !== "self"`
 * (lib/viewer-relation.ts isViewer), or add it here with its reason if it really is a parent's.
 */
const ALLOWED: { file: string; code: string; why: string }[] = [
  { file: "lib/viewer-relation.ts", code: 'return relation === "guardian";', why: "isParent itself" },
  { file: "components/account/ViewerBanner.tsx", code: 'Viewing as a {relation === "guardian" ? <Term term="guardian">guardian</Term> : "counselor"}', why: "the banner's role word" },
  {
    file: "lib/households.ts",
    code: 'return a.relation === "guardian" && at !== undefined ? [{ access: a, joined: at }] : [];',
    why: "householdChildren: a household's children are a parent's (the plan's switcher, save targets)",
  },
  {
    file: "lib/households.ts",
    code: 'if (access?.relation === "guardian") await scheduleStudentReadLog(studentId, table);',
    why: "openStudentAs: U1 (the model unit) owns lib/households.ts and makes this `!== \"self\"`; until it lands a counselor has no grants",
  },
];

const PATTERN = /\b(?:relation|viewer\.role)\s*(?:===|!==)\s*"guardian"/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(rel);
  }
  return out;
}

/** The code lines (comments skipped) that compare a relation with "guardian". */
function guardianComparisons(file: string, src: string): { file: string; code: string }[] {
  return src
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("*") && !line.startsWith("//") && !line.startsWith("/*") && PATTERN.test(line))
    .map((code) => ({ file, code }));
}

const allowed = (hit: { file: string; code: string }) => ALLOWED.some((a) => a.file === hit.file && a.code === hit.code);

test("no relation === \"guardian\" left where the meaning is \"not the student\"", () => {
  const hits = ["app", "components", "lib"].flatMap(sourceFiles).flatMap((f) => guardianComparisons(relative(ROOT, join(ROOT, f)), read(f)));
  const unexplained = hits.filter((h) => !allowed(h));
  assert.deepEqual(unexplained, [], "each of these leaves a counselor out; use relation !== \"self\", or list it in ALLOWED with its reason");
  for (const a of ALLOWED) assert.ok(a.why.length > 10, `${a.file}: say why`);
});

test("the sweep catches a guardian-only check and skips comments", () => {
  // The rule broken: the record page's old read log, and the profile store's old redaction.
  assert.equal(guardianComparisons("x.tsx", 'if (profile.relation === "guardian") await scheduleStudentReadLog(id, "x");').length, 1);
  assert.equal(guardianComparisons("x.ts", 'if (relation !== "guardian") return data;').length, 1);
  assert.equal(guardianComparisons("x.ts", 'if (viewer.role === "guardian") void log();').length, 1);
  assert.equal(guardianComparisons("x.ts", ' * render the banner when `relation === "guardian"`').length, 0);
  assert.equal(guardianComparisons("x.ts", 'const guardians = members.filter((m) => m.role === "guardian");').length, 0, "a household member's role is not a viewer's relation");
  assert.equal(allowed({ file: "lib/x.ts", code: 'if (relation === "guardian") x();' }), false);
});
