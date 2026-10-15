/**
 * The Next steps tab's UI (specs/planner/next-steps/seasons.md "The Next steps tab"; build-plan.md "U1b Next steps
 * tab UI"): `MoveCard`'s rendering (why, date/overdue, assignee chip, the citation, the one action button per
 * `task.action`, read-only labels without edit access) rendered for real with `react-dom/server`, no bundler (the
 * same technique as tests/chances-estimate-ui.test.mts); `NextYearCard`'s fallback to `MoveCard` for every task that
 * isn't the course-choice move; and, for `NextSteps.tsx`, `SeasonExplainer.tsx`, `PlanRow.tsx`, `PlanPeople.tsx`, and
 * `app/plan/page.tsx` (whose client-only hooks and dialog primitive aren't worth stubbing here), structural checks on
 * the source — the groups' order, the empty state, a guardian's Your part, `?move=` scrolling, and the people line's
 * "Next:" reading the loaded plan's top move before the profile step. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanContext, PlanTask } from "../lib/planner/types.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* Rendering MoveCard and NextYearCard without a build step            */
/* ------------------------------------------------------------------ */

const tmp = mkdtempSync(join(tmpdir(), "next-steps-ui-"));
const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;

// The client-only pieces every card leans on: the glossary popovers render as plain marked-up spans, next/link as a
// plain anchor — enough to read back what was passed in.
writeFileSync(
  join(tmp, "info-tip.mjs"),
  `import React from ${JSON.stringify(reactUrl)};
export const InfoTip = ({ term }) => React.createElement("span", { "data-term": term });
export const SourceTip = ({ cited }) => React.createElement("span", { "data-cited": typeof cited === "string" ? cited : cited?.path });
export const Term = ({ term, children }) => React.createElement("span", { "data-term": term }, children);
export const MetricLabel = ({ cited, children, className }) => React.createElement("span", { className, "data-cited": cited ? "yes" : undefined }, children);`,
);
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(reactUrl)};\nexport default ({ href, children, className }) => React.createElement("a", { href, className }, children);`);
// NextYearCard's fallback only needs to prove it reaches for MoveCard; MoveCard's own markup has its own tests below.
writeFileSync(
  join(tmp, "move-card-stub.mjs"),
  `import React from ${JSON.stringify(reactUrl)};\nexport default function MoveCard({ task }) { return React.createElement("div", { "data-stub": "MoveCard" }, task.title); }`,
);
// NextYearCard's own writes (saveCourses, markScheduleDone, …) are "use server" actions that pull in next/cache and
// Supabase; the fallback path this test exercises never calls them, so they're stood in rather than loaded for real.
writeFileSync(join(tmp, "courses-store.mjs"), `export async function saveCourses() { return { ok: true }; }`);
writeFileSync(
  join(tmp, "course-plan-store.mjs"),
  `export async function dismissSuggestion() { return { ok: true }; }\nexport async function markScheduleDone() { return { ok: true }; }\nexport async function saveSchoolOffers() { return { ok: true }; }`,
);
writeFileSync(
  join(tmp, "course-plan-estimate.mjs"),
  `export const ESTIMATE_MAX_COLLEGES = 20;\nexport function endpointFetch() { return async () => null; }\nexport async function whatItChanges() { return null; }`,
);
writeFileSync(join(tmp, "estimate-input.mjs"), `export function estimateInputFromProfile() { return { student: {} }; }`);

/**
 * Transpiles a component (JSX → React.createElement) and wires its imports to the stubs above or the real file.
 * `extra` maps an exact original import line (checked before the general "@/lib/…" rewrite below, so it can
 * override a single module without touching the rest) to its replacement.
 */
async function load(rel: string, extra: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  let code = outputText;
  for (const [from, to] of Object.entries(extra)) code = code.replaceAll(from, to);
  code = code
    .replace(/from "@\/components\/ui\/info-tip"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "info-tip.mjs")).href)}`)
    .replace(/from "next\/link"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "link.mjs")).href)}`)
    .replace(/from "@\/(lib\/[^"]+)"/g, (_m, p: string) => `from ${JSON.stringify(pathToFileURL(join(ROOT, `${p}.ts`)).href)}`)
    .replace(/from "react"/g, `from ${JSON.stringify(reactUrl)}`);
  const file = join(tmp, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}

const React = (await import("react")).default;
const moveCardMod = (await load("components/planner/moves/MoveCard.tsx")) as {
  MoveCard: (p: Record<string, unknown>) => import("react").ReactElement;
  personFor: (ctx: PlanContext) => string | null;
};
const render = (El: (p: Record<string, unknown>) => import("react").ReactElement, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(El, props));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const TODAY = "2027-03-01";

function ctxOf(o: Partial<PlanContext> = {}): PlanContext {
  return {
    list: { id: "l1", student_id: "s1", is_default: true, sort: null, rounds_plan_accepted_at: null } as never,
    items: [],
    tasks: [],
    visits: [],
    offers: [],
    nudges: [],
    student: { id: "s1", display_name: "Maya Ross", grad_year: 2028, user_id: "u1" },
    profile: null,
    schools: {},
    home: null,
    viewer: { userId: "u1", firstName: "Jo", canEdit: true, relation: "self", isGuardian: false },
    today: TODAY,
    cycle: {} as never,
    grade: {} as never,
    season: "junior_spring",
    gradYear: 2028,
    estimates: {},
    stages: {} as never,
    current: 1 as never,
    ...o,
  };
}

function taskOf(o: Partial<PlanTask> = {}): PlanTask {
  return {
    id: "t1",
    list_id: "l1",
    item_id: null,
    key: "l1:playbook:notice_teachers",
    kind: "playbook",
    title: "Notice two teachers you'd ask to write for you",
    detail: "Junior-year teachers in core subjects know your work best. The asking comes in spring.",
    due_on: null,
    window_start: null,
    window_end: null,
    assignee: "student",
    source: "season",
    source_field: null,
    source_edition: null,
    date_note: null,
    done_at: null,
    done_by: null,
    snoozed_until: null,
    dismissed: false,
    orphaned: false,
    position: 0,
    created_by: null,
    created_at: TODAY,
    season: "junior_fall",
    action: { kind: "tick" },
    ...o,
  };
}

const noop = () => {};

/* ------------------------------------------------------------------ */
/* MoveCard                                                             */
/* ------------------------------------------------------------------ */

test("MoveCard: title, why, and 'this season' for an undated move — never Overdue", () => {
  const html = render(moveCardMod.MoveCard as never, { task: taskOf(), ctx: ctxOf(), onDone: noop, onSkip: noop, pending: false });
  assert.match(html, /Notice two teachers/);
  assert.match(html, /Junior-year teachers in core subjects/);
  assert.match(html, />this season</);
  assert.doesNotMatch(html, /Overdue/);
  assert.doesNotMatch(html, /text-destructive/);
});

test("MoveCard: a past dated move is Overdue, in the warning color; the same date next week isn't", () => {
  const overdue = render(moveCardMod.MoveCard as never, { task: taskOf({ due_on: "2027-01-01" }), ctx: ctxOf(), onDone: noop, onSkip: noop, pending: false });
  assert.match(overdue, /Overdue · Jan 1/);
  assert.match(overdue, /text-destructive/);
  const soon = render(moveCardMod.MoveCard as never, { task: taskOf({ due_on: "2027-03-08" }), ctx: ctxOf(), onDone: noop, onSkip: noop, pending: false });
  assert.doesNotMatch(soon, /Overdue/);
  assert.doesNotMatch(soon, /text-destructive/);
});

test("MoveCard: the assignee chip shows only when the assignee isn't the viewer, 'Either' always", () => {
  const student = (assignee: PlanTask["assignee"], isGuardian: boolean) =>
    render(moveCardMod.MoveCard as never, { task: taskOf({ assignee }), ctx: ctxOf({ viewer: { userId: "u1", firstName: "Jo", canEdit: true, relation: "self", isGuardian } }), onDone: noop, onSkip: noop, pending: false });
  assert.doesNotMatch(student("student", false), /data-term="task-assignee"/, "a student sees no chip on their own move");
  assert.match(student("student", true), /data-term="task-assignee"/, "a guardian sees a chip on the student's move");
  assert.doesNotMatch(student("guardian", true), /data-term="task-assignee"/, "a guardian sees no chip on their own move");
  assert.match(student("guardian", false), /data-term="task-assignee"/, "a student sees a chip on a guardian's move");
  assert.match(student("either", false), /data-term="task-assignee"/);
  assert.match(student("either", true), /data-term="task-assignee"/);
});

test("MoveCard: the date is cited only when the task names a field the school actually has", () => {
  const school = { cites: { "admissions.deadline_ed": { path: "admissions.deadline_ed", value: "Nov 1" } } };
  const withCite = render(moveCardMod.MoveCard as never, {
    task: taskOf({ item_id: "i1", source_field: "admissions.deadline_ed", due_on: "2027-11-01" }),
    ctx: ctxOf({ items: [{ id: "i1", unit_id: "u1" } as never], schools: { u1: school as never } }),
    onDone: noop,
    onSkip: noop,
    pending: false,
  });
  assert.match(withCite, /data-cited="yes"/);
  const withoutCite = render(moveCardMod.MoveCard as never, {
    task: taskOf({ item_id: "i1", source_field: "admissions.deadline_rd", due_on: "2027-11-01" }),
    ctx: ctxOf({ items: [{ id: "i1", unit_id: "u1" } as never], schools: { u1: school as never } }),
    onDone: noop,
    onSkip: noop,
    pending: false,
  });
  assert.doesNotMatch(withoutCite, /data-cited="yes"/);
});

test("MoveCard: one button per action kind beyond Done/Not now; tick and the other units' kinds add none", () => {
  const ctx = ctxOf();
  const hrefHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "href", href: "https://example.edu" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.match(hrefHtml, /href="https:\/\/example\.edu"/);
  assert.match(hrefHtml, /target="_blank"/);

  const intakeHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "open_intake", step: 3 } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.match(intakeHtml, /href="\/plan\?setup=1&amp;step=3"/);

  const tabHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "open_tab", tab: "colleges" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.match(tabHtml, /href="\/plan\?tab=colleges"/);

  // PlanList reads `row`/`panel` on the Colleges tab and opens that row's drawer there (the lead's merge notice,
  // replacing an earlier #row- anchor): the same shape U2's edRowHref() builds for the pill's "See why".
  const rowHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "open_row", itemId: "i9" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.match(rowHtml, /href="\/plan\?tab=colleges&amp;row=i9"/);
  assert.match(rowHtml, /See the college/);

  const rowWithPanelHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "open_row", itemId: "i9", panel: "ed" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.match(rowWithPanelHtml, /href="\/plan\?tab=colleges&amp;row=i9&amp;panel=ed"/);

  const tickHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "tick" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.doesNotMatch(tickHtml, /See the college|Open</);

  // The brag-sheet playbook entry (junior spring) carries action.kind "story": the Numbers page's story section,
  // the same route for self and a guardian (the lead's merge notice, after U7's StorySection landed there).
  const storyHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "story" } }), ctx: ctxOf({ student: { id: "s9", display_name: "Maya", grad_year: 2028, user_id: "u1" } }), onDone: noop, onSkip: noop, pending: false });
  assert.match(storyHtml, /href="\/household\/s9\/numbers#story"/);

  const otherUnitHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "mark_applied", itemId: "i1" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.doesNotMatch(otherUnitHtml, /See the college|Open</, "no button for a kind without its own card yet; the title alone stands in");
});

test("MoveCard: Done and Not now are buttons with edit access, plain read-only labels without it", () => {
  const editable = render(moveCardMod.MoveCard as never, { task: taskOf(), ctx: ctxOf({ viewer: { userId: "u1", firstName: "Jo", canEdit: true, relation: "self", isGuardian: false } }), onDone: noop, onSkip: noop, pending: false });
  assert.match(editable, /<button[^>]*>Done<\/button>/);
  assert.match(editable, /<button[^>]*>Not now<\/button>/);
  const readOnly = render(moveCardMod.MoveCard as never, { task: taskOf(), ctx: ctxOf({ viewer: { userId: "u1", firstName: "Jo", canEdit: false, relation: "self", isGuardian: false } }), onDone: noop, onSkip: noop, pending: false });
  assert.doesNotMatch(readOnly, /<button/, "no tappable control at all without edit access");
  assert.match(readOnly, />Done</);
  assert.match(readOnly, />Not now</);
});

test("personFor: null for a signed-in student's own plan, the child's id for a guardian", () => {
  assert.equal(moveCardMod.personFor(ctxOf({ viewer: { userId: "u1", firstName: null, canEdit: true, relation: "self", isGuardian: false } })), null);
  assert.equal(moveCardMod.personFor(ctxOf({ viewer: { userId: "u1", firstName: null, canEdit: true, relation: "guardian", isGuardian: true }, student: { id: "kid-1", display_name: "Maya", grad_year: 2028, user_id: null } })), "kid-1");
});

/* ------------------------------------------------------------------ */
/* NextYearCard: falls back to MoveCard outside the course-choice move */
/* ------------------------------------------------------------------ */

test("NextYearCard: a playbook task that isn't the course choice, or any non-playbook kind, falls back to MoveCard", async () => {
  const mod = (await load("components/planner/NextYearCard.tsx", {
    'from "@/components/planner/moves/MoveCard"': `from ${JSON.stringify(pathToFileURL(join(tmp, "move-card-stub.mjs")).href)}`,
    'from "@/lib/chances/courses-store"': `from ${JSON.stringify(pathToFileURL(join(tmp, "courses-store.mjs")).href)}`,
    'from "@/lib/chances/course-plan-store"': `from ${JSON.stringify(pathToFileURL(join(tmp, "course-plan-store.mjs")).href)}`,
    'from "@/lib/chances/course-plan-estimate"': `from ${JSON.stringify(pathToFileURL(join(tmp, "course-plan-estimate.mjs")).href)}`,
    'from "@/lib/chances/estimate-input"': `from ${JSON.stringify(pathToFileURL(join(tmp, "estimate-input.mjs")).href)}`,
  })) as { NextYearCard: (p: Record<string, unknown>) => import("react").ReactElement };
  const notCourseChoice = renderToStaticMarkup(
    React.createElement(mod.NextYearCard as never, { task: taskOf({ key: "l1:playbook:notice_teachers" }), ctx: ctxOf(), onDone: noop, onSkip: noop, pending: false } as never),
  );
  assert.match(notCourseChoice, /data-stub="MoveCard"/);
  assert.match(notCourseChoice, /Notice two teachers/);

  const noCoursePlan = renderToStaticMarkup(
    React.createElement(mod.NextYearCard as never, {
      task: taskOf({ key: "l1:playbook:freshman_choose_courses", title: "Plan next year's courses" }),
      ctx: ctxOf({ coursePlan: null }),
      onDone: noop,
      onSkip: noop,
      pending: false,
    } as never),
  );
  assert.match(noCoursePlan, /data-stub="MoveCard"/, "a course-choice task still falls back without a loaded course plan");
});

/* ------------------------------------------------------------------ */
/* NextSteps.tsx, SeasonExplainer.tsx: structural checks               */
/* ------------------------------------------------------------------ */

test("NextSteps: PlanTabProps, groups in order, the empty state, Your part first for a guardian, ?move= scrolling", () => {
  const src = read("components", "planner", "NextSteps.tsx");
  assert.match(src, /export function NextSteps\(\{ ctx, view \}: PlanTabProps\)/);
  assert.match(src, /"use client"/);
  // Order in the source: Your part, then Now, then More this season, then Coming up, then Done.
  // Only the function's body, not the file's doc comment (which names every group too, in prose).
  const body = src.slice(src.indexOf("export function NextSteps"));
  const iYourPart = body.indexOf("Your part");
  const iNow = body.indexOf("groups.now.length === 0");
  const iMore = body.indexOf("More this season");
  const iComingUp = body.indexOf("Coming up:");
  const iDone = body.indexOf("Done ({groups.done.length})");
  assert.ok(iYourPart > 0 && iYourPart < iNow, "Your part renders before Now");
  assert.ok(iNow < iMore && iMore < iComingUp && iComingUp < iDone, "More this season, then Coming up, then Done, in that order");
  assert.match(src, /Nothing to do this season\. Enjoy it\./);
  assert.match(src, /open=\{groups\.now\.length === 0\}/, "Coming up opens by itself when there's nothing to do");
  assert.match(src, /ctx\.viewer\.isGuardian && yourPart\.length > 0/, "Your part only for a guardian, and only when there's something in it");
  assert.match(src, /searchParams\.get\("move"\)/);
  assert.match(src, /scrollIntoView/);
  assert.match(src, /plan_move_done[\s\S]*by: viewerRole/);
  assert.match(src, /plan_move_skipped/);
  assert.match(src, /plan_season_explainer_opened/);
  assert.match(src, /UNDO_MS = 60_000/, "Undo stays for a minute");
  assert.match(src, /MOVE_CARDS\[task\.kind\] \?\? MoveCard/, "a kind with no card of its own falls back to MoveCard");
});

test("SeasonExplainer: the sheet dialog, SEASON_EXPLAINER's paragraph and next line", () => {
  const src = read("components", "planner", "SeasonExplainer.tsx");
  assert.match(src, /SheetDialog/);
  assert.match(src, /SEASON_EXPLAINER\[season\]/);
  assert.match(src, /info\.paragraph/);
  assert.match(src, /info\.next/);
});

test("PlanRow: the row carries an id for ?move= / #row- to scroll to", () => {
  // U2 put a ref and a scroll margin on the same element; the id may sit among other attributes.
  assert.match(read("components", "planner", "PlanRow.tsx"), /<li[^>]*\bid=\{`row-\$\{item\.id\}`\}[^>]*>/);
});

/* ------------------------------------------------------------------ */
/* The people line's "Next:" (app/plan/page.tsx, PlanPeople.tsx)       */
/* ------------------------------------------------------------------ */

test("The people line's Next: reads the loaded plan's top move first, the profile step otherwise", () => {
  const page = read("app", "plan", "page.tsx");
  assert.match(page, /topMove\(groups\)/);
  assert.match(page, /nowMoves\(ctx\.tasks, \{ season: ctx\.season, gradYear: ctx\.gradYear, today: ctx\.today, viewer: ctx\.viewer\.isGuardian \? "guardian" : "student" \}\)/);
  assert.match(page, /planHref\(\{ person, tab: "next", move: move\.id \}\)/);
  // Still there, unchanged: the profile-step fallback used for a child with no loaded plan (the other chips).
  assert.match(page, /planHref\(\{ person, setup: true, step: where \}\)/);

  const people = read("components", "planner", "PlanPeople.tsx");
  assert.match(people, /shown\?\.next\?\.label \?\? progress\?\.nextLabel \?\? null/);
  assert.match(people, /shown\?\.next\?\.href \?\? shown\?\.nextHref \?\? null/);
  assert.match(people, /"Profile complete"/, "the ring and its fallback text still work without a move");
});
