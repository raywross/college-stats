/**
 * The advisor's tabs switch in the browser (round 4, U3; specs/planner/redesign/page.md "Tabs switch in place"):
 * - lib/planner/plan-tabs.ts: `openTabFor` (the server's choice from the URL), `switchableTabs` (which tabs' panels are
 *   on the page: Next steps always since round 5, Offers when the load read its stage's data), `hasDecision`, `panelOnceKey`;
 * - the rendered frame (PlanTabProvider + PlanTabPills + PlanTabs, through React's server renderer with the panel
 *   bodies stubbed): `?tab=essays` renders the Essays panel visible on the server and mounts no other; a URL naming a
 *   switchable tab shows that panel; one naming a tab without a panel here shows the opened one; the pills are links
 *   with hrefs, `data-switch` client or server, the open one ink-filled;
 * - the switch's source: a plain click prevents the navigation and `pushState`s the pill's own href; panels hidden,
 *   never unmounted; the page computes the essays data whatever the tab.
 * Each rule has a guard that fails when it's broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { ReactElement, ReactNode } from "react";
import { hasDecision, openTabFor, panelOnceKey, PANEL_ONCE_PARAMS, switchableTabs, tabsFor, type PlanTab } from "../lib/planner/plan-tabs.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ */
/* The pure rules                                                      */
/* ------------------------------------------------------------------ */

const FOUR = tabsFor({ everyone: false, hasDecision: false });
const FIVE = tabsFor({ everyone: false, hasDecision: true });

test("openTabFor: the URL's tab when this view shows it, else the fallback (as the page and the frame decide)", () => {
  assert.equal(openTabFor("essays", FOUR, "next"), "essays");
  assert.equal(openTabFor("offers", FOUR, "next"), "next", "no Offers before a decision");
  assert.equal(openTabFor("offers", FIVE, "next"), "offers");
  assert.equal(openTabFor("scores", FIVE, "next"), "next", "a retired tab");
  assert.equal(openTabFor(null, FIVE, "next"), "next");
  assert.equal(openTabFor("", FIVE, "colleges"), "colleges");
});

test("switchableTabs: Next steps, Colleges, Essays, Calendar always (round 5); Offers when its data came with the plan, or when opened on it", () => {
  assert.deepEqual(switchableTabs({ tabs: FIVE, opened: "next", offersRead: false }), ["next", "colleges", "essays", "calendar"]);
  assert.deepEqual(switchableTabs({ tabs: FIVE, opened: "colleges", offersRead: false }), ["next", "colleges", "essays", "calendar"]);
  assert.deepEqual(switchableTabs({ tabs: FIVE, opened: "colleges", offersRead: true }), ["next", "colleges", "essays", "calendar", "offers"]);
  assert.deepEqual(switchableTabs({ tabs: FIVE, opened: "offers", offersRead: false }), ["next", "colleges", "essays", "calendar", "offers"]);
  assert.deepEqual(switchableTabs({ tabs: FOUR, opened: "essays", offersRead: false }), ["next", "colleges", "essays", "calendar"]);
  // Guard: the opened tab is always among them (its panel is on the page), whatever the view.
  for (const tabs of [FOUR, FIVE]) for (const opened of tabs) for (const offersRead of [true, false]) assert.ok(switchableTabs({ tabs, opened, offersRead }).includes(opened));
  // Guard: Next steps switches in place for everyone now (the asks come with the load; seen is marked from the browser).
  for (const tabs of [FOUR, FIVE]) for (const opened of tabs) for (const offersRead of [true, false]) assert.ok(switchableTabs({ tabs, opened, offersRead }).includes("next"));
  // Guard: without its data, Offers' stage reads on its own, so it never switches in place unless the page opened on it.
  for (const opened of FIVE.filter((t) => t !== "offers")) assert.ok(!switchableTabs({ tabs: FIVE, opened, offersRead: false }).includes("offers"));
  // Never a tab the view doesn't show.
  assert.ok(!switchableTabs({ tabs: FOUR, opened: "next", offersRead: true }).includes("offers"));
});

test("hasDecision: a college answered (a decision date) or the student decided; the Offers tab's gate and the load's", () => {
  assert.equal(hasDecision([]), false);
  assert.equal(hasDecision([{ status: "applied", decision_date: null }, { status: "considering", decision_date: null }]), false);
  assert.equal(hasDecision([{ status: "applied", decision_date: "2026-12-15" }]), true);
  assert.equal(hasDecision([{ status: "decided", decision_date: null }]), true);
  assert.deepEqual(tabsFor({ everyone: false, hasDecision: hasDecision([{ status: "decided", decision_date: null }]) }), FIVE);
  // The frame and the loader share it (one gate, so the load reads the stage's data exactly when the tab shows).
  assert.match(read("components/planner/PlanFrame.tsx"), /tabsFor\(\{ everyone: false, hasDecision: hasDecision\(ctx\.items\) \}\)/);
  assert.match(read("lib/planner/load.ts"), /if \(!hasDecision\(plan\.items\)\) return Promise\.resolve\(null\);/);
});

test("panelOnceKey: changes with a move, a row's ED sheet, or the calendar range; not with the tab or the person", () => {
  const key = (q: string) => panelOnceKey((k) => new URLSearchParams(q).get(k));
  assert.deepEqual([...PANEL_ONCE_PARAMS], ["move", "row", "panel", "range"]);
  assert.equal(key("tab=next&for=s1"), key("tab=colleges"));
  assert.notEqual(key("tab=next&move=t1"), key("tab=next"));
  assert.notEqual(key("tab=colleges&row=i1&panel=ed"), key("tab=colleges"));
  assert.notEqual(key("tab=calendar&range=year"), key("tab=calendar"));
});

/* ------------------------------------------------------------------ */
/* Rendering the frame's tabs                                          */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format: string; source: string | Buffer; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
type NextLoad = (url: string, context: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(s: string, c: { parentURL?: string }, n: NextResolve): ResolveResult; load(u: string, c: unknown, n: NextLoad): LoadResult }): void;
};
const STUB_DIR = join(ROOT, "__tab_switch_stubs__");
const body = (name: string, def = false) =>
  `import React from "react";\n${def ? "export default function X" : `export function ${name}`}() { return React.createElement("p", { "data-body": ${JSON.stringify(name)} }); }`;
const STUBS: Record<string, string> = {
  "next/link": `import React from "react";
export default function Link({ href, children, prefetch, ...rest }) { return React.createElement("a", { href, "data-prefetch": String(prefetch), ...rest }, children); }`,
  // The URL the browser is on: set per render.
  "next/navigation": `export function useSearchParams() { return new URLSearchParams(globalThis.__tabSwitchUrl ?? ""); }`,
  "@/components/planner/FamilyCalendar": body("calendar", true),
  "@/components/planner/NextSteps": body("NextSteps"),
  "@/components/planner/PlanOpened": `export function PlanOpened() { return null; }`,
  "@/components/planner/PlanList": body("colleges", true),
  "@/components/planner/stages/OffersStage": body("offers", true),
  "@/components/planner/EssaysTab": body("EssaysTab"),
  "@/components/org/AskNotice": body("AskNotice"),
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
    if (url.startsWith("file:") && /\.tsx$/.test(url) && !url.includes("/node_modules/")) {
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
const { PlanTabProvider, PlanTabPills } = (await import("../components/planner/PlanTabSwitch.tsx")) as {
  PlanTabProvider: (p: { tabs: readonly PlanTab[]; opened: PlanTab; fallback: PlanTab; local: readonly PlanTab[]; children?: ReactNode }) => ReactElement;
  PlanTabPills: (p: { tabs: readonly PlanTab[]; tab: PlanTab; person: string | null }) => ReactElement;
};
const { PlanTabs } = (await import("../components/planner/PlanTabs.tsx")) as unknown as { PlanTabs: (p: Record<string, unknown>) => ReactElement };

const ctx = { student: { id: "s1" }, viewer: { isCounselor: false } };

/** The frame's tab part for a page the server rendered `opened`, read with the browser on `url`. */
function frame(opts: { tabs?: readonly PlanTab[]; opened: PlanTab; url?: string; offersRead?: boolean }): string {
  const tabs = opts.tabs ?? FIVE;
  const local = switchableTabs({ tabs, opened: opts.opened, offersRead: opts.offersRead ?? false });
  (globalThis as { __tabSwitchUrl?: string }).__tabSwitchUrl = opts.url ?? `tab=${opts.opened}`;
  return renderToStaticMarkup(
    React.createElement(
      PlanTabProvider,
      { tabs, opened: opts.opened, fallback: "next", local },
      React.createElement(PlanTabPills, { tabs, tab: opts.opened, person: "s1" }),
      React.createElement(PlanTabs, { ctx, view: {}, tab: opts.opened, local, calendarChild: {}, viewer: "guardian", essays: null, person: "s1" }),
    ),
  );
}

const panels = (html: string) => [...html.matchAll(/<div id="plan-panel-([a-z]+)" role="tabpanel" data-tab-panel="\1"( hidden="")?/g)].map((m) => ({ tab: m[1], hidden: !!m[2] }));
const pills = (html: string) =>
  [...html.matchAll(/<a href="([^"]+)" data-prefetch="([^"]*)" role="tab" aria-selected="(true|false)"[^>]*data-switch="(client|server)"/g)].map((m) => ({ href: m[1].replaceAll("&amp;", "&"), prefetch: m[2], selected: m[3] === "true", via: m[4] }));

test("?tab=essays renders the Essays panel, visible, on the server, and mounts no other panel", () => {
  const html = frame({ opened: "essays" });
  assert.deepEqual(panels(html), [{ tab: "essays", hidden: false }]);
  assert.match(html, /<div id="plan-panel-essays"[^>]*><p data-body="EssaysTab"><\/p><\/div>/);
  assert.doesNotMatch(html, /data-body="(colleges|calendar|NextSteps|offers)"/, "hidden panels cost nothing on first paint");
  // Guard: a frame that rendered every panel visible would fail the check above.
  assert.notDeepEqual(panels(`<div id="plan-panel-essays" role="tabpanel" data-tab-panel="essays"></div><div id="plan-panel-colleges" role="tabpanel" data-tab-panel="colleges"></div>`), [{ tab: "essays", hidden: false }]);
});

test("the pills: real links to ?tab=, the open one selected; client-side for panels on the page, a navigation for the rest", () => {
  const html = frame({ opened: "essays" });
  const p = pills(html);
  assert.deepEqual(p.map((x) => x.href), ["/advisor?for=s1&tab=next", "/advisor?for=s1&tab=colleges", "/advisor?for=s1&tab=essays", "/advisor?for=s1&tab=calendar", "/advisor?for=s1&tab=offers"]);
  assert.deepEqual(p.map((x) => x.selected), [false, false, true, false, false]);
  // Opened on Essays without the Offers data: only Offers stays a navigation (its stage reads for itself).
  assert.deepEqual(p.map((x) => x.via), ["client", "client", "client", "client", "server"]);
  // A switched tab needs no prefetch; a navigating one keeps Next's default.
  assert.deepEqual(p.map((x) => x.prefetch), ["false", "false", "false", "false", "undefined"]);
  // With the Offers data read with the plan (round 5), every tab switches in place.
  assert.deepEqual(pills(frame({ opened: "next", offersRead: true })).map((x) => x.via), ["client", "client", "client", "client", "client"]);
});

test("after a switch (the URL says calendar), the calendar panel shows, its pill is selected, and the opened panel stays mounted, hidden", () => {
  // A fresh render reads the URL; the browser keeps what it mounted. Here: mounted on the URL's tab only.
  const html = frame({ opened: "next", url: "tab=calendar" });
  assert.deepEqual(panels(html), [{ tab: "calendar", hidden: false }]);
  assert.deepEqual(pills(html).map((x) => x.selected), [false, false, false, true, false]);
  // No ?tab= at all: the viewer's default, as a full load of that URL opens.
  assert.deepEqual(panels(frame({ opened: "next", url: "" })), [{ tab: "next", hidden: false }]);
  // A URL naming a tab whose panel isn't here (Offers without its data) shows the opened one rather than nothing.
  assert.deepEqual(panels(frame({ opened: "colleges", url: "tab=offers" })), [{ tab: "colleges", hidden: false }]);
  assert.deepEqual(panels(frame({ opened: "colleges", url: "tab=offers", offersRead: true })), [{ tab: "offers", hidden: false }]);
  // Next steps is on the page for everyone now (round 5).
  assert.deepEqual(panels(frame({ opened: "colleges", url: "tab=next" })), [{ tab: "next", hidden: false }]);
});

test("PlanTabs renders the panels on the page: the opened one first, then the switchable ones; Next steps with its asks notice above", () => {
  const src = read("components/planner/PlanTabs.tsx");
  assert.match(src, /for \(const t of \[tab, \.\.\.local\]\) if \(!\(t in panels\)\) panels\[t\] = panel\[t\]\(\);/);
  assert.match(src, /return <PlanTabPanels panels=\{panels\} /);
  assert.match(src, /next: \(\) => \(\s*<>[\s\S]*?<AskNotice asks=\{tabsRead\?\.asks \?\? null\} ctx=\{ctx\} \/>\s*<NextSteps ctx=\{ctx\} view=\{view\} \/>/);
  assert.match(src, /offers: \(\) => <OffersStage ctx=\{ctx\} read=\{tabsRead\?\.offers \?\? null\} \/>/);
  // The frame decides which tabs are local and wraps the pills and the panels in one provider.
  const f = read("components/planner/PlanFrame.tsx");
  assert.match(f, /const local = switchableTabs\(\{ tabs, opened: openTab, offersRead: tabsRead\?\.offers != null \}\);/);
  assert.match(f, /<PlanTabs [^>]*tabsRead=\{tabsRead\}/);
  assert.match(f, /<PlanTabProvider tabs=\{tabs\} opened=\{openTab\} fallback=\{fallbackTab\} local=\{local\}>/);
  assert.match(f, /<PlanTabs [^>]*local=\{local\}/);
});

/* ------------------------------------------------------------------ */
/* The switch's source (the click itself runs only in a browser)       */
/* ------------------------------------------------------------------ */

/** The code of a source, comments dropped. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("a plain click on a local tab prevents the navigation and pushState's the pill's own href; modified clicks stay the browser's", () => {
  const src = code(read("components/planner/PlanTabSwitch.tsx"));
  assert.match(src, /^"use client";/);
  assert.match(
    src,
    /function switchTo\(e: MouseEvent<HTMLAnchorElement>, href: string, tab: PlanTab, state: TabState \| null\): void \{\s*if \(!state \|\| !state\.local\.includes\(tab\) \|\| !plainClick\(e\)\) return;\s*e\.preventDefault\(\);[\s\S]*?window\.history\.pushState\(null, "", href\);\s*\}/,
  );
  // The same address again adds no history entry.
  assert.match(src, /if \(to\.pathname === window\.location\.pathname && to\.search === window\.location\.search\) return;/);
  assert.match(src, /e\.button === 0 && !e\.metaKey && !e\.ctrlKey && !e\.shiftKey && !e\.altKey && !e\.defaultPrevented/);
  // The pills keep their hrefs and call the switch; the open tab comes from useSearchParams (which follows pushState).
  assert.match(src, /<Link\s+key=\{t\}\s+href=\{href\}[\s\S]*?onClick=\{\(e\) => switchTo\(e, href, t, state\)\}/);
  assert.match(src, /const href = planHref\(\{ person, tab: t \}\);/);
  assert.match(src, /const params = useSearchParams\(\);[\s\S]*?openTabFor\(params\?\.get\("tab"\) \?\? null, state\.tabs, state\.fallback\)/);
  // Never the router: a router push would be a server render.
  assert.doesNotMatch(src, /useRouter|router\.(push|replace)/);
  // Guard: a pill without the switch, or one that navigates through the router, fails the checks above.
  assert.doesNotMatch(src.replace(/onClick=\{\(e\) => switchTo\(e, href, t, state\)\}/, ""), /<Link\s+key=\{t\}\s+href=\{href\}[\s\S]*?onClick=\{\(e\) => switchTo\(e, href, t, state\)\}/);
});

test("panels: hidden, not unmounted; each mounts the first time it shows; a new server render with new once-parameters mounts them again", () => {
  const src = code(read("components/planner/PlanTabSwitch.tsx"));
  assert.match(src, /hidden=\{t !== open\}/);
  assert.match(src, /\.filter\(\(t\) => shown\.has\(t\) \|\| t === open\)/);
  assert.match(src, /if \(!shown\.has\(open\)\) setShown\(new Set\(\[\.\.\.shown, open\]\)\);/);
  assert.match(src, /if \(seen\.panels !== panels\) setSeen\(\{ panels, key: panelOnceKey/);
  assert.match(src, /<Panels key=\{seen\.key\} panels=\{panels\} open=\{open\} \/>/);
  // Each tab shown reports plan_opened.
  assert.match(src, /<PlanOpened tab=\{open\} /);
  // Guard: a panel list that rendered only the open tab (unmounting the others) would drop `hidden`.
  assert.doesNotMatch(src, /\{open === "[a-z]+" && /);
});

test("the page makes the essays data with every plan, not only on the Essays tab", () => {
  const page = code(read("app/advisor/page.tsx"));
  assert.doesNotMatch(page, /tab !== "essays"/);
  assert.equal((page.match(/const essays = await essaysFor\((loaded|load), "(student|guardian|counselor)"\);/g) ?? []).length, 3);
});
