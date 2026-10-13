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
 * - **Public text carries a display name, never an email.** The repository is public; hold and close comments, commit
 *   messages, and PR bodies name the admin by `deps.adminName()` (which falls back to "an admin"), and `publicName`
 *   refuses anything that looks like an address.
 * - **The form is not trusted.** A dispatch is rebuilt from the console's own table (`buildDispatch`); a review item
 *   is found on `main` by its id, and the file edits come from the committed files, not from the form.
 */
import { PR_NUMBER_PLACEHOLDER } from "../github-app.ts";
import type { CommitAndPullOptions, CommitAndPullResult, DispatchResult, MergeResult, PullActionResult, ReadFileResult, WorkflowRun } from "../github-app.ts";
import { OVERRIDES_PATH, QUEUE_PATH, acceptChange, rejectChange, type ChangeResult, type QueueRow, type readQueue } from "./review-queue.ts";
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
  readRepoFile(path: string): Promise<ReadFileResult>;
  commitFileAndOpenPull(opts: CommitAndPullOptions): Promise<CommitAndPullResult>;
  /** The review queue on `main`; null when GitHub isn't configured. */
  readQueue(): Promise<Awaited<ReturnType<typeof readQueue>> | null>;
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
/* The review queue                                                    */
/* ------------------------------------------------------------------ */

async function openRow(deps: OpsDeps, id: string): Promise<{ ok: true; row: QueueRow; items: QueueRow["item"][] } | { ok: false; state: OpsState }> {
  const queue = await deps.gh.readQueue();
  if (!queue) return { ok: false, state: NOT_CONFIGURED };
  if (!queue.ok) return { ok: false, state: err(`Couldn't read the review queue from GitHub: ${queue.reason}.`) };
  const row = queue.rows.find((r) => r.id === id);
  if (!row) return { ok: false, state: err("That item is no longer in the review queue on main. Reload the page.") };
  if (row.status !== "open") return { ok: false, state: err(`That item was already ${row.status}.`) };
  return { ok: true, row, items: queue.items };
}

function itemDetails(row: QueueRow, change: Extract<ChangeResult, { ok: true }>) {
  return {
    unit: row.item.unit_id,
    code: row.item.code ?? null,
    edition: row.item.edition ?? row.item.entering_term ?? null,
    branch: change.change.branch,
    items: change.items.map((i) => i.code ?? "C1"),
  };
}

async function openReviewPull(deps: OpsDeps, action: "accept" | "reject", id: string): Promise<OpsState> {
  if (!deps.gh.configured()) return NOT_CONFIGURED;
  const found = await openRow(deps, id);
  if (!found.ok) return found.state;
  const path = action === "accept" ? OVERRIDES_PATH : QUEUE_PATH;
  const file = await deps.gh.readRepoFile(path);
  if (!file.ok) return err(`Couldn't read ${path} from GitHub: ${file.reason}.`);

  const ctx = { admin: await deps.adminName(), today: deps.now().toISOString().slice(0, 10), placeholder: PR_NUMBER_PLACEHOLDER };
  const change =
    action === "accept"
      ? acceptChange(found.row.item, { content: file.content, sha: file.sha }, found.items, ctx)
      : rejectChange(found.row.item, { content: file.content, sha: file.sha }, ctx);
  if (!change.ok) return err(change.message);

  const requestId = deps.requestId();
  const blocked = await logBefore(deps, `review.${action}`, itemDetails(found.row, change), requestId);
  if (blocked) return blocked;

  const opened = await deps.gh.commitFileAndOpenPull(change.change);
  if (!opened.ok) {
    await logFailure(deps, "review", `review.${action}`, opened.reason, requestId);
    return err(opened.reason === "branch_exists" ? "A change to this item was already started today; look for its pull request." : `Couldn't open the pull request: ${opened.reason}.`);
  }
  const verb = action === "accept" ? "Accepted" : "Rejected";
  return {
    status: "done",
    message: `${verb}: pull request #${opened.number} opened${opened.autoMerge ? " with auto-merge on" : ""}. It merges when its checks pass.`,
    link: { href: opened.url, label: `Pull request #${opened.number}` },
  };
}

/** Accept the value: a PR that writes the override (`acceptChange`). Refusals come back as the plan's own message. */
export const acceptReviewItem = (deps: OpsDeps, id: string) => openReviewPull(deps, "accept", id);

/** Reject: a PR that marks the item rejected so the next run doesn't queue it again. */
export const rejectReviewItem = (deps: OpsDeps, id: string) => openReviewPull(deps, "reject", id);

/**
 * Re-run discovery: just dispatches a `college` run with `rediscover: true` (the workflow climbs the discovery ladder
 * from the start and its own PR carries the new recipe); no second PR is opened. Logged as `review.rediscover`.
 */
export async function rediscoverReviewItem(deps: OpsDeps, id: string): Promise<OpsState> {
  if (!deps.gh.configured()) return NOT_CONFIGURED;
  const found = await openRow(deps, id);
  if (!found.ok) return found.state;
  return dispatchRun(
    deps,
    { run: "college", values: { college: found.row.item.unit_id, rediscover: true, auto_merge: true } },
    { logAction: "review.rediscover", details: { unit: found.row.item.unit_id, code: found.row.item.code ?? null } },
  );
}
