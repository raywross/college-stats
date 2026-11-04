/**
 * Suggest changes and Review changes, the U3 tests (named apart from tests/essays-review-ui.test.mts, the notes panel's) (specs/product/essays/editors.md "1. Suggestions", "The reader's fixes";
 * essay-editors-build/brief.md "U3"): the pure view helpers in lib/essays/review-view.ts (which tabs show, the banner
 * and confirmation words, the chip order, the reader's fixes as changes, the marks the open changes draw), the
 * Review changes rendering from fixture rows (each toggle's text, a stale change's card, Accept and Reject only for
 * the student), SuggestBox never on the student's page, and the draft page itself rendered with its loaders stubbed:
 * a guardian gets Suggest changes and no writable field; the student gets Write and Review changes while a
 * suggestion is open. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { ReactElement } from "react";
import { assignColors, type MarkColor } from "../lib/essays/marks.ts";
import { changesBetween, locateChange, type ChangeView, type Decision } from "../lib/essays/suggestions.ts";
import {
  applyPlaced,
  bannerLine,
  changeMarks,
  confirmLine,
  editorLabel,
  fixChanges,
  openSuggestions,
  readerFixes,
  reviewCount,
  reviewEditors,
  segmentBlocks,
  showsReviewTabs,
  staleOf,
  suggestionAuthorKey,
  waitingLine,
  type ReaderFix,
  type ReviewEditor,
  type SuggestionView,
} from "../lib/essays/review-view.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const BASE = "I walked to the store on a cold morning.\n\nMy sister came with me and we talked.";
const PROPOSED = "I ran to the store on a cold morning.\n\nMy sister came with me and we laughed.";
const ESSAY_ID = "11111111-1111-4111-8111-111111111111";

const suggestion = (over: Partial<SuggestionView> = {}): SuggestionView => ({
  id: "22222222-2222-4222-8222-222222222222",
  essay_id: ESSAY_ID,
  base_version_id: null,
  base_body: BASE,
  author_id: "mom",
  author_role: "guardian",
  proposed_body: PROPOSED,
  note: "Two small ones; your call.",
  status: "open",
  decisions: {},
  created: "2026-11-01T10:00:00Z",
  updated: "2026-11-01T10:00:00Z",
  decided_at: null,
  author_name: "Jane Smith",
  ...over,
});

const fix = (over: Partial<ReaderFix> = {}): ReaderFix => ({ noteId: "33333333-3333-4333-8333-333333333333", span: { paragraph: 1, start: 0, end: 2 }, fix: "Our", observation: "A word", ...over });

/* ------------------------------------------------------------------ */
/* The view helpers                                                    */
/* ------------------------------------------------------------------ */

test("the words: banner, confirmation, waiting, labels", () => {
  assert.equal(bannerLine(suggestion(), 3), "Jane suggested 3 changes");
  assert.equal(bannerLine(suggestion(), 1), "Jane suggested 1 change");
  assert.equal(bannerLine(suggestion({ author_name: null }), 2), "A parent suggested 2 changes");
  assert.equal(bannerLine(suggestion({ author_name: null, author_role: "counselor" }), 2), "A counselor suggested 2 changes");
  assert.equal(confirmLine("accept", "Jane", 3), "Accept all 3 changes from Jane?");
  assert.equal(confirmLine("reject", "Jane", 1), "Reject the 1 change from Jane?");
  assert.equal(waitingLine("Alice Smith"), "Waiting for Alice");
  assert.equal(waitingLine(null), "Waiting for the student");
  assert.equal(editorLabel(suggestion()), "Jane");
  assert.equal(editorLabel(suggestion({ author_name: " " })), "Parent");
  assert.equal(suggestionAuthorKey(suggestion()), "mom");
  assert.equal(suggestionAuthorKey(suggestion({ author_id: null })), "former-guardian");
  // Never Word's words, never "AI".
  for (const w of [bannerLine(suggestion(), 2), confirmLine("accept", "Jane", 2)]) assert.doesNotMatch(w, /track changes|markup|\bAI\b/i);
});

test("open suggestions: open ones only, oldest first, and gone once this page has decided every change", () => {
  const older = suggestion({ id: "a", created: "2026-10-30T00:00:00Z", author_id: "dad", author_name: "Tom" });
  const newer = suggestion({ id: "b", created: "2026-11-01T00:00:00Z" });
  const done = suggestion({ id: "c", status: "decided" });
  const open = openSuggestions([newer, done, older]);
  assert.deepEqual(
    open.map((x) => x.suggestion.id),
    ["a", "b"],
  );
  assert.equal(open[0].changes.length, 2);
  const keys = open[1].changes.map((c) => c.key);
  const local: Record<string, Record<string, Decision>> = { b: { [keys[0]]: "accepted" } };
  assert.equal(openSuggestions([newer], local).length, 1, "one change left: still open");
  local.b[keys[1]] = "rejected";
  assert.equal(openSuggestions([newer], local).length, 0, "every change decided here: closed");
  // Stored decisions count too.
  assert.equal(openSuggestions([suggestion({ decisions: { [keys[0]]: "accepted", [keys[1]]: "rejected" } })]).length, 0);
});

test("which tabs show and the badge: an open suggestion or a reader's fix", () => {
  const open = openSuggestions([suggestion()]);
  assert.equal(showsReviewTabs([], []), false);
  assert.equal(showsReviewTabs(open, []), true);
  assert.equal(showsReviewTabs([], [fix()]), true);
  assert.equal(reviewCount(open, [fix()]), 3);
  const one = openSuggestions([suggestion({ decisions: { [open[0].changes[0].key]: "rejected" } })]);
  assert.equal(reviewCount(one, []), 1, "decided changes leave the badge");
});

test("the chips: each open suggestion's author oldest first, then the reader's fixes", () => {
  const a = suggestion({ id: "a", created: "2026-10-30T00:00:00Z", author_id: "dad", author_name: "Tom" });
  const b = suggestion({ id: "b" });
  const text = "I walked to the store on a cold morning.\n\nMy sister came with me and we talked.";
  const eds = reviewEditors(text, openSuggestions([b, a]), [fix()], locateChange);
  assert.deepEqual(
    eds.map((e) => [e.id, e.label, e.authorKey, e.kind]),
    [
      ["a", "Tom", "dad", "suggestion"],
      ["b", "Jane", "mom", "suggestion"],
      ["reader", "Reader's notes", "reader", "reader"],
    ],
  );
  assert.equal(reviewEditors(text, openSuggestions([b]), [], locateChange).length, 1, "no reader chip without fixes");
});

test("the changes found in the current text; a rewritten spot is stale", () => {
  const student = "I walked to the store on a cold morning.\n\nMy brother came along and we walked home.";
  const [ed] = reviewEditors(student, openSuggestions([suggestion()]), [], locateChange);
  assert.equal(ed.changes.length, 2);
  assert.ok(ed.changes[0].located, "the first change still fits");
  assert.equal(staleOf(ed.changes).length, 1, "the student rewrote the second spot");
  assert.equal(staleOf(ed.changes)[0].inserted.trim(), "laughed.");
});

test("the reader's fixes: open mechanics notes with a fix, as changes at their span", () => {
  const notes = [
    { id: "n1", category: "mechanics", span: { paragraph: 0, start: 2, end: 8 }, fix: "strolled", state: "open", observation: "x" },
    { id: "n2", category: "mechanics", span: { paragraph: 0, start: 0, end: 1 }, fix: null, state: "open", observation: "no fix" },
    { id: "n3", category: "voice", span: { paragraph: 0, start: 0, end: 1 }, fix: "Me", state: "open", observation: "not mechanics" },
    { id: "n4", category: "mechanics", span: { paragraph: 0, start: 0, end: 1 }, fix: "We", state: "done", observation: "done" },
    { id: "streamed-0", category: "mechanics", span: { paragraph: 0, start: 0, end: 1 }, fix: "We", state: "open", observation: "no id yet" },
  ];
  const fixes = readerFixes(notes);
  assert.deepEqual(
    fixes.map((f) => f.noteId),
    ["n1"],
  );
  const changes = fixChanges(BASE, fixes);
  assert.equal(changes[0].removed, "walked");
  assert.equal(changes[0].inserted, "strolled");
  assert.deepEqual(changes[0].located, { start: 2, end: 8 });
  assert.equal(applyPlaced(BASE, changes), BASE.replace("walked", "strolled"));
  // A span the draft no longer has: no place, so stale.
  assert.equal(fixChanges("Short.", fixes)[0].located, null);
});

test("the change marks: each undecided change under its author, pointing at its card", () => {
  const [x] = openSuggestions([suggestion()]);
  const marks = changeMarks(x, "Jane");
  assert.equal(marks.length, 2);
  assert.deepEqual(
    { ...marks[0], change: undefined },
    { id: `change-${x.changes[0].key}`, kind: "change", authorKey: "mom", label: "Jane", firstLine: "Suggests: ran", targetId: `change-${x.changes[0].key}`, change: undefined },
  );
  const [y] = openSuggestions([suggestion({ decisions: { [x.changes[0].key]: "accepted" } })]);
  assert.equal(changeMarks(y, "Jane").length, 1, "a decided change draws nothing");
});

test("the rendering in paragraphs: a line break in unchanged text starts one, an empty line is an empty block", () => {
  const blocks = segmentBlocks([
    { kind: "text", text: "One two\n\nThree " },
    { kind: "del", text: "four", key: "k" },
    { kind: "ins", text: "five", key: "k" },
  ]);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[1], []);
  assert.deepEqual(
    blocks[2].map((s) => s.kind),
    ["text", "del", "ins"],
  );
});

/* ------------------------------------------------------------------ */
/* Loading the components and the page                                */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format: string; source: string | Buffer; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
type NextLoad = (url: string, context: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(s: string, c: { parentURL?: string }, n: NextResolve): ResolveResult; load(u: string, c: unknown, n: NextLoad): LoadResult }): void;
};

/** What the page's loaders return, set by each page test. */
const fixture = globalThis as unknown as { __essayPage: { viewer: unknown; read: unknown } };

const STUB_DIR = join(ROOT, "__essays_review_stubs__");
const nothing = (names: string[]) => names.map((n) => `export function ${n}() { return null; }`).join("\n");
const STUBS: Record<string, string> = {
  "next/navigation": `export function useRouter() { return { push() {}, refresh() {} }; } export function notFound() { throw new Error("not found"); }`,
  "next/server": `export async function connection() {}`,
  "next/link": `import React from "react"; export default function Link({ href, children, ...rest }) { return React.createElement("a", { href, ...rest }, children); }`,
  "@/lib/essays/store": [
    "addComment",
    "deleteComment",
    "resolveComment",
    "saveEssay",
    "restoreVersion",
    "setEssayStatus",
    "renameEssay",
    "deleteEssay",
    "openVersion",
    "suggestChanges",
    "updateSuggestion",
    "withdrawSuggestion",
    "decideSuggestion",
    "acceptFix",
  ]
    .map((n) => `export async function ${n}() { return { ok: false, message: "stub" }; }`)
    .join("\n"),
  "@/lib/analytics": `export function track() {}`,
  "@/lib/auth": `export function authConfigured() { return true; }`,
  "@/lib/timing-server": `export function withTiming(_route, fn) { return fn(); }`,
  "@/lib/essays/load": `export async function essaysViewer() { return globalThis.__essayPage.viewer; }
export async function readEssay() { return globalThis.__essayPage.read; }
export async function planColleges() { return []; }
export async function promptLookup() { return { school: () => null, schoolRecord: () => null, platform: null }; }`,
  "@/components/ui/info-tip": nothing(["InfoTip"]),
  "@/components/ui/why-fold": nothing(["WhyFold"]),
  "@/components/account/AuthUnavailable": nothing(["AuthUnavailable"]),
  "@/components/account/SignInPrompt": nothing(["SignInPrompt"]),
  "@/components/account/ViewerBanner": nothing(["ViewerBanner"]),
  "@/components/essays/ExportMenu": nothing(["ExportMenu"]),
  "@/components/essays/ImportSheet": nothing(["ImportSheet"]),
  "@/components/essays/PromptPicker": nothing(["ReusePicker"]),
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
type ReviewProps = {
  text: string;
  editors: ReviewEditor[];
  colors: Record<string, MarkColor>;
  canDecide: boolean;
  onDecide: () => Promise<{ stale: string[] }>;
  initialView?: "with" | "suggested" | "original";
  initialEditor?: string;
};
const { ReviewChanges } = (await import("../components/essays/ReviewChanges.tsx")) as { ReviewChanges: (p: ReviewProps) => ReactElement };
const { SuggestBox } = (await import("../components/essays/SuggestBox.tsx")) as unknown as { SuggestBox: (p: Record<string, unknown>) => ReactElement };
const Page = (await import("../app/advisor/essays/[id]/page.tsx")) as { default: (p: { params: Promise<{ id: string }>; searchParams: Promise<{ for?: string }> }) => Promise<ReactElement> };

const decode = (html: string) =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, "")).replace(/​/g, "");
const colors = assignColors(["reader", "mom", "dad"]);
const review = (over: Partial<ReviewProps> & { text: string; editors: ReviewEditor[] }) =>
  renderToStaticMarkup(React.createElement(ReviewChanges, { colors, canDecide: true, onDecide: async () => ({ stale: [] }), ...over }));

/** The rendering's own block (the draft at the field's type), after the toggles. */
const renderedText = (html: string) => {
  const at = html.indexOf("whitespace-pre-wrap");
  const from = html.lastIndexOf("<div", at);
  return html.slice(from);
};

/* ------------------------------------------------------------------ */
/* Review changes                                                      */
/* ------------------------------------------------------------------ */

test("Review changes, With changes: struck old words and underlined new ones, each change a card with Accept and Reject", () => {
  const editors = reviewEditors(BASE, openSuggestions([suggestion()]), [], locateChange);
  const html = review({ text: BASE, editors });
  const [first, second] = editors[0].changes;
  assert.match(html, new RegExp(`id="change-${first.key}"`));
  assert.match(html, new RegExp(`id="change-${second.key}"`));
  assert.match(html, /<del class="line-through decoration-2" style="color:var\(--mark-blue\);text-decoration-color:var\(--mark-blue\)">walked<\/del>/);
  assert.match(html, /<ins class="underline decoration-2 underline-offset-4" style="color:var\(--mark-blue\);text-decoration-color:var\(--mark-blue\)">ran<\/ins>/);
  assert.equal((html.match(/>Accept</g) ?? []).length, 2, "one Accept per change (inline on a pointer device)");
  assert.equal((html.match(/>Reject</g) ?? []).length, 2, "one Reject per change");
  assert.match(html, />Reject all</);
  assert.match(html, />Accept all</);
  assert.match(html, />With changes<[\s\S]*>As suggested<[\s\S]*>Original</);
  assert.match(html, /“Two small ones; your call\.”/, "the editor's note");
  assert.match(html, /Jane: 2 changes/);
  // The text with every change marked reads as both versions side by side.
  assert.equal(textOf(renderedText(html).split(`<div class="space-y-2 border-t`)[0]).replace(/AcceptReject/g, ""), "I walkedran to the store on a cold morning.My sister came with me and we talked.laughed.");
});

test("Review changes, As suggested and Original: the text with every open change, and the text as it is", () => {
  const editors = reviewEditors(BASE, openSuggestions([suggestion()]), [], locateChange);
  const suggested = review({ text: BASE, editors, initialView: "suggested" });
  assert.match(suggested, /data-view="suggested">I ran to the store on a cold morning\.\n\nMy sister came with me and we laughed\.<\/div>/);
  assert.doesNotMatch(suggested, /<del|<ins/);
  const original = review({ text: BASE, editors, initialView: "original" });
  assert.match(original, /data-view="original">I walked to the store on a cold morning\.\n\nMy sister came with me and we talked\.<\/div>/);
});

test("Review changes: a change whose spot was rewritten is listed under the text with Copy, and can still be rejected", () => {
  const student = "I walked to the store on a cold morning.\n\nMy brother came along and we walked home.";
  const editors = reviewEditors(student, openSuggestions([suggestion()]), [], locateChange);
  const stale = staleOf(editors[0].changes)[0];
  const html = review({ text: student, editors });
  const card = html.slice(html.indexOf(`<li id="change-${stale.key}"`));
  assert.ok(card.length > 0 && html.includes(`<li id="change-${stale.key}"`), "the stale change's card");
  assert.match(card, /The draft changed here/);
  assert.match(card, /Suggests: laughed\./);
  assert.match(card, />Copy</);
  assert.match(card, />Reject</);
  assert.doesNotMatch(renderedText(html).split("<ul")[0], /laughed/, "a stale change isn't drawn in the text");
});

test("Review changes: Accept and Reject only for the student", () => {
  const editors = reviewEditors(BASE, openSuggestions([suggestion()]), [], locateChange);
  const html = review({ text: BASE, editors, canDecide: false });
  assert.doesNotMatch(html, />Accept</);
  assert.doesNotMatch(html, />Reject</);
  assert.doesNotMatch(html, /role="button"/);
  assert.match(html, /<del /, "the changes still show");
});

test("Review changes: one editor at a time, a chip each; the reader's fixes as Reader's notes", () => {
  const dad = suggestion({ id: "a", created: "2026-10-30T00:00:00Z", author_id: "dad", author_name: "Tom", proposed_body: BASE.replace("cold", "bright") });
  const editors = reviewEditors(BASE, openSuggestions([suggestion(), dad]), [fix({ span: { paragraph: 1, start: 0, end: 2 }, fix: "Our" })], locateChange);
  const html = review({ text: BASE, editors });
  const chips = [...html.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*><span[^>]*><\/span>([^<]+)<span[^>]*>(\d+)<\/span><\/button>/g)].map((m) => [decode(m[2]), m[1], m[3]]);
  assert.deepEqual(chips, [
    ["Tom", "true", "1"],
    ["Jane", "false", "2"],
    ["Reader's notes", "false", "1"],
  ]);
  assert.match(html, /<del[^>]*>cold<\/del>/, "the first chip's changes only");
  assert.doesNotMatch(html, />walked<\/del>/, "not another editor's");
  const reader = review({ text: BASE, editors, initialEditor: "reader" });
  assert.match(reader, /<del[^>]*>My<\/del><ins[^>]*>Our<\/ins>/, "the reader's fix as a change");
  assert.match(reader, /style="color:var\(--mark-amber\)/, "in the reader's color");
});

test("Review changes: the words on screen are the spec's", () => {
  const src = read("components", "essays", "ReviewChanges.tsx") + read("components", "essays", "SuggestBox.tsx") + read("lib", "essays", "review-view.ts");
  for (const w of ["With changes", "As suggested", "Original", "Accept all", "Reject all", "The draft changed here", "Copy", "Send suggestions", "Edit your suggestions", "Withdraw", "Suggest changes"])
    assert.ok(src.includes(w), w);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /track changes|markup|\bAI\b/i);
});

/* ------------------------------------------------------------------ */
/* Suggest changes                                                     */
/* ------------------------------------------------------------------ */

test("SuggestBox: Suggest changes for an editor without one open; Waiting for the student, Edit and Withdraw with one", () => {
  const props = { essayId: ESSAY_ID, userId: "mom", text: BASE, countKind: "words", limit: null, studentFirst: "Alice Smith", color: "blue" };
  const fresh = renderToStaticMarkup(React.createElement(SuggestBox, { ...props, mine: null }));
  assert.match(fresh, />Suggest changes</);
  assert.doesNotMatch(fresh, /<textarea/, "the copy opens on the button");
  const waiting = renderToStaticMarkup(React.createElement(SuggestBox, { ...props, mine: suggestion() }));
  assert.match(waiting, />Waiting for Alice</);
  assert.match(waiting, />Edit your suggestions</);
  assert.match(waiting, />Withdraw</);
  assert.match(waiting, /<del[^>]*>walked<\/del><ins[^>]*>ran<\/ins>/, "the changes marked");
  const key = changesBetween(BASE, PROPOSED)[0].key;
  assert.match(waiting, new RegExp(`id="change-${key}"`), "a change mark's Open lands on it");
  const started = renderToStaticMarkup(React.createElement(SuggestBox, { ...props, mine: suggestion({ decisions: { [key]: "accepted" } }) }));
  assert.doesNotMatch(started, /Edit your suggestions|>Withdraw</, "once the student decides anything, the suggestion is theirs");
});

test("SuggestBox: unsent text is kept in this browser under its own key and cleared once sent; it never writes the draft", () => {
  const src = read("components", "essays", "SuggestBox.tsx");
  assert.match(read("lib", "essays", "review-view.ts"), /quad\.essay\.\$\{essayId\}\.suggest\.\$\{userId\}/);
  assert.match(src, /writeLocal\(key, null\);\s*setOpen\(false\);\s*router\.refresh\(\);/, "cleared on send");
  assert.doesNotMatch(src, /saveEssay|id="essay-field"/, "the box never touches the student's field or body");
  assert.match(src, /maxLength=\{MAX_NOTE\}/);
});

/* ------------------------------------------------------------------ */
/* The draft page                                                      */
/* ------------------------------------------------------------------ */

const essayRow = {
  id: ESSAY_ID,
  student_id: "alice",
  prompt_ref: "free",
  title: "A walk",
  count_kind: "words",
  count: 17,
  limit_max: null,
  limit_min: null,
  status: "draft",
  kind: "free",
  base_id: null,
  created: "2026-10-01T00:00:00Z",
  updated: "2026-11-01T09:00:00Z",
  body: BASE,
};
const readWith = (suggestions: SuggestionView[]) => ({ kind: "ready", essay: essayRow, versions: [], links: [], comments: [], suggestions, base: null, variants: 0 });
const student = { kind: "ready", userId: "alice-user", student: { id: "alice", name: "Alice Smith" }, canWrite: true, role: "student", person: null, children: [] };
const guardian = { kind: "ready", userId: "mom", student: { id: "alice", name: "Alice Smith" }, canWrite: false, role: "guardian", person: "alice", children: [] };
const renderPage = async (viewer: unknown, suggestions: SuggestionView[]) => {
  fixture.__essayPage = { viewer, read: readWith(suggestions) };
  return renderToStaticMarkup(await Page.default({ params: Promise.resolve({ id: ESSAY_ID }), searchParams: Promise.resolve({}) }));
};
const fieldTag = (html: string) => html.match(/<textarea[^>]*id="essay-field"[^>]*>/)?.[0] ?? "";

test("the page: a guardian gets Suggest changes and never a writable field", async () => {
  const html = await renderPage(guardian, []);
  assert.match(html, />Suggest changes</);
  assert.match(fieldTag(html), /readOnly=""/);
  assert.doesNotMatch(html, /role="tablist"/, "no Write / Review changes for an editor");
  const waiting = await renderPage(guardian, [suggestion()]);
  assert.match(waiting, />Waiting for Alice</);
  assert.match(fieldTag(waiting), /readOnly=""/);
});

test("the page: the student gets the banner and Write / Review changes while a suggestion is open, and never Suggest changes", async () => {
  const html = await renderPage(student, [suggestion()]);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>Write</);
  assert.match(html, />Review changes<span[^>]*>2<\/span>/);
  assert.match(html, /Jane suggested 2 changes/);
  assert.match(html, />Review</);
  assert.doesNotMatch(fieldTag(html), /readOnly/);
  assert.doesNotMatch(html, />Suggest changes<|Waiting for/, "SuggestBox never renders for the student");
  const none = await renderPage(student, []);
  assert.doesNotMatch(none, /role="tablist"|suggested/, "nothing to review: no tabs, no banner");
  const decided = await renderPage(student, [suggestion({ status: "decided" })]);
  assert.doesNotMatch(decided, /role="tablist"/);
});

test("guard: the decisions go through the server, after what is waiting is saved, and the text swaps in", () => {
  const src = read("components", "essays", "Editor.tsx");
  const decide = src.slice(src.indexOf("const decide = async"), src.indexOf("const count = countText"));
  assert.match(decide, /await flush\(\);[\s\S]*decideSuggestion\(editor\.id, decisions\)/, "flush, then decide");
  assert.match(decide, /swapIn\(r\.body, r\.updated\)/, "the server's body and updated, no conflict prompt");
  assert.match(src, /usePublishMarks\("changes", changeItems\)/);
  assert.match(src, /useMarkOpener\(\s*"change"/);
  assert.match(src, /<Marks locate=\{locateChange\} \/>/);
  assert.match(src, /<MarksLegend locate=\{locateChange\}/);
  assert.match(src, /\{!canWrite && <SuggestBox /, "the box is an editor's only");
  // The guard sees a decision that skips the flush.
  assert.doesNotMatch(decide.replace("await flush();", ""), /await flush\(\);[\s\S]*decideSuggestion/);
});

test("guard: a ChangeView from the helpers carries what the rendering needs", () => {
  const v: ChangeView = fixChanges(BASE, [fix()])[0];
  assert.deepEqual(Object.keys(v).sort(), ["after", "before", "decision", "inserted", "key", "located", "removed"]);
});
