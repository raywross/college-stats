/**
 * What the Data console's buttons do (specs/data-platform/publish.md "The admin's publish controls";
 * specs/data-platform/change-sets.md "The console", "Holds and review", "Revert"), over injected dependencies so
 * tests/admin-data.test.mts runs every path with no network and no database, the way tests/admin-ops.test.mts runs
 * lib/admin/ops-actions.ts. app/admin/data/actions.ts calls requireAdmin() first, builds the real dependencies, and
 * hands the form here.
 *
 * - **Publish now** dispatches `publish-snapshot.yml` with `force` through the existing dispatch path (`dispatchRun`,
 *   `lib/admin/workflows.ts`'s `publish-snapshot` row), logged `ops.dispatch` before it is sent, like every run.
 * - **Point back here**: `admin_data_point_snapshot` (which logs `data.point` in the same transaction), then the
 *   workflow's `point` job, dispatched the same way. A refused RPC dispatches nothing. Typed confirmation "point back".
 * - **Hold** (`admin_data_hold`, a reason required), **Publish anyway** (`admin_data_unhold`, then the publish
 *   dispatched with `force`, logged first), **Revert** (`admin_data_revert`, typed confirmation "revert"; a refusal
 *   because a later change set touched a document comes back naming it, so the admin reverts that one first).
 * - The held review items' **Accept the value**, **Reject** and **Re-run discovery** run lib/admin/ops-actions.ts
 *   with the store reads and these functions.
 *
 * Every `admin_data_*` function logs its own `data.*` row with before and after, in the same transaction as the
 * change, so nothing here can change data without a log row; only GitHub dispatches log separately, before sending.
 */
import type { OpsDeps, OpsState, ReviewDeps } from "./ops-actions.ts";
import { acceptReviewItem, dispatchRun, noteFromForm, rediscoverReviewItem, rejectReviewItem, reviewKeyFromForm } from "./ops-actions.ts";
import { ADMIN_FAILED, CONFIRM_REVERT, typedMatches, type AdminActionState } from "./console.ts";
import { ADMIN_ERRORS } from "./constants.ts";
import type { ReviewItem } from "../reported.ts";

/** The word typed to move the live pointer to an older snapshot. */
export const CONFIRM_POINT_BACK = "point back";
/** The word typed to revert a change set (defined in console.ts so client components can import it without this module). */
export { CONFIRM_REVERT } from "./console.ts";

function fromOpsState(state: OpsState): AdminActionState {
  if (state.status === "idle") return state;
  if (state.status === "error") return state;
  return { status: "done", message: state.link ? `${state.message} ${state.link.label}: ${state.link.href}` : state.message };
}

/** One `admin_data_point_snapshot` call. The real one is `lib/admin/people.ts`'s `adminSupabase()`, mapped through `adminErrorMessage`. */
export interface PointSnapshotRpc {
  (id: number): Promise<{ ok: true } | { ok: false; message: string }>;
}

/** The console's `admin_data_*` functions this module calls, by name. */
export type DataFunction = "admin_data_hold" | "admin_data_unhold" | "admin_data_revert" | "admin_data_edit" | "admin_data_release_edit" | "admin_data_resolve_review";

/** One `admin_data_*` call with the admin's session: the result, or the database's raw error text (mapped here). */
export interface DataRpc {
  (fn: DataFunction, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}

export interface DataActionDeps {
  ops: OpsDeps;
  pointSnapshot: PointSnapshotRpc;
  rpc: DataRpc;
  /** `reported.review_queue` documents by key (lib/admin/review-queue.ts `readDocuments`). */
  readItems(keys: string[]): Promise<Map<string, ReviewItem>>;
}

/* ------------------------------------------------------------------ */
/* Refusals in plain words                                             */
/* ------------------------------------------------------------------ */

const DATA_ERRORS: Record<string, string> = {
  change_set_not_found: "That change set doesn't exist. Reload the page.",
  change_set_not_applied: "Only an applied change set can be held.",
  change_set_published: "A snapshot already carries this change set, so holding it changes nothing. Revert it instead.",
  change_set_not_held: "That change set isn't held any more. Reload the page.",
  change_set_not_revertible: "Only an applied or held change set can be reverted.",
  reason_required: "Say why it's held (up to 500 characters).",
  invalid_note: "Keep the note under 500 characters.",
  invalid_unit: "That isn't a college's unit id.",
  invalid_path: "That isn't a field the console can edit.",
  edit_not_found: "That edit doesn't exist any more. Reload the page.",
  edit_released: "That edit was already released. Reload the page.",
  invalid_resolution: "Pick accepted or rejected.",
  review_item_not_found: "That item is no longer held. Reload the page.",
  "version conflict": "Someone changed that item a moment ago. Reload the page and try again.",
  "change set is not open": "That change couldn't be written. Reload the page and try again.",
};

/**
 * The plain-words message for an `admin_data_*` refusal. A revert refused because a later change set touched one of
 * the documents ("later change set touched reported.entries/166027 (change set 45)") names that set and the document,
 * so the admin can revert it first (newest first keeps history a straight line).
 */
export function dataErrorMessage(raw: string | null | undefined): string {
  const text = raw ?? "";
  const later = /later change set touched (.+) \(change set (\d+)\)/.exec(text);
  if (later) return `Change set #${later[2]} changed ${later[1]} after this one. Revert #${later[2]} first, then this one.`;
  if (/\badmin only\b/.test(text)) return ADMIN_ERRORS["admin only"];
  const key = Object.keys(DATA_ERRORS).find((k) => text.includes(k));
  return key ? DATA_ERRORS[key] : ADMIN_FAILED;
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

/** The slice of a form these actions read (FormData in production). */
export interface DataFormLike {
  get(name: string): unknown;
}

const positiveId = (raw: unknown): number | null => {
  const text = typeof raw === "string" ? raw.trim() : "";
  const n = Number(text);
  return text !== "" && /^\d+$/.test(text) && Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** A snapshot id from a form field, or null when it isn't a positive integer. */
export function snapshotIdFromForm(form: DataFormLike): number | null {
  return positiveId(form.get("snapshot"));
}

/** A change set id from a form field, or null when it isn't a positive integer. */
export function changeSetIdFromForm(form: DataFormLike): number | null {
  return positiveId(form.get("change_set"));
}

/** A reason or note from a form: one trimmed line, or null when empty. Longer than 500 characters is refused by the function. */
function lineFromForm(form: DataFormLike, name: string): string | null {
  const raw = form.get(name);
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return text || null;
}

const BAD_SNAPSHOT: AdminActionState = { status: "error", message: "That snapshot wasn't recognized. Reload the page and try again." };
const BAD_CHANGE_SET: AdminActionState = { status: "error", message: "That change set wasn't recognized. Reload the page and try again." };
const BAD_ITEM: AdminActionState = { status: "error", message: "That item wasn't recognized. Reload the page and try again." };

/* ------------------------------------------------------------------ */
/* Overview and Snapshots                                              */
/* ------------------------------------------------------------------ */

/** Publish now: specs/data-platform/publish.md "The admin's publish controls". */
export async function publishNow(deps: DataActionDeps): Promise<AdminActionState> {
  return fromOpsState(await dispatchRun(deps.ops, { run: "publish-snapshot", values: {} }));
}

export async function pointBackHere(deps: DataActionDeps, form: DataFormLike): Promise<AdminActionState> {
  const id = snapshotIdFromForm(form);
  if (id === null) return BAD_SNAPSHOT;
  if (!typedMatches(form.get("confirm"), CONFIRM_POINT_BACK)) return { status: "error", message: `Type "${CONFIRM_POINT_BACK}" to confirm.` };

  const pointed = await deps.pointSnapshot(id);
  if (!pointed.ok) return { status: "error", message: pointed.message };

  return fromOpsState(await dispatchRun(deps.ops, { run: "point-snapshot", values: { point: String(id) } }));
}

/* ------------------------------------------------------------------ */
/* Change sets: Hold, Publish anyway, Revert                            */
/* ------------------------------------------------------------------ */

/** Hold: the automatic publish stops at this set (and every later one) until someone publishes anyway or reverts it. */
export async function holdChangeSet(deps: DataActionDeps, form: DataFormLike): Promise<AdminActionState> {
  const id = changeSetIdFromForm(form);
  if (id === null) return BAD_CHANGE_SET;
  const reason = lineFromForm(form, "reason");
  if (!reason) return { status: "error", message: DATA_ERRORS.reason_required };
  const r = await deps.rpc("admin_data_hold", { p_change_set: id, p_reason: reason });
  if (!r.ok) return { status: "error", message: dataErrorMessage(r.error) };
  return { status: "done", message: `Change set #${id} is held. Nothing from it or later publishes until it is published anyway or reverted.` };
}

/**
 * Publish anyway: `admin_data_unhold`, then the publisher dispatched with `force` (logged `ops.dispatch` before it is
 * sent). A refused unhold dispatches nothing; a dispatch that fails after the unhold says so (the set is applied, so
 * Publish now on the Overview, or the nightly publish, carries it).
 */
export async function publishAnyway(deps: DataActionDeps, form: DataFormLike): Promise<AdminActionState> {
  const id = changeSetIdFromForm(form);
  if (id === null) return BAD_CHANGE_SET;
  const r = await deps.rpc("admin_data_unhold", { p_change_set: id });
  if (!r.ok) return { status: "error", message: dataErrorMessage(r.error) };
  const sent = await dispatchRun(deps.ops, { run: "publish-snapshot", values: {} });
  if (sent.status === "error") return { status: "error", message: `Change set #${id} is no longer held, but the publish didn't start: ${sent.message} Publish now on the Overview carries it.` };
  return fromOpsState(sent.status === "done" ? { ...sent, message: `Change set #${id} is no longer held. ${sent.message}` } : sent);
}

/**
 * Revert: a new `revert` change set restoring the version before this one of every document it touched (and
 * releasing its field edits). Refused when a later change set touched one of them; the message names it. The next
 * publish carries the revert; to undo a publish at once, Point back here on Snapshots.
 */
export async function revertChangeSet(deps: DataActionDeps, form: DataFormLike): Promise<AdminActionState> {
  const id = changeSetIdFromForm(form);
  if (id === null) return BAD_CHANGE_SET;
  if (!typedMatches(form.get("confirm"), CONFIRM_REVERT)) return { status: "error", message: `Type "${CONFIRM_REVERT}" to confirm.` };
  const r = await deps.rpc("admin_data_revert", { p_change_set: id, p_note: lineFromForm(form, "note") });
  if (!r.ok) return { status: "error", message: dataErrorMessage(r.error) };
  const revert = typeof r.data === "number" ? r.data : Number(r.data);
  return { status: "done", message: `Reverted: change set #${Number.isFinite(revert) && revert > 0 ? revert : "?"} puts back what #${id} changed. The next publish carries it.` };
}

/* ------------------------------------------------------------------ */
/* Holds: the held review items                                        */
/* ------------------------------------------------------------------ */

/** The review actions' dependencies, from the Data console's: the store read and the two functions. */
export function reviewDeps(deps: DataActionDeps): ReviewDeps {
  return {
    ops: deps.ops,
    readItems: (keys) => deps.readItems(keys),
    async edit(unit, path, value, note) {
      const r = await deps.rpc("admin_data_edit", { p_unit: unit, p_path: path, p_value: value, p_note: note });
      return r.ok ? { ok: true } : { ok: false, message: dataErrorMessage(r.error) };
    },
    async resolve(key, resolution, note) {
      const r = await deps.rpc("admin_data_resolve_review", { p_key: key, p_resolution: resolution, p_note: note });
      return r.ok ? { ok: true } : { ok: false, message: dataErrorMessage(r.error) };
    },
  };
}

/** Accept the value: field edits with today's mapping, then the items resolved `accepted`. */
export async function acceptHeldItem(deps: DataActionDeps, form: DataFormLike): Promise<AdminActionState> {
  const key = reviewKeyFromForm(form);
  if (key === null) return BAD_ITEM;
  return fromOpsState(await acceptReviewItem(reviewDeps(deps), key));
}

/** Reject: the item resolved `rejected`, with the admin's optional note. */
export async function rejectHeldItem(deps: DataActionDeps, form: DataFormLike): Promise<AdminActionState> {
  const key = reviewKeyFromForm(form);
  if (key === null) return BAD_ITEM;
  return fromOpsState(await rejectReviewItem(reviewDeps(deps), key, noteFromForm(form)));
}

/** Re-run discovery: the college run with `rediscover`, logged `review.rediscover` before it is sent. */
export async function rediscoverHeldItem(deps: DataActionDeps, form: DataFormLike): Promise<AdminActionState> {
  const key = reviewKeyFromForm(form);
  if (key === null) return BAD_ITEM;
  return fromOpsState(await rediscoverReviewItem(reviewDeps(deps), key));
}
