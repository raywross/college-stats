/**
 * What each Operations button does (specs/product/admin.md "Operations: reruns and approvals"), over injected
 * dependencies so `tests/admin-ops.test.mts` runs every path with no network and no database. The Server Actions in
 * app/admin/operations/actions.ts call `requireAdmin()` first, build the real dependencies (lib/admin/ops.ts), and hand
 * the form to one of these.
 *
 * Rules every action here keeps:
 * - **Log before sending.** `deps.note` (the `admin_note_ops` function: one `admin_log` row) is awaited before the
 *   first call that changes anything on GitHub, and a failed note stops the action: nothing is sent that the log does
 *   not show. A send that then fails is logged too (`ops.failed` / `review.failed`).
 * - **Public text carries a display name, never an email.** The repository is public; hold and close comments name
 *   the admin by `deps.adminName()` (which falls back to "an admin"), and `publicName` refuses anything that looks
 *   like an address.
 * - **The form is not trusted.** A dispatch is rebuilt from the console's own table (`buildDispatch`); a held review
 *   item is read from the store by its key, and the values an Accept writes come from that document, not the form.
 *
 * The held review items (specs/data-platform/change-sets.md "Holds and review") no longer open pull requests: Accept
 * the value writes field edits through `admin_data_edit`, Reject resolves the item through `admin_data_resolve_review`
 * (both log `data.*` in the same transaction as the change), and Re-run discovery dispatches as before.
 */
import type { DispatchResult, MergeResult, PullActionResult, WorkflowRun } from "../github-app.ts";
import { reviewKey, type ReviewItem } from "../reported.ts";
import { acceptNote, acceptPlan, siblingKeys } from "./review-queue.ts";
import { blockingRun, buildDispatch, runById, type DispatchableRun } from "./workflows.ts";

export type OpsState = { status: "idle" } | { status: "done"; message: string; link?: { href: string; label: string } } | { status: "error"; message: string };

/** The GitHub calls the actions make (lib/github-app.ts, wired in lib/admin/ops.ts). */
export interface OpsGithub {
  configured(): boolean;
  dispatchWorkflow(file: string, inputs: Record<string, string>, requestId: string, opts: { ref: string }): Promise<DispatchResult>;
  listRuns(workflows: string[]): Promise<WorkflowRun[]>;
  findRunByRequestId(requestId: string): Promise<WorkflowRun | null>;
  mergePull(n: number): Promise<MergeResult>;
  holdPull(n: number, admin: string): Promise<PullActionResult>;
  closePull(n: number, admin: string): Promise<PullActionResult>;
}

export interface OpsDeps {
  gh: OpsGithub;
  /** One `admin_log` row (`admin_note_ops`): `ops.*` and `review.*` actions only. */
  note(action: string, details: Record<string, unknown>, requestId: string | null): Promise<{ ok: true } | { ok: false; message: string }>;
  /** The acting admin's display name for public text; already safe (`publicName`). */
  adminName(): Promise<string>;
  now(): Date;
  requestId(): string;
  sleep(ms: number): Promise<void>;
}

const NOT_CONFIGURED: OpsState = { status: "error", message: "GitHub isn't set up for the console yet, so nothing can be sent." };
const err = (message: string): OpsState => ({ status: "error", message });

/** How long, and how often, a dispatch waits for GitHub to show the run it started. */
export const FIND_RUN_ATTEMPTS = 4;
export const FIND_RUN_DELAY_MS = 1500;

/**
 * A display name safe for a public comment or commit message: one line, no control characters, nothing that looks like
 * an email address. An unusable name becomes "an admin".
 */
export function publicName(displayName: string | null | undefined): string {
  const name = (displayName ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!name || name.includes("@") || /\b[\w-]+\.[a-z]{2,}\b/i.test(name)) return "an admin";
  return name.slice(0, 80);
}

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

async function logBefore(deps: OpsDeps, action: string, details: Record<string, unknown>, requestId: string | null): Promise<OpsState | null> {
  const r = await deps.note(action, details, requestId);
  return r.ok ? null : err(`The action was not sent because it could not be logged: ${r.message}`);
}

/** Records that a logged action then failed to send. Best effort: the original failure is what the admin sees. */
async function logFailure(deps: OpsDeps, family: "ops" | "review", action: string, reason: string, requestId: string | null): Promise<void> {
  await deps.note(`${family}.failed`, { action, reason: reason.slice(0, 300) }, requestId).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

/** The slice of a form the actions read (FormData in production). */
export interface FormLike {
  get(name: string): unknown;
}

const text = (form: FormLike, name: string) => (typeof form.get(name) === "string" ? (form.get(name) as string) : "");

/** A dispatch form's typed values: a checkbox is true when ticked and false when not (the form shows every input). */
export function readDispatchForm(form: FormLike): { run: string; values: Record<string, string | boolean>; confirm: string; branch: string } {
  const run = runById(text(form, "run"));
  const values: Record<string, string | boolean> = {};
  for (const input of run?.inputs ?? []) {
    values[input.name] = input.kind === "boolean" ? form.get(input.name) === "on" : text(form, input.name);
  }
  return { run: run?.id ?? text(form, "run"), values, confirm: text(form, "confirm"), branch: text(form, "branch") };
}

interface DispatchOptions {
  /** The log action: `ops.dispatch` from a run form, `review.rediscover` from the review queue. */
  logAction: "ops.dispatch" | "review.rediscover";
  /** Extra log details (the queue item the dispatch settles). */
  details?: Record<string, unknown>;
}

async function waitForRun(deps: OpsDeps, requestId: string): Promise<WorkflowRun | null> {
  for (let attempt = 0; attempt < FIND_RUN_ATTEMPTS; attempt++) {
    if (attempt > 0) await deps.sleep(FIND_RUN_DELAY_MS);
    const run = await deps.gh.findRunByRequestId(requestId).catch(() => null);
    if (run) return run;
  }
  return null;
}

/**
 * Starts a run from the console's table. Order: build the dispatch from the typed table, check the one-at-a-time guard
 * against the live runs, log `ops.dispatch` (with the request id), send it, then look the run up by its request id.
 */
export async function dispatchRun(
  deps: OpsDeps,
  request: { run: string; values: Record<string, string | boolean | undefined>; confirm?: string; branch?: string },
  options: DispatchOptions = { logAction: "ops.dispatch" },
): Promise<OpsState> {
  if (!deps.gh.configured()) return NOT_CONFIGURED;
  const built = buildDispatch(request.run, request.values, { confirm: request.confirm, branch: request.branch });
  if (!built.ok) return err(`Check the form: ${built.errors.join("; ")}.`);

  const row: DispatchableRun = built.run;
  if (row.guards.oneAtATime) {
    const running = blockingRun(row, await deps.gh.listRuns([row.workflow]));
    if (running) return err(`A run of this workflow is already ${running.status === "queued" ? "queued" : "in progress"} (${running.title || running.name}). Wait for it to finish.`);
  }

  const requestId = deps.requestId();
  const blocked = await logBefore(deps, options.logAction, { run: row.id, workflow: built.file, ref: built.ref, inputs: built.inputs, ...options.details }, requestId);
  if (blocked) return blocked;

  const sent = await deps.gh.dispatchWorkflow(built.file, built.inputs, requestId, { ref: built.ref });
  if (!sent.ok) {
    await logFailure(deps, "ops", options.logAction, sent.reason, requestId);
    return err(`GitHub refused the run: ${sent.reason}.`);
  }
  const found = await waitForRun(deps, requestId);
  return found
    ? { status: "done", message: `${row.label} started.`, link: { href: found.url, label: `Run #${found.runNumber} on GitHub` } }
    : { status: "done", message: `${row.label} was sent. GitHub hasn't listed the run yet; it appears under Runs in a moment.` };
}

/* ------------------------------------------------------------------ */
/* Pull requests                                                       */
/* ------------------------------------------------------------------ */

/** A pull request number from a form field, or null. */
export function pullNumber(form: FormLike): number | null {
  const n = Number(text(form, "pull"));
  return Number.isInteger(n) && n > 0 && n < 10_000_000 ? n : null;
}

const MERGE_REFUSALS: Record<string, string> = {
  checks_pending: "Not merged: the checks are still running or haven't started. Re-run CI starts them.",
  checks_failed: "Not merged: a check failed. Look at the failure on GitHub.",
};

export async function mergeDataPull(deps: OpsDeps, n: number): Promise<OpsState> {
  if (!deps.gh.configured()) return NOT_CONFIGURED;
  const blocked = await logBefore(deps, "ops.merge", { pull: n }, null);
  if (blocked) return blocked;
  const r = await deps.gh.mergePull(n);
  if (r.ok) return { status: "done", message: `Pull request #${n} was merged.` };
  await logFailure(deps, "ops", "ops.merge", r.reason === "error" ? (r.detail ?? "error") : r.reason, null);
  return err(MERGE_REFUSALS[r.reason] ?? `Not merged: ${r.detail ?? "GitHub refused"}.`);
}

export async function holdDataPull(deps: OpsDeps, n: number): Promise<OpsState> {
  if (!deps.gh.configured()) return NOT_CONFIGURED;
  const blocked = await logBefore(deps, "ops.hold", { pull: n }, null);
  if (blocked) return blocked;
  const r = await deps.gh.holdPull(n, await deps.adminName());
  if (r.ok) return { status: "done", message: `Pull request #${n} is held: auto-merge is off.` };
  await logFailure(deps, "ops", "ops.hold", r.reason, null);
  return err(`Not held: ${r.reason}.`);
}

export async function closeDataPull(deps: OpsDeps, n: number): Promise<OpsState> {
  if (!deps.gh.configured()) return NOT_CONFIGURED;
  const blocked = await logBefore(deps, "ops.close", { pull: n }, null);
  if (blocked) return blocked;
  const r = await deps.gh.closePull(n, await deps.adminName());
  if (r.ok) return { status: "done", message: `Pull request #${n} was closed.` };
  await logFailure(deps, "ops", "ops.close", r.reason, null);
  return err(`Not closed: ${r.reason}.`);
}

/* ------------------------------------------------------------------ */
/* Held review items: Accept the value, Reject, Re-run discovery       */
/* ------------------------------------------------------------------ */

export type RpcResult = { ok: true } | { ok: false; message: string };

/**
 * What the held items' three actions need besides GitHub: the review items in the store (with the admin's session),
 * and the two `admin_data_*` functions. The real ones are in app/admin/data/actions.ts; `message` is already in plain
 * words (lib/admin/data-actions.ts `dataErrorMessage`).
 */
export interface ReviewDeps {
  ops: OpsDeps;
  /** `reported.review_queue` documents by key; a key that isn't there is left out. */
  readItems(keys: string[]): Promise<Map<string, ReviewItem>>;
  /** `admin_data_edit(unit, path, value, note)`: one field edit, logged `data.edit`. */
  edit(unit: string, path: string, value: unknown, note: string): Promise<RpcResult>;
  /** `admin_data_resolve_review(key, resolution, note)`, logged `data.review`. */
  resolve(key: string, resolution: "accepted" | "rejected", note: string | null): Promise<RpcResult>;
}

/** A review item's key from a form (`unit|edition|code`), or null when it isn't one. */
export function reviewKeyFromForm(form: FormLike): string | null {
  const key = text(form, "item");
  return /^\d{1,12}\|[^|]{0,40}\|[^|]{0,20}$/.test(key) ? key : null;
}

/** An optional note from a form: one trimmed string up to 500 characters, or null. */
export function noteFromForm(form: FormLike): string | null {
  const note = text(form, "note").replace(/\s+/g, " ").trim();
  return note ? note.slice(0, 500) : null;
}

async function openItem(deps: ReviewDeps, key: string, keys: string[] = [key]): Promise<{ ok: true; item: ReviewItem; items: Map<string, ReviewItem> } | { ok: false; state: OpsState }> {
  let items: Map<string, ReviewItem>;
  try {
    items = await deps.readItems(keys);
  } catch (e) {
    return { ok: false, state: err(`Couldn't read the held item: ${e instanceof Error ? e.message : String(e)}.`) };
  }
  const item = items.get(key);
  if (!item) return { ok: false, state: err("That item is no longer held. Reload the page.") };
  if (item.resolved) return { ok: false, state: err(`That item was already ${item.resolved}.`) };
  return { ok: true, item, items };
}

/**
 * Accept the value: today's mapping (`acceptPlan`) as field edits, one `admin_data_edit` per field with the note
 * "Accepted from the review queue: {document}", then each settled item resolved `accepted`. Nothing is written when
 * the plan refuses. The edits go first so an item is never marked accepted without its value; an edit that fails stops
 * the rest and says how far it got (the edits already made stand, each its own change set, and Accept can be pressed
 * again once the cause is fixed: the item is still open).
 */
export async function acceptReviewItem(deps: ReviewDeps, key: string): Promise<OpsState> {
  const found = await openItem(deps, key, siblingKeys(key));
  if (!found.ok) return found.state;
  const plan = acceptPlan(found.item, [...found.items.values()]);
  if (!plan.ok) return err(plan.message);

  const note = acceptNote(plan.url);
  const fields = Object.entries(plan.values);
  for (const [i, [path, value]] of fields.entries()) {
    const r = await deps.edit(found.item.unit_id, path, value, note);
    if (!r.ok) return err(i === 0 ? `Nothing was accepted: ${r.message}` : `Stopped after ${i} of ${fields.length} edits (${path} failed): ${r.message}`);
  }
  for (const settled of plan.items) {
    const r = await deps.resolve(reviewKey(settled), "accepted", null);
    if (!r.ok) return err(`The values were saved as edits, but ${settled.code ?? "the item"} couldn't be marked accepted: ${r.message}`);
  }
  const n = fields.length;
  return { status: "done", message: `Accepted: ${n} value${n === 1 ? "" : "s"} for ${found.item.name} saved as edits. The next snapshot publishes them.` };
}

/** Reject: the item is resolved `rejected` (with the admin's optional note) so the next run doesn't hold it again. */
export async function rejectReviewItem(deps: ReviewDeps, key: string, note: string | null = null): Promise<OpsState> {
  const found = await openItem(deps, key);
  if (!found.ok) return found.state;
  const r = await deps.resolve(key, "rejected", note);
  if (!r.ok) return err(`Not rejected: ${r.message}`);
  return { status: "done", message: `Rejected: ${found.item.code ?? "C1"} for ${found.item.name} stays off the site.` };
}

/**
 * Re-run discovery: dispatches a `college` run with `rediscover: true` (the workflow climbs the discovery ladder from
 * the start and writes the new recipe to the store). Logged `review.rediscover` before it is sent, like every dispatch.
 */
export async function rediscoverReviewItem(deps: ReviewDeps, key: string): Promise<OpsState> {
  if (!deps.ops.gh.configured()) return NOT_CONFIGURED;
  const found = await openItem(deps, key);
  if (!found.ok) return found.state;
  return dispatchRun(
    deps.ops,
    { run: "college", values: { college: found.item.unit_id, rediscover: true } },
    { logAction: "review.rediscover", details: { unit: found.item.unit_id, code: found.item.code ?? null } },
  );
}
