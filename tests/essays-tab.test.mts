/**
 * The Essays tab (specs/product/essays/tab.md "The screen"), rendered for real through React's server renderer on a
 * fixture plan: the header line from `essayProgress`, the personal essay's card first with a Common App college and
 * absent without one, one card per college in the plan's deadline order with its anchor, the three lines for a
 * college whose prompts we can't list (not on file, none, refers to the form), Start on an empty prompt row, the
 * Package link once something is started, and a guardian's read-only screen. Also the tab's pure words
 * (lib/essays/tab-view.ts). Fixtures carry prompt kinds and counts only, never essay text. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { ReactElement } from "react";
import type { PlanContext } from "../lib/planner/types.ts";
import type { EssayLinkRow, EssayRow } from "../lib/essays/rows.ts";
import type { EssaysTabData } from "../lib/essays/tab-view.ts";
import { alsoUsedFor, collegeHeading, collegeNote, collegeStatus, collegesByEssay, firstWords, promptTitle, stateLine } from "../lib/essays/tab-view.ts";
import { MAIN_REF } from "../lib/essays/prompts.ts";

const ROOT = join(import.meta.dirname, "..");

/* ------------------------------------------------------------------ */
/* Loading the components                                              */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format: string; source: string | Buffer; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
type NextLoad = (url: string, context: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(s: string, c: { parentURL?: string }, n: NextResolve): ResolveResult; load(u: string, c: unknown, n: NextLoad): LoadResult }): void;
};
const STUB_DIR = join(ROOT, "__essays_tab_stubs__");
const STUBS: Record<string, string> = {
  "next/link": `import React from "react";
export default function Link({ href, children, ...rest }) { return React.createElement("a", { href, ...rest }, children); }`,
  "next/navigation": `export function useRouter() { return { push() {}, refresh() {} }; }`,
  "@/lib/essays/store": `export async function createEssay() { return { ok: false, message: "stub" }; }`,
  "@/lib/analytics": `export function track() {}`,
  // The picker is its own client component (tests/essays-workspace.test.mts covers its groups); here, what it was given.
  "@/components/essays/PromptPicker": `import React from "react";
export function PromptPicker({ label = "Write a new one", college = null }) { return React.createElement("span", { "data-picker": college ? college.unit_id : "new", "data-own": college?.ownRef ?? undefined }, label); }`,
};
const stubUrl = (name: string) => pathToFileURL(join(STUB_DIR, `${name.replace(/[^a-z]/gi, "_")}.mjs`)).href;
const STUB_SOURCES = new Map(Object.entries(STUBS).map(([name, src]) => [stubUrl(name), src]));
const asFile = (b: string) => [b, `${b}.ts`, `${b}.tsx`].find((c) => existsSync(c)) ?? null;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: stubUrl(specifier), shortCircuit: true };
    let b: string | null = null;
    if (specifier.startsWith("@/")) b = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) b = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    if (b?.endsWith(".json")) return { url: pathToFileURL(b).href, shortCircuit: true };
    const file = b ? (/\.tsx?$/.test(b) && existsSync(b) ? b : asFile(b)) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    if (context.parentURL && STUB_SOURCES.has(context.parentURL)) return next(specifier, { ...context, parentURL: pathToFileURL(join(ROOT, "package.json")).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    const stub = STUB_SOURCES.get(url);
    if (stub) return { format: "module", source: stub, shortCircuit: true };
    if (url.startsWith("file:") && url.endsWith(".json")) return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
    if (url.startsWith("file:") && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
      const file = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { PromptRow } = await import("../components/essays/CollegeEssayCard.tsx");
const { EssaysTab } = (await import("../components/planner/EssaysTab.tsx")) as {
  EssaysTab: (p: { ctx: PlanContext; essays: EssaysTabData | null; person: string | null; canWrite: boolean }) => ReactElement;
};

/* ------------------------------------------------------------------ */
/* The fixture plan                                                    */
/* ------------------------------------------------------------------ */

const DUKE = "100001";
const GT = "100002";
const YALE = "100003";
const ELON = "100004";
const RICE = "100005";
const CYCLE = "2026-27";

type Deadlines = { ed?: string | null; ea?: string | null; regular?: string | "rolling" | null };
const prompt = (unit: string, n: number, kind: string, max: number, required = true) => ({
  id: `${unit}:${CYCLE}:${n}`,
  text: `Prompt number ${n} of the fixture college asks this.`,
  kind,
  limit: { kind: "words", max },
  required,
  applies_to: "all",
  quote: "",
});
function school(unit: string, name: string, deadlines: Deadlines, essays: unknown, commonApp = true) {
  return {
    unit_id: unit,
    name,
    cycleStartYear: 2026,
    profile: null,
    logistics: null,
    cites: {},
    apply: commonApp ? { common_app: { member: true, member_id: null, slug: unit, cycle: CYCLE, updated: null }, deadlines: { ed: null, ed2: null, ea: null, ea2: null, rea: null, regular: null, ...deadlines }, fee: null, fee_waiver: null } : null,
    coalition: null,
    essays,
  };
}
const published = (prompts: unknown[], choose?: { n: number; of: number }) => ({ cycle: CYCLE, status: "published", source_url: "https://example.edu/essays", retrieved: "2026-08-01", prompts, ...(choose ? { choose: { ...choose, quote: "" } } : {}) });

const SCHOOLS = {
  [DUKE]: school(DUKE, "Duke", { ed: "2026-11-01", regular: "2027-01-02" }, published([prompt(DUKE, 1, "why_us", 250), prompt(DUKE, 2, "essay", 250, false), prompt(DUKE, 3, "essay", 250, false), prompt(DUKE, 4, "short_answer", 150)], { n: 1, of: 2 })),
  [GT]: school(GT, "Georgia Tech", { ea: "2026-10-15", regular: "2027-01-04" }, published([prompt(GT, 1, "short_answer", 300), prompt(GT, 2, "short_answer", 300), prompt(GT, 3, "optional", 200, false)])),
  [YALE]: school(YALE, "Yale", { regular: "2027-01-02" }, undefined),
  [ELON]: school(ELON, "Elon", { regular: "rolling" }, { cycle: CYCLE, status: "none", source_url: "https://example.edu", retrieved: "2026-08-01", prompts: [] }),
  [RICE]: school(RICE, "Rice", { regular: "2027-01-04" }, { cycle: CYCLE, status: "refers_to_form", source_url: "https://example.edu", retrieved: "2026-08-01", prompts: [] }),
};

const item = (id: string, unit: string, round: string | null) => ({
  id,
  list_id: "L",
  unit_id: unit,
  round,
  status: "applying",
  outcome: null,
  withdrawn_on: null,
  enrolling: false,
  application_platform: null,
  deadline_date: null,
  decision_date: null,
});
const ITEMS = [item("i1", YALE, "rd"), item("i2", DUKE, "ed"), item("i3", ELON, "rolling"), item("i4", GT, "ea"), item("i5", RICE, "rd")];

const essay = (id: string, ref: string, status: "draft" | "ready", count: number, kind = "other"): EssayRow => ({
  id,
  student_id: "s1",
  prompt_ref: ref,
  title: "Draft",
  count_kind: "words",
  count,
  limit_max: 650,
  limit_min: null,
  status,
  kind: kind as EssayRow["kind"],
  base_id: null,
  created: "2026-09-01T00:00:00Z",
  updated: "2026-09-01T00:00:00Z",
});
const ROWS: EssayRow[] = [
  essay("e-main", MAIN_REF, "ready", 648, "personal"),
  essay("e-duke-why", `college:${DUKE}:${CYCLE}:1`, "ready", 240, "why_us"),
  essay("e-duke-2", `college:${DUKE}:${CYCLE}:2`, "draft", 180, "essay"),
  essay("e-loose", "free", "draft", 90, "free"),
];
const LINKS: EssayLinkRow[] = [{ essay_id: "e-duke-why", prompt_ref: `college:${GT}:${CYCLE}:1`, created: "" }];

function ctxWith(over: { items?: unknown[]; schools?: Record<string, unknown>; season?: string; grade?: string; guardian?: boolean } = {}): PlanContext {
  return {
    grade: over.grade ?? "senior_fall",
    cycle: { startYear: 2026 },
    items: over.items ?? ITEMS,
    schools: over.schools ?? SCHOOLS,
    season: over.season ?? "senior_fall",
    student: { id: "s1", display_name: "Maya Lopez", grad_year: 2027, user_id: "u1" },
    viewer: { userId: over.guardian ? "g1" : "u1", firstName: null, canEdit: true, relation: over.guardian ? "guardian" : "self", isGuardian: !!over.guardian },
    today: "2026-10-20",
    tasks: [],
  } as unknown as PlanContext;
}
const DATA: EssaysTabData = { kind: "ready", rows: ROWS, links: LINKS, openComments: { "e-duke-2": 2 }, picker: [], collegeNames: {} };
const render = (ctx: PlanContext, opts: { canWrite?: boolean; essays?: EssaysTabData | null; person?: string | null } = {}) =>
  renderToStaticMarkup(React.createElement(EssaysTab, { ctx, essays: opts.essays === undefined ? DATA : opts.essays, person: opts.person ?? null, canWrite: opts.canWrite ?? true }));

/** The college cards' unit ids in document order. */
const cardOrder = (html: string) => [...html.matchAll(/data-college="(\d+)"/g)].map((m) => m[1]);
/** One college card's markup. */
const card = (html: string, unit: string) => {
  const start = html.indexOf(`id="college-${unit}"`);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
};

/* ------------------------------------------------------------------ */
/* The screen                                                          */
/* ------------------------------------------------------------------ */

test("the header: 'Your essays', the progress line from essayProgress, the student's lead line, and Write a new one", () => {
  const html = render(ctxWith());
  assert.match(html, /<h2 id="essays-title"[^>]*>Your essays<\/h2>/);
  // Main ready (1) + Duke why_us ready (1 of 3) + GT short answer 1 ready through the link (1 of 2): 3 of 6.
  assert.match(html, /data-progress-line="true">3 of 6 ready · next: Georgia Tech, Oct 15<\/p>/);
  assert.match(html, /Write the personal essay once; each college&#x27;s own prompts below, earliest deadline first\./);
  assert.match(html, /data-picker="new">Write a new one</);
});

test("the personal essay's card comes first with a Common App college: its state, count against 650, and how many colleges use it", () => {
  const html = render(ctxWith());
  const main = html.indexOf("data-main-essay");
  assert.ok(main > 0 && main < html.indexOf("data-college="), "before the first college card");
  assert.match(html, /Personal essay · Common App/);
  assert.match(html, /Ready · 648 of 650 words · used by 5 colleges/);
  assert.match(html, /href="\/advisor\/essays\/e-main"/);
});

test("without a Common App college there's no personal essay card (and none on an empty list before the writing seasons)", () => {
  const noCa = Object.fromEntries(Object.entries(SCHOOLS).map(([k, s]) => [k, { ...s, apply: null }]));
  assert.doesNotMatch(render(ctxWith({ schools: noCa })), /data-main-essay/);
  assert.doesNotMatch(render(ctxWith({ items: [], season: "junior_spring" })), /data-main-essay/);
});

test("an empty list: the line and the link to the Colleges tab, and the personal essay's card for a rising senior", () => {
  const html = render(ctxWith({ items: [], season: "summer_before_senior" }));
  assert.match(html, /Add colleges first; their prompts show up here\./);
  assert.match(html, /href="\/advisor\?tab=colleges"/);
  assert.match(html, /data-main-essay/);
  assert.match(html, /Your colleges&#x27; prompts arrive by August; the personal essay is the summer&#x27;s work\./);
});

test("one card per college in the plan's deadline order, undated last, each anchored #college-<unit id>", () => {
  const html = render(ctxWith());
  // GT EA Oct 15, Duke ED Nov 1, Yale RD Jan 2, Rice RD Jan 4, Elon rolling (undated): never the list's own order.
  assert.deepEqual(cardOrder(html), [GT, DUKE, YALE, RICE, ELON]);
  for (const u of [GT, DUKE, YALE, RICE, ELON]) assert.match(html, new RegExp(`<section id="college-${u}"`));
  assert.match(card(html, DUKE), /Duke · ED · by Nov 1/);
  assert.match(card(html, ELON), /Elon · rolling/);
});

test("before senior year a card names the college alone: no round is picked yet (as the Colleges tab's rows)", () => {
  const html = render(ctxWith({ grade: "junior_spring", season: "junior_spring" }));
  assert.match(card(html, DUKE), /<h3[^>]*>Duke<\/h3>/);
  assert.doesNotMatch(html, /· by /);
});

test("guard: an alphabetical order would fail the deadline-order check", () => {
  const alpha = [DUKE, ELON, GT, RICE, YALE];
  assert.notDeepEqual(alpha, cardOrder(render(ctxWith())));
});

test("inside a card: required first, the choose set under its heading, then optional; states, counts, Start, also used for, comments, Package", () => {
  const html = render(ctxWith());
  const duke = card(html, DUKE);
  assert.match(duke, /data-college-status="true">1 of 3 ready</);
  const order = [...duke.matchAll(/data-prompt-row="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["ready", "not_started", "draft", "not_started"], "why us, the short answer, then the choose set");
  assert.ok(duke.indexOf("Choose 1 of 2") > duke.indexOf("Short answer"), "the choose heading after the required rows");
  assert.match(duke, /Why us \(250 words\)/);
  assert.match(duke, /Short answer \(150 words\) · “Prompt number 4 of the…”/, "a vague kind adds the prompt's first words");
  assert.match(duke, /Draft · 180 of 250 words/);
  assert.match(duke, />Start</);
  assert.match(duke, /also used for Georgia Tech/);
  assert.match(duke, /2 comments/);
  assert.match(duke, /href="\/advisor\/essays\/package\/100001"[^>]*>Package</);
  const gt = card(html, GT);
  assert.match(gt, /Optional/);
  assert.match(gt, /also used for Duke/);
});

test("a row's title unfolds the whole prompt (owner, 2026-10-30); the status is the link to the draft; a row with no text on file has no fold", () => {
  const html = render(ctxWith());
  const duke = card(html, DUKE);
  // The short title stays in the summary; the college's full prompt sits in the fold beneath it.
  assert.match(duke, /<details[^>]*data-prompt-fold[^>]*>\s*<summary[^>]*>[\s\S]*?Short answer \(150 words\) · “Prompt number 4 of the…”[\s\S]*?<\/summary>\s*<p[^>]*data-prompt-text[^>]*>Prompt number 4 of the/);
  // The status, not the title, opens the draft.
  assert.match(duke, /<a[^>]*href="\/advisor\/essays\/[^"]+"[^>]*data-open-draft[^>]*>Draft · 180 of 250 words/);
  assert.doesNotMatch(duke, /<a[^>]*>\s*<details/, "the fold is never inside a link");
  // The summary is a 44 px target.
  assert.match(duke, /<summary class="[^"]*min-h-11/);
  // Guard: a row whose prompt text isn't on file keeps a plain title (no fold to open on nothing).
  const bare = renderToStaticMarkup(
    React.createElement(PromptRow, { p: { ref: "college:100001:2026-27:own-1", title: "Your own essay", kind: "free", limit: null, state: "draft", essayId: "e-own", count: 12 }, text: null, also: null, comments: 0, person: null, canWrite: true }),
  );
  assert.doesNotMatch(bare, /data-prompt-fold/);
  assert.match(bare, /data-open-draft/);
});

test("the three lines: not on file (with Add what {College} asks), none, and refers to the form", () => {
  const html = render(ctxWith());
  const yale = card(html, YALE);
  assert.match(yale, /prompts not on file/);
  assert.match(yale, /We haven&#x27;t read Yale&#x27;s essay page yet\. Yale&#x27;s own site has it\./);
  // Add starts a draft on the college's next own ref, so it counts on this card (lib/essays/progress.ts nextOwnRef).
  assert.match(yale, /data-picker="100003" data-own="college:100003:2026-27:own-1">Add what Yale asks</);
  assert.doesNotMatch(yale, />Package</, "nothing started, no Package link");
  assert.match(card(html, ELON), /no essays beyond the Common App&#x27;s/);
  assert.doesNotMatch(card(html, ELON), /data-picker/);
  assert.match(card(html, RICE), /Rice asks its questions inside the application; add them here as you meet them\./);
});

test("the folds: drafts not tied to a college", () => {
  const html = render(ctxWith());
  assert.match(html, /data-fold="loose"[^]*Not for a college yet \(1\)/);
  assert.doesNotMatch(html, /data-fold="coalition"/, "no listed college takes the Coalition");
});

test("a guardian: the same screen read-only, the lead line, no Start, no picker, open-comment counts kept", () => {
  const html = render(ctxWith({ guardian: true }), { canWrite: false, person: "s1" });
  assert.match(html, /Only Maya edits a draft; you can read and comment\./);
  assert.doesNotMatch(html, />Start</);
  assert.doesNotMatch(html, /data-picker/);
  assert.doesNotMatch(html, /Write the personal essay once/);
  assert.match(html, /Not started/);
  assert.match(html, /2 comments/);
  assert.match(html, /href="\/advisor\/essays\/e-duke-2\?for=s1"/, "a guardian's links keep the child");
  assert.deepEqual(cardOrder(html), [GT, DUKE, YALE, RICE, ELON]);
});

test("guard: a student's render would fail the guardian's checks", () => {
  const html = render(ctxWith());
  assert.match(html, />Start</);
  assert.doesNotMatch(html, /Only Maya edits a draft/);
});

test("without the tab's own read the drafts come from the plan (ctx.essays, read by loadPlanFor)", () => {
  const ctx = { ...ctxWith(), essays: { rows: ROWS, links: LINKS } } as PlanContext;
  const html = render(ctx, { essays: null });
  assert.match(html, /data-progress-line="true">3 of 6 ready · next: Georgia Tech, Oct 15<\/p>/);
  assert.deepEqual(cardOrder(html), [GT, DUKE, YALE, RICE, ELON]);
});

test("the workspace isn't set up: one line, no cards", () => {
  const html = render(ctxWith(), { essays: { ...DATA, kind: "setup-missing" } });
  assert.match(html, /The essay workspace isn&#x27;t set up in the database yet\./);
  assert.equal(cardOrder(html).length, 0);
});

test("no essay text on the tab: a draft's body never reaches it (the read carries none), titles and counts only", () => {
  const src = readFileSync(join(ROOT, "components/planner/EssaysTab.tsx"), "utf8") + readFileSync(join(ROOT, "components/essays/CollegeEssayCard.tsx"), "utf8");
  assert.doesNotMatch(src, /\.body\b/);
  assert.doesNotMatch(readFileSync(join(ROOT, "lib/essays/load.ts"), "utf8").match(/ESSAY_LIST_COLUMNS = "[^"]*"/)?.[0] ?? "body", /\bbody\b/);
});

/* ------------------------------------------------------------------ */
/* The words                                                           */
/* ------------------------------------------------------------------ */

test("tab-view: headings, statuses, notes, titles, states, and also used for", () => {
  assert.equal(collegeHeading({ name: "Duke", round: "ed", deadline: "2026-11-01" }), "Duke · ED · by Nov 1");
  assert.equal(collegeHeading({ name: "Elon", round: "rolling", deadline: null }), "Elon · rolling");
  assert.equal(collegeHeading({ name: "Yale", round: null, deadline: null }), "Yale");
  assert.equal(collegeStatus({ onFile: "published", ready: 2, total: 3, own: [] }), "2 of 3 ready");
  assert.equal(collegeStatus({ onFile: "not_on_file", ready: 0, total: 0, own: [] }), "prompts not on file");
  assert.equal(collegeStatus({ onFile: "none", ready: 0, total: 0, own: [] }), "no essays beyond the Common App's");
  assert.equal(collegeNote({ onFile: "published", name: "Duke" }), null);
  assert.equal(firstWords("Tell us about a time you were wrong."), "Tell us about a time…");
  assert.equal(firstWords("Why us?"), "Why us?");
  assert.equal(promptTitle({ kind: "why_us", limit: { kind: "words", max: 250 } }, "anything"), "Why us (250 words)");
  assert.equal(promptTitle({ kind: "short_answer", limit: { kind: "characters", max: 300 } }, null), "Short answer (300 characters)");
  assert.equal(stateLine({ state: "not_started", count: null, limit: null }), null);
  assert.equal(stateLine({ state: "ready", count: 249, limit: { kind: "words", max: 250 } }), "Ready");
  assert.equal(stateLine({ state: "draft", count: 180, limit: { kind: "words", max: 250 } }), "Draft · 180 of 250 words");
  const by = collegesByEssay(ROWS, LINKS, { [DUKE]: "Duke", [GT]: "Georgia Tech" });
  assert.equal(alsoUsedFor(by, "e-duke-why", DUKE), "also used for Georgia Tech");
  assert.equal(alsoUsedFor(by, "e-duke-2", DUKE), null);
  assert.equal(alsoUsedFor(by, null, DUKE), null);
});

test("the wiring: the page reads the tab's data only on the Essays tab, PlanTabs renders EssaysTab with the student-only write rule", () => {
  const page = readFileSync(join(ROOT, "app/advisor/page.tsx"), "utf8");
  assert.match(page, /if \(tab !== "essays" \|\| load\.kind !== "ready"\) return null;/);
  assert.match(page, /essays=\{essays\}/);
  const tabs = readFileSync(join(ROOT, "components/planner/PlanTabs.tsx"), "utf8");
  assert.match(tabs, /tab === "essays" && <EssaysTab ctx=\{ctx\} essays=\{essays\} person=\{person\} canWrite=\{viewer === "student"\} \/>/);
  const frame = readFileSync(join(ROOT, "components/planner/PlanFrame.tsx"), "utf8");
  assert.match(frame, /<Link href=\{planHref\(\{ person: personId, tab: "essays" \}\)\}[^>]*>\s*Your list asks for \{essayCount\}\./);
  assert.match(readFileSync(join(ROOT, "components/planner/PlanList.tsx"), "utf8"), /<Link href=\{planHref\(\{ person, tab: "essays" \}\)\}[^>]*>\s*Your list asks for \{essayCount\}\./);
  assert.match(readFileSync(join(ROOT, "components/planner/guides/StoryGuide.tsx"), "utf8"), /href=\{personalEssayHref\(ctx, person\)\}/);
});
