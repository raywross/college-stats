/**
 * The advisor's RSC payload, measured offline (round 4, U3; specs/serving-architecture.md "Left, after this PR"): renders
 * `PlanFrame` (components/planner/PlanFrame.tsx) for a plan built from the bundled snapshot (the mini fixture in a fresh
 * checkout) through React's own Flight server, the serializer Next uses for a page's payload, and prints its bytes and
 * gzipped bytes per opening tab, with and without the Essays tab's data. Also prints the list page's rows
 * (components/lists/ListPage.tsx `boardItems`' school facts) as JSON, with full citations and with references.
 *
 * Every "use client" module becomes a client reference (what the payload names, not what it runs); the server
 * components run for real. No database, no session: the plan is generated from the snapshot (a senior with N colleges,
 * the generators' moves, a few drafts). The numbers are this fixture's, not a real student's; compare runs, not pages.
 *
 *   NODE_ENV=production node --conditions=react-server --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     scripts/measure-plan-payload.mts [colleges=15]
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import * as nodeModule from "node:module";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");
const require = createRequire(join(ROOT, "package.json"));
const NODE_MODULES = realpathSync(join(ROOT, "node_modules"));
const NEXT = join(NODE_MODULES, "next", "dist", "compiled");
const FLIGHT = join(NEXT, "react-server-dom-webpack", "cjs", "react-server-dom-webpack-server.node.production.js");

type ResolveResult = { url: string; shortCircuit?: boolean; format?: string };
type LoadResult = { format: string; source: string | Buffer; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(s: string, c: { parentURL?: string; conditions?: string[] }, n: (s: string, c?: unknown) => ResolveResult): ResolveResult;
    load(u: string, c: { format?: string }, n: (u: string, c?: unknown) => LoadResult): LoadResult;
  }): void;
};

/** React and React DOM as Next's server layer loads them (the react-server builds Next ships). */
const REACT: Record<string, string> = {
  react: join(NEXT, "react", "react.react-server.js"),
  "react/jsx-runtime": join(NEXT, "react", "jsx-runtime.react-server.js"),
  "react/jsx-dev-runtime": join(NEXT, "react", "jsx-dev-runtime.react-server.js"),
  "react-dom": join(NEXT, "react-dom", "react-dom.react-server.js"),
  "next/dist/compiled/react": join(NEXT, "react", "react.react-server.js"),
};

/** A module whose every export answers null (or the given body): the session and the household reads. */
function stubAll(rel: string, bodies: Record<string, string>): string {
  const file = join(ROOT, rel);
  return exportNames(file, readFileSync(file, "utf8"))
    .map((n) => `export const ${n} = ${bodies[n] ?? "async () => null"};`)
    .join("\n");
}

/** Modules that would reach the database, the session, or the request: none here. */
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  // A database that answers every query with no rows (the Offers stage, opened without the load's data, reads itself).
  "@/lib/supabase-server": "const q = { select: () => q, in: () => q, eq: () => q, order: () => q, maybeSingle: async () => ({ data: null, error: null }), then: (f) => Promise.resolve({ data: [], error: null }).then(f) }; export async function createServerSupabase(){ return { from: () => q }; } export function supabaseAuthEnv(){ return null; }",
  "@/lib/essays/overrides": "export async function readEssayOverrides(){ return new Map(); } export function withOverride(s){ return s; }",
  "@/lib/analytics-server": "export async function trackServer(){}",
  "@/lib/app-settings": "export async function appSettings(){ return null; } export async function plannerToday(){ return null; }",
  "@/lib/households": stubAll("lib/households.ts", {}),
  "@/lib/auth": stubAll("lib/auth.ts", { getUser: "async () => ({ id: 'u-guardian' })", authConfigured: "() => true" }),
  // The asks notice renders from the load's read since round 5, but its list imports the org Server Actions: a stand-in
  // (a few hundred bytes per ask; the fixture has none). The Offers stage runs for real, from the data handed to it.
  "@/components/org/AskNotice": "export function AskNotice(){ return null; }",
};
const STUB_URL = (name: string) => `file:///__measure_stubs__/${name.replace(/[^a-z]/gi, "_")}.mjs`;
const STUB_SOURCES = new Map(Object.entries(STUBS).map(([k, v]) => [STUB_URL(k), v]));

const asFile = (b: string) => [b, `${b}.ts`, `${b}.tsx`, join(b, "index.ts"), join(b, "index.tsx")].find((c) => existsSync(c) && /\.(m?[jt]sx?)$/.test(c)) ?? null;

/** The export names of a "use client" module (what a client reference stands for). */
function exportNames(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const names: string[] = [];
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? (ts.getModifiers(st) ?? []) : [];
    const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isExportAssignment(st)) names.push("default");
    else if (exported && isDefault) names.push("default");
    else if (exported && (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) names.push(st.name.text);
    else if (exported && ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
    } else if (ts.isExportDeclaration(st) && !st.isTypeOnly && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) if (!e.isTypeOnly) names.push(e.name.text);
    }
  }
  return [...new Set(names)];
}

/** Whether the module's directive prologue (past any comments) holds "use client". */
function isClientModule(src: string): boolean {
  let i = 0;
  for (;;) {
    while (i < src.length && /[\s;]/.test(src[i])) i++;
    if (src.startsWith("/*", i)) i = src.indexOf("*/", i + 2) + 2;
    else if (src.startsWith("//", i)) i = src.indexOf("\n", i) + 1;
    else if (src.startsWith('"use client"', i) || src.startsWith("'use client'", i)) return true;
    else if (src[i] === '"' || src[i] === "'") i = src.indexOf(src[i], i + 1) + 1;
    else return false;
    if (i <= 1) return false;
  }
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: STUB_URL(specifier), shortCircuit: true, format: "module" };
    if (specifier in REACT) return { url: pathToFileURL(REACT[specifier]).href, shortCircuit: true };
    // next/link and next/image are client components in Next's own build: client references here too.
    if (specifier === "next/link" || specifier === "next/image") return { url: pathToFileURL(join(ROOT, `__measure_${specifier.slice(5)}__.tsx`)).href, shortCircuit: true };
    if (specifier === "lucide-react") return { url: pathToFileURL(join(NODE_MODULES, "lucide-react", "dist", "esm", "lucide-react.mjs")).href, shortCircuit: true };
    let b: string | null = null;
    if (specifier.startsWith("@/")) b = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !context.parentURL.includes("/node_modules/"))
      b = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const file = b ? asFile(b) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);
    if (context.parentURL && STUB_SOURCES.has(context.parentURL)) return next(specifier, { ...context, parentURL: pathToFileURL(join(ROOT, "package.json")).href });
    return next(specifier, context);
  },
  load(url, context, next) {
    const stub = STUB_SOURCES.get(url);
    if (stub) return { format: "module", source: stub, shortCircuit: true };
    const nextClient = /\/__measure_(link|image)__\.tsx$/.exec(url);
    if (nextClient) return { format: "module", source: clientRefModule(`next/${nextClient[1]}`, ["default"]), shortCircuit: true };
    // lucide-react's ESM build marks its Icon "use client", as Next's bundler sees it: an icon is a client reference.
    if (url.includes("/node_modules/lucide-react/") && url.endsWith(".mjs")) {
      const file = fileURLToPath(url);
      const src = readFileSync(file, "utf8");
      if (isClientModule(src)) return { format: "module", source: clientRefModule(file.slice(ROOT.length + 1), exportNames(file, src)), shortCircuit: true };
      return next(url, context);
    }
    if (url.startsWith("file:") && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
      const file = fileURLToPath(url);
      const src = readFileSync(file, "utf8");
      if (isClientModule(src)) return { format: "module", source: clientRefModule(file.slice(ROOT.length + 1), exportNames(file, src)), shortCircuit: true };
      // Node strips a .ts file's types itself; only JSX needs the compiler.
      if (file.endsWith(".ts")) return next(url, context);
      const { outputText } = ts.transpileModule(src, {
        fileName: file,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});

function clientRefModule(id: string, names: string[]): string {
  const lines = [`import { createRequire } from "node:module";`, `const F = createRequire(${JSON.stringify(join(ROOT, "package.json"))})(${JSON.stringify(FLIGHT)});`];
  const ref = (n: string) => `F.registerClientReference(function () { throw new Error("client only"); }, ${JSON.stringify(id)}, ${JSON.stringify(n)})`;
  for (const n of names) lines.push(n === "default" ? `export default ${ref(n)};` : `export const ${n} = ${ref(n)};`);
  return lines.join("\n");
}

const Flight = require(FLIGHT) as {
  renderToPipeableStream(model: unknown, config: unknown, opts?: { onError?: (e: unknown) => void }): { pipe(w: Writable): void };
};
/** Any client reference resolves to a module of its own (no chunks): what matters is the bytes the payload carries. */
const manifest = new Proxy({}, { get: (_t, key: string) => ({ id: key.split("#")[0], chunks: [], name: key.split("#")[1] ?? "*" }) });

async function flightBytes(element: unknown): Promise<{ raw: number; gz: number }> {
  const chunks: Buffer[] = [];
  await new Promise<void>((done, fail) => {
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
      final(cb) {
        cb();
        done();
      },
    });
    Flight.renderToPipeableStream(element, manifest, { onError: (e) => fail(e) }).pipe(sink);
  });
  const all = Buffer.concat(chunks);
  return { raw: all.length, gz: gzipSync(all).length };
}

/* ------------------------------------------------------------------ */
/* A plan from the snapshot                                            */
/* ------------------------------------------------------------------ */

const React = (await import("react")).default;
const { getData } = await import("../lib/data.ts");
const { generatorInputFor, planContextFrom } = await import("../lib/planner/context.ts");
const { generateTasks, mergeTasks, applyMerge } = await import("../lib/planner/tasks.ts");
const { planView } = await import("../lib/planner/plan-view.ts");
const { emptyProfile } = await import("../lib/student-profile.ts");
const { essaysTabData } = await import("../lib/essays/tab-data.ts");
const { PlanFrame } = await import("../components/planner/PlanFrame.tsx");
const { PLAN_TABS } = await import("../lib/planner/plan-tabs.ts");
const { citeRefOf } = await import("../lib/lineage.ts");
const { DEFAULT_UNITS } = await import("./build-mini-fixture.mts");

const N = Number(process.argv[2] ?? 15);
const TODAY = "2026-11-08";
const GRAD = 2027;
const data = await getData();
const units = DEFAULT_UNITS.filter((id) => data.getSchoolById(id)).slice(0, N);
const LIST = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const items = units.map((unit_id, i) => ({
  id: `item-${unit_id}`, list_id: LIST, unit_id, category: null, category_source: "auto", round: null, round_source: "auto", status: i < 3 ? "applying" : "considering",
  outcome: null, position: i, added_by: null, added_at: "2026-06-01", decision_date: null, deadline_text: null, deadline_date: null, enrolling: false, updates: true,
  visited_on: null, follows_social: false, application_platform: null, withdrawn_on: null, supplements_count: null, dream: i === 0,
}));
const profile = emptyProfile();
profile.basics.gradYear = GRAD;
profile.basics.stateOfResidence = "TN";
profile.academics.gpa = 3.8;
profile.tests.satTotal = 1420;
profile.tests.focus = "sat";
const mainRef = "platform:common_app:main";
const essayRows = [mainRef, ...units.slice(0, 4).map((u) => `college:${u}:2026-27:1`)].map((prompt_ref, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, student_id: STUDENT, prompt_ref, title: `Draft ${i + 1}`, count_kind: "words", count: 300 + i,
  limit_max: 650, limit_min: null, status: i % 2 ? "ready" : "draft", kind: i === 0 ? "personal" : "why_us", base_id: null, created: "2026-07-01T00:00:00Z", updated: "2026-07-02T00:00:00Z",
}));
const plan = {
  list: { id: LIST, name: "My list", student_id: STUDENT, user_id: null, is_default: true, sort: null, rounds_plan_accepted_at: null, created_at: "2026-06-01" },
  items, tasks: [], visits: [], offers: [], nudges: [],
  essays: { rows: essayRows, links: [], comments: [], suggestions: [] },
} as never;
const input = await generatorInputFor(plan, { gradYear: GRAD, profile, home: null, today: TODAY });
const tasks = applyMerge(LIST, [], mergeTasks([], generateTasks(input)), "2026-11-01T00:00:00Z", (k) => `task-${k}`);
const ctx = planContextFrom(input, { ...(plan as object), tasks } as never, {
  student: { id: STUDENT, display_name: "Jordan Lee", grad_year: GRAD, user_id: null },
  home: null,
  viewer: { userId: "u-guardian", firstName: "Sam", canEdit: true, relation: "guardian", isGuardian: true, isCounselor: false },
});
const view = planView({ items: ctx.items, schools: ctx.schools, profile: ctx.profile, estimates: {}, today: TODAY });
const essays = await essaysTabData(ctx, "guardian");

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
console.log(`[payload] ${units.length} colleges, ${tasks.length} moves, ${essayRows.length} drafts; PlanFrame through Flight (raw / gzipped)`);
for (const tab of PLAN_TABS.filter((t) => t !== "offers")) {
  const base = { people: null, ctx, view, relation: "guardian", firstName: "Jordan", colorSlot: 0, personId: STUDENT, tab, setup: false, back: "plan" };
  const without = await flightBytes(React.createElement(PlanFrame as never, { ...base, essays: null } as never));
  const withE = await flightBytes(React.createElement(PlanFrame as never, { ...base, essays } as never));
  console.log(`  tab=${tab.padEnd(8)} without essays data ${kb(without.raw)} / ${kb(without.gz)}; with ${kb(withE.raw)} / ${kb(withE.gz)}`);
}

/*
 * Round 5, U4: a plan with decisions (three admits, one with an entered offer, a wait list, a denial), with the Offers
 * stage's data read the way the load reads it (lib/planner/offers-server.ts readOffers, over a database that answers no
 * letters) and without it. Without it (before round 5) Offers navigates, so its panel is on the page only when opened;
 * with it, the panel rides on every tab so the switch is in place.
 */
const { readOffers } = await import("../lib/planner/offers-server.ts");
const decidedItems = items.map((it, i) =>
  i < 3 ? { ...it, status: "applied", outcome: "admitted", decision_date: "2027-03-20" } : i === 3 ? { ...it, status: "applied", outcome: "waitlisted", decision_date: "2027-03-20" } : i === 4 ? { ...it, status: "applied", outcome: "denied", decision_date: "2027-03-20" } : it,
);
const offer = {
  id: "offer-1", item_id: decidedItems[0].id, award_year: 2027, letter_date: "2027-03-25", source: "form", quotes: null, pros: "Close to home", cons: null, confirmed_at: "2027-03-26T00:00:00Z", created_by: "u-guardian", created_at: "2027-03-26T00:00:00Z",
  coa: { tuition_fees: 58000, housing_food: 19000, books: 1200, transport: 900, personal: 2000, other: null, total: 81100, stated_by_college: true },
  gift: [{ kind: "college_need", name: "University Grant", amount: 42000, renewable: true, renewal_condition: null, years: 4 }], work_study: 2500, loans: [{ kind: "direct_sub", amount: 3500 }],
};
const decidedPlan = { ...(plan as object), items: decidedItems, offers: [offer] } as never;
const decidedInput = await generatorInputFor(decidedPlan, { gradYear: GRAD, profile, home: null, today: "2027-04-01" });
const decidedTasks = applyMerge(LIST, [], mergeTasks([], generateTasks(decidedInput)), "2027-04-01T00:00:00Z", (k) => `task-${k}`);
const decidedCtx = planContextFrom(decidedInput, { ...(decidedPlan as object), tasks: decidedTasks } as never, {
  student: { id: STUDENT, display_name: "Jordan Lee", grad_year: GRAD, user_id: null },
  home: null,
  viewer: { userId: "u-guardian", firstName: "Sam", canEdit: true, relation: "guardian", isGuardian: true, isCounselor: false },
});
const decidedView = planView({ items: decidedCtx.items, schools: decidedCtx.schools, profile: decidedCtx.profile, estimates: {}, today: "2027-04-01" });
/** The database as the stage reads it: no letters shared, the consent column present and unset. */
const builder: Record<string, unknown> = {};
for (const m of ["select", "in", "eq", "order"]) builder[m] = () => builder;
builder.then = (done: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(done);
builder.maybeSingle = () => Promise.resolve({ data: { outcome_share_consented_at: null }, error: null });
const offersData = await readOffers({ from: () => builder } as never, decidedCtx, decidedCtx.profile);
console.log(`[offers] a decided plan: ${Object.keys(offersData.facts).length} admits' facts, ${Object.keys(offersData.waits).length} wait lists; as JSON ${kb(JSON.stringify(offersData).length)}`);
for (const tab of ["next", "colleges", "offers"] as const) {
  const base = { people: null, ctx: decidedCtx, view: decidedView, relation: "guardian", firstName: "Jordan", colorSlot: 0, personId: STUDENT, tab, setup: false, back: "plan", essays };
  const before = await flightBytes(React.createElement(PlanFrame as never, { ...base, tabsRead: null } as never));
  const after = await flightBytes(React.createElement(PlanFrame as never, { ...base, tabsRead: { offers: offersData, asks: null } } as never));
  console.log(`  tab=${tab.padEnd(8)} Offers navigates ${kb(before.raw)} / ${kb(before.gz)}; Offers in place ${kb(after.raw)} / ${kb(after.gz)} (+${kb(after.raw - before.raw)} / +${kb(after.gz - before.gz)})`);
}

/* The list page's school facts (ListPage.tsx boardItems): the three citations per row, full and as references. */
const full = units.map((u) => {
  const s = data.getSchoolById(u)!;
  return [data.citeField("admissions.acceptance_rate", s), data.citeField("cost.avg_paid_all", s), data.citeField("location.lat", s)];
});
const refs = units.map((u, i) => full[i].map((c) => citeRefOf(c, u)));
console.log(`[list] ${units.length} rows' three citations as JSON: full ${kb(JSON.stringify(full).length)}, references ${kb(JSON.stringify(refs).length)}`);
