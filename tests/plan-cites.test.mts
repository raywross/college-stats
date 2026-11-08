/**
 * The plan's citations by reference (counselor performance build, U3; specs/data-lineage.md "Citations on the plan";
 * specs/serving-architecture.md "Follow-up (2026-11-08)", cause 4):
 * - lib/lineage.ts: `isCiteRef`, `citeRefOf` (keeps key, year, edition, document kind; nothing else), `citeLinkHref`,
 *   `citeFieldLabel`;
 * - lib/planner/context.ts `planSchoolFor`: `"ref"` (the default) yields references with no url, quote, method,
 *   inputs, replaces, or formula and with year, edition, and kind preserved; `"full"` yields the full citations, each
 *   the one `planCiteFor` (what `/api/cite` answers) gives; `planSchools` passes the option through;
 * - the size guard: `planSchools` for the mini fixture's colleges under `"ref"` is under a tenth of `"full"`, for its
 *   citations, and the whole slice is smaller too (the numbers are printed);
 * - only the print page asks for `"full"` (source);
 * - `GET /api/cite`: 200 with the citation, the cache header and the snapshot ETag; 304 on a matching ETag; 404 for an
 *   unknown college or an unregistered path; 400 for a malformed one; `go=1` redirects to the source;
 * - components/ui/info-tip.tsx: one module-level cache and in-flight map, "Loading the source…", the API (source).
 * `npm test`. Reads the mini fixture; no network, no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import { DEFAULT_UNITS } from "../scripts/build-mini-fixture.mts";
import { installMiniAsBundledCopy } from "./helpers/snapshot.mts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ */
/* Next.js and database stand-ins                                      */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  // The saved hand-read prompts are a database read; none here (they touch essays, never citations).
  "@/lib/essays/overrides": "export async function readEssayOverrides(){ return new Map(); } export function withOverride(s){ return s; }",
  "@/lib/analytics-server": "export async function trackServer(){}",
  "@/lib/supabase-server": "export async function createServerSupabase(){ throw new Error('no database in this test'); } export function supabaseAuthEnv(){ return null; }",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return stub(STUBS[specifier]);
    let spec = specifier;
    if (/^next\/[a-z-]+$/.test(spec)) return next(`${spec}.js`, context);
    if (spec.startsWith("@/"))spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

installMiniAsBundledCopy();

const { citeFieldLabel, citeLinkHref, citeRefOf, isCiteRef } = await import("../lib/lineage.ts");
const { getData } = await import("../lib/data.ts");
const { planSchoolFor, planSchools, POOL_LINEAGE_PATHS } = await import("../lib/planner/context.ts");
const { comparedWith } = await import("../lib/chances/compared-with.ts");
const { poolRateFor } = await import("../lib/chances/pool-rate.ts");
const { planCiteFor } = await import("../lib/planner/plan-cites.ts");
const { gpaCurve, gpaModel } = await import("../lib/planner/gpa-model-server.ts");
const { GET } = await import("../app/api/cite/route.ts");

type AnyCited = import("../lib/lineage.ts").AnyCited;
type CiteRef = import("../lib/lineage.ts").CiteRef;

const data = await getData();
const models = { gpaModel: await gpaModel(), gpaCurve: await gpaCurve() };
const units = DEFAULT_UNITS.filter((id) => data.getSchoolById(id));
const HEAVY = ["url", "quote", "method", "inputs", "replaces", "formula", "label", "publisher", "retrieved", "field", "document"];

function build(unit: string, cites?: "full" | "ref") {
  const school = data.getSchoolById(unit)!;
  return planSchoolFor(school, data.citeField, { studentCycleStart: 2026, home: null, ...models, ...(cites ? { cites } : {}) });
}

/* ------------------------------------------------------------------ */
/* lib/lineage.ts                                                      */
/* ------------------------------------------------------------------ */

test("citeRefOf keeps the unit, path, key, year, edition, and document kind, and nothing else; isCiteRef tells them apart", () => {
  const vandy = data.getSchoolById("221999")!;
  const full = data.citeField("admissions.acceptance_rate", vandy);
  const ref = citeRefOf(full, "221999");
  assert.deepEqual(Object.keys(ref).sort(), ["key", "path", "ref", "unit", "year", ...(full.cdsEdition !== undefined ? ["cdsEdition"] : []), ...(full.sourceKind !== undefined ? ["sourceKind"] : [])].sort());
  assert.equal(ref.year, full.year);
  assert.equal(ref.key, full.key);
  assert.equal(isCiteRef(ref), true);
  assert.equal(isCiteRef(full), false);
  assert.equal(isCiteRef(null), false);
  assert.equal(isCiteRef({ ref: true, unit: 1, path: "x" }), false, "a unit must be a string");
});

test("citeLinkHref: a full citation's own url, a reference's redirect through /api/cite; citeFieldLabel: the registry's label", () => {
  const vandy = data.getSchoolById("221999")!;
  const full = data.citeField("admissions.acceptance_rate", vandy);
  assert.equal(citeLinkHref(full), full.url);
  const ref = citeRefOf(full, "221999");
  assert.equal(citeLinkHref(ref), "/api/cite?unit=221999&path=admissions.acceptance_rate&go=1");
  assert.equal(citeFieldLabel(ref), full.field);
  assert.equal(citeFieldLabel(full), full.field);
});

/* ------------------------------------------------------------------ */
/* planSchoolFor / planSchools                                         */
/* ------------------------------------------------------------------ */

test('planSchoolFor defaults to references: no url, quote, method, inputs, replaces, or formula; year, edition, kind kept', () => {
  let checked = 0;
  for (const unit of units) {
    const ref = build(unit);
    const full = build(unit, "full");
    assert.deepEqual(Object.keys(ref.cites).sort(), Object.keys(full.cites).sort(), `${unit}: the same fields are cited`);
    for (const [path, c] of Object.entries(ref.cites)) {
      assert.ok(isCiteRef(c), `${unit} ${path} is a reference`);
      for (const k of HEAVY) assert.equal(k in c, false, `${unit} ${path} carries no ${k}`);
      const f = full.cites[path] as AnyCited;
      const r = c as CiteRef;
      assert.equal(r.unit, unit);
      assert.equal(r.path, path);
      assert.equal(r.year, f.year, `${unit} ${path} year`);
      assert.equal(r.cdsEdition, f.cdsEdition, `${unit} ${path} edition`);
      assert.equal(r.sourceKind, f.sourceKind, `${unit} ${path} kind`);
      checked++;
    }
    // The two shortcuts are the same references, so the logic that reads their year keeps working.
    assert.deepEqual(ref.admitRateCite, ref.cites["admissions.acceptance_rate"] ?? null);
    assert.deepEqual(ref.avgCostCite, ref.cites["cost.avg_paid_all"] ?? null);
  }
  assert.ok(checked > 100, `checked ${checked} references`);
  // A ref is what ships: shown failing when a heavy field slips back in.
  const leaky = { ...(build("221999").cites["admissions.acceptance_rate"] as CiteRef), url: "https://example.edu" };
  assert.equal(HEAVY.some((k) => k in leaky), true);
});

test('planSchoolFor "full" yields whole citations, each the one /api/cite answers (planCiteFor)', () => {
  let gpa = 0;
  for (const unit of units) {
    const school = data.getSchoolById(unit)!;
    const full = build(unit, "full");
    for (const [path, c] of Object.entries(full.cites)) {
      assert.equal(isCiteRef(c), false);
      assert.equal(typeof (c as AnyCited).url, "string", `${unit} ${path} has its url`);
      assert.deepEqual(planCiteFor(school, path as never, data.citeField, models), c, `${unit} ${path}`);
      if (path.startsWith("derived.gpa_") || path === "reported.admission_profile.gpa.average") gpa++;
    }
    assert.deepEqual(full.admitRateCite, full.cites["admissions.acceptance_rate"] ?? null);
  }
  assert.ok(gpa > 0, "a GPA citation (the fitted model's formula) is among them");
});

test("poolSchool keeps only the lineage the pool reads, and the pool reads the same from it", () => {
  const students = [
    { state: "CA", classRankPercentile: null, gpa: null, majors: [], round: null },
    { state: "TN", classRankPercentile: 5, gpa: 3.9, majors: ["Computer Science"], round: "ed" },
    { state: "TX", classRankPercentile: 8, gpa: 3.7, majors: ["Engineering"], round: "rd" },
    { state: null, classRankPercentile: null, gpa: 3.2, majors: [], round: "ea" },
  ];
  let compared = 0;
  let readsLineage = 0;
  for (const unit of units) {
    const school = data.getSchoolById(unit)!;
    const slim = build(unit).poolSchool;
    assert.deepEqual(Object.keys(slim.lineage ?? {}).every((p) => (POOL_LINEAGE_PATHS as readonly string[]).includes(p)), true, `${unit}: only the pool's records`);
    assert.equal(build(unit, "full").poolSchool, school, `${unit}: "full" keeps the college as it was`);
    for (const st of students) {
      assert.deepEqual(comparedWith(st, slim), comparedWith(st, school), `${unit} ${JSON.stringify(st)}`);
      assert.deepEqual(poolRateFor(st, slim), poolRateFor(st, school), `${unit} ${JSON.stringify(st)}`);
      const bare = { ...school, lineage: {} };
      if (JSON.stringify([comparedWith(st, bare), poolRateFor(st, bare)]) !== JSON.stringify([comparedWith(st, school), poolRateFor(st, school)])) readsLineage++;
      compared++;
    }
  }
  assert.ok(compared >= 100);
  // Shown failing: with no lineage at all the pool reads differently, so the check above has teeth.
  assert.ok(readsLineage > 0, "the pool reads lineage somewhere in the fixture");
});

test("the size guard: planSchools under \"ref\" for the mini fixture's colleges is a fraction of \"full\" (numbers printed)", async () => {
  const ref = await planSchools([...units], 2026, null);
  const full = await planSchools([...units], 2026, null, { cites: "full" });
  assert.equal(Object.keys(ref).length, units.length);
  const citesOf = (s: typeof ref) => JSON.stringify(Object.values(s).map((p) => [p.cites, p.admitRateCite, p.avgCostCite]));
  const refCites = citesOf(ref).length;
  const fullCites = citesOf(full).length;
  const refAll = JSON.stringify(ref).length;
  const fullAll = JSON.stringify(full).length;
  const ten = units.slice(0, 10);
  const ref10 = JSON.stringify(await planSchools(ten, 2026, null)).length;
  const full10 = JSON.stringify(await planSchools(ten, 2026, null, { cites: "full" })).length;
  console.log(
    `[plan-cites] ${units.length} colleges: citations ${fullCites} → ${refCites} bytes; whole slice ${fullAll} → ${refAll} bytes. ` +
      `Ten colleges (${ten.join(", ")}): ${full10} → ${ref10} bytes.`,
  );
  // Measured on the fixture (2026-11-08): citations 0.30 of full, the whole slice 0.25. A reference is ~150 bytes (its
  // path is most of it), so "a tenth" holds only for what a ref drops, not for the ref itself; see the report.
  assert.ok(refCites * 3 < fullCites, `citations: ref ${refCites} bytes is not under a third of full ${fullCites}`);
  assert.ok(refAll * 3 < fullAll, `the slice: ref ${refAll} bytes is not under a third of full ${fullAll}`);
  assert.ok(ref10 * 3 < full10, `ten colleges: ref ${ref10} bytes is not under a third of full ${full10}`);
  // What a reference dropped (url, quote, method, inputs, replaces, labels) is under a tenth of what it was.
  const heavyOf = (s: typeof ref) =>
    JSON.stringify(Object.values(s).flatMap((p) => Object.values(p.cites).map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => HEAVY.includes(k)))))).length;
  assert.ok(heavyOf(ref) * 10 < heavyOf(full), "the heavy fields are gone");
});

/* ------------------------------------------------------------------ */
/* Who asks for "full"                                                 */
/* ------------------------------------------------------------------ */

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

test('only the print page asks for "full" citations; planSchoolFor and planSchools default to references', () => {
  // Code lines only (comments describe the option).
  const code = (f: string) => read(f).split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  const askers = ["app", "components", "lib"].flatMap(sources).filter((f) => /cites:\s*"full"/.test(code(f)));
  assert.deepEqual(askers, ["app/advisor/print/page.tsx"]);
  assert.match(read("app/advisor/print/page.tsx"), /loadPlanFor\(c\.studentId, counselor, \{ cites: "full" \}\)/);
  const context = read("lib/planner/context.ts");
  assert.match(context, /if \(opts\.cites !== "full"\) for \(const \[path, cited\] of Object\.entries\(cites\)\) cites\[path\] = citeRefOf\(/);
  assert.match(read("lib/planner/load.ts"), /generatorInputFor\(read, \{[^}]*cites: opts\.cites \}\)/);
});

/* ------------------------------------------------------------------ */
/* GET /api/cite                                                       */
/* ------------------------------------------------------------------ */

const get = (qs: string, headers: Record<string, string> = {}) => GET(new Request(`https://quad.test/api/cite?${qs}`, { headers }));

test("GET /api/cite answers the citation with a day's cache and the snapshot ETag; 304 when it matches", async () => {
  const res = await get("unit=221999&path=admissions.acceptance_rate");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, max-age=86400, stale-while-revalidate=604800");
  const etag = res.headers.get("etag");
  assert.match(etag ?? "", /^"cite-\d+"$/);
  const body = await res.json();
  assert.deepEqual(body, JSON.parse(JSON.stringify(data.citeField("admissions.acceptance_rate", data.getSchoolById("221999")!))));
  const again = await get("unit=221999&path=admissions.acceptance_rate", { "if-none-match": etag! });
  assert.equal(again.status, 304);
});

test("GET /api/cite: a GPA field carries the fitted model's formula, as the plan built it", async () => {
  for (const unit of units) {
    const full = build(unit, "full");
    const path = Object.keys(full.cites).find((p) => p.startsWith("derived.gpa_"));
    if (!path) continue;
    const body = await (await get(`unit=${unit}&path=${path}`)).json();
    assert.deepEqual(body, JSON.parse(JSON.stringify(full.cites[path])));
    return;
  }
  assert.fail("no mini-fixture college has a derived GPA citation");
});

test("GET /api/cite: 404 for an unknown college or an unregistered path; 400 for a malformed one", async () => {
  assert.equal((await get("unit=999999999&path=admissions.acceptance_rate")).status, 404);
  assert.equal((await get("unit=221999&path=admissions.no_such_field")).status, 404);
  assert.equal((await get("unit=221999&path=Admissions.Rate")).status, 400);
  assert.equal((await get("unit=221999&path=a..b")).status, 400);
  assert.equal((await get("unit=abc&path=admissions.acceptance_rate")).status, 400);
  assert.equal((await get("path=admissions.acceptance_rate")).status, 400);
  assert.equal((await get("unit=221999")).status, 400);
});

test("GET /api/cite?go=1 redirects to the source's own page", async () => {
  const res = await get("unit=221999&path=admissions.acceptance_rate&go=1");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), data.citeField("admissions.acceptance_rate", data.getSchoolById("221999")!).url);
});

test("the route reads nothing personal: no session, no Supabase, no cookies", () => {
  const src = read("app/api/cite/route.ts");
  assert.doesNotMatch(src, /supabase|cookies\(|headers\(\)|requireUser|getAccount/i);
  assert.doesNotMatch(read("proxy.ts"), /"\/api\/cite/, "the session proxy doesn't run on it");
});

/* ------------------------------------------------------------------ */
/* components/ui/info-tip.tsx (source: pages don't render under node)  */
/* ------------------------------------------------------------------ */

test("the ⓘ: one loader with a module-level cache and shared in-flight fetches, a loading line, a fallback", () => {
  const src = read("components/ui/info-tip.tsx");
  assert.match(src, /^const citeCache = new Map<string, AnyCited>\(\);$/m);
  assert.match(src, /^const citeInflight = new Map<string, Promise<AnyCited>>\(\);$/m);
  assert.match(src, /fetch\(citeApiHref\(ref\)\)/);
  assert.match(src, /export function useCite\(cite: CiteLike \| null \| undefined\): CiteState/);
  assert.match(src, /Loading the source…/);
  assert.match(src, /citeFieldLabel\(cited\)/, "the fallback names the field");
  // Every ⓘ takes a reference: MetricLabel, InfoTip, SourceTip, Term.
  for (const sig of [/export function InfoTip\([^)]*cited\?: CiteLike/, /export function SourceTip\([^)]*cited: CiteLike/, /export function Term\([^)]*cited\?: CiteLike/]) assert.match(src, sig);
  assert.match(src, /export function MetricLabel\([\s\S]*?cited\?: CiteLike;[\s\S]*?\}\)/);
  // The popovers render the lazy block, never the plain one with a possibly-unresolved citation.
  assert.doesNotMatch(src, /<SourceBlock cited=\{cited\} \/>/);
});

test("the calendar's always-visible source links go through citeLinkHref, never a cite's url directly", () => {
  for (const f of ["components/planner/FamilyCalendar.tsx", "components/planner/calendar/UpcomingList.tsx"]) {
    const src = read(f);
    assert.match(src, /citeLinkHref\(cited\)/, f);
    assert.doesNotMatch(src, /cited\?\.url/, f);
  }
});
