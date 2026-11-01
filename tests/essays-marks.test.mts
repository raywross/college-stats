/**
 * Marks in the draft (specs/product/essays/editors.md "2. Marks in the draft"; essay-editors-build/brief.md "U2
 * Marks"): `lib/essays/marks.ts` on fixtures (spans resolved in the live text and dropped when the draft changed under
 * them, overlapping marks cut into segments carrying both, an insertion as a zero-width segment, colors by first
 * appearance repeating after five, the legend's counts and order); the backdrop's and overlay's spans and the legend's
 * chips rendered for real with renderToStaticMarkup; the items the notes and the comments publish; and guards that the
 * field stays a plain, transparent `<textarea id="essay-field">` with its marks around it. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { ReactElement } from "react";
import {
  assignColors,
  authorOrder,
  changeLine,
  commentAuthorKey,
  firstLineOf,
  legendFor,
  resolveMarks,
  segmentMarks,
  type Change,
  type ChangeLocator,
  type MarkColor,
  type MarkItem,
  type MarkSegment,
} from "../lib/essays/marks.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const TEXT = "The first paragraph has words.\n\nThe second one is here.";
//            0123456789012345678901234567890 1 2
// Paragraph 1 starts at 32.

const note = (id: string, paragraph: number, start: number, end: number): MarkItem => ({
  id,
  kind: "note",
  authorKey: "reader",
  label: "Reader's notes",
  firstLine: "An observation",
  targetId: `note-${id}`,
  span: { paragraph, start, end },
});
const comment = (id: string, authorKey: string, paragraph: number, start: number, end: number, label = "Jane"): MarkItem => ({
  id,
  kind: "comment",
  authorKey,
  label,
  firstLine: "A comment",
  targetId: `comment-${id}`,
  span: { paragraph, start, end },
});
const change = (key: string, authorKey: string, c: Partial<Change>): MarkItem => {
  const full: Change = { key, removed: "", inserted: "", before: "", after: "", ...c };
  return { id: `change-${key}`, kind: "change", authorKey, label: "Jane", firstLine: changeLine(full), targetId: `change-${key}`, change: full };
};
/** A stand-in for lib/essays/suggestions.ts's locateChange: `removed` when it occurs once; an insertion at before+after. */
const locate: ChangeLocator = (current, c) => {
  if (c.removed) {
    const at = current.indexOf(c.removed);
    return at >= 0 && current.indexOf(c.removed, at + 1) < 0 ? { start: at, end: at + c.removed.length } : null;
  }
  const at = current.indexOf(`${c.before}${c.after}`);
  return at >= 0 ? { start: at + c.before.length, end: at + c.before.length } : null;
};
const sliceOf = (seg: MarkSegment, text = TEXT) => text.slice(seg.start, seg.end);
const ids = (seg: MarkSegment) => seg.items.map((i) => i.id);

/* ------------------------------------------------------------------ */
/* resolveMarks                                                        */
/* ------------------------------------------------------------------ */

test("resolveMarks: spans become offsets in the live text", () => {
  const r = resolveMarks(TEXT, [note("a", 0, 4, 9), comment("b", "u1", 1, 4, 10)]);
  assert.deepEqual(
    r.map((x) => [x.item.id, TEXT.slice(x.start, x.end)]),
    [
      ["a", "first"],
      ["b", "second"],
    ],
  );
});

test("resolveMarks drops a note whose span no longer resolves (the paragraph is gone or shorter)", () => {
  const items = [note("a", 0, 4, 9), note("gone", 2, 0, 3), note("short", 1, 10, 200), note("empty", 0, 3, 3)];
  assert.deepEqual(
    resolveMarks(TEXT, items).map((x) => x.item.id),
    ["a"],
  );
  // The student deleted the first paragraph: the note on it now points past the end of what is left.
  assert.deepEqual(resolveMarks("Short.", [note("a", 0, 4, 9)]), []);
});

test("resolveMarks: changes resolve through the locator; without one (or when stale) they don't draw", () => {
  const items = [change("k1", "u1", { removed: "words" }), change("k2", "u1", { before: "The ", after: "second" }), change("stale", "u1", { removed: "nowhere" })];
  const r = resolveMarks(TEXT, items, locate);
  assert.deepEqual(
    r.map((x) => [x.item.id, x.start, x.end]),
    [
      ["change-k1", 24, 29],
      ["change-k2", 36, 36],
    ],
  );
  assert.deepEqual(resolveMarks(TEXT, items), []);
});

/* ------------------------------------------------------------------ */
/* segmentMarks                                                        */
/* ------------------------------------------------------------------ */

test("segmentMarks splits overlaps into segments carrying both items, in text order", () => {
  // "first paragraph" (4..19) and "paragraph has" (10..23).
  const segs = segmentMarks(resolveMarks(TEXT, [note("a", 0, 4, 19), comment("b", "u1", 0, 10, 23)]));
  assert.deepEqual(
    segs.map((s) => [sliceOf(s), ids(s)]),
    [
      ["first ", ["a"]],
      ["paragraph", ["a", "b"]],
      [" has", ["b"]],
    ],
  );
  for (let i = 1; i < segs.length; i++) assert.ok(segs[i].start >= segs[i - 1].end, "non-overlapping");
});

test("segmentMarks: the same words marked twice are one segment with both items; disjoint marks leave gaps", () => {
  const segs = segmentMarks(resolveMarks(TEXT, [note("a", 0, 4, 9), comment("b", "u1", 0, 4, 9), comment("c", "u2", 1, 4, 10)]));
  assert.deepEqual(
    segs.map((s) => [sliceOf(s), ids(s)]),
    [
      ["first", ["a", "b"]],
      ["second", ["c"]],
    ],
  );
});

test("segmentMarks: an insertion is a zero-width segment, splitting a range it falls inside", () => {
  // A comment on "The second one" (32..46) and an insertion before "second" (36).
  const r = resolveMarks(TEXT, [comment("b", "u1", 1, 0, 14), change("ins", "u2", { before: "The ", after: "second" })], locate);
  const segs = segmentMarks(r);
  assert.deepEqual(
    segs.map((s) => [s.start, s.end, ids(s)]),
    [
      [32, 36, ["b"]],
      [36, 36, ["change-ins"]],
      [36, 46, ["b"]],
    ],
  );
  // On its own, it is still a segment.
  assert.deepEqual(
    segmentMarks(resolveMarks(TEXT, [change("ins", "u2", { before: "The ", after: "second" })], locate)).map((s) => [s.start, s.end]),
    [[36, 36]],
  );
});

/* ------------------------------------------------------------------ */
/* Colors and the legend                                               */
/* ------------------------------------------------------------------ */

test("assignColors: the reader amber, the student gray, everyone else in order, repeating after five; stable", () => {
  const order = ["u1", "reader", "u2", "student", "u3", "u4", "u5", "u6", "u7"];
  const colors = assignColors(order);
  assert.deepEqual(colors, { u1: "blue", reader: "amber", u2: "violet", student: "gray", u3: "green", u4: "rose", u5: "teal", u6: "blue", u7: "violet" } satisfies Record<string, MarkColor>);
  assert.deepEqual(assignColors(order), colors, "the same order gives the same colors");
  assert.deepEqual(assignColors(["u1", "u2", "u1"]), { u1: "blue", u2: "violet" }, "a repeated key keeps its first color");
  // Adding a later author never changes an earlier one's color (Mom stays blue).
  assert.equal(assignColors([...order, "u8"]).u1, "blue");
});

test("authorOrder: each key at its earliest created, earliest first", () => {
  const order = authorOrder([
    { key: "dad", created: "2026-10-03T00:00:00Z" },
    { key: "mom", created: "2026-10-02T00:00:00Z" },
    { key: "dad", created: "2026-10-01T00:00:00Z" },
    { key: "student", created: "2026-10-05T00:00:00Z" },
  ]);
  assert.deepEqual(order, ["dad", "mom", "student"]);
});

test("commentAuthorKey: the student's own comments are 'student' for everyone; others by author id", () => {
  assert.equal(commentAuthorKey({ author_id: "alice", author_role: "student" }), "student");
  assert.equal(commentAuthorKey({ author_id: "mom", author_role: "guardian" }), "mom");
  assert.equal(commentAuthorKey({ author_id: null, author_role: "guardian" }), "former-guardian");
});

test("legendFor counts per key and keeps the colors' order, with the first item's label", () => {
  const colors = assignColors(["reader", "mom", "dad"]);
  const items = [comment("1", "dad", 0, 0, 3, "Dad"), note("2", 0, 0, 3), comment("3", "mom", 0, 0, 3, "Mom"), note("4", 1, 0, 3), comment("5", "dad", 1, 0, 3, "Dad"), comment("6", "x", 1, 0, 3, "X")];
  assert.deepEqual(legendFor(items, colors), [
    { key: "reader", label: "Reader's notes", color: "amber", count: 2 },
    { key: "mom", label: "Mom", color: "blue", count: 1 },
    { key: "dad", label: "Dad", color: "violet", count: 2 },
    { key: "x", label: "X", color: "gray", count: 1 },
  ]);
});

test("first lines: 80 characters on one line; a change says what it suggests", () => {
  assert.equal(firstLineOf("Short\n\nnote"), "Short note");
  const long = "word ".repeat(30);
  assert.ok(firstLineOf(long).length <= 81 && firstLineOf(long).endsWith("…"));
  assert.equal(changeLine({ removed: "very", inserted: "" }), "Suggests removing: very");
  assert.equal(changeLine({ removed: "big", inserted: "enormous" }), "Suggests: enormous");
});

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
const STUB_DIR = join(ROOT, "__essays_marks_stubs__");
const STUBS: Record<string, string> = {
  "next/navigation": `export function useRouter() { return { push() {}, refresh() {} }; }`,
  "@/lib/essays/store": `export async function addComment() { return { ok: false }; } export async function deleteComment() { return { ok: false }; } export async function resolveComment() { return { ok: false }; }`,
  "@/lib/analytics": `export function track() {}`,
  "@/components/ui/info-tip": `export function InfoTip() { return null; }`,
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
const MarksModule = (await import("../components/essays/Marks.tsx")) as {
  MarkLayer: (p: { text: string; segments: MarkSegment[]; colors: Record<string, MarkColor>; layer: "backdrop" | "overlay" }) => ReactElement;
  LegendChips: (p: { entries: ReturnType<typeof legendFor>; hidden: ReadonlySet<string>; onToggle: (k: string) => void }) => ReactElement;
  Marks: (p: object) => ReactElement | null;
};
const { MarksProvider } = (await import("../components/essays/marks-context.tsx")) as { MarksProvider: (p: { order: string[]; initialText?: string; children?: unknown }) => ReactElement };
const { commentMarks } = (await import("../components/essays/Comments.tsx")) as { commentMarks: (c: unknown[], userId: string) => MarkItem[] };
const { noteMarks } = (await import("../components/essays/Notes.tsx")) as { noteMarks: (n: unknown[]) => MarkItem[] };

const layer = (text: string, segments: MarkSegment[], colors: Record<string, MarkColor>, which: "backdrop" | "overlay") =>
  renderToStaticMarkup(React.createElement(MarksModule.MarkLayer, { text, segments, colors, layer: which }));
const stripTags = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/​/g, "");

/* ------------------------------------------------------------------ */
/* The backdrop and the overlay                                        */
/* ------------------------------------------------------------------ */

test("the backdrop: the whole text, each segment a span with one 2 px band per author color", () => {
  const colors = assignColors(["reader", "mom"]);
  const segs = segmentMarks(resolveMarks(TEXT, [note("a", 0, 4, 19), comment("b", "mom", 0, 10, 23)]));
  const html = layer(TEXT, segs, colors, "backdrop");
  assert.equal(stripTags(html), TEXT, "the copy holds exactly the field's text, so it wraps the same");
  const spans = [...html.matchAll(/<span data-mark="([^"]*)" data-start="(\d+)" class="([^"]*)" style="([^"]*)">([^<]*)<\/span>/g)];
  assert.deepEqual(
    spans.map((m) => [m[1], m[2], m[5]]),
    [
      ["a", "4", "first "],
      ["a b", "10", "paragraph"],
      ["b", "19", " has"],
    ],
  );
  for (const m of spans) assert.equal(m[3], "mark-span");
  // Two marks on the same words: two bands, amber and blue, stacked.
  assert.match(spans[1][4], /background-image:linear-gradient\(var\(--mark-amber\), var\(--mark-amber\)\), linear-gradient\(var\(--mark-blue\), var\(--mark-blue\)\)/);
  assert.match(spans[1][4], /background-size:100% 2px, 100% 2px/);
  assert.match(spans[1][4], /background-position:0 calc\(100% - 0px\), 0 calc\(100% - 3px\)/);
  assert.match(spans[0][4], /linear-gradient\(var\(--mark-amber\), var\(--mark-amber\)\);/, "one band for one mark");
});

test("the backdrop: at most three bands, one per distinct color", () => {
  const colors = assignColors(["reader", "a", "b", "c"]);
  const items = [note("n", 0, 0, 3), comment("1", "a", 0, 0, 3), comment("2", "a", 0, 0, 3), comment("3", "b", 0, 0, 3), comment("4", "c", 0, 0, 3)];
  const html = layer(TEXT, segmentMarks(resolveMarks(TEXT, items)), colors, "backdrop");
  assert.equal((html.match(/linear-gradient/g) ?? []).length, 3);
});

test("an insertion is a caret-width bar taking no width; the overlay's copy is wider to tap", () => {
  const colors = assignColors(["mom"]);
  const segs = segmentMarks(resolveMarks(TEXT, [change("ins", "mom", { before: "The ", after: "second" })], locate));
  const back = layer(TEXT, segs, colors, "backdrop");
  assert.match(back, /<span data-mark="change-ins" data-start="36" class="mark-caret" style="border-left:2px solid var\(--mark-blue\);padding-inline:0px;margin-inline:-1px"><\/span>/);
  const over = layer(TEXT, segs, colors, "overlay");
  assert.match(over, /class="mark-caret pointer-events-auto cursor-pointer" style="border-left:2px solid var\(--mark-blue\);padding-inline:6px;margin-inline:-7px"/);
  assert.equal(stripTags(back), TEXT);
});

test("the overlay: marked spans alone take pointer events; no bands drawn twice", () => {
  const segs = segmentMarks(resolveMarks(TEXT, [note("a", 0, 4, 9)]));
  const html = layer(TEXT, segs, assignColors(["reader"]), "overlay");
  assert.match(html, /<span data-mark="a" data-start="4" class="mark-span pointer-events-auto cursor-pointer">first<\/span>/);
  assert.doesNotMatch(html, /linear-gradient/);
  assert.equal(stripTags(html), TEXT);
});

test("a trailing line break keeps its line in the copy", () => {
  const html = layer("One line\n", segmentMarks(resolveMarks("One line\n", [note("a", 0, 0, 3)])), assignColors(["reader"]), "backdrop");
  assert.ok(html.endsWith("\n​"));
});

test("Marks renders nothing without marks; both copies are aria-hidden and the field's type when it does", () => {
  const empty = renderToStaticMarkup(React.createElement(MarksProvider, { order: [], initialText: TEXT }, React.createElement(MarksModule.Marks, {})));
  assert.equal(empty, "", "no copies of the draft in the page when nothing is marked");
  const src = read("components", "essays", "Marks.tsx");
  assert.match(src, /<div ref=\{backdrop\} aria-hidden data-marks="backdrop" className=\{cn\(LAYER, MARK_VARS, "pointer-events-none z-0 select-none"\)\}>/);
  assert.match(src, /<div ref=\{overlay\} aria-hidden data-marks="overlay" className=\{cn\(LAYER, MARK_VARS, "pointer-events-none z-20 select-none"\)\}>/);
  assert.match(src, /const LAYER = "absolute top-0 left-0 h-full w-full overflow-hidden px-4 py-4 text-\[18px\] leading-relaxed whitespace-pre-wrap break-words text-transparent sm:px-6 sm:text-lg/);
  assert.match(src, /role="dialog"/, "the popover is a dialog");
  assert.match(src, /aria-label="Close"/, "with a close button");
  assert.match(src, /"\(max-width: 639px\)"/, "a bottom sheet on a phone");
  assert.match(src, /new ResizeObserver\(later\)/);
  assert.match(src, /document\.fonts\?\.ready/);
  assert.match(src, /addEventListener\("resize", later\)/);
  assert.match(src, /addEventListener\("input", later\)/);
  assert.match(src, /el\.setSelectionRange\(at, at\)/, "a tap puts the caret where it landed");
  assert.match(src, /e\.key !== "Escape"/);
});

test("every palette color has a light and a dark variable", () => {
  const src = read("components", "essays", "Marks.tsx");
  for (const c of ["amber", "gray", "blue", "violet", "green", "rose", "teal"]) {
    assert.match(src, new RegExp(` \\[--mark-${c}:#[0-9a-f]{6}\\]|"\\[--mark-${c}:#[0-9a-f]{6}\\]`), `${c} light`);
    assert.match(src, new RegExp(`dark:\\[--mark-${c}:#[0-9a-f]{6}\\]`), `${c} dark`);
  }
});

/* ------------------------------------------------------------------ */
/* The band colors' contrast                                           */
/* ------------------------------------------------------------------ */

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (rgb: number[]) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("each band color is at least 3:1 against the page in both themes", () => {
  const src = read("components", "essays", "Marks.tsx");
  // The page backgrounds (app/globals.css --background, light oklch(0.982 0.006 95) and dark oklch(0.155 0.03 282)), in sRGB; and the card white.
  const light = [hex("#f9f8f3"), hex("#ffffff")];
  const dark = [hex("#0f0f1e")];
  for (const m of src.matchAll(/(dark:)?\[--mark-(\w+):(#[0-9a-f]{6})\]/g)) {
    const pages = m[1] ? dark : light;
    for (const page of pages) assert.ok(contrast(hex(m[3]), page) >= 3, `${m[1] ?? ""}${m[2]} ${m[3]} is ${contrast(hex(m[3]), page).toFixed(2)}:1`);
  }
});

/* ------------------------------------------------------------------ */
/* The legend                                                          */
/* ------------------------------------------------------------------ */

test("the legend: a chip per author with its dot, label and count; each toggles; hidden ones are dimmed", () => {
  const entries = legendFor([note("1", 0, 0, 3), note("2", 0, 0, 3), comment("3", "mom", 0, 0, 3, "Jane")], assignColors(["reader", "mom"]));
  const html = renderToStaticMarkup(React.createElement(MarksModule.LegendChips, { entries, hidden: new Set(["mom"]), onToggle: () => {} }));
  assert.match(html, /role="group" aria-label="Marks in the draft"/);
  assert.match(html, /flex-nowrap[^"]*overflow-x-auto/, "one row that scrolls sideways on a phone");
  const chips = [...html.matchAll(/<button type="button" aria-pressed="(true|false)" class="([^"]*)">.*?<\/span>([^<]+)<span[^>]*>(\d+)<\/span><\/button>/g)];
  assert.deepEqual(
    chips.map((c) => [c[1], stripTags(c[3]), c[4]]),
    [
      ["true", "Reader's notes", "2"],
      ["false", "Jane", "1"],
    ],
  );
  for (const c of chips) assert.match(c[2], /min-h-11/, "44 px targets");
  assert.match(chips[1][2], /opacity-60/);
});

/* ------------------------------------------------------------------ */
/* What the notes and the comments publish                             */
/* ------------------------------------------------------------------ */

test("the notes publish the newest read's open notes on words, as the reader's", () => {
  const notes = [
    { id: "n1", category: "mechanics", span: { paragraph: 0, start: 0, end: 3 }, observation: "A typo", why: "", ask: "", state: "open" },
    { id: "n2", category: "voice", span: null, observation: "The whole draft", why: "", ask: "", state: "open" },
    { id: "n3", category: "voice", span: { paragraph: 0, start: 0, end: 3 }, observation: "Done one", why: "", ask: "", state: "done" },
  ];
  assert.deepEqual(noteMarks(notes), [{ id: "note-n1", kind: "note", authorKey: "reader", label: "Reader's notes", firstLine: "A typo", targetId: "note-n1", span: { paragraph: 0, start: 0, end: 3 } }]);
});

test("the comments publish open anchored comments: the student's gray as 'student', others by id with their first name", () => {
  const base = { essay_id: "e", version_id: null, created: "2026-10-01T00:00:00Z" };
  const rows = [
    { ...base, id: "c1", author_id: "alice", author_role: "student", author_name: "Alice Smith", anchor: { paragraph: 0, start: 0, end: 3 }, body: "My own note", resolved_at: null },
    { ...base, id: "c2", author_id: "mom", author_role: "guardian", author_name: "Jane Smith", anchor: { paragraph: 1, start: 0, end: 3 }, body: "Tighten this", resolved_at: null },
    { ...base, id: "c3", author_id: "mom", author_role: "guardian", author_name: "Jane Smith", anchor: null, body: "On the whole draft", resolved_at: null },
    { ...base, id: "c4", author_id: "mom", author_role: "guardian", author_name: "Jane Smith", anchor: { paragraph: 0, start: 0, end: 3 }, body: "Resolved", resolved_at: "2026-10-02T00:00:00Z" },
    { ...base, id: "c5", author_id: "dad", author_role: "guardian", author_name: null, anchor: { paragraph: 0, start: 0, end: 3 }, body: "No name", resolved_at: null },
  ];
  const asStudent = commentMarks(rows, "alice");
  assert.deepEqual(
    asStudent.map((m) => [m.id, m.authorKey, m.label, m.targetId]),
    [
      ["comment-c1", "student", "You", "comment-c1"],
      ["comment-c2", "mom", "Jane", "comment-c2"],
      ["comment-c5", "dad", "Parent", "comment-c5"],
    ],
  );
  const asMom = commentMarks(rows, "mom");
  assert.deepEqual(
    asMom.map((m) => [m.authorKey, m.label]),
    [
      ["student", "Alice"],
      ["mom", "You"],
      ["dad", "Parent"],
    ],
  );
});

/* ------------------------------------------------------------------ */
/* Guards: the field stays a plain, transparent textarea                */
/* ------------------------------------------------------------------ */

/** The field's opening tag in the Editor's source, and whether it is the plain transparent textarea over its marks. */
function fieldRule(src: string): string[] {
  const broken: string[] = [];
  const tag = src.match(/<textarea\s+id="essay-field"[\s\S]*?\/>/)?.[0];
  if (!tag) return ["no <textarea id=\"essay-field\">"];
  if (!/\bbg-transparent\b/.test(tag)) broken.push("the field isn't bg-transparent");
  if (/\bbg-(background|muted|card)/.test(tag)) broken.push("the field paints a background over its marks");
  if (/contentEditable|contenteditable/i.test(src)) broken.push("contenteditable in the editor");
  const wrapper = /<div className=\{cn\("relative rounded-3xl border bg-background", !canWrite && "bg-muted\/30"\)\}>\s*<Marks(?: locate=\{locateChange\})? \/>\s*<textarea\s+id="essay-field"/;
  if (!wrapper.test(src)) broken.push("the marks don't sit before the field in a relative wrapper");
  return broken;
}

test("guard: the field keeps id=essay-field, a transparent background, and sits over its marks in a relative wrapper", () => {
  const src = read("components", "essays", "Editor.tsx");
  assert.deepEqual(fieldRule(src), []);
  assert.match(src, /usePublishMarksText\(text\);/, "the Editor publishes the live text");
  assert.match(src, /<MarksLegend /, "the legend sits above the field");
  // The guard catches each way of breaking the rule.
  assert.ok(fieldRule(src.replace("rounded-3xl bg-transparent px-4", "rounded-3xl bg-background px-4")).length > 0, "a field with a background");
  assert.ok(fieldRule(src.replace(/<textarea(\s+id="essay-field")/, "<div contentEditable$1")).length > 0, "a contenteditable field");
  assert.ok(fieldRule(src.replace(/<Marks [^>]*\/>/, "")).length > 0, "marks taken out");
});

test("guard: the margin marks are gone; the notes still open to their spot; cards carry the ids Open scrolls to", () => {
  const notes = read("components", "essays", "Notes.tsx");
  assert.doesNotMatch(notes, /MarginMarks|createPortal/);
  assert.match(notes, /Show in the draft/);
  assert.match(notes, /usePublishMarks\("notes", marks\)/);
  assert.match(notes, /id=\{`note-\$\{n\.id\}`\}/);
  const comments = read("components", "essays", "Comments.tsx");
  assert.match(comments, /<li key=\{c\.id\} id=\{`comment-\$\{c\.id\}`\}/);
  assert.match(comments, /usePublishMarks\("comments", marks\)/);
  const page = read("app", "advisor", "essays", "[id]", "page.tsx");
  assert.match(page, /<MarksProvider order=\{markOrder\} initialText=\{essay\.body\}>[\s\S]*<Editor[\s\S]*<Notes [\s\S]*<\/MarksProvider>/, "the Editor and the notes share one provider");
});

test("guard: nothing about a mark's words reaches analytics", () => {
  const src = read("components", "essays", "Marks.tsx");
  const calls = [...src.matchAll(/track\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(calls, ['"essay_mark_opened", { kind: item.kind, via }']);
  const broken = 'track("essay_mark_opened", { kind: item.kind, via, words: item.firstLine })';
  assert.notDeepEqual([...broken.matchAll(/track\(([^)]*)\)/g)].map((m) => m[1]), calls, "the check sees an added property");
});
