/**
 * The Next steps tab's UI (specs/planner/v3/now.md "The tab"; plan v3 build-plan.md "U1 Foundation" step 7; first
 * built by next steps' U1b): `MoveCard`'s rendering (why, date/overdue, assignee chip, the citation, the one button:
 * the move's guide when it has one, else the built action; Done and Skip for now in the corner menu, only with edit
 * access, and no Skip for a guardian) rendered for real with `react-dom/server`, no bundler (the same technique as
 * tests/chances-estimate-ui.test.mts); and, for `NextSteps.tsx`, `ParentNextSteps.tsx`, `SeasonExplainer.tsx`, `PlanRow.tsx`,
 * `PlanPeople.tsx`, and `app/plan/page.tsx` (whose client-only hooks and dialog primitive aren't worth stubbing here),
 * structural checks on the source: three cards and the Done and skipped fold for the student, the empty state, the
 * guardian's tab kept as built, `?move=` scrolling, and the people line's "Next:" reading the loaded plan's top move
 * before the profile step. `npm test`.
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
import { doneLabel, skippedLabel } from "../lib/planner/moves.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* Rendering MoveCard without a build step                             */
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
    key: "l1:playbook:summer_program",
    kind: "playbook",
    title: "Apply to a summer program by its deadline",
    detail: "Optional. Many summer programs close their applications in winter.",
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
    dismissed_at: null,
    dismissed_by: null,
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
  assert.match(html, /Apply to a summer program/);
  assert.match(html, /Many summer programs close/);
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

test("MoveCard: one button per action kind for a move with no guide; tick and the other units' kinds add none", () => {
  const ctx = ctxOf();
  const hrefHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "href", href: "https://example.edu" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.match(hrefHtml, /href="https:\/\/example\.edu"/);
  assert.match(hrefHtml, /target="_blank"/);

  const intakeHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "open_intake", step: 3 } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.match(intakeHtml, /href="\/plan\?setup=1&amp;step=3"/);

  const tabHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "open_tab", tab: "colleges" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.match(tabHtml, /href="\/plan\?tab=colleges"/);

  // Plan v3 (build-plan.md U2b): every row task but the ED sheet's has its own guide now, so `open_row` without
  // `panel: "ed"` renders no button here (PlanList's row no longer has a drawer for it to open).
  const rowHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "open_row", itemId: "i9" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.doesNotMatch(rowHtml, /See the college|Open</, "no button for an open_row without panel: \"ed\"");

  // PlanList reads `row`/`panel=ed` on the Colleges tab and opens that row's ED dialog (EdDecideCard's edRowHref()
  // builds the same shape for its own links).
  const rowWithPanelHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "open_row", itemId: "i9", panel: "ed" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.match(rowWithPanelHtml, /href="\/plan\?tab=colleges&amp;row=i9&amp;panel=ed"/);
  assert.match(rowWithPanelHtml, /See the college/);

  const tickHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "tick" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.doesNotMatch(tickHtml, /See the college|Open</);

  // The brag-sheet playbook entry (junior spring) carries action.kind "story": the Numbers page's story section,
  // the same route for self and a guardian (the lead's merge notice, after U7's StorySection landed there).
  const storyHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "story" } }), ctx: ctxOf({ student: { id: "s9", display_name: "Maya", grad_year: 2028, user_id: "u1" } }), onDone: noop, onSkip: noop, pending: false });
  assert.match(storyHtml, /href="\/plan\/guide\/story\?from=card"/);

  const otherUnitHtml = render(moveCardMod.MoveCard as never, { task: taskOf({ action: { kind: "mark_applied", itemId: "i1" } }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.doesNotMatch(otherUnitHtml, /See the college|Open</, "no button for a kind without its own card yet; the title alone stands in");
});

test("MoveCard: a move with a guide has one button, the guide's, linking the guide page with the move open", () => {
  const ctx = ctxOf({ items: [{ id: "i1", unit_id: "198419" } as never] });
  const interest = render(moveCardMod.MoveCard as never, {
    task: taskOf({ id: "t5", kind: "show_interest", key: "l1:show_interest:i1", item_id: "i1", title: "Show Duke you're interested", action: { kind: "open_row", itemId: "i1", panel: "capture" } }),
    ctx,
    onDone: noop,
    onSkip: noop,
    pending: false,
  });
  assert.match(interest, /href="\/plan\/guide\/interest\?move=t5&amp;college=198419&amp;from=move"/);
  assert.match(interest, />Show me how</);
  assert.doesNotMatch(interest, /See the college/, "the built action gives way to the guide");
  const recs = render(moveCardMod.MoveCard as never, { task: taskOf({ id: "t6", key: "l1:playbook:pick_recommenders", action: null }), ctx, onDone: noop, onSkip: noop, pending: false });
  assert.match(recs, /href="\/plan\/guide\/recommenders\?move=t6&amp;from=move"[^>]*>Help me pick</);
  // A guardian's link carries the child.
  const guardian = render(moveCardMod.MoveCard as never, {
    task: taskOf({ id: "t7", key: "l1:playbook:build_list", action: { kind: "open_tab", tab: "colleges" } }),
    ctx: ctxOf({ viewer: { userId: "u2", firstName: "Jo", canEdit: false, relation: "guardian", isGuardian: true }, student: { id: "kid-1", display_name: "Maya", grad_year: 2028, user_id: null } }),
    onDone: noop,
    onSkip: noop,
    pending: false,
  });
  assert.match(guardian, /href="\/plan\/guide\/list\?for=kid-1&amp;move=t7&amp;from=move"[^>]*>Help me build it</, "a read-only guardian still opens the guide");
});

test("MoveCard: Done and Skip for now live in the corner menu, with edit access only; a guardian's menu has no Skip", () => {
  const editable = render(moveCardMod.MoveCard as never, { task: taskOf(), ctx: ctxOf({ viewer: { userId: "u1", firstName: "Jo", canEdit: true, relation: "self", isGuardian: false } }), onDone: noop, onSkip: noop, pending: false });
  assert.match(editable, /<details[^>]*>\s*<summary[^>]*aria-label="More for Apply to a summer program by its deadline"/);
  assert.match(editable, /size-11/, "the ⋯ button is 44px");
  assert.match(editable, /<button[^>]*>Done<\/button>/);
  assert.match(editable, /<button[^>]*>Skip for now<\/button>/);
  assert.doesNotMatch(editable, /Not now/);
  const guardian = render(moveCardMod.MoveCard as never, { task: taskOf(), ctx: ctxOf({ viewer: { userId: "u2", firstName: "Jo", canEdit: true, relation: "guardian", isGuardian: true } }), onDone: noop, onSkip: noop, pending: false });
  assert.match(guardian, /<button[^>]*>Done<\/button>/);
  assert.doesNotMatch(guardian, /Skip for now/, "a parent never skips for the student");
  const readOnly = render(moveCardMod.MoveCard as never, { task: taskOf(), ctx: ctxOf({ viewer: { userId: "u1", firstName: "Jo", canEdit: false, relation: "self", isGuardian: false } }), onDone: noop, onSkip: noop, pending: false });
  assert.doesNotMatch(readOnly, /<button|<details/, "no menu at all without edit access");
  assert.doesNotMatch(readOnly, />Done<|Skip for now/);
});

test("the Done and skipped fold's labels: 'Skipped Oct 12' (or 'Skipped' before the record), 'Done Oct 3'", () => {
  assert.equal(skippedLabel({ dismissed_at: "2026-10-12T15:00:00Z" }, "2026-11-01"), "Skipped Oct 12");
  assert.equal(skippedLabel({ dismissed_at: "2025-10-12T15:00:00Z" }, "2026-11-01"), "Skipped Oct 12, 2025");
  assert.equal(skippedLabel({ dismissed_at: null }, "2026-11-01"), "Skipped");
  assert.equal(doneLabel({ done_at: "2026-10-03T09:00:00Z" }, "2026-11-01"), "Done Oct 3");
  assert.equal(doneLabel({ done_at: null }, "2026-11-01"), null);
});

test("personFor: null for a signed-in student's own plan, the child's id for a guardian", () => {
  assert.equal(moveCardMod.personFor(ctxOf({ viewer: { userId: "u1", firstName: null, canEdit: true, relation: "self", isGuardian: false } })), null);
  assert.equal(moveCardMod.personFor(ctxOf({ viewer: { userId: "u1", firstName: null, canEdit: true, relation: "guardian", isGuardian: true }, student: { id: "kid-1", display_name: "Maya", grad_year: 2028, user_id: null } })), "kid-1");
});

/* ------------------------------------------------------------------ */
/* NextSteps.tsx, SeasonExplainer.tsx: structural checks               */
/* ------------------------------------------------------------------ */

test("NextSteps: three cards, then one Done and skipped fold with Bring back; nothing else; the empty state; a guardian gets the same view plus Your part", () => {
  const src = read("components", "planner", "NextSteps.tsx");
  assert.match(src, /export function NextSteps\(\{ ctx, view \}: PlanTabProps\)/);
  assert.match(src, /"use client"/);
  // Plan v3 fix (2026-10-16, owner: "when a parent looks at a student they should see what they see"): no more
  // guardian branch to GuardianNextSteps; every viewer renders StudentNextSteps, the same nowMoves(viewer: "student").
  assert.doesNotMatch(src, /GuardianNextSteps/, "the guardian branch is gone; ParentNextSteps.tsx is unused now");
  assert.match(src, /return <StudentNextSteps ctx=\{ctx\} view=\{view\} \/>;/);
  // Only the student's body, not the file's doc comment (which names the groups in prose).
  const body = src.slice(src.indexOf("function StudentNextSteps"));
  const iYourPart = body.indexOf(">Your part<");
  const iNow = body.indexOf("groups.now.length === 0");
  const iFold = body.indexOf("Done and skipped ({foldCount})");
  assert.ok(iYourPart > 0 && iYourPart < iNow && iNow < iFold, "Your part (guardian only), then Now, then the fold");
  for (const gone of ["More this season", "Coming up", "groups.more", "groups.comingUp"]) assert.ok(!body.includes(gone), `no ${gone}`);
  assert.match(body, /isGuardian \? yourPartMoves\(ctx\.tasks, ctx\.today\)\.filter\(\(t\) => !nowIds\.has\(t\.id\)\) : \[\]/, "a guardian's own Your part cards, minus the three already shown, hidden for the student");
  assert.match(body, /isGuardian && yourPart\.length > 0/);
  assert.match(body, /Nothing to do right now\. Enjoy it\./);
  assert.match(body, /SEASON_EXPLAINER\[ctx\.season\]\.lead/, "the empty state adds the explainer's lead");
  assert.match(body, /Bring back/);
  assert.match(body, /await undismiss\(task\.id\)/);
  assert.match(body, /track\("plan_move_restored", \{ kind: task\.kind, season: seasonOfTask\(task\), by \}\)/);
  // Every title the fold shows goes through parentSafeTitle for a guardian, task.title verbatim for the student.
  assert.match(body, /const titleFor = \(t: PlanTask\) => \(isGuardian \? parentSafeTitle\(t\) : t\.title\)/);
  assert.match(body, /skippedLabel\(t, ctx\.today\)/);
  assert.match(body, /doneLabel\(t, ctx\.today\)/);
  assert.match(body, /searchParams\.get\("move"\)/);
  assert.match(body, /scrollIntoView/);
  assert.match(body, /plan_move_done/);
  assert.match(body, /plan_move_skipped/);
  assert.match(body, /plan_season_explainer_opened/);
  assert.match(src, /UNDO_MS = 60_000/, "Undo stays for a minute");
  assert.match(body, /MOVE_CARDS\[task\.kind\] \?\? MoveCard/, "a kind with no card of its own falls back to MoveCard");
});

test("a guardian's card title never carries a digit for a reach_score_* move (parentSafeTitle, plan-v3-fix-cards)", () => {
  const reachScore = taskOf({
    id: "t9",
    key: "l1:playbook:reach_score_junior_fall",
    title: "Work toward your 1400",
    detail: "Your target is your own. The dates below are the ones whose scores would arrive in time.",
    action: null,
  });
  const guardianCtx = ctxOf({ viewer: { userId: "u2", firstName: "Jo", canEdit: true, relation: "guardian", isGuardian: true } });
  const html = render(moveCardMod.MoveCard as never, { task: reachScore, ctx: guardianCtx, onDone: noop, onSkip: noop, pending: false });
  assert.match(html, /Work toward the target score/);
  assert.doesNotMatch(html, /1400/, "a parent never sees the student's own target number");
  // The student's own card still shows it.
  const studentHtml = render(moveCardMod.MoveCard as never, { task: reachScore, ctx: ctxOf(), onDone: noop, onSkip: noop, pending: false });
  assert.match(studentHtml, /Work toward your 1400/);
});

test("ParentNextSteps (plan v3 U9): Your part, {First}'s season, Coming up folded open, Done and skipped folded", () => {
  const src = read("components", "planner", "ParentNextSteps.tsx");
  assert.match(src, /export function GuardianNextSteps\(\{ ctx, view \}: PlanTabProps\)/);
  const body = src.slice(src.indexOf("export function GuardianNextSteps"));
  const iYourPart = body.indexOf('>Your part<');
  const iSeason = body.indexOf("Nothing open this season");
  const iComingUp = body.indexOf("Coming up ·");
  const iDone = body.indexOf("Done and skipped this season");
  assert.ok(iYourPart > 0 && iYourPart < iSeason && iSeason < iComingUp && iComingUp < iDone);
  assert.match(src, /yourPart\.length > 0/);
  // No "More this season": the parent sees the season's open rows at once (Now and Next), not a second fold.
  assert.doesNotMatch(body, /More this season/);
  // A reach_score move never shows the student's own target to a parent.
  assert.match(src, /parentSafeTitle/);
  // Coming up is the one look-ahead a parent gets (folded open, `<details open>`); Done and skipped folds closed.
  const comingUpTag = body.slice(body.indexOf('<details className="group rounded-3xl bg-card p-4 ring-1 ring-border" open>'));
  assert.match(comingUpTag.slice(0, 80), /open>/);
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
  // R1b (ranking.md): the facts object (importanceFactsFrom) feeds nowMoves' importance sort.
  assert.match(page, /importanceFactsFrom\(ctx, view\)/);
  assert.match(
    page,
    /nowMoves\(ctx\.tasks, \{ season: ctx\.season, gradYear: ctx\.gradYear, today: ctx\.today, viewer: ctx\.viewer\.isGuardian \? "guardian" : "student", facts \}\)/,
  );
  assert.match(page, /planHref\(\{ person, tab: "next", move: move\.id \}\)/);
  // Still there, unchanged: the profile-step fallback used for a child with no loaded plan (the other chips).
  assert.match(page, /planHref\(\{ person, setup: true, step: where \}\)/);

  const people = read("components", "planner", "PlanPeople.tsx");
  assert.match(people, /shown\?\.next\?\.label \?\? progress\?\.nextLabel \?\? null/);
  assert.match(people, /shown\?\.next\?\.href \?\? shown\?\.nextHref \?\? null/);
  assert.match(people, /"Profile complete"/, "the ring and its fallback text still work without a move");
});
