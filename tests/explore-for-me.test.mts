/**
 * Explore's "For you" levels (specs/planner/record/explore-levels.md; lib/params.ts parseForMe, lib/explore-for-me.ts,
 * app/explore/page.tsx, components/explore/{FilterPanel,Toolbar,ForYouChip}.tsx): parsing `forMe`; the filter keeps only
 * the picked levels, by the real estimate over the real dataset; a viewer who isn't a student gets the list unchanged
 * and the group's sign-in line; the cap and its message; nothing from the estimate but the level word in the markup;
 * the page resolving the viewer only with `forMe` set; and the client never reaching the server module. Each guard is
 * shown failing on a planted bad case. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { countActiveFilters, parseFilters, parseForMe } from "../lib/params.ts";
import { STANDING_LEVELS, STANDING_LEVEL_LABELS } from "../lib/chances/levels.ts";
import type { StandingLevel } from "../lib/chances/types.ts";
import { numberProblems } from "./helpers/copy-guard.mts";
import { reachedFromClient, walk } from "./helpers/client-reach.mts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

test("forMe: level keys in the URL's order, unknown keys dropped, repeats once, nothing left is undefined", () => {
  assert.deepEqual(parseForMe({ forMe: "reach,high_reach" }), ["reach", "high_reach"]);
  assert.deepEqual(parseForMe({ forMe: "safe,bogus,,target,safe" }), ["safe", "target"]);
  assert.equal(parseForMe({ forMe: "bogus" }), undefined);
  assert.equal(parseForMe({ forMe: "" }), undefined);
  assert.equal(parseForMe({}), undefined);
  assert.equal(parseForMe({ forMe: ["reach", "safe"] }), undefined, "a repeated param isn't a list Explore writes");
});

test("forMe counts as one active filter and never reaches the dataset's filters", () => {
  assert.equal(countActiveFilters({ forMe: "reach,target" }), 1);
  assert.equal(countActiveFilters({ forMe: "reach", states: "NC" }), 2);
  assert.deepEqual(parseFilters({ forMe: "reach", states: "NC" }), parseFilters({ states: "NC" }));
});

/* ------------------------------------------------------------------ */
/* The filter over the real dataset                                    */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier === "next/headers")
      return { url: "data:text/javascript,export function cookies(){throw new Error('no request')} export function headers(){throw new Error('no request')}", shortCircuit: true };
    // The auth and plan loaders import Next's own entry points without an extension (the bundler resolves them).
    if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const forMeMod = await import("../lib/explore-for-me.ts");
const { closestFirst, FOR_ME_CAP, forMeCappedLine, forMeFilter, hooksFor, SPEC_CAP, studentSat } = forMeMod;
type ForMeViewer = import("../lib/explore-for-me.ts").ForMeViewer;
const { getData } = await import("../lib/data.ts");
const { estimateContext, estimateMany } = await import("../lib/chances/estimate.ts");
const { satMid } = await import("../lib/metrics.ts");
type EstimateStudent = import("../lib/chances/types.ts").EstimateStudent;

function student(o: Partial<EstimateStudent> = {}): EstimateStudent {
  return { gpa: 3.7, gpaScale: "4.0", gpaRange: [3.7, 3.7], test: { kind: "sat", score: 1330 }, satMath: null, actMath: null, classRankPercentile: null, courses: [], state: "NC", majors: [], round: null, highSchoolId: null, ...o } as EstimateStudent;
}
const ready = (s = student()): ForMeViewer => ({ kind: "ready", person: null, student: s, extra: { coreAtTopLevel: null, grade: 11 }, hooks: {} });

const data = await getData();
const all = data.getAllSchools();
const truth = estimateMany(student(), all.map((s) => s.unit_id), await estimateContext(student(), { grade: 11 }));

test("the filter keeps exactly the colleges at the picked levels, in the order they came in, each with its level key", async () => {
  const wanted: StandingLevel[] = ["reach", "high_reach"];
  const r = await forMeFilter(all, wanted, ready());
  assert.equal(r.status, "applied");
  assert.equal(r.capped, false);
  const expected = all.filter((s) => wanted.includes(truth[s.unit_id]?.group as StandingLevel));
  assert.ok(expected.length > 0, "the planted student has Reaches");
  assert.deepEqual(r.schools.map((s) => s.unit_id), expected.map((s) => s.unit_id));
  for (const s of r.schools) assert.equal(r.levels[s.unit_id], truth[s.unit_id].group);
  assert.equal(Object.keys(r.levels).length, r.schools.length, "levels only for the colleges kept");
  // A planted bad case: a filter that kept a Target would fail the same check.
  const leaky = [...r.schools, all.find((s) => truth[s.unit_id]?.group === "target")!];
  assert.notDeepEqual(leaky.map((s) => s.unit_id), expected.map((s) => s.unit_id));
});

test("the filter runs after the others: it only ever narrows what it's given", async () => {
  const nc = all.filter((s) => s.location.state === "NC");
  const r = await forMeFilter(nc, ["target", "likely", "safe"], ready());
  assert.ok(r.schools.length > 0 && r.schools.length <= nc.length);
  for (const s of r.schools) assert.equal(s.location.state, "NC");
});

test("levels carry a level key and nothing else from the estimate", async () => {
  const r = await forMeFilter(all, [...STANDING_LEVELS], ready());
  for (const v of Object.values(r.levels)) assert.ok(STANDING_LEVELS.includes(v), String(v));
  assert.deepEqual(Object.keys(r).sort(), ["cap", "capped", "levels", "recordHref", "schools", "status"]);
});

test("a viewer who isn't a student gets the list unchanged and the group's line", async () => {
  const some = all.slice(0, 40);
  for (const viewer of [{ kind: "signed-out" }, { kind: "no-student" }] as ForMeViewer[]) {
    const r = await forMeFilter(some, ["reach"], viewer);
    assert.equal(r.schools, some, viewer.kind);
    assert.deepEqual(r.levels, {});
    assert.equal(r.status, viewer.kind);
  }
  assert.equal((await forMeFilter(some, ["reach"], { kind: "signed-out" })).recordHref, null, "signed out: the sign-in line, no record link");
  const noNumbers = await forMeFilter(some, ["reach"], { kind: "no-numbers", person: "kid-1" });
  assert.equal(noNumbers.schools, some);
  assert.equal(noNumbers.status, "no-numbers");
  assert.equal(noNumbers.recordHref, "/advisor?for=kid-1&record=1", "the plan's person's record");
  assert.equal((await forMeFilter(some, ["reach"], { kind: "no-numbers", person: null })).recordHref, "/advisor?record=1");
  // The group's lines, as the panel shows them.
  const panel = read("components", "explore", "FilterPanel.tsx");
  assert.match(panel, /Sign in and add your grades to filter by your level/);
  assert.match(panel, /Add your grades and a test choice to filter by your level/);
  assert.match(panel, /loginHref\("\/explore"\)/);
});

test("the cap: measured under 150 ms over every college, so it's off; when on, the nearest to the student's numbers and its line", async () => {
  assert.equal(FOR_ME_CAP, null, "estimateMany over all ~1,900 colleges measured under 150 ms (lib/explore-for-me.ts)");
  assert.equal(SPEC_CAP, 600);
  assert.equal(forMeCappedLine(600), "Showing levels for the 600 colleges closest to your numbers; narrow the filters to see more.");

  const cap = 120;
  const s = student();
  const r = await forMeFilter(all, [...STANDING_LEVELS], ready(s), { cap });
  assert.equal(r.capped, true);
  assert.equal(r.cap, cap);
  const nearest = new Set(closestFirst(all, studentSat(s), cap).map((x) => x.unit_id));
  assert.equal(nearest.size, cap);
  assert.ok(r.schools.length <= cap);
  for (const x of r.schools) assert.ok(nearest.has(x.unit_id), `${x.name} is among the ${cap} nearest`);
  // Nearest means nearest: every college kept is at least as close as every one left out that has an SAT midpoint.
  const dist = (x: (typeof all)[number]) => Math.abs((satMid(x) ?? Infinity) - 1330);
  const worstIn = Math.max(...[...nearest].map((id) => dist(data.getSchoolById(id)!)));
  const left = all.filter((x) => !nearest.has(x.unit_id) && satMid(x) !== null);
  assert.ok(left.every((x) => dist(x) >= worstIn));
  // A planted bad case: the first 120 in the list's own order aren't the nearest.
  const naive = new Set(all.slice(0, cap).map((x) => x.unit_id));
  assert.ok([...naive].some((id) => !nearest.has(id)));
  // Under the cap, nothing is capped.
  const small = await forMeFilter(all.slice(0, 50), ["target"], ready(), { cap });
  assert.equal(small.capped, false);
  assert.equal(small.cap, null);
  // An ACT student sorts by the concorded SAT; no score sorts by admit rate alone.
  assert.equal(studentSat(student({ test: { kind: "act", score: 30 } })), 1370);
  assert.equal(studentSat(student({ test: null })), null);
});

test("hooks: the list's rows, plus a connection on a college not on the list", () => {
  const profile = { academics: { connections: [{ unitId: "198419", family: ["parent"], recruited: "none" }] } } as never;
  const items = [{ id: "i1", unit_id: "199847", visited_on: "2026-09-01", info_requested_on: null }];
  const hooks = hooksFor(profile, items, []);
  assert.equal(hooks["199847"]?.interest, true, "a visit on the list");
  assert.equal(hooks["198419"]?.legacy, true, "a parent's college, not on the list");
  assert.equal(Object.keys(hooksFor(null, [], [])).length, 0);
});

/* ------------------------------------------------------------------ */
/* Nothing from the estimate but the level word                        */
/* ------------------------------------------------------------------ */

const tmp = mkdtempSync(join(tmpdir(), "explore-for-me-"));
const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(reactUrl)};\nexport default ({ href, children, className }) => React.createElement("a", { href, className }, children);`);
async function load(rel: string): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const code = outputText
    .replace(/from "next\/link"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "link.mjs")).href)}`)
    .replace(/from "@\/(lib\/[^"]+)"/g, (_m, p: string) => `from ${JSON.stringify(pathToFileURL(join(ROOT, `${p}.ts`)).href)}`)
    .replace(/from "react"/g, `from ${JSON.stringify(reactUrl)}`);
  const file = join(tmp, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}
const React = (await import("react")).default;
const { ForYouChip } = (await load("components/explore/ForYouChip.tsx")) as { ForYouChip: (p: { level: StandingLevel }) => import("react").ReactElement };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Problems with the markup a level chip renders: anything but "<Level> for you". */
function chipProblems(html: string, level: StandingLevel): string[] {
  const t = text(html);
  const out = numberProblems(t);
  if (t !== `${STANDING_LEVEL_LABELS[level]} for you`) out.push(`unexpected words: ${t}`);
  return out;
}

test("the chip is the level word and nothing else: no number, no percentage, no odds", () => {
  for (const level of STANDING_LEVELS) {
    const html = renderToStaticMarkup(React.createElement(ForYouChip, { level }));
    assert.deepEqual(chipProblems(html, level), [], html);
  }
  // Planted bad cases.
  assert.ok(chipProblems("<span>Reach for you · 18%</span>", "reach").length > 0);
  assert.ok(chipProblems("<span>Reach for you</span><span>closeness 3</span>", "reach").length > 0);
  assert.ok(chipProblems("<span>Target for you: good odds</span>", "target").length > 0);
});

test("the page, cards, row, and table pass only level keys; none reads any other estimate field", () => {
  const files = ["app/explore/page.tsx", "components/school/SchoolCard.tsx", "components/school/SchoolRow.tsx", "components/explore/SchoolTable.tsx", "components/explore/ForYouChip.tsx", "components/explore/FilterPanel.tsx", "components/explore/Toolbar.tsx"];
  // The dataset's own percentages (Pell share, admit rate) are fine on these pages; the estimate's fields are not.
  const bad = /closeness|moveUp|\.facts\b|\.notes\b|likeYou|\bodds\b|from "@\/lib\/chances\/estimate"/;
  for (const f of files) assert.doesNotMatch(read(f), bad, f);
  assert.match(bad.source, /closeness/);
  assert.ok(bad.test("const x = r.closeness"), "a planted read of closeness fails");
  // The levels map is typed as level keys.
  assert.match(read("components", "explore", "SchoolTable.tsx"), /levels\?: Readonly<Record<string, StandingLevel>> \| null/);
});

/* ------------------------------------------------------------------ */
/* Every other Explore request does exactly what it did                */
/* ------------------------------------------------------------------ */

/** Problems with the page's source: the viewer read outside `if (forMe)`, or any auth/profile read of its own. */
function pageProblems(src: string): string[] {
  const out: string[] = [];
  for (const banned of [/from "@\/lib\/auth"/, /from "@\/lib\/student-profile-store"/, /from "next\/headers"/, /\bgetUser\(/, /\bprofileFor\(/, /\bplanViewer\(/, /\bcookies\(/])
    if (banned.test(src)) out.push(`reads ${banned.source} itself`);
  const calls = [...src.matchAll(/resolveForMeViewer\(\)/g)].length;
  if (calls !== 1) out.push(`resolveForMeViewer() called ${calls} times`);
  if (!/if \(forMe\) \{\n[^}]*await forMeFilter\(schools, forMe, await resolveForMeViewer\(\)\);/.test(src)) out.push("the viewer isn't resolved inside if (forMe)");
  if (/forMeFilter\(/.test(src.replace(/if \(forMe\) \{\n[^}]*\}/, ""))) out.push("forMeFilter runs outside if (forMe)");
  return out;
}

test("the page resolves the viewer and runs the estimate only with forMe in the URL", () => {
  const src = read("app", "explore", "page.tsx");
  assert.deepEqual(pageProblems(src), []);
  // Planted bad cases: the viewer read up front, and an auth read of the page's own.
  const upFront = src.replace("  let schools = getSchools(filters);", "  const viewer = await resolveForMeViewer();\n  let schools = getSchools(filters);");
  assert.ok(pageProblems(upFront).length > 0);
  assert.ok(pageProblems(`import { getUser } from "@/lib/auth";\n${src}`).length > 0);
  const unconditional = src.replace("if (forMe) {", "if (true) {");
  assert.ok(pageProblems(unconditional).length > 0);
});

test("the client never reaches lib/explore-for-me.ts", () => {
  const files = walk("app");
  for (const dir of ["components", "lib"]) walk(dir, files);
  assert.deepEqual(reachedFromClient(files, ["lib/explore-for-me.ts"]), []);
  // A planted client file importing it is caught.
  const planted = new Map(files);
  planted.set("components/explore/Planted.tsx", `"use client";\nimport { forMeFilter } from "@/lib/explore-for-me";\n`);
  assert.equal(reachedFromClient(planted, ["lib/explore-for-me.ts"]).length, 1);
});

/* ------------------------------------------------------------------ */
/* The panel, the chips, telemetry                                     */
/* ------------------------------------------------------------------ */

test("the For you group: five chips in the level colors, 44 px, the active chip, and telemetry with a count only", () => {
  const panel = read("components", "explore", "FilterPanel.tsx");
  assert.match(panel, /<Section title="For you" term="levels">/);
  assert.match(panel, /STANDING_LEVELS\.map/);
  assert.match(panel, /GROUP_CLASS\[l\]/);
  assert.match(panel, /min-h-11/);
  assert.match(panel, /track\("explore_for_me", \{ levels: next\.length \}\)/);
  assert.match(read("components", "explore", "MobileFilterSheet.tsx"), /forYou=\{forYou\}/);
  const toolbar = read("components", "explore", "Toolbar.tsx");
  assert.match(toolbar, /`For you: \$\{forMe\.map\(\(l\) => STANDING_LEVEL_LABELS\[l\]\)\.join\(", "\)\}`/);
  assert.match(toolbar, /onRemove: \(\) => update\(\{ forMe: null \}\)/);
});
