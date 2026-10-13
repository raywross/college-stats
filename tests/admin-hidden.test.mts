/**
 * The admin console's hidden values (specs/product/admin.md "Colleges and hidden values", "A student's standing";
 * lib/admin/hidden.ts, lib/admin/college.ts, lib/admin/high-school.ts, lib/admin/standing.ts, the pages under
 * app/admin/colleges and app/admin/high-schools, components/admin/StandingPanelSlot.tsx): the selectivity breakdown
 * adds up to the committed index for every college; hysteresis is explained; the GPA panel names its source; the
 * registry's `hidden: true` fields each have a value and never appear on a public page; the three-student line matches
 * the migration; the standing panel carries the estimate's private detail while the public endpoint never does, and
 * nothing a browser or an API route reaches imports it. Each guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as nodeModule from "node:module";
import type { School, DatasetMeta } from "../lib/types";

// lib/admin/hidden.ts and the method start with `import "server-only"`, which only Next.js resolves.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    return next(specifier, context);
  },
});

const hidden = await import("../lib/admin/hidden.ts");
const { WEIGHTS, SCORE_CENTER, SCORE_SPREAD, HYSTERESIS, selectivityScore, rawInputs } = await import("../lib/selectivity.ts");
const { FIELDS, HIDDEN_FIELDS } = await import("../lib/fields.ts");
const { lineageFor } = await import("../lib/lineage.ts");
const { SELECTIVITY_TIERS } = await import("../lib/chances/levels.ts");
const { fitGpaCurve, fitGpaModel, curveRows, trainingRows, collegeGpa } = await import("../lib/planner/gpa-model.ts");
const { modelEstimateWithDetail } = await import("../lib/chances/model.ts");
const { baselineEstimate, standingSchoolFor } = await import("../lib/chances/baseline.ts");
const { publicResult } = await import("../lib/chances/estimate-request.ts");
const { reachedFromClient, walk } = await import("./helpers/client-reach.mts");

type EstimateStudent = import("../lib/chances/types.ts").EstimateStudent;
type SelectivityTier = import("../lib/chances/types.ts").SelectivityTier;

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const schools = JSON.parse(read("data", "schools.json")) as School[];
const meta = JSON.parse(read("data", "meta.json")) as DatasetMeta;
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const HARVARD = "166027";
const ctx = hidden.selectivityContext(schools);

/* ------------------------------------------------------------------ */
/* Selectivity                                                         */
/* ------------------------------------------------------------------ */

/** The inputs the panel lists, against the method's weights: names missing from either side. */
function inputMismatch(list: readonly { input: string }[], weights: Record<string, number>): string[] {
  const a = list.map((r) => r.input);
  const b = Object.keys(weights);
  return [...a.filter((k) => !b.includes(k)), ...b.filter((k) => !a.includes(k))];
}

test("the panel lists exactly the method's inputs, in its order", () => {
  assert.deepEqual(inputMismatch(hidden.SELECTIVITY_INPUTS, WEIGHTS), []);
  assert.deepEqual(hidden.SELECTIVITY_INPUTS.map((r) => r.input), Object.keys(WEIGHTS));
});

test("guard: an input the method adds (or the panel drops) is caught", () => {
  assert.deepEqual(inputMismatch(hidden.SELECTIVITY_INPUTS.slice(1), WEIGHTS), ["admit_rate"]);
  assert.deepEqual(inputMismatch(hidden.SELECTIVITY_INPUTS, { ...WEIGHTS, trend: 5 }), ["trend"]);
});

/** Center + spread × Σ(weight share × reading) × evidence, held to 0–100: the score the formula gives from the rows. */
function fromRows(pool: import("../lib/admin/hidden.ts").SelectivityPoolView, rows = pool.rows): number {
  const mean = rows.reduce((s, r) => s + r.contribution, 0);
  return Math.min(100, Math.max(0, SCORE_CENTER + SCORE_SPREAD * mean * pool.evidence.factor));
}

test("every rated college's rows add up to its score, which is the committed index, for every pool", () => {
  const index = JSON.parse(read("data", "selectivity-index.json")) as { colleges: Record<string, { all: number; in_state?: number; out_of_state?: number }> };
  let rated = 0;
  for (const s of schools) {
    const panel = hidden.selectivityPanel(s, ctx);
    const entry = index.colleges[s.unit_id];
    if (panel.status !== "rated") {
      assert.equal(entry, undefined, `${s.name} is unrated in the panel but indexed`);
      continue;
    }
    rated++;
    for (const pool of panel.pools) {
      const shares = pool.rows.reduce((t, r) => t + r.share, 0);
      assert.ok(Math.abs(shares - 1) < 1e-12, `${s.name}: weight shares sum to ${shares}`);
      assert.ok(Math.abs(fromRows(pool) - pool.exact) < 1e-9, `${s.name} ${pool.pool}: rows give ${fromRows(pool)}, score ${pool.exact}`);
      assert.equal(pool.score, entry[pool.pool], `${s.name} ${pool.pool}`);
      assert.ok(pool.hysteresis.consistent, `${s.name} ${pool.pool}: ${pool.hysteresis.sentence}`);
      for (const r of pool.rows) if (r.percentile !== null) assert.ok(r.percentile >= 0 && r.percentile <= 100);
    }
  }
  assert.equal(rated, Object.keys(index.colleges).length);
});

test("guard: a row left out of the sum, or a weight changed, no longer gives the score", () => {
  const pool = hidden.selectivityPanel(byId.get(HARVARD)!, ctx).pools[0];
  assert.ok(Math.abs(fromRows(pool, pool.rows.slice(1)) - pool.exact) > 0.5);
  const reweighted = pool.rows.map((r) => (r.input === "admit_rate" ? { ...r, contribution: r.reading * (r.weight + 10) / 100 } : r));
  assert.ok(Math.abs(fromRows(pool, reweighted) - pool.exact) > 0.5);
});

test("Harvard: the admit rate is harder than nearly every reporter, the tier is Ultra selective, and it is in the top band", () => {
  const panel = hidden.selectivityPanel(byId.get(HARVARD)!, ctx);
  const all = panel.pools[0];
  assert.equal(all.pool, "all");
  const rate = all.rows.find((r) => r.input === "admit_rate")!;
  assert.ok(rate.present && rate.percentile! > 99, String(rate.percentile));
  assert.equal(all.publishedTier, "elite");
  assert.equal(all.hysteresis.held, false);
  assert.equal(all.hysteresis.upAt, null); // nothing above Ultra selective
  assert.ok(panel.topBand?.inBand && panel.topBand.stored);
  assert.equal(panel.constants.weights.reduce((s, w) => s + w.weight, 0), Object.values(WEIGHTS).reduce((s, w) => s + w, 0));
});

test("a public with both residency rates gets in-state and out-of-state breakdowns that read the residency rate", () => {
  const s = schools.find((x) => {
    const r = rawInputs(x);
    return r.inStateRate !== null && r.outOfStateRate !== null && hidden.selectivityPanel(x, ctx).status === "rated";
  })!;
  assert.ok(s, "no public with both residency rates in the dataset");
  const panel = hidden.selectivityPanel(s, ctx);
  assert.deepEqual(panel.pools.map((p) => p.pool), ["all", "in_state", "out_of_state"]);
  const inState = panel.pools[1].rows.find((r) => r.input === "admit_rate")!;
  assert.equal(inState.field, "derived.admit_rate_in_state");
  assert.equal(inState.raw, rawInputs(s).inStateRate);
});

test("a college without a SAT has it filled from the fit; a missing yield reads as the middle", () => {
  const rated = (x: School) => hidden.selectivityPanel(x, ctx).status === "rated";
  const noSat = schools.find((x) => rawInputs(x).sat75 === null && rated(x));
  assert.ok(noSat);
  assert.equal(hidden.selectivityPanel(noSat, ctx).pools[0].rows.find((r) => r.input === "class_strength")!.filled, "fit");
  const noYield = clone(schools.find((x) => rated(x) && rawInputs(x).yield !== null)!);
  noYield.admissions.enrolled = null;
  noYield.admissions.admitted = null;
  delete (noYield.admissions as { federal?: unknown }).federal;
  assert.equal(rawInputs(noYield).yield, null, "the fixture has no yield");
  const rows = hidden.selectivityPanel(noYield, ctx).pools[0].rows;
  const y = rows.find((r) => r.input === "yield")!;
  assert.equal(y.filled, "middle");
  assert.equal(y.reading, 0);
  assert.equal(y.percentile, null);
});

test("unrated colleges say why: no admit rate, or figures that can't describe one class", () => {
  const none = schools.find((x) => x.admissions.acceptance_rate === null)!;
  assert.equal(hidden.selectivityPanel(none, ctx).status, "no_admit_rate");
  const odd = clone(byId.get(HARVARD)!);
  odd.admissions.enrolled = 1_000_000;
  assert.equal(hidden.selectivityPanel(odd, ctx).status, "inconsistent");
});

test("hysteresis: a stored tier the band kept is explained as held; one the rule can't give is flagged stale", () => {
  // A college whose score sits less than the band above its tier's floor: stored one tier lower, the band holds it there.
  let found = false;
  for (const s of schools) {
    const pool = hidden.selectivityPanel(s, ctx).pools[0];
    if (!pool) continue;
    const floor = hidden.tierFloor(pool.plainTier);
    if (floor === null || pool.score - floor >= HYSTERESIS) continue;
    const lower = SELECTIVITY_TIERS[SELECTIVITY_TIERS.indexOf(pool.plainTier) + 1] as SelectivityTier;
    const held = clone(s);
    held.selectivity = { ...(held.selectivity ?? { tier: null }), tier: lower };
    const view = hidden.selectivityPanel(held, ctx).pools[0];
    assert.equal(view.publishedTier, lower);
    assert.ok(view.hysteresis.held && view.hysteresis.consistent, view.hysteresis.sentence);
    assert.match(view.hysteresis.sentence, /^Hysteresis held /);
    found = true;
    break;
  }
  assert.ok(found, "no college near a cutoff");
  const stale = clone(byId.get(HARVARD)!);
  stale.selectivity = { tier: "open" };
  const view = hidden.selectivityPanel(stale, ctx).pools[0];
  assert.equal(view.hysteresis.consistent, false);
  assert.match(view.hysteresis.sentence, /build is stale/);
});

test("percentileAmong: the share of reporters a value is harder than, ties counting half", () => {
  assert.equal(hidden.percentileAmong([1, 2, 3, 4], 5), 100);
  assert.equal(hidden.percentileAmong([1, 2, 3, 4], 0), 0);
  assert.equal(hidden.percentileAmong([1, 2, 2, 4], 2), 50);
  assert.equal(hidden.percentileAmong([1, 2], null), null);
});

/* ------------------------------------------------------------------ */
/* GPA                                                                 */
/* ------------------------------------------------------------------ */

test("the GPA panel names each source kind with its field, and an estimate's fit", () => {
  const model = fitGpaModel(trainingRows(schools));
  const curve = fitGpaCurve(curveRows(schools));
  assert.ok(model && curve);
  const seen = new Map<string, ReturnType<typeof hidden.gpaPanel>>();
  for (const s of schools) {
    const p = hidden.gpaPanel(s, model, curve);
    if (!seen.has(p.kind)) seen.set(p.kind, p);
  }
  for (const kind of ["reported", "estimated", "none"]) assert.ok(seen.has(kind), `no ${kind} college`);
  const reported = seen.get("reported")!;
  assert.ok(reported.field === "reported.admission_profile.gpa.average" || reported.field === "derived.gpa_middle_half", String(reported.field));
  const est = seen.get("estimated")!;
  assert.equal(est.model?.n, model.n);
  assert.ok(est.inputs.some((i) => i.label === "SAT midpoint"));
  assert.equal(seen.get("none")!.field, null);
  // The panel's point is collegeGpa's (the standing model's own reading), formatted.
  const s = schools.find((x) => collegeGpa(x, model, curve).kind === "estimated")!;
  assert.equal(hidden.gpaPanel(s, model, curve).point, collegeGpa(s, model, curve).point!.toFixed(2));
});

/* ------------------------------------------------------------------ */
/* Hidden derived fields                                               */
/* ------------------------------------------------------------------ */

test("the registry marks method-only fields hidden: the band and the score per pool, each with a value and lineage", () => {
  assert.deepEqual([...HIDDEN_FIELDS].sort(), ["derived.selectivity_score", "derived.selectivity_score_in_state", "derived.selectivity_score_out_of_state", "selectivity.band"]);
  assert.deepEqual(hidden.hiddenFieldsWithoutValue(), []);
  const harvard = byId.get(HARVARD)!;
  const panel = hidden.selectivityPanel(harvard, ctx);
  const rows = hidden.hiddenFieldRows(harvard, { selectivity: panel });
  assert.equal(rows.length, HIDDEN_FIELDS.length);
  const score = rows.find((r) => r.path === "derived.selectivity_score")!;
  assert.equal(score.value, selectivityScore(rawInputs(harvard), ctx.scales)!.toFixed(2));
  assert.equal(rows.find((r) => r.path === "selectivity.band")!.value, "Top band");
  for (const p of HIDDEN_FIELDS) {
    const c = lineageFor(p, harvard, meta);
    assert.ok(c.label && c.formula, `${p} cites a source and a formula`);
    assert.doesNotMatch(c.formula!, /\b\d+(\.\d+)?\b/, `${p}'s formula names a number (kinds only, never weights or cutoffs)`);
  }
});

test("guard: a hidden field without a value is caught", () => {
  assert.deepEqual(hidden.hiddenFieldsWithoutValue([...HIDDEN_FIELDS, "derived.yield"]), ["derived.yield"]);
});

/** Files outside the console and the method that name a hidden field's path in a string. */
function publicNamers(files: Map<string, string>, paths: readonly string[]): string[] {
  const allowed = (f: string) => f.startsWith("app/admin/") || f.startsWith("components/admin/") || f.startsWith("lib/admin/") || f === "lib/fields.ts";
  const out: string[] = [];
  for (const [f, raw] of files) {
    if (allowed(f)) continue;
    // Code only: a comment naming the field (the method documents what it reads) isn't a citation.
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const p of paths) if (new RegExp(`["'\`]${p.replace(/\./g, "\\.")}["'\`]`).test(text)) out.push(`${f}: ${p}`);
  }
  return out;
}

test("a hidden field is never named on a public page, component, or library outside the console", () => {
  const files = new Map([...walk("app"), ...walk("components"), ...walk("lib")]);
  assert.deepEqual(publicNamers(files, HIDDEN_FIELDS), []);
  // The Data page lists stored fields; it leaves hidden ones out.
  assert.match(read("app/data/page.tsx"), /!def\.computed && !def\.hidden/);
});

test("guard: a profile section citing a hidden field is caught", () => {
  const files = new Map([["components/school/Bad.tsx", 'export const F = ["derived.selectivity_score"];'], ["app/admin/colleges/Fine.tsx", 'const f = "derived.selectivity_score";']]);
  assert.deepEqual(publicNamers(files, HIDDEN_FIELDS), ["components/school/Bad.tsx: derived.selectivity_score"]);
});

/* ------------------------------------------------------------------ */
/* High school pooled counts                                           */
/* ------------------------------------------------------------------ */

/** The threshold school_course_list() uses, read from its migration. */
const migrationLine = (sql: string) => Number(/c\.students\s*>=\s*(\d+)/.exec(sql)?.[1]);

test("the three-student line drawn on the page is school_course_list()'s own threshold", () => {
  assert.equal(migrationLine(read("supabase/migrations/20261011120000_school_course_counts.sql")), hidden.COURSE_LIST_MIN_STUDENTS);
});

test("guard: a migration that moves the threshold no longer matches the page's line", () => {
  const moved = read("supabase/migrations/20261011120000_school_course_counts.sql").replace(/c\.students >= 3/, "c.students >= 5");
  assert.notEqual(migrationLine(moved), hidden.COURSE_LIST_MIN_STUDENTS);
});

test("course counts come back in full, most students first, each marked against the line", () => {
  const rows = hidden.courseCountRows(
    [
      { course_key: "ap_biology", students: 2 },
      { course_key: "ap_calculus_bc", students: 7 },
      { course_key: "ap_chemistry", students: 3 },
      { course_key: "ib_unknown", students: 1 },
    ],
    (k) => (k === "ib_unknown" ? null : k.replace("ap_", "AP ")),
  );
  assert.deepEqual(rows.map((r) => [r.key, r.students, r.listed]), [["ap_calculus_bc", 7, true], ["ap_chemistry", 3, true], ["ap_biology", 2, false], ["ib_unknown", 1, false]]);
  assert.equal(rows[3].name, "ib_unknown");
});

/* ------------------------------------------------------------------ */
/* The standing panel                                                  */
/* ------------------------------------------------------------------ */

function student(o: Partial<EstimateStudent> = {}): EstimateStudent {
  return { gpa: 3.85, gpaScale: "4.0", gpaRange: [3.85, 3.85], test: { kind: "sat", score: 1480 }, satMath: null, actMath: null, classRankPercentile: 10, courses: [], state: "OH", majors: ["biology"], round: null, highSchoolId: null, ...o };
}

/** The standing panel from the real model for one college (what lib/admin/standing.ts builds per list row). */
function panelFor(unit: string, s = student()) {
  const school = byId.get(unit)!;
  const college = standingSchoolFor(school, fitGpaModel(trainingRows(schools)), fitGpaCurve(curveRows(schools)));
  const applied = modelEstimateWithDetail({ student: s, school, standing: college, offering: null });
  return { applied, view: hidden.standingPanel({ applied, baseline: baselineEstimate(s, college, unit), student: s, college }) };
}

test("the standing panel carries the estimate's private detail: hidden odds, ablations, inputs beside the college's, notes, version, baseline", () => {
  const unit = schools.find((x) => x.selectivity?.tier === "selective" && x.admissions.sat_math_25_75)!.unit_id;
  const { applied, view } = panelFor(unit);
  assert.ok(applied.detail, "the model returned its detail");
  assert.equal(view.fellBack, false);
  assert.equal(view.unitId, unit);
  if (applied.detail!.hiddenOdds != null) assert.equal(view.hiddenOdds, `${(applied.detail!.hiddenOdds * 100).toFixed(1)}%`);
  assert.equal(view.ablations.length, Object.keys(applied.detail!.without ?? {}).length);
  assert.ok(view.ablations.length >= 5);
  for (const a of view.ablations) assert.match(a.input, /^Without /);
  assert.deepEqual(view.sideBySide.map((r) => r.input), ["GPA", "Test", "Class rank", "Rigor", "State", "Major"]);
  assert.match(view.sideBySide[1].student, /^SAT 1480/);
  assert.equal(view.notes.length, applied.result.notes.length);
  for (const n of view.notes) assert.ok(n.length > 0);
  assert.equal(view.modelVersion, applied.result.modelVersion);
  assert.ok(view.baseline);
  assert.ok(view.detail.some((d) => d.label === "Stage 1 position" || d.label === "Completeness"));
});

test("when the model fails the panel says the baseline was served and shows no private detail", () => {
  const { applied } = panelFor(HARVARD);
  const view = hidden.standingPanel({ applied: { result: applied.result, detail: null }, baseline: null, student: student(), college: null });
  assert.equal(view.fellBack, true);
  assert.equal(view.hiddenOdds, null);
  assert.deepEqual(view.ablations, []);
  assert.deepEqual(view.detail, []);
  assert.match(hidden.standingSummary(view), /baseline served/);
});

/** Every key SnapshotDetail can carry (the private fields), from its declaration. */
const DETAIL_KEYS = [...read("lib/chances/snapshot.ts").match(/export interface SnapshotDetail \{([\s\S]*?)\n\}/)![1].matchAll(/^\s{2}(\w+)\?:/gm)].map((m) => m[1]);

test("the public endpoint's response carries none of the detail: publicResult rebuilds the contract's fields only", () => {
  assert.ok(DETAIL_KEYS.includes("hiddenOdds") && DETAIL_KEYS.includes("without") && DETAIL_KEYS.length >= 8, DETAIL_KEYS.join(", "));
  const { applied } = panelFor(HARVARD);
  // A result that somehow carried the detail (spread in, or nested) comes out of publicResult without it.
  const leaky = { ...applied.result, ...applied.detail, detail: applied.detail, hiddenOdds: 0.42 } as unknown as Parameters<typeof publicResult>[0];
  const out = publicResult(leaky) as unknown as Record<string, unknown>;
  for (const k of [...DETAIL_KEYS, "detail"]) assert.equal(k in out, false, `${k} reached the response`);
  assert.deepEqual(Object.keys(out).sort(), ["closeness", "ed", "facts", "group", "label", "missing", "modelVersion", "moveUp", "notes", "pool", "send", "unitId", "used"]);
});

test("the endpoint sends every result through publicResult and the like-you count only, never the detail", () => {
  const route = read("app/api/estimate/route.ts");
  assert.match(route, /results\[id\] = publicResult\(r\)/);
  assert.match(route, /NextResponse\.json\(likeYou \? \{ results, likeYou: like \} : \{ results \}/);
  assert.doesNotMatch(route, /\.detail\b|estimateWithDetail|SnapshotDetail/);
  // estimateWithLikeYou hands back the result and a count; the detail picks the count and goes no further.
  const est = read("lib/chances/estimate.ts");
  assert.match(est, /return \{ result, likeYou: count \? \{ \.\.\.count, residency: detail\.baseRateKind === "residency" \} : null \};/);
  // No admin option was added to estimate(): its signature is the contract's.
  assert.match(est, /export function estimate\(input: EstimateInput, ctx: EstimateContext\): EstimateResult \{/);
});

/** Files under app/api/ or "use client" files that import estimateWithDetail, SnapshotDetail, or the console's hidden modules. */
function detailImporters(files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [f, text] of files) {
    const scoped = f.startsWith("app/api/") || /^\s*["']use client["']/.test(text);
    if (!scoped) continue;
    const imports = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[0]);
    for (const line of imports) if (/\bestimateWithDetail\b|\bSnapshotDetail\b|lib\/admin\/(hidden|standing|selectivity-history)\b/.test(line)) out.push(f);
  }
  return out;
}

test("no API route or client component imports estimateWithDetail, SnapshotDetail, or the console's hidden modules", () => {
  const files = new Map([...walk("app"), ...walk("components"), ...walk("lib")]);
  assert.deepEqual(detailImporters(files), []);
  // Nor can a client component reach them through a chain of imports.
  assert.deepEqual(reachedFromClient(files, ["lib/admin/hidden.ts", "lib/admin/standing.ts", "lib/admin/college.ts", "lib/chances/estimate.ts", "lib/chances/snapshot.ts", "lib/selectivity.ts", "lib/admin/selectivity-history.ts", "lib/admin/selectivity-history-view.ts"]), []);
});

test("guard: a route or a client component importing the detail is caught", () => {
  const files = new Map([
    ["app/api/leak/route.ts", 'import { estimateWithDetail } from "@/lib/chances/estimate";'],
    ["components/x/Leak.tsx", '"use client";\nimport type { SnapshotDetail } from "@/lib/chances/snapshot";'],
    ["components/x/Panel.tsx", '"use client";\nimport { standingSummary } from "@/lib/admin/hidden";'],
    ["components/admin/Fine.tsx", 'import { estimateWithDetail } from "@/lib/chances/estimate";'],
  ]);
  assert.deepEqual(detailImporters(files), ["app/api/leak/route.ts", "components/x/Leak.tsx", "components/x/Panel.tsx"]);
});

/* ------------------------------------------------------------------ */
/* Pages and loaders                                                   */
/* ------------------------------------------------------------------ */

const NEW_PAGES = ["app/admin/colleges/page.tsx", "app/admin/colleges/[unit]/page.tsx", "app/admin/high-schools/[id]/page.tsx"];

/** Pages that read something before requireAdmin(), or never call it, or lack noindex. */
function unguardedPages(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, src]) => {
      const body = src.slice(src.indexOf("export default async function"));
      const guard = body.indexOf("await requireAdmin()");
      const firstRead = body.search(/await (adminCollege|adminHighSchool|getData|searchParams|params)\b/);
      return guard < 0 || (firstRead >= 0 && firstRead < guard) || !/robots: \{ index: false/.test(src);
    })
    .map(([f]) => f);
}

test("the college and high-school pages call requireAdmin() before reading anything, and are noindex", () => {
  const files = Object.fromEntries(NEW_PAGES.map((f) => [f, read(f)]));
  assert.deepEqual(unguardedPages(files), []);
});

test("guard: a page that reads before requireAdmin(), or forgets it, is caught", () => {
  const files = Object.fromEntries(NEW_PAGES.map((f) => [f, read(f)]));
  files[NEW_PAGES[1]] = files[NEW_PAGES[1]].replace("await requireAdmin();", "").replace("if (!college) notFound();", "if (!college) notFound();\n  await requireAdmin();");
  files[NEW_PAGES[2]] = files[NEW_PAGES[2]].replace("await requireAdmin();", "");
  assert.deepEqual(unguardedPages(files), [NEW_PAGES[1], NEW_PAGES[2]]);
});

test("family data is read only through the console client, and the standing panel adds no second access log", () => {
  const standing = read("lib/admin/standing.ts");
  assert.match(standing, /await requireAdmin\(\);\n\s+const supabase = await adminSupabase\(\);/);
  assert.match(standing, /estimateWithDetail\(/);
  assert.doesNotMatch(standing, /createServerSupabase|logStudentView|admin_log_access/);
  assert.match(standing, /export const standingForStudent = cache\(/);
  const hs = read("lib/admin/high-school.ts");
  assert.match(hs, /await requireAdmin\(\);[\s\S]*const supabase = await adminSupabase\(\);[\s\S]*from\("school_course_counts"\)/);
  assert.doesNotMatch(hs, /createServerSupabase|supabaseClient\(/);
  const slot = read("components/admin/StandingPanelSlot.tsx");
  assert.doesNotMatch(slot, /^\s*["']use client["']/);
  assert.match(slot, /await standingForStudent\(studentId\)/);
  for (const f of ["lib/admin/hidden.ts", "lib/admin/standing.ts", "lib/admin/college.ts", "lib/admin/high-school.ts"]) assert.match(read(f), /^import "server-only";/, f);
});

test("app code never reads data files directly: the loaders go through getData() and the high-school store", () => {
  for (const f of [...NEW_PAGES, "lib/admin/college.ts", "lib/admin/high-school.ts", "lib/admin/standing.ts", "lib/admin/hidden.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /readFileSync|from ["'][^"']*data\/[^"']*\.json["']|selectivity-index/, f);
  }
});

/* The admin rail already routes /admin/colleges and /admin/high-schools to Colleges (tests/admin-console-ui.test.mts). */
test("every new page lives under the Colleges section of the console", () => {
  for (const f of NEW_PAGES) assert.ok(statSync(join(ROOT, f)).isFile(), f);
  const dirs = readdirSync(join(ROOT, "app", "admin"));
  assert.ok(dirs.includes("colleges") && dirs.includes("high-schools"));
  // Every SnapshotDetail key the panel reads is one the type declares (a rename in the method would surface here).
  for (const k of ["hiddenOdds", "without", "position", "baseRateKind", "baseRate", "crowded", "rigorReading", "selectivityTier", "completeness", "stateUsed", "depth"]) assert.ok(DETAIL_KEYS.includes(k), k);
  void FIELDS;
});
