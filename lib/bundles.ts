import "server-only";
/**
 * The batched reads (supabase/migrations/20261012140000_plan_bundle.sql; U20 "real speed"), with the signed-in
 * user's own session so row-level security decides, once per request: React `cache` in a render, `requestMemo` in a
 * Server Action that opens a scope (lib/request-memo.ts). Each returns null while its function isn't in the database
 * yet (or on any other error), and the caller falls back to the per-table reads it always made (lib/bundle-read.ts).
 *
 *   viewerBundle()          lib/auth.ts (account, own student, students and memberships), lib/households.ts
 *                           (households and rosters), lib/student-profile-store.ts (profiles), lib/home-store.ts (home)
 *   planBundle(student)     lib/planner/load.ts (the list and its plan, the student's grad year)
 *   freshPlanBundle(…)      store-plan.ts's follow-up pass (after the response), never memoized
 *
 * Callers check that someone is signed in first (the functions are closed to anon). The viewer bundle is a read from
 * the start of the request: a caller that writes a profile and then needs it uses what it wrote (store-plan.ts does),
 * never a second viewerBundle().
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerSupabase } from "@/lib/supabase-server";
import { requestMemo } from "@/lib/request-memo";
import { callBundle, type PlanBundle, type ViewerBundle } from "./bundle-read";

export type { PlanBundle, ViewerBundle } from "./bundle-read";

/**
 * Concurrent identical reads within one request share one call. A Server Action runs outside React's render, where
 * `cache` doesn't dedupe, and getAccount/currentStudent/studentsICanSee each ask for the bundle at the same moment.
 * Keyed by the request's cookie store (one object per request) and only while the call is in flight, so nothing is
 * ever served from before a write the same request made after it.
 */
const inflight = new WeakMap<object, Map<string, Promise<unknown>>>();

async function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  let owner: object | null = null;
  try {
    owner = await cookies();
  } catch {
    owner = null;
  }
  if (!owner) return load();
  let calls = inflight.get(owner);
  if (!calls) inflight.set(owner, (calls = new Map()));
  const hit = calls.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = load();
  calls.set(key, p);
  const done = () => calls.delete(key);
  p.then(done, done);
  return p;
}

function logError(fn: string, error: { message?: string }) {
  console.error(`bundles: ${fn} failed, using the per-table reads: ${error.message ?? "unknown error"}`);
}

async function loadPlanBundle(studentId: string | null, listId: string | null): Promise<PlanBundle | null> {
  const r = await callBundle<PlanBundle>(await createServerSupabase(), "plan_bundle", { p_student: studentId, p_list: listId });
  if (r.kind === "error") logError("plan_bundle", r.error);
  return r.kind === "ok" ? r.data : null;
}

/** viewer_bundle() once per request, or null (not installed, or failed: the caller reads table by table). */
export const viewerBundle = cache(
  (): Promise<ViewerBundle | null> =>
    requestMemo("viewer_bundle", () =>
      shared("viewer_bundle", async () => {
        const r = await callBundle<ViewerBundle>(await createServerSupabase(), "viewer_bundle");
        if (r.kind === "error") logError("viewer_bundle", r.error);
        return r.kind === "ok" ? r.data : null;
      }),
    ),
);

/**
 * plan_bundle(student, list) once per request and arguments, or null. `studentId` null is the caller's own student;
 * `listId` null is that student's default list.
 */
export const planBundle = cache(
  (studentId: string | null, listId: string | null = null): Promise<PlanBundle | null> => {
    const key = `plan_bundle:${studentId}:${listId}`;
    return requestMemo(key, () => shared(key, () => loadPlanBundle(studentId, listId)));
  },
);

/** plan_bundle() fresh, never memoized: for the follow-up pass after a write, which must see the write. */
export function freshPlanBundle(studentId: string | null, listId: string): Promise<PlanBundle | null> {
  return loadPlanBundle(studentId, listId);
}
