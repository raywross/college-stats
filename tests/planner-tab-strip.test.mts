/**
 * The advisor's tab strip (specs/product/essays/tab.md "The tab strip": "One row, always"): four or five tabs on a
 * 390 px phone (358 px inside the gutters) as a segmented control of equal cells, and the pills as built from `sm`.
 * - A width estimate: every label at 12 px semibold Geist (advance widths measured in Chromium, no kerning, so the
 *   sum runs a little wide of the browser's own) plus the cell's side padding fits one cell of the 358 px row, with
 *   four and with five tabs. A label that wouldn't fit fails.
 * - The rendered strip (`PlanTabPills`, for real through React's server renderer): a grid that flows into columns of
 *   equal width, never `overflow-x-auto` or `flex-wrap`, every cell 44 px tall, 12 px, `whitespace-nowrap`, the icon
 *   only from `sm`. The Playwright pass (~/Projects/college-stats/essays-next-build/qa/strip-width.mjs) measures
 *   `scrollWidth <= clientWidth` at 390.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { ReactElement } from "react";
import { TAB_LABELS, tabsFor, type PlanTab } from "../lib/planner/plan-tabs.ts";

const ROOT = join(import.meta.dirname, "..");

/* ------------------------------------------------------------------ */
/* The width estimate                                                  */
/* ------------------------------------------------------------------ */

/** Geist 600 at 12 px: each character's advance in CSS px (canvas `measureText`, Chromium, 2026-10-30). */
const GEIST_600_12: Record<string, number> = {
  A: 8.51, B: 8.34, C: 8.69, D: 8.5, E: 7.38, F: 7.2, G: 8.71, H: 8.63, I: 3.48, J: 7.4, K: 8.06, L: 7.03, M: 10.82,
  N: 8.98, O: 9.16, P: 7.97, Q: 9.08, R: 8.27, S: 8.02, T: 7.01, U: 8.39, V: 8.51, W: 11.89, X: 7.92, Y: 7.36, Z: 6.92,
  a: 6.96, b: 7.45, c: 6.96, d: 7.45, e: 7.09, f: 5.15, g: 7.44, h: 7.21, i: 3.23, j: 3.7, k: 7.54, l: 3.56, m: 10.7,
  n: 7.21, o: 7.24, p: 7.45, q: 7.45, r: 4.91, s: 6.64, t: 5.12, u: 7.16, v: 7.01, w: 10.07, x: 7.54, y: 6.84, z: 6.8,
  " ": 2.83,
};
/** The widest advance in the table, for a character it doesn't list (an estimate must never run narrow). */
const WIDEST = Math.max(...Object.values(GEIST_600_12));

export function labelWidth(label: string): number {
  return [...label].reduce((w, ch) => w + (GEIST_600_12[ch] ?? WIDEST), 0);
}

/** Tailwind's spacing scale (0.25rem = 4 px a step): `px-1` → 4, `gap-1` → 4, `px-0` → 0, `px-0.5` → 2. */
const step = (v: string) => Number(v) * 4;

/** The phone (below `sm`) classes of a class string: the tokens without a breakpoint prefix. */
const base = (classes: string) => classes.split(/\s+/).filter((c) => c && !/^(sm|md|lg|xl|2xl):/.test(c));

/** The phone cell's side padding and the rail's gap, in px, read from the classes. */
function phoneSpacing(rail: string, cell: string): { gap: number; padX: number } {
  const gap = base(rail).map((c) => /^gap(?:-x)?-(\d+(?:\.\d+)?)$/.exec(c)?.[1]).find(Boolean);
  const px = base(cell).map((c) => /^px-(\d+(?:\.\d+)?)$/.exec(c)?.[1]).find(Boolean);
  return { gap: gap ? step(gap) : 0, padX: px ? step(px) : 0 };
}

/** Whether every label fits its equal cell in a row `width` px wide; the overflows when not. */
export function stripFits(labels: readonly string[], opts: { width: number; gap: number; padX: number }): { fits: boolean; cell: number; over: { label: string; need: number }[] } {
  const cell = (opts.width - opts.gap * (labels.length - 1)) / labels.length;
  const over = labels.map((label) => ({ label, need: labelWidth(label) + opts.padX * 2 })).filter((x) => x.need > cell);
  return { fits: over.length === 0, cell, over };
}

const PHONE_ROW = 390 - 2 * 16;

/* ------------------------------------------------------------------ */
/* Rendering the strip                                                 */
/* ------------------------------------------------------------------ */

// PlanTabs.tsx is written for the Next bundler ("@/" paths, JSX) and imports every tab's body; for this test a
// resolve/load hook maps "@/" to files, transpiles .tsx, and stubs next/link and the tab bodies (the technique of
// tests/essay-display.test.mts).
type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format: string; source: string | Buffer; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
type NextLoad = (url: string, context: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(s: string, c: { parentURL?: string }, n: NextResolve): ResolveResult; load(u: string, c: unknown, n: NextLoad): LoadResult }): void;
};
const STUB_DIR = join(ROOT, "__tab_strip_stubs__");
const NOTHING = `export default function X() { return null; }`;
const STUBS: Record<string, string> = {
  "next/link": `import React from "react";
export default function Link({ href, children, ...rest }) { return React.createElement("a", { href, ...rest }, children); }`,
  "@/components/planner/FamilyCalendar": NOTHING,
  "@/components/planner/NextSteps": `export function NextSteps() { return null; }`,
  "@/components/planner/PlanOpened": `export function PlanOpened() { return null; }`,
  "@/components/planner/PlanList": NOTHING,
  "@/components/planner/stages/OffersStage": NOTHING,
  "@/components/planner/EssaysTab": `export function EssaysTab() { return null; }`,
};
const stubUrl = (name: string) => pathToFileURL(join(STUB_DIR, `${name.replace(/[^a-z]/gi, "_")}.mjs`)).href;
const STUB_SOURCES = new Map(Object.entries(STUBS).map(([name, src]) => [stubUrl(name), src]));
const asFile = (b: string) => [b, `${b}.ts`, `${b}.tsx`].find((c) => existsSync(c) && !c.endsWith("/")) ?? null;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: stubUrl(specifier), shortCircuit: true };
    let b: string | null = null;
    if (specifier.startsWith("@/")) b = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) b = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const file = b ? (/\.tsx?$/.test(b) && existsSync(b) ? b : asFile(b)) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    if (context.parentURL && STUB_SOURCES.has(context.parentURL)) return next(specifier, { ...context, parentURL: pathToFileURL(join(ROOT, "package.json")).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    const stub = STUB_SOURCES.get(url);
    if (stub) return { format: "module", source: stub, shortCircuit: true };
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
const { PlanTabPills, STRIP_RAIL, STRIP_CELL } = (await import("../components/planner/PlanTabs.tsx")) as {
  PlanTabPills: (p: { tabs: readonly PlanTab[]; tab: PlanTab; person: string | null }) => ReactElement;
  STRIP_RAIL: string;
  STRIP_CELL: string;
};

const strip = (tabs: readonly PlanTab[], tab: PlanTab = "essays") => renderToStaticMarkup(React.createElement(PlanTabPills, { tabs, tab, person: null }));
const classesOf = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);

/** What a phone strip must be (tab.md): a grid of equal columns, no sideways scroll, no wrapping; cells 44 px, 12 px, one line. */
export function phoneStripProblems(rail: string, cells: readonly string[]): string[] {
  const r = base(rail);
  const problems: string[] = [];
  for (const need of ["grid", "grid-flow-col", "auto-cols-fr"]) if (!r.includes(need)) problems.push(`rail lacks ${need}`);
  if (r.some((c) => /^overflow-x-(auto|scroll)$/.test(c))) problems.push("rail scrolls sideways");
  if (r.includes("flex-wrap") || r.includes("flex-wrap-reverse")) problems.push("rail wraps");
  for (const cell of cells) {
    const c = base(cell);
    for (const need of ["min-h-11", "text-xs", "font-semibold", "whitespace-nowrap", "justify-center"]) if (!c.includes(need)) problems.push(`cell lacks ${need}`);
  }
  return [...new Set(problems)];
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test("the five labels, and the four, each fit one equal cell of the 358 px phone row at 12 px with the strip's own spacing", () => {
  const { gap, padX } = phoneSpacing(STRIP_RAIL, STRIP_CELL);
  assert.equal(gap, 4, "gap-1 between cells");
  for (const hasDecision of [false, true]) {
    const tabs = tabsFor({ everyone: false, hasDecision });
    assert.equal(tabs.length, hasDecision ? 5 : 4);
    const r = stripFits(tabs.map((t) => TAB_LABELS[t]), { width: PHONE_ROW, gap, padX });
    assert.ok(r.fits, `${tabs.length} tabs: ${JSON.stringify(r.over)} over a ${r.cell.toFixed(1)} px cell`);
  }
  // The estimate is honest about the widest label: "Next steps" is the one near the edge.
  assert.ok(labelWidth("Next steps") > 60 && labelWidth("Next steps") < 68, String(labelWidth("Next steps")));
});

test("guard: a label that wouldn't fit fails the width estimate, and so would px-1 cells with five tabs", () => {
  const five = tabsFor({ everyone: false, hasDecision: true }).map((t) => TAB_LABELS[t]);
  const longer = five.map((l) => (l === "Essays" ? "Applications" : l));
  const r = stripFits(longer, { width: PHONE_ROW, gap: 4, padX: 0 });
  assert.equal(r.fits, false);
  assert.deepEqual(r.over.map((o) => o.label), ["Applications"]);
  // tab.md's own sketch said px-1: with Geist's real widths "Next steps" wouldn't fit five 68 px cells that way.
  assert.deepEqual(stripFits(five, { width: PHONE_ROW, gap: 4, padX: 4 }).over.map((o) => o.label), ["Next steps"]);
  // An unknown character is estimated at the widest advance, never as nothing.
  assert.equal(labelWidth("—"), WIDEST);
});

test("the rendered strip, with four and with five tabs: an equal-column grid on phones, no sideways scroll, no wrap, 44 px cells", () => {
  for (const hasDecision of [false, true]) {
    const tabs = tabsFor({ everyone: false, hasDecision });
    const html = strip(tabs);
    const rail = classesOf(html, /<div class="([^"]*)" role="tablist"/g);
    assert.equal(rail.length, 1);
    const cells = classesOf(html, /<a [^>]*class="([^"]*)"/g);
    assert.equal(cells.length, tabs.length);
    assert.deepEqual(phoneStripProblems(rail[0], cells), []);
    // The labels in order, Essays third; the active one ink-filled.
    assert.deepEqual([...html.matchAll(/<\/svg>([^<]+)<\/a>/g)].map((m) => m[1]), tabs.map((t) => TAB_LABELS[t]));
    assert.equal(tabs[2], "essays");
    assert.match(html, /aria-selected="true"[^>]*class="[^"]*bg-foreground text-background/);
    // The icon only from sm: hidden on phones.
    for (const svg of classesOf(html, /<svg [^>]*class="([^"]*)"/g)) assert.match(svg, /\bhidden\b[^"]*\bsm:block\b/);
    // From sm the pills as built: one flex line, 14 px, px-4.
    assert.match(rail[0], /\bsm:flex\b/);
    assert.match(rail[0], /\bsm:flex-nowrap\b/);
    for (const c of cells) assert.match(c, /\bsm:px-4\b.*\bsm:text-sm\b|\bsm:text-sm\b.*\bsm:px-4\b/);
  }
});

test("guard: a strip that scrolls sideways, wraps, or loses the 44 px cells is caught", () => {
  const good = { rail: STRIP_RAIL, cell: STRIP_CELL };
  assert.deepEqual(phoneStripProblems(good.rail, [good.cell]), []);
  assert.ok(phoneStripProblems("flex flex-nowrap overflow-x-auto gap-1", [good.cell]).includes("rail scrolls sideways"));
  assert.ok(phoneStripProblems("flex flex-wrap gap-2", [good.cell]).includes("rail wraps"));
  assert.ok(phoneStripProblems(good.rail, [good.cell.replace("min-h-11", "min-h-8")]).includes("cell lacks min-h-11"));
  assert.ok(phoneStripProblems(good.rail, [good.cell.replace("whitespace-nowrap", "")]).includes("cell lacks whitespace-nowrap"));
  // A breakpoint-prefixed class is a wider screen's, not the phone's.
  assert.ok(phoneStripProblems("sm:grid sm:grid-flow-col sm:auto-cols-fr", [good.cell]).includes("rail lacks grid"));
});

test("the loading skeleton draws the same strip shape: one equal-column rail of 44 px cells, never wrapping", () => {
  const src = readFileSync(join(ROOT, "app/advisor/loading.tsx"), "utf8");
  const rail = /<div className="([^"]*grid-flow-col[^"]*)" aria-hidden>/.exec(src)?.[1] ?? "";
  assert.ok(rail, "the skeleton has the strip");
  assert.deepEqual(phoneStripProblems(rail, []), []);
  assert.match(src, /h-11 min-w-0 rounded-full/);
  assert.doesNotMatch(src, /flex flex-wrap items-center gap-2" aria-hidden/);
});
