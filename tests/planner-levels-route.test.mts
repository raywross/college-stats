/**
 * POST /api/plan/levels (app/api/plan/levels/route.ts; specs/planner/record/reading.md "Beside a college you might
 * add"): signed out is a 401, more than 12 ids is a 400 (the cap), a student the caller can't see is a 404
 * (`loadPlanFor` is the access check — a fake client with no access to try it), and the response carries only
 * `levels`/`sorted`, never another estimate field. A profile with no grades or test reads as `sorted: false` and
 * every id null, without needing the real dataset or estimate pipeline (the route returns before calling either).
 * `@/lib/auth` and `@/lib/planner/load` are stubbed (so this runs with no request, session, or database); every
 * other import is the real module, resolved the way `tests/chances-estimate-ui.test.mts` resolves "@/" and
 * `server-only` outside Next's bundler. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");

/* ------------------------------------------------------------------ */
/* Fakes `@/lib/auth`'s getUser and `@/lib/planner/load`'s loadPlanFor */
/* carry across the data: URL module boundary through globalThis.      */
/* ------------------------------------------------------------------ */

const state = { user: null as { id: string } | null, load: null as unknown };
(globalThis as Record<string, unknown>).__r6LevelsTestState = state;

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const dataModule = (src: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return dataModule("export {}");
    if (specifier === "next/headers") {
      return dataModule("export function cookies(){throw new Error('no request')} export function headers(){throw new Error('no request')}");
    }
    if (specifier === "next/server") {
      return dataModule(`export class NextResponse extends Response {
        static json(body, init) { return new NextResponse(JSON.stringify(body), { ...init, headers: { ...(init?.headers ?? {}), "Content-Type": "application/json" } }); }
      }`);
    }
    if (specifier === "@/lib/auth") return dataModule(`export async function getUser(){ return globalThis.__r6LevelsTestState.user; }`);
    if (specifier === "@/lib/planner/load") return dataModule(`export async function loadPlanFor(){ return globalThis.__r6LevelsTestState.load; }`);
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const { POST } = await import("../app/api/plan/levels/route.ts");

function post(body: unknown): Promise<Response> {
  return POST(new Request("http://localhost/api/plan/levels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

const READY_EMPTY_PROFILE = { kind: "ready", ctx: { profile: null, items: [], visits: [], gradYear: null } };

/* ------------------------------------------------------------------ */

test("POST /api/plan/levels: signed out is 401", async () => {
  state.user = null;
  state.load = null;
  const res = await post({ studentId: "s1", unitIds: ["1"] });
  assert.equal(res.status, 401);
});

test("POST /api/plan/levels: more than 12 ids is 400 (the cap)", async () => {
  state.user = { id: "u1" };
  state.load = READY_EMPTY_PROFILE;
  const unitIds = Array.from({ length: 13 }, (_, i) => String(i + 1));
  const res = await post({ studentId: "s1", unitIds });
  assert.equal(res.status, 400);
});

test("POST /api/plan/levels: exactly 12 ids is allowed (the cap's own edge)", async () => {
  state.user = { id: "u1" };
  state.load = READY_EMPTY_PROFILE;
  const unitIds = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const res = await post({ studentId: "s1", unitIds });
  assert.equal(res.status, 200);
});

test("POST /api/plan/levels: a student the caller can't see (loadPlanFor's access check) is 404", async () => {
  state.user = { id: "u1" };
  state.load = { kind: "not-found" };
  const res = await post({ studentId: "stranger", unitIds: ["1", "2"] });
  assert.equal(res.status, 404);
});

test("POST /api/plan/levels: a plan that isn't ready yet (no list) reads the same as access denied", async () => {
  state.user = { id: "u1" };
  state.load = { kind: "empty" };
  const res = await post({ studentId: "s1", unitIds: ["1"] });
  assert.equal(res.status, 404);
});

test("POST /api/plan/levels: the response carries only levels and sorted, no other estimate field", async () => {
  state.user = { id: "u1" };
  state.load = READY_EMPTY_PROFILE;
  const res = await post({ studentId: "s1", unitIds: ["1", "2"] });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["levels", "sorted"]);
});

test("POST /api/plan/levels: no grades or test on the profile reads as sorted:false with every id null (never the dataset)", async () => {
  state.user = { id: "u1" };
  state.load = READY_EMPTY_PROFILE;
  const res = await post({ studentId: "s1", unitIds: ["1", "2", "3"] });
  const body = (await res.json()) as { levels: Record<string, unknown>; sorted: boolean };
  assert.equal(body.sorted, false);
  assert.deepEqual(body.levels, { "1": null, "2": null, "3": null });
});

test("POST /api/plan/levels: a bad body (no studentId, or unitIds not a list) is 400", async () => {
  state.user = { id: "u1" };
  state.load = READY_EMPTY_PROFILE;
  assert.equal((await post({ unitIds: ["1"] })).status, 400);
  assert.equal((await post({ studentId: "s1", unitIds: [] })).status, 400);
  assert.equal((await post({ studentId: "s1", unitIds: "1" })).status, 400);
});
