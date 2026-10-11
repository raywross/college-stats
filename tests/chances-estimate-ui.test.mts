/**
 * Quad's estimate on the site (specs/chances/estimate.md "What families see"; specs/product/chances-and-fit.md
 * "Display"): "What went into this estimate" shows only catalog sentences, the student's own entries, and cited facts
 * (never an internal field); the rate kind under Compare's estimate; the numbers card's "most useful missing input"
 * line and when it stays away; every field an estimate can cite is one the pages resolve a citation for; the request
 * carries the profile's core answers and grade; the estimate_shown event has exactly its three properties; the
 * session-refresh matcher covers /api/estimate; and the new components stay clear of server-only code and of the
 * method. Each guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

// estimate.ts is server code written for Next.js: stand in empty modules for `server-only` and the request, and
// resolve `@/` and extensionless imports the way the bundler does (as tests/chances-estimate.test.mts does).
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier === "next/headers")
      return { url: "data:text/javascript,export function cookies(){throw new Error('no request')} export function headers(){throw new Error('no request')}", shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const { estimateContext, estimateMany, estimateWithLikeYou } = await import("../lib/chances/estimate.ts");
const { NOTES, noteText } = await import("../lib/chances/notes.ts");
const { citedPaths, ESTIMATE_FACT_PATHS, hasNumbers, isEstimateFactPath, mostUsefulMissing, panelParts, promptedInput, rateKindText, uncoveredFacts, yourNumbersFrom, yourNumbersList } =
  await import("../lib/chances/what-went-in.ts");
const { parseEstimateRequest } = await import("../lib/chances/estimate-request.ts");
const { POOL_FIELDS } = await import("../lib/chances/pool-rate.ts");
const { MAJOR_FIELDS } = await import("../lib/chances/major-review.ts");
const { FIELDS } = await import("../lib/fields.ts");
const { EVENTS, isDeniedPropertyName, sanitizeProperties } = await import("../lib/analytics.ts");
type EstimateResult = import("../lib/chances/types.ts").EstimateResult;
type EstimateStudent = import("../lib/chances/types.ts").EstimateStudent;
type EstimateNote = import("../lib/chances/types.ts").EstimateNote;

const PURDUE = "243780";
const UT_AUSTIN = "228778";
const BERKELEY = "110635";
const UNC = "199120";

function student(o: Partial<EstimateStudent> = {}): EstimateStudent {
  const gpa = o.gpa ?? null;
  return { gpa, gpaScale: "4.0", gpaRange: gpa !== null ? [gpa, gpa] : null, test: null, satMath: null, actMath: null, classRankPercentile: null, courses: [], state: null, majors: [], round: null, highSchoolId: null, ...o };
}
const note = (key: string, values: EstimateNote["values"] = {}, cite?: string): EstimateNote => (cite ? { key, values, cite } : { key, values });
function result(o: Partial<EstimateResult> = {}): EstimateResult {
  return { unitId: "1", group: "target", label: null, used: [], missing: [], facts: [], notes: [], send: null, moveUp: null, modelVersion: "test", ...o };
}

/* ------------------------------------------------------------------ */
/* Rendering WhatWentIn without a build step                           */
/* ------------------------------------------------------------------ */

const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
const tmp = mkdtempSync(join(tmpdir(), "chances-ui-"));
// The two client-only imports are stood in for: the (i) icons show as empty spans that name the field they cite.
writeFileSync(
  join(tmp, "info-tip.mjs"),
  `import React from ${JSON.stringify(reactUrl)};
export const InfoTip = ({ term }) => React.createElement("span", { "data-term": term });
export const SourceTip = ({ cited }) => React.createElement("span", { "data-cited": cited.path });`,
);
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(reactUrl)};\nexport default ({ href, children }) => React.createElement("a", { href }, children);`);

/** Transpiles a component and wires its imports: the stubs above, the real lib modules, no bundler. */
async function load(rel: string): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const code = outputText
    .replace(/from "@\/components\/ui\/info-tip"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "info-tip.mjs")).href)}`)
    .replace(/from "next\/link"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "link.mjs")).href)}`)
    .replace(/from "@\/(lib\/[^"]+)"/g, (_m, p: string) => `from ${JSON.stringify(pathToFileURL(join(ROOT, `${p}.ts`)).href)}`);
  const file = join(tmp, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The text of every li, p, and h4 in the markup, tags stripped. */
function texts(html: string): string[] {
  return [...html.matchAll(/<(li|p|h4)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => decode(m[2].replace(/<[^>]*>/g, "")).trim());
}
/** Text in the markup that isn't one of the allowed sentences: what a free-text leak would look like. */
const foreignText = (html: string, allowed: string[]) => texts(html).filter((t) => t && !allowed.includes(t));

const mod = (await load("components/chances/WhatWentIn.tsx")) as { WhatWentIn: (p: Record<string, unknown>) => import("react").ReactElement };
const React = (await import("react")).default;
const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(mod.WhatWentIn as never, props as never));

/* ------------------------------------------------------------------ */
/* What went into this estimate                                        */
/* ------------------------------------------------------------------ */

const PURDUE_STUDENT = student({ gpa: 3.85, test: { kind: "sat", score: 1300 }, state: "IN", majors: ["14"], courses: [] });

test("the panel lists the student's entries, the college's facts as catalog sentences with their sources, and the disclaimer", async () => {
  const ctx = await estimateContext(PURDUE_STUDENT);
  const r = estimateMany(PURDUE_STUDENT, [PURDUE], ctx)[PURDUE];
  assert.ok(r, "Purdue is in the dataset");
  const yours = yourNumbersFrom(PURDUE_STUDENT, "3.85");
  const cites = new Set(citedPaths(r));
  const html = render({ result: r, yours, college: "Purdue", cite: (p: string) => (cites.has(p) ? { path: p } : undefined) });

  const parts = panelParts(r);
  const yourLine = noteText({ key: "estimate.your_numbers", values: { list: yourNumbersList(yours, r.used).join(" · ") } });
  assert.match(yourLine, /^Your numbers: GPA 3\.85 · SAT 1300/);
  assert.ok(texts(html).includes(yourLine), "the student's entries");
  for (const n of parts.reasons) assert.ok(texts(html).includes(noteText(n)), `a reason: ${n.key}`);
  assert.ok(texts(html).includes(noteText({ key: "estimate.disclaimer", values: { college: "Purdue" } })), "the standing disclaimer");
  if (parts.prompt) assert.ok(texts(html).includes(noteText(parts.prompt)), "the missing-input prompt");
  // A source beside each fact whose note cites one, and the glossary term for the estimate.
  for (const n of parts.reasons) if (n.cite) assert.match(html, new RegExp(`data-cited="${n.cite.replace(/\./g, "\\.")}"`), `a source for ${n.cite}`);
  assert.match(html, /data-term="quads-estimate"/);
});

test("the panel holds only catalog sentences, headings, and the student's own entries, and none of the estimate's internal fields", async () => {
  const ctx = await estimateContext(PURDUE_STUDENT);
  const results = estimateMany(PURDUE_STUDENT, [PURDUE, UT_AUSTIN, BERKELEY, UNC], ctx);
  const yours = yourNumbersFrom(PURDUE_STUDENT, "3.85");
  for (const [id, r] of Object.entries(results)) {
    const html = render({ result: r, yours, college: "The College", cite: () => undefined });
    const parts = panelParts(r);
    const also = uncoveredFacts(r);
    const allowed = [
      noteText({ key: "estimate.panel_title", values: {} }),
      noteText({ key: "estimate.your_numbers", values: { list: yourNumbersList(yours, r.used).join(" · ") } }),
      noteText({ key: "estimate.panel_college", values: { college: "The College" } }),
      ...parts.reasons.map(noteText),
      ...parts.notUsed.map(noteText),
      ...(parts.prompt ? [noteText(parts.prompt)] : []),
      noteText({ key: "estimate.disclaimer", values: { college: "The College" } }),
      ...(also.length ? [`${noteText({ key: "estimate.panel_also", values: {} })}: ${also.map((f) => f.label).join(" · ")}`] : []),
    ];
    assert.deepEqual(foreignText(html, allowed), [], `${id}: no text beyond the catalog`);
    // None of the result's internals, and no machine-looking key, in the markup.
    assert.doesNotMatch(html, /modelVersion|moveUp|unitId|"send"|detail|crowded|cutoff|threshold|estimate\.[a-z_.]+|\bnull\b|undefined|\[object/i, `${id}: no internal field`);
  }
});

test("guard: foreignText catches a sentence the catalog doesn't have, and a panel that adds one fails the check", async () => {
  const ctx = await estimateContext(PURDUE_STUDENT);
  const r = estimateMany(PURDUE_STUDENT, [PURDUE], ctx)[PURDUE];
  const html = render({ result: r, yours: null, college: "Purdue", cite: () => undefined });
  const allowed = [
    noteText({ key: "estimate.panel_title", values: {} }),
    noteText({ key: "estimate.panel_college", values: { college: "Purdue" } }),
    ...panelParts(r).reasons.map(noteText),
    ...(panelParts(r).prompt ? [noteText(panelParts(r).prompt!)] : []),
    noteText({ key: "estimate.disclaimer", values: { college: "Purdue" } }),
    ...(uncoveredFacts(r).length ? [`${noteText({ key: "estimate.panel_also", values: {} })}: ${uncoveredFacts(r).map((f) => f.label).join(" · ")}`] : []),
  ];
  assert.deepEqual(foreignText(html, allowed), []);
  const doctored = html.replace("</section>", "<p>Your chance is 62%</p></section>");
  assert.deepEqual(foreignText(doctored, allowed), ["Your chance is 62%"]);
});

test("a result with a note key the catalog doesn't have renders nothing for it (never free text)", () => {
  const r = result({ used: ["gpa"], notes: [note("estimate.made_up", { x: "Your chance is high" }), note("estimate.score_inside", { test: "SAT" })] });
  const html = render({ result: r, yours: null, college: "X", cite: () => undefined });
  assert.doesNotMatch(html, /Your chance|made_up/);
  assert.match(html, /Your SAT is inside the middle 50%/);
});

test("the panel sorts a result: label, stage lines, reasons, what isn't used, and one prompt", () => {
  const r = result({
    notes: [
      note("estimate.reach_for_everyone", {}, "admissions.acceptance_rate"),
      note("estimate.academics", { position: "in the middle of admitted students" }),
      note("estimate.pool", { pool: "11% of applicants were admitted" }, "admissions.acceptance_rate"),
      note("estimate.score_inside", { test: "SAT" }, "derived.sat_total"),
      note("estimate.not_used", { input: "class rank", college: "X" }, "reported.admission_profile.factors.class_rank"),
      note("estimate.missing_courses"),
    ],
  });
  const p = panelParts(r);
  assert.equal(p.label?.key, "estimate.reach_for_everyone");
  assert.deepEqual(p.stages.map((n) => n.key), ["estimate.academics", "estimate.pool"]);
  assert.deepEqual(p.reasons.map((n) => n.key), ["estimate.score_inside"]);
  assert.deepEqual(p.notUsed.map((n) => n.key), ["estimate.not_used"]);
  assert.equal(p.prompt?.key, "estimate.missing_courses");
});

test("the student's side names only the inputs the estimate used", () => {
  const s = student({ gpa: 3.85, test: { kind: "sat", score: 1300 }, classRankPercentile: 10, state: "IN", majors: ["14"] });
  const y = yourNumbersFrom(s, "3.85");
  assert.deepEqual(yourNumbersList(y, ["gpa", "test", "state"]), ["GPA 3.85", "SAT 1300", "Indiana resident"]);
  assert.deepEqual(yourNumbersList(y, ["gpa"]), ["GPA 3.85"], "a test the estimate didn't use isn't listed");
  assert.deepEqual(yourNumbersList(y, []), []);
  assert.ok(yourNumbersList(y, ["class_rank"])[0].includes("top 10%"));
  assert.equal(hasNumbers(student()), false);
  assert.equal(hasNumbers(student({ gpa: 3.2 })), true);
  assert.equal(hasNumbers(student({ test: { kind: "act", score: 30 } })), true);
});

/* ------------------------------------------------------------------ */
/* The numbers card's most useful missing input                        */
/* ------------------------------------------------------------------ */

const asks = (input: string, missing: EstimateResult["missing"]) => result({ missing, notes: [note("estimate.missing_input", { input })] });

test("the numbers card names the one input that would sort the most colleges", () => {
  const rank = asks("class rank", ["class_rank"]);
  const line = mostUsefulMissing([rank, rank, asks("state", ["state"]), result()]);
  assert.ok(line);
  assert.equal(noteText(line), "Adding your class rank would sort 2 more colleges.");
  assert.equal(noteText(mostUsefulMissing([rank])!), "Adding your class rank would sort 1 more college.");
  assert.equal(noteText(mostUsefulMissing([result({ missing: ["courses"], notes: [note("estimate.missing_courses")] })])!), "Adding your courses would sort 1 more college.");
  // A tie goes to courses first.
  assert.match(noteText(mostUsefulMissing([rank, result({ missing: ["courses"], notes: [note("estimate.missing_courses")] })])!), /courses/);
});

test("the line stays away when no input would change a group", () => {
  assert.equal(mostUsefulMissing([]), null);
  assert.equal(mostUsefulMissing([result({ group: "likely", label: "guaranteed", notes: [note("estimate.guaranteed", { program: "P" })] })]), null);
  // An input the estimate asks for but doesn't list as missing doesn't count.
  assert.equal(mostUsefulMissing([result({ missing: [], notes: [note("estimate.missing_input", { input: "class rank" })] })]), null);
  // A prompt naming a word the catalog's inputs don't have names no input.
  assert.equal(promptedInput(result({ notes: [note("estimate.missing_input", { input: "shoe size" })] })), null);
});

test("guard: a line built without the missing check would name an input the estimate doesn't list", () => {
  const unlisted = result({ missing: [], notes: [note("estimate.missing_input", { input: "class rank" })] });
  assert.equal(mostUsefulMissing([unlisted]), null);
  assert.equal(promptedInput(unlisted), "class_rank", "the prompt alone would have counted it: the missing list is what stops that");
});

test("across real colleges the line is either absent or names an input a college actually asked for", async () => {
  const s = student({ gpa: 3.85, test: { kind: "sat", score: 1300 }, state: "IN" });
  const ctx = await estimateContext(s);
  const ids = [PURDUE, UT_AUSTIN, BERKELEY, UNC];
  const results = Object.values(estimateMany(s, ids, ctx));
  const line = mostUsefulMissing(results);
  if (line) {
    const input = String(line.values.input);
    assert.ok(results.some((r) => r.notes.some((n) => n.values.input === input || (input === "courses" && n.key === "estimate.missing_courses"))));
    assert.ok(Number(line.values.count) >= 1 && Number(line.values.count) <= ids.length);
  }
});

/* ------------------------------------------------------------------ */
/* Compare's row                                                       */
/* ------------------------------------------------------------------ */

test("Compare names the rate under each estimate: in-state, guaranteed, the major's, the overall", async () => {
  const s = student({ gpa: 3.85, test: { kind: "sat", score: 1300 }, state: "IN" });
  const ctx = await estimateContext(s);
  const purdue = estimateMany(s, [PURDUE], ctx)[PURDUE];
  assert.equal(rateKindText(purdue), "in-state rate");
  assert.equal(rateKindText(result({ label: "guaranteed", notes: [note("estimate.guaranteed", { program: "P" })] })), "guaranteed");
  assert.equal(rateKindText(result({ notes: [note("estimate.pool", { pool: "x" }, "reported.major_admission.admit_rate")] })), "rate for your major");
  assert.equal(rateKindText(result({ notes: [note("estimate.pool", { pool: "x" }, "admissions.acceptance_rate")] })), "overall rate");
  assert.equal(rateKindText(result({ notes: [note("estimate.pool", { pool: "x" }, "derived.admit_rate_out_of_state")] })), "out-of-state rate");
  assert.equal(rateKindText(result({ notes: [] })), null, "an estimate with no pool line names no rate");
});

test("Compare's row is a block on the admissions page for the signed-in student only, with the glossary term", () => {
  const page = read("app", "compare", "admissions", "page.tsx");
  assert.match(page, /<CompareStanding\b/);
  const comp = read("components", "compare", "CompareStanding.tsx");
  assert.match(comp, /!mine\.signedIn \|\| !mine\.hasNumbers/, "nothing for a visitor or a student without numbers");
  assert.match(comp, /rateKindText\(/);
  assert.match(comp, /term="quads-estimate"/);
  assert.doesNotMatch(comp, /chances\/(model|estimate)["'.]/);
});

/* ------------------------------------------------------------------ */
/* Every fact an estimate cites has a citation the pages resolve       */
/* ------------------------------------------------------------------ */

test("the cited-field list matches the pool's and the major's constants and is made of registered fields", () => {
  for (const p of [...Object.values(POOL_FIELDS), ...Object.values(MAJOR_FIELDS)]) assert.ok(isEstimateFactPath(p), `${p} is listed`);
  for (const p of ESTIMATE_FACT_PATHS) assert.ok(p in FIELDS, `${p} is a registered field`);
  assert.equal(new Set(ESTIMATE_FACT_PATHS).size, ESTIMATE_FACT_PATHS.length, "no duplicates");
});

test("every field a real estimate cites, across students and colleges, is in the list the pages resolve", async () => {
  const students: EstimateStudent[] = [
    student({ gpa: 3.85, test: { kind: "sat", score: 1300 }, state: "IN", majors: ["14"] }),
    student({ gpa: 3.4, test: { kind: "act", score: 27 }, classRankPercentile: 10, state: "TX", majors: ["11"] }),
    student({ gpa: 3.95, gpaRange: [3.4, 4], test: { kind: "sat", score: 1550 }, classRankPercentile: 3, state: "CA", majors: ["52"], round: "ed" }),
    student({ gpa: 2.9, state: "NC" }),
    student({ test: { kind: "sat", score: 1100 }, state: "OUTSIDE_US" }),
  ];
  const { getData } = await import("../lib/data.ts");
  const ids = (await getData()).getAllSchools().map((sc) => sc.unit_id).filter((_, i) => i % 9 === 0);
  const seen = new Set<string>();
  for (const s of students) {
    const ctx = await estimateContext(s);
    for (const r of Object.values(estimateMany(s, ids, ctx))) for (const p of citedPaths(r)) seen.add(p);
  }
  assert.ok(seen.size > 8, "the sweep reaches a good spread of fields");
  assert.deepEqual([...seen].filter((p) => !isEstimateFactPath(p)), [], "a cited field outside the list would show a fact with no source");
});

test("guard: a field outside the list is caught", () => {
  assert.equal(isEstimateFactPath("cost.sticker"), false);
  assert.equal(isEstimateFactPath("admissions.acceptance_rate"), true);
});

test("the plan loader resolves the citations its estimates name and the college page resolves the whole list", () => {
  assert.match(read("lib", "planner", "load.ts"), /withFactCites\(ctx\.schools, estimates\)/);
  const section = read("components", "chances", "StandingSection.tsx");
  assert.match(section, /estimateFactCites\(school, citeField\)/);
  assert.match(section, /majorUnitCites\(school, citeField\)/);
});

/* ------------------------------------------------------------------ */
/* The request carries what the server load passes                     */
/* ------------------------------------------------------------------ */

test("the request carries the core answers and the grade, sanitized, and likeYou only for one college", () => {
  const body = { student: {}, unitIds: [PURDUE], context: { coreAtTopLevel: { 9: { english: true, junk: 1 } }, grade: 11 }, likeYou: true };
  const ok = parseEstimateRequest(body, { signedIn: false });
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.request.context.grade, 11);
  assert.ok(ok.request.context.coreAtTopLevel, "the core answers arrive (sanitized)");
  assert.equal(ok.request.likeYou, true);
  const many = parseEstimateRequest({ ...body, unitIds: [PURDUE, UT_AUSTIN] }, { signedIn: false });
  assert.ok(many.ok && many.request.likeYou === false, "students-like-you is for a single college");
  const bad = parseEstimateRequest({ ...body, context: { grade: 14, coreAtTopLevel: "x" } }, { signedIn: false });
  assert.ok(bad.ok && bad.request.context.grade === null);
  const none = parseEstimateRequest({ student: {}, unitIds: [PURDUE] }, { signedIn: false });
  assert.ok(none.ok && none.request.context.grade === null && none.request.context.coreAtTopLevel === null && none.request.likeYou === false);
});

test("NumbersForm's live preview sends the core answers and the student's grade, as the server load does", () => {
  const hook = read("components", "planner", "useEstimates.ts");
  assert.match(hook, /JSON\.stringify\(\{ student, unitIds, context \}\)/);
  assert.match(hook, /gradeNow\(gradYear/);
  assert.match(hook, /coreAtTopLevel: profile\?\.academics\.coreAtTopLevel/);
  assert.match(read("components", "planner", "NumbersForm.tsx"), /useEstimates\(draftProfile, unitIds, view\.estimates, \{ gradYear: ctx\.student\?\.grad_year/);
  assert.match(read("app", "api", "estimate", "route.ts"), /estimateContext\(student, context\)/);
  // The route and the loader pass the same two extras to the same function.
  assert.match(read("lib", "planner", "plan-estimates.ts"), /estimateContext\(input, \{ coreAtTopLevel: profile\?\.academics\.coreAtTopLevel \?\? null, grade: gradeNow\(/);
});

test("students like you: nothing without outcome data, and the route answers it only for a single college", async () => {
  const had = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    const s = student({ gpa: 3.85, test: { kind: "sat", score: 1300 }, state: "IN" });
    const ctx = await estimateContext(s);
    const out = await estimateWithLikeYou({ student: s, unitId: PURDUE }, ctx);
    assert.ok(out.result.group);
    assert.equal(out.likeYou, null, "no database, no count");
  } finally {
    if (had.url !== undefined) process.env.SUPABASE_URL = had.url;
    if (had.key !== undefined) process.env.SUPABASE_PUBLISHABLE_KEY = had.key;
  }
  const route = read("app", "api", "estimate", "route.ts");
  assert.match(route, /likeYou && !counterfactual/);
  assert.doesNotMatch(route, /estimateWithDetail|\.detail\b|chances\/model/, "the method's details stay inside the estimate module");
  assert.match(noteText({ key: "estimate.like_you", values: { n: 63, admitted: 47, college: "Purdue", from: " from Indiana" } }), /^Of 63 students on Quad with numbers like yours who applied to Purdue from Indiana in the last three seasons, 47 were admitted\.$/);
});

/* ------------------------------------------------------------------ */
/* Sessions refresh on /api/estimate                                   */
/* ------------------------------------------------------------------ */

function proxyMatcher(src: string): string[] {
  const block = src.match(/matcher:\s*\[([^\]]*)\]/);
  assert.ok(block, "proxy.ts must export config.matcher as a literal array");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("the session-refresh matcher includes /api/estimate, so an expired session doesn't read as signed out there", () => {
  const src = read("proxy.ts");
  assert.ok(proxyMatcher(src).includes("/api/estimate"));
  assert.equal(proxyMatcher(src.replace('"/api/estimate", ', "")).includes("/api/estimate"), false, "guard: the check fails when the entry is removed");
});

/* ------------------------------------------------------------------ */
/* Telemetry                                                           */
/* ------------------------------------------------------------------ */

test("estimate_shown is registered with the group, the label, and the model version, and nothing else", () => {
  assert.deepEqual([...EVENTS.estimate_shown.properties], ["group", "label", "model_version"]);
  assert.equal(EVENTS.estimate_shown.side, "client");
  for (const p of EVENTS.estimate_shown.properties) assert.equal(isDeniedPropertyName(p), false, p);
  // Anything beyond the three is dropped, including the student's numbers.
  const kept = sanitizeProperties("estimate_shown", { group: "target", label: "none", model_version: "20261011.1", gpa: 3.9, sat: 1300, unit_id: PURDUE, state: "IN" });
  assert.deepEqual(kept, { group: "target", label: "none", model_version: "20261011.1" });
  assert.match(read("specs", "product", "telemetry.md"), /`estimate_shown` \(`group`.*`label`.*`model_version`\)/);
});

test("the places that report an estimate send exactly those three and nothing from the student", () => {
  for (const f of ["components/chances/StandingCard.tsx", "components/planner/RowDrawer.tsx"]) {
    const src = read(f);
    const calls = [...src.matchAll(/track\("estimate_shown",\s*\{([^}]*)\}/g)];
    assert.equal(calls.length, 1, f);
    assert.deepEqual(
      calls[0][1].split(",").map((kv) => kv.split(":")[0].trim()),
      ["group", "label", "model_version"],
      f,
    );
    assert.doesNotMatch(calls[0][1], /gpa|score|student|yours|state|major|rank/i);
  }
  // The chip and Compare don't report: one report per estimate seen, from the card and the drawer.
  assert.doesNotMatch(read("components/chances/StandingChip.tsx"), /track\(/);
});

/* ------------------------------------------------------------------ */
/* The pages use the pieces                                            */
/* ------------------------------------------------------------------ */

test("the chip is in the profile hero and on the overview's admissions card; the card sits on the admissions page with its anchor", () => {
  assert.match(read("app", "schools", "[id]", "page.tsx"), /<StandingChip unitId=\{school\.unit_id\} \/>/);
  assert.match(read("components", "profile", "AdmissionsCard.tsx"), /<StandingChip unitId=\{school\.unit_id\}/);
  const admissions = read("app", "schools", "[id]", "admissions", "page.tsx");
  assert.match(admissions, /<StandingSection school=\{school\} id="standing"/);
  assert.match(admissions, /\{ id: "standing", label: "Where you stand" \}/);
  assert.match(read("components", "chances", "StandingChip.tsx"), /#standing/);
  // The chip, the card, and the panel link the glossary.
  for (const f of ["StandingChip", "StandingCard", "StandingSection", "WhatWentIn"]) assert.match(read("components", "chances", `${f}.tsx`), /quads-estimate/, f);
  // The existing score checker stays where it was.
  assert.match(admissions, /<ScoreChecker\b/);
});

test("the signed-out card keeps the save prompt and the major picker; the picker keeps its pick with the profile in the browser", () => {
  const card = read("components", "chances", "StandingCard.tsx");
  assert.match(card, /estimate\.save_prompt/);
  assert.match(card, /SignedOutMajor/);
  assert.match(card, /useLocalProfile\(\)/);
  assert.match(card, /intendedMajors: isMajorFamily\(family\)/);
  assert.match(card, /estimate\.like_you/);
  assert.match(card, /CAVEATS/);
  for (const k of ["holistic", "enrolled", "hooked", "afford"]) assert.ok(`estimate.caveat.${k}` in NOTES);
});

test("the row drawer shows the stage lines and the panel from the row's estimate and links to how the college reads a record", () => {
  const drawer = read("components", "planner", "RowDrawer.tsx");
  assert.match(drawer, /<WhatWentIn result=\{estimate\}/);
  assert.match(drawer, /panelParts\(estimate\)/);
  assert.match(drawer, /\/schools\/\$\{school\.unit_id\}\/admissions#factors/);
  assert.match(drawer, /How \{school\.name\} reads a record/);
  assert.match(read("lib", "planner", "plan-view.ts"), /estimate: school \? est : null/);
});

test("the numbers card and the signed-out plan show the most useful missing input", () => {
  assert.match(read("components", "planner", "PlanHeaderCard.tsx"), /<MostUsefulInput estimates=\{view\.estimates\}/);
  assert.match(read("components", "planner", "SignedOutPlan.tsx"), /<MostUsefulInput estimates=\{estimates\}/);
  assert.match(read("components", "chances", "MostUsefulInput.tsx"), /mostUsefulMissing\(Object\.values\(estimates\)\)/);
});

test("the rigor line ties the college's rating to how common a high GPA is, from the shared share and the catalog sentence", () => {
  assert.match(read("components", "school", "RigorLine.tsx"), /key: "rigor\.college_tie"/);
  const panel = read("components", "school", "GpaPanel.tsx");
  assert.match(panel, /gpaTopShare\(school\)/);
  assert.match(panel, /isWeightedReporter\(school\)/);
  assert.match(panel, /derived\.gpa_top_share/);
  assert.equal(noteText({ key: "rigor.college_tie", values: { college: "Purdue", rating: "very important", share: "71%" } }), "Purdue rates course rigor very important, and 71% of its first-years had a 3.75 or higher.");
});

test("What you'll need in high school adds the intended major's required courses beside the college-wide units", () => {
  const table = read("components", "school", "HsPrepTable.tsx");
  assert.match(table, /majorReviewFor\(/);
  assert.match(table, /unitRequires/);
  assert.match(table, /major\.required_/);
  assert.match(read("components", "school", "HsPrepBox.tsx"), /majorUnitCites\(school, cite\)/);
});

/* ------------------------------------------------------------------ */
/* The proprietary rule, and server-only code stays on the server      */
/* ------------------------------------------------------------------ */

const NEW_UI = [
  "components/chances/WhatWentIn.tsx",
  "components/chances/StandingCard.tsx",
  "components/chances/StandingChip.tsx",
  "components/chances/StandingBadge.tsx",
  "components/chances/StandingSection.tsx",
  "components/chances/MajorLines.tsx",
  "components/chances/MostUsefulInput.tsx",
  "components/chances/useStanding.ts",
  "components/compare/CompareStanding.tsx",
  "lib/chances/what-went-in.ts",
  "lib/chances/fact-cites.ts",
  "lib/chances/standing-store.ts",
];

test("the new components and helpers never import the method, the estimate, or the rigor rules, and spell no year or threshold", () => {
  for (const f of NEW_UI) {
    const src = read(f);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /from\s+["'][^"']*chances\/(model|estimate|rigor-rules|rigor|rigor-server|baseline)["']/, `${f} reaches server-only code`);
    // No data year written in a component: years come from lineage and the sentences' values.
    assert.doesNotMatch(code, /\b(19|20)\d\d\b/, `${f} writes a year`);
    assert.doesNotMatch(code, /\b(top|above|below|at least|under|over)\s+\d/i, `${f} spells a threshold`);
  }
});

test("the sentences the display added hold no number, threshold, or weight", () => {
  const added = Object.keys(NOTES).filter((k) => /^(estimate\.(panel_|card_|label\.|save_prompt|add_numbers|unavailable|caveat\.|compare_)|major\.(pick_|no_statement))/.test(k));
  assert.ok(added.length >= 12);
  for (const k of added) {
    const text = NOTES[k]({ college: "X", group: "Target" });
    assert.doesNotMatch(text, /\d/, `${k} has a digit: ${text}`);
    assert.doesNotMatch(text, /weight|threshold|cutoff|score of|percent/i, k);
  }
});

/** Files reachable from a root by relative and `@/` imports, stopping at "use server" modules (the browser gets a call stub). */
function reach(roots: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const resolveImport = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? relative(ROOT, resolve(ROOT, dirname(from), spec)) : null;
    if (base === null) return null;
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base.replace(/\.js$/, ".ts")]) if (existsSync(join(ROOT, cand)) && statSync(join(ROOT, cand)).isFile()) return cand;
    return null;
  };
  const visit = (file: string, text: string) => {
    if (out.has(file)) return;
    out.set(file, text);
    if (/^\s*["']use server["']/.test(text)) return;
    // Type-only imports are erased and put nothing in a bundle.
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveImport(file, m[1] ?? m[2]);
      if (target) visit(target, readFileSync(join(ROOT, target), "utf8"));
    }
  };
  for (const r of roots) visit(r, read(r));
  return out;
}
const serverOnly = (files: Map<string, string>) => [...files].filter(([, t]) => /^import "server-only";/m.test(t)).map(([f]) => f);

test("nothing the new client components import is server-only code (Server Actions are call stubs)", () => {
  const shared = ["WhatWentIn.tsx", "StandingBadge.tsx", "MajorLines.tsx", "MostUsefulInput.tsx"]; // no directive: they ship wherever a client component imports them
  const touched = [
    "components/school/HsPrepTable.tsx",
    "components/school/RigorLine.tsx",
    "components/planner/RowDrawer.tsx",
    "components/planner/PlanHeaderCard.tsx",
    "components/planner/SignedOutPlan.tsx",
    "components/planner/useEstimates.ts",
  ];
  const clients = [...NEW_UI.filter((f) => /^\s*["']use client["']/.test(read(f)) || shared.some((s) => f.endsWith(s))), ...touched];
  assert.ok(clients.length >= 10);
  const reached = reach(clients.filter((f) => f !== "lib/chances/standing-store.ts"));
  assert.deepEqual(serverOnly(reached), []);
  // The Server Action itself is "use server", so what it imports stays behind it.
  assert.match(read("lib/chances/standing-store.ts"), /^"use server";/);
  // Guard: a client file that imported the estimate would be flagged.
  const bad = reach(["components/chances/WhatWentIn.tsx"]);
  bad.set("lib/chances/estimate.ts", read("lib/chances/estimate.ts"));
  assert.ok(serverOnly(bad).includes("lib/chances/estimate.ts"), "the check sees a server-only module");
});

test("the client bundle for the page code stays off the curated files' heavy neighbors (no client import of the model's data)", () => {
  const reached = reach(["components/chances/StandingCard.tsx", "components/chances/StandingChip.tsx", "components/school/HsPrepTable.tsx"]);
  for (const f of reached.keys()) assert.doesNotMatch(f, /lib\/chances\/(model|estimate|rigor-rules)\.ts$/, f);
});

test("every file in components/chances is listed by this suite's guards", () => {
  const dir = join(ROOT, "components", "chances");
  const files = readdirSync(dir).map((f) => `components/chances/${f}`);
  for (const f of files) assert.ok(NEW_UI.includes(f), `${f} is not in NEW_UI: add it so the guards cover it`);
});
