/**
 * Quad Advisor's splash page (specs/product/advisor.md "3. The page: /advisor, signed out"; the build brief's U3):
 * the sample fixture (`data/reference/sample-plan.json`) validates against the dataset and its words are the
 * catalog's own; every section renders for real with `react-dom/server` (the components are transpiled on the fly by a
 * module hook, with the glossary popovers, next/link, next/image, and the offer form stubbed); every frame carries the
 * "Sample: Jordan, class of 2028" badge; college figures are cited; nothing reads as a percentage chance or mentions
 * the trial yet; the two events are registered; the page's signed-out branch renders the splash and the old signed-out
 * plan is gone; the home page links the advisor. The page is dynamic (it reads the session), which Splash.tsx states.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { ReactElement } from "react";
import type { Dataset } from "../lib/dataset.ts";
import type { SampleFixture, SplashData } from "../components/advisor/sample.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* Loading the components without a build step                         */
/* ------------------------------------------------------------------ */

// The app's files are written for the Next bundler ("@/" paths, extensionless imports, JSX), which plain Node can't
// load; for this test only, a resolve hook maps them to files and a load hook transpiles .ts/.tsx (the same technique
// as tests/explore-cost.test.mts, plus JSX). A few client-only modules resolve to stubs that render plain markup.
// (module.registerHooks is in Node 22.15+ and 24; the installed @types/node predates it.)
type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format: string; source: string | Buffer; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
type NextLoad = (url: string, context: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(specifier: string, context: { parentURL?: string }, next: NextResolve): ResolveResult;
    load(url: string, context: unknown, next: NextLoad): LoadResult;
  }): void;
};

const STUB_DIR = join(ROOT, "__advisor_splash_stubs__");
const STUBS: Record<string, string> = {
  "@/components/ui/info-tip": `import React from "react";
const path = (c) => (c && typeof c === "object" ? c.path : undefined);
export const InfoTip = ({ term, cited }) => React.createElement("span", { "data-term": term, "data-cited": path(cited) });
export const SourceTip = ({ cited }) => React.createElement("span", { "data-cited": path(cited) });
export const Term = ({ term, children }) => React.createElement("span", { "data-term": term }, children);
export const MetricLabel = ({ term, cited, children, className }) => React.createElement("span", { className, "data-term": term, "data-cited": path(cited) }, children);`,
  "next/link": `import React from "react";
export default function Link({ href, children, className, onClick }) { return React.createElement("a", { href, className, onClick }, children); }`,
  "next/image": `import React from "react";
export default function Image({ src, alt, className }) { return React.createElement("img", { src, alt, className }); }`,
  "@/components/planner/OfferControls": `export const OfferSheet = () => null;`,
};
const stubUrl = (name: string) => pathToFileURL(join(STUB_DIR, `${name.replace(/[^a-z]/gi, "_")}.mjs`)).href;
const STUB_SOURCES = new Map(Object.entries(STUBS).map(([name, src]) => [stubUrl(name), src]));

function asFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(candidate) && /\.tsx?$/.test(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: stubUrl(specifier), shortCircuit: true };
    if (specifier === "server-only") return { url: stubUrl("server-only"), shortCircuit: true };
    let base: string | null = null;
    if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const file = base ? (/\.tsx?$/.test(base) && existsSync(base) ? base : asFile(base)) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    // A stub's own imports ("react") resolve as if from the repository root.
    if (context.parentURL && STUB_SOURCES.has(context.parentURL)) return next(specifier, { ...context, parentURL: pathToFileURL(join(ROOT, "package.json")).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === stubUrl("server-only")) return { format: "module", source: "export {};", shortCircuit: true };
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
const { createDataset } = await import("../lib/dataset.ts");
const sampleMod = await import("../components/advisor/sample.ts");
const { buildSplash, validateSample, deadlineOf } = sampleMod;

const json = (file: string) => JSON.parse(read("data", file));
const ds = createDataset({ schools: json("schools.json"), meta: json("meta.json"), releaseCalendar: json("release-calendar.json"), aliases: existsSync(join(ROOT, "data", "aliases.json")) ? json("aliases.json") : [] }) as Dataset;
const FIXTURE = JSON.parse(read("data", "reference", "sample-plan.json")) as SampleFixture;
const DATA: SplashData = buildSplash(FIXTURE, ds);

type Section = (p: Record<string, unknown>) => ReactElement;
async function section(name: string): Promise<Section> {
  const mod = (await import(`../components/advisor/sections/${name}.tsx`)) as Record<string, Section>;
  return mod[name];
}
const html = (El: Section, props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(El, props));

/** Frames that show the sample student, each of which must wear the badge. */
const FRAMED = ["Hero", "WhereYouStand", "ThisSeason", "NeverMissADate", "ForParents", "Offers"] as const;
/** Text sections: a title and a line (and the facts, the refusals, the questions, or the button). */
const TEXT = ["WhatItReads", "WhatItNeverDoes", "Counselors", "Questions", "Close"] as const;

const RENDERED: Record<string, string> = {};
for (const name of [...FRAMED, ...TEXT]) RENDERED[name] = html(await section(name), { data: DATA });

/* ------------------------------------------------------------------ */
/* The fixture                                                         */
/* ------------------------------------------------------------------ */

test("the sample fixture validates: five real colleges, one per level, and its dates match the dataset", () => {
  assert.deepEqual(validateSample(FIXTURE, ds), []);
  assert.equal(FIXTURE.colleges.length, 5);
  assert.equal(new Set(FIXTURE.colleges.map((c) => c.level)).size, 5);
  for (const c of FIXTURE.colleges) assert.ok(ds.getSchoolById(c.unit_id), `${c.unit_id} is in the dataset`);
  assert.equal(FIXTURE.name, "Jordan");
  assert.equal(FIXTURE.gradYear, 2028);
  assert.equal(FIXTURE.season, "junior_spring");
  // The guard fails when the fixture is broken: a sixth college, a missing level, an unknown id, a wrong deadline.
  const broken: SampleFixture = {
    ...FIXTURE,
    colleges: [...FIXTURE.colleges.slice(1), { unit_id: "000000", level: "target" }],
    calendar: FIXTURE.calendar.map((e) => (e.kind === "deadline" ? { ...e, iso: "2026-12-31" } : e)),
  };
  const errors = validateSample(broken, ds);
  assert.ok(errors.some((e) => /no college at high_reach/.test(e)));
  assert.ok(errors.some((e) => /000000 is not in the dataset/.test(e)));
  assert.ok(errors.some((e) => /the dataset says/.test(e)));
});

test("the sample's moves are the catalog's own words, filled from the fixture and the dataset", async () => {
  const { countLine, listGapTitle, shapeFor } = await import("../lib/planner/list-shape.ts");
  const { interestMoveText } = await import("../lib/planner/interest.ts");
  const { PLAYBOOK } = await import("../lib/planner/moves-catalog.ts");
  const counts = { high_reach: 0, reach: 0, target: 0, likely: 0, safe: 0 };
  for (const c of FIXTURE.colleges) counts[c.level] += 1;
  const [list, interest, score] = FIXTURE.moves;
  assert.equal(list.title, listGapTitle(counts, shapeFor(FIXTURE.season)!));
  assert.equal(list.why, countLine(counts));
  assert.equal(list.guide, "list");
  const wake = ds.getSchoolById(interest.unit_id!)!;
  const text = interestMoveText({ kind: "show_interest" }, { name: wake.name, profile: wake.reported?.admission_profile ?? null, cites: {} } as never);
  assert.equal(interest.title, text.title);
  assert.equal(interest.why, text.why);
  assert.equal(interest.guide, "interest");
  const entry = PLAYBOOK.find((e) => e.key === `reach_score_${FIXTURE.season}`)!;
  assert.equal(score.title, entry.title.replace("{target}", String(FIXTURE.target)));
  assert.equal(score.why, entry.why);
  assert.equal(score.guide, "test");
  // The parent's Done and Skipped rows are real playbook moves.
  const titles = new Set(PLAYBOOK.map((e) => e.title));
  for (const t of [...FIXTURE.parent.done, ...FIXTURE.parent.skipped]) assert.ok(titles.has(t.title), t.title);
});

test("the calendar's dates are the dataset's and the cycle file's, and the bubble is the day before a deadline", async () => {
  const { currentCycle, loadCycle } = await import("../lib/planner/cycle.ts");
  const cycle = loadCycle(currentCycle(FIXTURE.calendarToday));
  for (const e of FIXTURE.calendar) {
    if (e.kind === "deadline") assert.equal(deadlineOf(ds.getSchoolById(e.unit_id!)!, e.round!), e.iso, e.label);
    if (e.kind === "test") assert.equal(cycle.entries.find((c) => c.key === e.cycle_key)?.date, e.iso, e.label);
  }
  assert.equal(DATA.calendar.bubble, "Tomorrow: Wake Forest ED I application is due");
  // Every college mark cites the college's own deadline field, resolved to a link.
  for (const lane of DATA.calendar.lanes)
    for (const m of lane.marks) if (m.cite?.kind === "field") assert.ok(DATA.calendar.cites[`${m.cite.unitId}:${m.cite.field}`]?.url, lane.label);
});

/* ------------------------------------------------------------------ */
/* The sections                                                        */
/* ------------------------------------------------------------------ */

test("every frame wears the sample badge, and every section renders its title", () => {
  assert.equal(DATA.badge, "Sample: Jordan, class of 2028");
  for (const name of FRAMED) assert.match(RENDERED[name], /data-sample-badge[^>]*>Sample: Jordan, class of 2028</, name);
  for (const name of [...FRAMED, ...TEXT]) assert.match(RENDERED[name], /<h[12]\b/, name);
  assert.match(RENDERED.Hero, /Quad Advisor/);
  assert.match(RENDERED.Hero, /An advisor for the whole road to college, <span class="highlight">in your pocket\.<\/span>/);
  assert.match(RENDERED.Hero, /href="\/login\?next=%2Fadvisor&amp;mode=signup"/);
  assert.match(RENDERED.Hero, /Free while Quad is in preview\./);
  assert.match(RENDERED.Close, /Already have an account\?/);
  assert.match(RENDERED.Close, /href="\/login\?next=%2Fadvisor"/);
});

test("the frames render the real components with the sample's colleges and moves", () => {
  // Where you stand: five colleges, each level's pill, the shape line.
  for (const c of DATA.colleges) assert.ok(RENDERED.WhereYouStand.includes(c.name.replace(/&/g, "&amp;")), c.name);
  for (const word of ["High reach · 1", "Reach · 1", "Target · 1", "Likely · 1", "Safe · 1"]) assert.ok(RENDERED.WhereYouStand.includes(word), word);
  assert.match(RENDERED.WhereYouStand, /A good senior list has 12 to 15 colleges; Jordan has 5\./);
  // Three things: the three titles and the guides' own buttons.
  for (const m of DATA.moves) {
    assert.ok(RENDERED.ThisSeason.includes(m.title.replace(/'/g, "&#x27;")), m.title);
    assert.ok(RENDERED.ThisSeason.includes(m.button), m.button);
  }
  // The calendar: the real lanes for the two ED deadlines, the test date, and the visit.
  for (const label of ["SAT dates", "Vanderbilt", "Wake Forest", "Visits", "Tomorrow: Wake Forest ED I application is due"]) assert.ok(RENDERED.NeverMissADate.includes(label), label);
  // Offers: both colleges, the four-year line, loans set apart.
  for (const name of ["Wake Forest University", "Clemson University", "Four-year net cost", "Parent PLUS"]) assert.ok(RENDERED.Offers.includes(name), name);
  // Parents: the season's list with done, skipped, and the nudge.
  for (const word of ["Jordan&#x27;s advisor", "Done and skipped (3)", "Skipped Mar 12", "Nudge"]) assert.ok(RENDERED.ForParents.includes(word), word);
  // What it never does: the five refusals.
  for (const r of ["No ads", "No leads sold to colleges", "No featured listings", "No percentage chances", "Nothing about a minor sold or shared"]) assert.ok(RENDERED.WhatItNeverDoes.includes(r), r);
  // Questions: four of them, as details.
  assert.equal((RENDERED.Questions.match(/<details/g) ?? []).length, 4);
});

test("college figures on the page are cited, never typed in", () => {
  // Each college's admit share carries the acceptance-rate citation; the interest move cites C7; the deadlines cite the grid.
  assert.equal((RENDERED.WhereYouStand.match(/data-cited="admissions\.acceptance_rate"/g) ?? []).length, 5);
  assert.match(RENDERED.ThisSeason, /data-cited="reported\.admission_profile\.factors\.interest"/);
  assert.match(RENDERED.WhatItReads, /data-cited="apply\.common_app"/);
  assert.match(RENDERED.WhatItReads, new RegExp(`${ds.getDatasetSummary().count.toLocaleString("en-US")} colleges`));
  // The offers' cost of attendance is each college's published full price, from the dataset.
  for (const col of DATA.offers) {
    const s = ds.getSchoolById(col.unitId)!;
    const expected = s.location.state === FIXTURE.homeState ? s.cost!.sticker!.in_state : s.cost!.sticker!.out_of_state;
    assert.equal(col.view?.coa.total, expected, col.school.name);
    assert.equal(col.view?.coa.source, "ipeds");
  }
  // No college figure lives in the fixture itself.
  assert.doesNotMatch(read("data", "reference", "sample-plan.json"), /acceptance_rate|admit_rate|sticker|avg_paid|"city"/);
  // Sections take years from lineage, never literals.
  for (const f of listFiles(join(ROOT, "components", "advisor"))) assert.doesNotMatch(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /\b(Fall|Spring) 20\d\d\b|\b20\d\d[–-]\d\d\b/, f);
});

/** A percentage next to a chance word, either way round: what the page must never say. */
function percentChance(text: string): RegExpMatchArray | null {
  return text.match(/\d\s*%[^<.]{0,40}\b(chance|odds|probability|likel(y|ihood))\b|\b(chance|odds|probability)\b[^<.]{0,30}\d\s*%/i);
}

test("nothing reads as a percentage chance, and nothing mentions the trial before it ships", () => {
  assert.ok(percentChance("a 23% chance of admission"), "the guard catches a percentage chance");
  assert.ok(percentChance("Your chance: 40%"), "either way round");
  for (const [name, out] of Object.entries(RENDERED)) {
    assert.equal(percentChance(out.replace(/<[^>]+>/g, " ")), null, name);
    assert.doesNotMatch(out, /14 days|14-day|free trial|\btrial\b|\$20 a year|\$30 (a year|for)/i, name);
  }
  // The levels are words, never numbers: no percentage on the list, the move cards, or the parent's view (the admit
  // share reads "1 in 19 admitted").
  for (const name of ["WhereYouStand", "ThisSeason", "ForParents"]) assert.doesNotMatch(RENDERED[name].replace(/<[^>]+>/g, " ").replace(/\d+ in \d+ admitted/g, ""), /%/, name);
});

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

test("the two events are registered, client side, with their properties", async () => {
  const { EVENTS } = await import("../lib/analytics.ts");
  assert.deepEqual(EVENTS.advisor_page_viewed.properties, ["signed_in"]);
  assert.equal(EVENTS.advisor_page_viewed.side, "client");
  assert.deepEqual(EVENTS.advisor_cta_tapped.properties, ["section"]);
  assert.equal(EVENTS.advisor_cta_tapped.side, "client");
  assert.match(read("components", "advisor", "SplashBeacon.tsx"), /track\("advisor_page_viewed", \{ signed_in: signedIn \}\)/);
  assert.match(read("components", "advisor", "CtaLink.tsx"), /track\("advisor_cta_tapped", \{ section \}\)/);
  // Nothing else is tracked on the page.
  for (const f of listFiles(join(ROOT, "components", "advisor"))) for (const m of readFileSync(f, "utf8").matchAll(/track\("([a-z_]+)"/g)) assert.ok(["advisor_page_viewed", "advisor_cta_tapped"].includes(m[1]), `${f}: ${m[1]}`);
});

test("the signed-out branch renders the splash, and the old signed-out plan is gone", () => {
  const page = read("app", "advisor", "page.tsx");
  assert.match(page, /if \(!user\) return <Splash \/>;/);
  assert.doesNotMatch(page, /SignedOutPlan/);
  assert.equal(existsSync(join(ROOT, "components", "planner", "SignedOutPlan.tsx")), false);
  // No code imports or renders it (comments elsewhere may still name it until their owners' copy passes).
  for (const dir of ["app", "components", "lib"]) for (const f of listFiles(join(ROOT, dir))) assert.doesNotMatch(readFileSync(f, "utf8"), /planner\/SignedOutPlan"|<SignedOutPlan\b|<PitchAnimation\b/, f);
  // The browser-kept list's import on sign-in stays one more release.
  for (const f of ["lib/planner/local-plan.ts", "lib/planner/local-plan-import.ts", "components/planner/ImportLocalPlan.tsx"]) assert.ok(existsSync(join(ROOT, f)), f);
  // The page reads the session, so the splash is dynamic; Splash.tsx says so.
  assert.match(read("components", "advisor", "Splash.tsx"), /Dynamic, not the spec's daily-revalidated static page/);
});

test("the home page's hero links the advisor, and stays static", () => {
  const home = read("app", "page.tsx");
  assert.match(home, /<Link href=\{ADVISOR_PATH\}[^>]*>\s*Try \{ADVISOR_NAME\}/);
  assert.match(home, /export const revalidate = 86400;/);
  assert.doesNotMatch(home, /getUser\(|cookies\(\)|connection\(\)/);
});

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []));
}
