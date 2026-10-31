/**
 * What the Data console's two buttons do (specs/data-platform/publish.md "The admin's publish controls";
 * specs/data-platform/change-sets.md "The console"), over injected dependencies so tests/admin-data.test.mts runs
 * every path with no network and no database, the way tests/admin-ops.test.mts runs lib/admin/ops-actions.ts.
 * app/admin/data/actions.ts calls requireAdmin() first, builds the real dependencies, and hands the form here.
 *
 * - **Publish now** just dispatches `publish-snapshot.yml` with `force` through the existing dispatch path
 *   (`dispatchRun`, `lib/admin/workflows.ts`'s `publish-snapshot` row), logged `ops.dispatch` like every other run.
 * - **Point back here** is two steps, in order: `admin_data_point_snapshot` (which logs `data.point` itself, in the
 *   same transaction as the database change) and then the workflow's `point` job, dispatched the same way as any
 *   other run (logged `ops.dispatch`). If the RPC refuses — the id doesn't exist, a later publish has already moved
 *   on — nothing is dispatched. A typed confirmation ("point back") guards the button, re-checked here: a forged
 *   form without it changes nothing.
 */
import type { OpsDeps, OpsState } from "./ops-actions.ts";
import { dispatchRun } from "./ops-actions.ts";
import { typedMatches, type AdminActionState } from "./console.ts";

/** The word typed to move the live pointer to an older snapshot. */
export const CONFIRM_POINT_BACK = "point back";

function fromOpsState(state: OpsState): AdminActionState {
  if (state.status === "idle") return state;
  if (state.status === "error") return state;
  return { status: "done", message: state.link ? `${state.message} ${state.link.label}: ${state.link.href}` : state.message };
}

/** One `admin_data_point_snapshot` call. The real one is `lib/admin/people.ts`'s `adminSupabase()`, mapped through `adminErrorMessage`. */
export interface PointSnapshotRpc {
  (id: number): Promise<{ ok: true } | { ok: false; message: string }>;
}

export interface DataActionDeps {
  ops: OpsDeps;
  pointSnapshot: PointSnapshotRpc;
}

/** Publish now: specs/data-platform/publish.md "The admin's publish controls". */
export async function publishNow(deps: DataActionDeps): Promise<AdminActionState> {
  return fromOpsState(await dispatchRun(deps.ops, { run: "publish-snapshot", values: {} }));
}

/** The slice of a form these actions read (FormData in production). */
export interface DataFormLike {
  get(name: string): unknown;
}

/** A snapshot id from a form field, or null when it isn't a positive integer. */
export function snapshotIdFromForm(form: DataFormLike): number | null {
  const raw = form.get("snapshot");
  const text = typeof raw === "string" ? raw.trim() : "";
  const n = Number(text);
  return text !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

const BAD_SNAPSHOT: AdminActionState = { status: "error", message: "That snapshot wasn't recognized. Reload the page and try again." };

export async function pointBackHere(deps: DataActionDeps, form: DataFormLike): Promise<AdminActionState> {
  const id = snapshotIdFromForm(form);
  if (id === null) return BAD_SNAPSHOT;
  if (!typedMatches(form.get("confirm"), CONFIRM_POINT_BACK)) return { status: "error", message: `Type "${CONFIRM_POINT_BACK}" to confirm.` };

  const pointed = await deps.pointSnapshot(id);
  if (!pointed.ok) return { status: "error", message: pointed.message };

  return fromOpsState(await dispatchRun(deps.ops, { run: "point-snapshot", values: { point: String(id) } }));
}
