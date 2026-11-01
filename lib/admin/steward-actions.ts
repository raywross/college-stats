/**
 * What the Data Steward's console buttons do (specs/product/data-steward.md "The console: where it all shows",
 * "Proposals", "The college's Review page"), over injected dependencies so tests/admin-steward.test.mts runs every path
 * with no network and no database. app/admin/data/steward-actions.ts calls requireAdmin() first, builds the real
 * dependencies, and hands the form here.
 *
 * - Every change to a `steward.*` document goes through `admin_steward_write` (S1's function): the action reads the
 *   document, changes the fields it owns (a status, a decision, a row's decision, a question, an answer, a reason) and
 *   writes it back whole. The function logs `steward.write` with the changed fields before and after, in the same
 *   transaction; the note names what the admin did (`steward.approve`, `steward.decline`, `steward.ask`,
 *   `steward.decide`, `steward.leave`, `steward.todo`, `steward.row`).
 * - **Approve** on a value proposal (correct, publish): each ticked row is a field edit (`admin_data_edit`, noted with
 *   the document, page, line and quote the Steward cited) and, when the row settles a queue item, the item resolved
 *   `accepted`; a ticked row the Steward didn't cite (no field, no value, no page or quote, no document) refuses the
 *   whole Approve before anything is written. On hold, refile, recipe and reject proposals, Approve records the
 *   decisions and dispatches the `apply` job (steward.yml, mode apply) once; on a re-read, it dispatches the college
 *   run for the first ticked college (college-reported.yml runs one at a time; the rest start from the proposal).
 *   Unticked rows are recorded declined with the admin's note, so the next run doesn't propose them again. A proposal
 *   already approved, declined or applied is refused.
 * - **Decline** closes a proposal with a reason (its undecided rows declined with it). **Ask** saves the question and
 *   dispatches the Steward on the proposal (steward.yml, mode answer, $5).
 * - Every dispatch goes through `dispatchRun` (lib/admin/ops-actions.ts), which logs `ops.dispatch` before sending;
 *   the document write that records the decision comes first, so nothing is sent that the log doesn't show.
 */
import { dispatchRun, reviewKeyFromForm, type OpsState } from "./ops-actions.ts";
import { reviewDeps, type DataActionDeps } from "./data-actions.ts";
import { ADMIN_FAILED, typedMatches, type AdminActionState } from "./console.ts";
import { ADMIN_ERRORS } from "./constants.ts";
import { NOTE_MAX } from "./review-queue.ts";
import { STEWARD_COLLECTIONS } from "./steward-reads.ts";
import { isFieldPath } from "../fields.ts";
import type { ReviewItem } from "../reported.ts";
import { checkOfKey } from "../steward/cluster.ts";
import { PROPOSAL_KIND_LABEL, type DecisionDoc, type IssueDoc, type IssueKind, type ProposalDoc, type ProposalKind, type ProposalRow, type TodoDoc } from "../steward/types.ts";

/** The word typed to approve a proposal that changes what a visitor sees (a correction, a publish, a hold). */
export const CONFIRM_APPROVE = "approve";
/** Proposal kinds whose Approve needs the typed word. */
export const TYPED_KINDS: ReadonlySet<ProposalKind> = new Set(["correct", "publish", "hold"]);
/** Kinds the console applies itself: field edits and resolutions. */
export const VALUE_KINDS: ReadonlySet<ProposalKind> = new Set(["correct", "publish"]);
/** Kinds the `apply` job applies (scripts/lib/steward/apply.mts `APPLIED_KINDS`; a test checks they agree). */
export const JOB_KINDS: ReadonlySet<ProposalKind> = new Set(["hold", "refile", "recipe", "reject"]);
/** A proposal still waiting on the owner. */
export const UNDECIDED: ReadonlySet<ProposalDoc["status"]> = new Set(["open", "asked"]);
/** The note an approved re-read row carries once its college's run was dispatched. */
export const REREAD_STARTED = "Re-read started";
/** The longest question on a proposal. */
export const QUESTION_MAX = 1000;

/** One `admin_steward_write` call with the admin's session: the change set id, or the database's raw error text. */
export interface StewardWrite {
  (collection: string, key: string, body: unknown, note: string | null): Promise<{ ok: true; changeSet: number } | { ok: false; error: string }>;
}

export interface StewardDeps {
  /** The Data console's dependencies: GitHub and the log (`ops`), `admin_data_*` (`rpc`), the queue items. */
  data: DataActionDeps;
  write: StewardWrite;
  /** One `steward.*` document by key, or null. */
  read<T>(collection: string, key: string): Promise<T | null>;
  /** A To do row by key: the stored document over the rows the engines' records give (lib/admin/steward-reads.ts `readTodo`). */
  todoRow(key: string): Promise<TodoDoc | null>;
  /** The kind of a cluster in the live queue, or null when the queue has no such cause. */
  clusterKind(key: string): Promise<IssueKind | null>;
}

/** The slice of a form these actions read (FormData in production). */
export interface StewardFormLike {
  get(name: string): unknown;
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

const STEWARD_ERRORS: Record<string, string> = {
  not_steward_collection: "The console writes only the Steward's own documents.",
  invalid_key: "That document's key wasn't recognized. Reload the page and try again.",
  invalid_body: "That document couldn't be saved as written. Reload the page and try again.",
  invalid_note: "Keep the note under 500 characters.",
  "version conflict": "Someone changed that a moment ago. Reload the page and try again.",
};

/** The plain-words message for an `admin_steward_write` refusal. */
export function stewardErrorMessage(raw: string | null | undefined): string {
  const text = raw ?? "";
  if (/\badmin only\b/.test(text)) return ADMIN_ERRORS["admin only"];
  const key = Object.keys(STEWARD_ERRORS).find((k) => text.includes(k));
  return key ? STEWARD_ERRORS[key] : ADMIN_FAILED;
}

const err = (message: string): AdminActionState => ({ status: "error", message });
const done = (message: string): AdminActionState => ({ status: "done", message });
const BAD_FORM = err("That form was incomplete. Reload the page and try again.");
const CHANGED = err("This proposal changed since the page loaded. Reload the page and look again.");

function fromOpsState(state: OpsState): AdminActionState {
  if (state.status !== "done") return state;
  return done(state.link ? `${state.message} ${state.link.label}: ${state.link.href}` : state.message);
}

/** A document key from a form: one line, 1 to 200 characters. */
export function keyFromForm(form: StewardFormLike, name: string): string | null {
  const raw = form.get(name);
  const key = typeof raw === "string" ? raw.trim() : "";
  return key.length >= 1 && key.length <= 200 && !/[\u0000-\u001f\u007f]/.test(key) ? key : null;
}

/** A note or reason: one trimmed line up to `max` characters, or null when empty. */
export function lineFromForm(form: StewardFormLike, name: string, max = NOTE_MAX): string | null {
  const raw = form.get(name);
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, max) : null;
}

/** The rows ticked on an Approve form (`row-<index>` checkboxes), within the proposal's rows. */
export function tickedRows(form: StewardFormLike, count: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < count; i++) if (form.get(`row-${i}`) === "on") out.add(i);
  return out;
}

const trim = (s: string) => (s.length > NOTE_MAX ? `${s.slice(0, NOTE_MAX - 1)}…` : s);

/** A log note: the action, then what it did. */
const logNote = (action: string, what: string) => trim(`${action}: ${what}`);

/* ------------------------------------------------------------------ */
/* Citations                                                           */
/* ------------------------------------------------------------------ */

/** Why a correct/publish row can't be applied as cited, or null when it can. */
export function uncited(row: ProposalRow): string | null {
  if (!row.field || !isFieldPath(row.field)) return "names no field the console can edit";
  if (row.value === undefined || row.value === null || row.value === "") return "has no value to write";
  if (row.source.page === null && !row.source.quote?.trim()) return "cites no page or quote from the document";
  if (!row.source.url && !row.sha256) return "names no document";
  return null;
}

/**
 * The edit's note: "Correct a value from {document}, page {n}, line {m}: {quote}", the parts the row has, and for a
 * publish the reason it is right as read. At most 500 characters (admin_data_edit's limit).
 */
export function editNote(kind: ProposalKind, row: ProposalRow): string {
  const document = row.source.url ?? (row.sha256 ? `document ${row.sha256.slice(0, 12)}` : "the college's document");
  const where = [row.source.page !== null ? `page ${row.source.page}` : null, row.source.line !== null ? `line ${row.source.line}` : null].filter(Boolean).join(", ");
  const quote = row.source.quote?.replace(/\s+/g, " ").trim();
  const reason = kind === "publish" ? ` (${row.why ?? row.proposed})` : "";
  return trim(`${PROPOSAL_KIND_LABEL[kind]} from ${document}${where ? `, ${where}` : ""}${quote ? `: ${quote}` : ""}${reason}`);
}

/* ------------------------------------------------------------------ */
/* Reading and writing a document                                      */
/* ------------------------------------------------------------------ */

async function readDoc<T>(deps: StewardDeps, collection: string, key: string): Promise<{ ok: true; doc: T | null } | { ok: false; state: AdminActionState }> {
  try {
    return { ok: true, doc: await deps.read<T>(collection, key) };
  } catch (e) {
    return { ok: false, state: err(`Couldn't read it: ${e instanceof Error ? e.message : String(e)}.`) };
  }
}

async function save(deps: StewardDeps, collection: string, key: string, body: unknown, note: string): Promise<AdminActionState | null> {
  const r = await deps.write(collection, key, body, note);
  return r.ok ? null : err(stewardErrorMessage(r.error));
}

async function openProposal(deps: StewardDeps, form: StewardFormLike): Promise<{ ok: true; p: ProposalDoc } | { ok: false; state: AdminActionState }> {
  const key = keyFromForm(form, "proposal");
  if (!key) return { ok: false, state: BAD_FORM };
  const read = await readDoc<ProposalDoc>(deps, STEWARD_COLLECTIONS.proposals, key);
  if (!read.ok) return read;
  if (!read.doc) return { ok: false, state: err("That proposal doesn't exist any more. Reload the page.") };
  return { ok: true, p: read.doc };
}

async function decider(deps: StewardDeps): Promise<{ decided_by: string; decided_at: string }> {
  return { decided_by: await deps.data.ops.adminName(), decided_at: deps.data.ops.now().toISOString() };
}

/* ------------------------------------------------------------------ */
/* Proposals: Approve, Decline, Ask, and the jobs after Approve         */
/* ------------------------------------------------------------------ */

/** The approved rows of a re-read whose college's run hasn't been dispatched yet, by college in row order. */
export function rereadsWaiting(p: ProposalDoc): string[] {
  const units: string[] = [];
  for (const r of p.rows) if (r.decision === "approved" && !r.decisionNote?.startsWith(REREAD_STARTED) && !units.includes(r.unit_id)) units.push(r.unit_id);
  return units;
}

/** The projected cost of re-reading one college of a re-read proposal: its `cost` shared over its colleges. */
export function rereadCostEach(p: Pick<ProposalDoc, "cost" | "rows">): number | null {
  const colleges = new Set(p.rows.map((r) => r.unit_id)).size;
  return typeof p.cost === "number" && colleges > 0 ? p.cost / colleges : null;
}

/**
 * The next re-read of an approved re-read proposal: the college run (college-reported.yml, mode college) for the first
 * college still waiting, logged `ops.dispatch` before it is sent; its rows then say the run started, and the proposal
 * is `applied` once every college's has. The workflow runs one at a time, so one college per press.
 */
async function startNextReread(deps: StewardDeps, p: ProposalDoc, prefix = ""): Promise<AdminActionState> {
  const waiting = rereadsWaiting(p);
  if (!waiting.length) return done(`${prefix}Every re-read has started.`.trim());
  const unit = waiting[0];
  const sent = await dispatchRun(deps.data.ops, { run: "college", values: { college: unit, rediscover: false } }, { logAction: "ops.dispatch", details: { steward: "reread", proposal: p.key, unit } });
  if (sent.status !== "done") return err(`${prefix}The re-read of ${unit} didn't start: ${sent.status === "error" ? sent.message : "nothing was sent."} Start it from this proposal.`.trim());
  const day = deps.data.ops.now().toISOString().slice(0, 10);
  const rows = p.rows.map((r) => (r.unit_id === unit && r.decision === "approved" ? { ...r, decisionNote: `${REREAD_STARTED} ${day}` } : r));
  const left = waiting.length - 1;
  const next: ProposalDoc = { ...p, rows, status: left ? "approved" : "applied" };
  const failed = await save(deps, STEWARD_COLLECTIONS.proposals, p.key, next, logNote("steward.reread", `${unit} started`));
  const started = fromOpsState(sent);
  const said = started.status === "done" ? (started.message ?? "") : "";
  if (failed) return err(`${prefix}${said} But the proposal couldn't record it: ${failed.status === "error" ? failed.message : ""}`.trim());
  return done(`${prefix}${said} ${left ? `${left} more ${left === 1 ? "college waits" : "colleges wait"}: start the next from this proposal when this run finishes.` : "Every re-read has started."}`.trim());
}

/** The apply job (steward.yml, mode apply) for an approved hold, refile, recipe or reject proposal. */
async function startApplyJob(deps: StewardDeps, p: ProposalDoc, prefix = ""): Promise<AdminActionState> {
  const sent = await dispatchRun(deps.data.ops, { run: "steward-apply", values: { proposal: p.key } }, { logAction: "ops.dispatch", details: { steward: "approve", proposal: p.key } });
  if (sent.status !== "done") return err(`${prefix}The apply job didn't start: ${sent.status === "error" ? sent.message : "nothing was sent."} Start it from this proposal.`.trim());
  const started = fromOpsState(sent);
  return done(`${prefix}${started.status === "done" ? (started.message ?? "") : ""} It marks the proposal applied when it finishes.`.trim());
}

/**
 * Approve: the contract in the file's header. Order: read the proposal (refused unless open or asked, or when its
 * rows changed since the page loaded), check the typed word and every ticked row's citation, apply a value proposal's
 * edits and resolutions (an item already accepted by an earlier press is skipped, so Approve can be pressed again
 * after a failure), write the decisions (logged), then dispatch what needs a job.
 */
export async function approveProposal(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const opened = await openProposal(deps, form);
  if (!opened.ok) return opened.state;
  const { p } = opened;
  if (!UNDECIDED.has(p.status)) return err(`This proposal was already ${p.status}.`);
  if (String(p.rows.length) !== form.get("rows")) return CHANGED;
  const note = lineFromForm(form, "note");
  const who = await decider(deps);

  if (p.kind === "systemic") {
    const next: ProposalDoc = { ...p, status: "approved", ...who, decision_note: note };
    const failed = await save(deps, STEWARD_COLLECTIONS.proposals, p.key, next, logNote("steward.approve", note ?? "the analysis, for the code change"));
    return failed ?? done("Approved: the analysis is recorded for the session that writes the change.");
  }

  const ticked = tickedRows(form, p.rows.length);
  if (!ticked.size) return err("Tick at least one row, or Decline the proposal.");
  if (TYPED_KINDS.has(p.kind) && !typedMatches(form.get("confirm"), CONFIRM_APPROVE)) return err(`Type "${CONFIRM_APPROVE}" to confirm.`);
  const chosen = p.rows.map((row, index) => ({ row, index })).filter((x) => ticked.has(x.index));

  if (VALUE_KINDS.has(p.kind)) {
    const problems = chosen.map(({ row, index }) => [index, uncited(row)] as const).filter(([, why]) => why !== null);
    if (problems.length) return err(`Nothing was applied: ${problems.map(([i, why]) => `row ${i + 1} ${why}`).join("; ")}. The Steward must cite the document for these.`);
    let items: Map<string, ReviewItem>;
    try {
      items = await deps.data.readItems(chosen.map((x) => x.row.item).filter((k): k is string => Boolean(k)));
    } catch (e) {
      return err(`Couldn't read the queue items: ${e instanceof Error ? e.message : String(e)}.`);
    }
    const rejected = chosen.filter(({ row }) => row.item && items.get(row.item)?.resolved === "rejected");
    if (rejected.length) return err(`Nothing was applied: ${rejected.map(({ index }) => `row ${index + 1}`).join(", ")} settle${rejected.length === 1 ? "s" : ""} an item already rejected. Untick ${rejected.length === 1 ? "it" : "them"}, or look at Holds.`);
    const review = reviewDeps(deps.data);
    let applied = 0;
    for (const { row, index } of chosen) {
      const item = row.item ? items.get(row.item) : undefined;
      if (item?.resolved === "accepted") continue;
      const edit = await review.edit(row.unit_id, row.field!, row.value, editNote(p.kind, row));
      if (!edit.ok) return err(applied === 0 ? `Nothing was applied: ${edit.message}` : `Stopped at row ${index + 1} after ${applied} of ${chosen.length}: ${edit.message} The proposal is still open; Approve again carries on.`);
      if (item) {
        const resolved = await review.resolve(row.item!, "accepted", trim(`Approved on proposal ${p.key}`));
        if (!resolved.ok) return err(`Row ${index + 1}'s value was saved as an edit, but its item couldn't be marked accepted: ${resolved.message} Approve again carries on.`);
      }
      applied++;
    }
  }

  const declinedNote = note ?? "Not ticked when the proposal was approved.";
  const rows: ProposalRow[] = p.rows.map((row, i) => {
    const { decisionNote: _old, ...rest } = row;
    void _old;
    return ticked.has(i) ? { ...rest, decision: "approved" } : { ...rest, decision: "declined", decisionNote: declinedNote };
  });
  const status: ProposalDoc["status"] = VALUE_KINDS.has(p.kind) ? "applied" : "approved";
  const next: ProposalDoc = { ...p, rows, status, ...who, decision_note: note };
  const declined = p.rows.length - ticked.size;
  const failed = await save(deps, STEWARD_COLLECTIONS.proposals, p.key, next, logNote("steward.approve", `${ticked.size} approved, ${declined} declined${note ? `; ${note}` : ""}`));
  if (failed) {
    if (VALUE_KINDS.has(p.kind)) return err(`The values were saved as edits, but the proposal couldn't record the decision: ${failed.status === "error" ? failed.message : ""} Approve again carries on.`);
    return failed;
  }
  const counts = `${ticked.size} row${ticked.size === 1 ? "" : "s"} approved${declined ? `, ${declined} declined` : ""}.`;
  if (VALUE_KINDS.has(p.kind)) return done(`Approved: ${counts} The values are saved as edits by Quad; the next snapshot publishes them.`);
  if (JOB_KINDS.has(p.kind)) return startApplyJob(deps, next, `Approved: ${counts}`);
  if (p.kind === "reread") return startNextReread(deps, next, `Approved: ${counts}`);
  return done(`Approved: ${counts}`);
}

/** After Approve: start the apply job again, or the next college's re-read, on an approved proposal. */
export async function startProposalJob(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const opened = await openProposal(deps, form);
  if (!opened.ok) return opened.state;
  const { p } = opened;
  if (p.status !== "approved") return err(p.status === "applied" ? "This proposal is applied already." : "Approve the proposal first.");
  if (JOB_KINDS.has(p.kind)) return startApplyJob(deps, p);
  if (p.kind === "reread") return startNextReread(deps, p);
  return err("Nothing waits on a job for this proposal.");
}

/** Decline: the proposal closed with a reason; its undecided rows are declined with it so the next run skips them. */
export async function declineProposal(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const opened = await openProposal(deps, form);
  if (!opened.ok) return opened.state;
  const { p } = opened;
  if (!UNDECIDED.has(p.status)) return err(`This proposal was already ${p.status}.`);
  const reason = lineFromForm(form, "reason");
  if (!reason) return err("Say why (up to 500 characters).");
  const rows = p.rows.map((r) => (r.decision ? r : { ...r, decision: "declined" as const, decisionNote: reason }));
  const next: ProposalDoc = { ...p, rows, status: "declined", ...(await decider(deps)), decision_note: reason };
  const failed = await save(deps, STEWARD_COLLECTIONS.proposals, p.key, next, logNote("steward.decline", reason));
  return failed ?? done("Declined. The Steward won't propose these rows again unless the document changes.");
}

/**
 * Ask: the question saved on the proposal (status `asked`), then the Steward dispatched on it (steward.yml, mode
 * answer, budget $5; logged `ops.dispatch` before it is sent). A dispatch that fails leaves the question saved; Ask
 * again sends it.
 */
export async function askProposal(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const opened = await openProposal(deps, form);
  if (!opened.ok) return opened.state;
  const { p } = opened;
  if (!UNDECIDED.has(p.status)) return err(`This proposal was already ${p.status}.`);
  const question = lineFromForm(form, "question", QUESTION_MAX);
  if (!question) return err("Write the question.");
  const next: ProposalDoc = { ...p, status: "asked", question, answer: null };
  const failed = await save(deps, STEWARD_COLLECTIONS.proposals, p.key, next, logNote("steward.ask", question));
  if (failed) return failed;
  const sent = await dispatchRun(deps.data.ops, { run: "steward-answer", values: { proposal: p.key } }, { logAction: "ops.dispatch", details: { steward: "ask", proposal: p.key } });
  if (sent.status !== "done") return err(`The question is saved, but the Steward didn't start: ${sent.status === "error" ? sent.message : "nothing was sent."} Ask again to send it.`);
  const started = fromOpsState(sent);
  return done(`Asked. ${started.status === "done" ? (started.message ?? "") : ""} The answer shows on this proposal.`.replace(/\s+/g, " ").trim());
}

/**
 * A proposal row decided on the college's Review page (the same row's tick on the proposal shows it): one write to
 * the proposal. Only while the proposal is open or asked; Approve on the proposal applies it.
 */
export async function decideProposalRow(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const opened = await openProposal(deps, form);
  if (!opened.ok) return opened.state;
  const { p } = opened;
  if (!UNDECIDED.has(p.status)) return err(`This proposal was already ${p.status}.`);
  const index = Number(form.get("row"));
  const decision = form.get("decision");
  if (!Number.isInteger(index) || index < 0 || index >= p.rows.length || (decision !== "approved" && decision !== "declined")) return BAD_FORM;
  if (p.rows[index].unit_id !== form.get("unit")) return CHANGED;
  const note = lineFromForm(form, "note");
  const rows = p.rows.map((r, i) => (i === index ? { ...r, decision: decision as "approved" | "declined", ...(note ? { decisionNote: note } : {}) } : r));
  const failed = await save(deps, STEWARD_COLLECTIONS.proposals, p.key, { ...p, rows }, logNote("steward.row", `row ${index + 1} (${p.rows[index].unit_id}) ${decision}${note ? `; ${note}` : ""}`));
  if (failed) return failed;
  return done(decision === "approved" ? "Ticked on the proposal. Approve on the proposal applies it." : "Recorded as declined on the proposal.");
}

/* ------------------------------------------------------------------ */
/* Issues: Leave                                                        */
/* ------------------------------------------------------------------ */

function freshIssue(key: string, kind: IssueKind, now: string): IssueDoc {
  return { key, kind, status: "new", hypothesis: "", findings: [], proposals: [], reason: null, run: "console", updated: now };
}

async function issueFor(deps: StewardDeps, key: string): Promise<{ ok: true; issue: IssueDoc } | { ok: false; state: AdminActionState }> {
  const read = await readDoc<IssueDoc>(deps, STEWARD_COLLECTIONS.issues, key);
  if (!read.ok) return read;
  if (read.doc) return { ok: true, issue: read.doc };
  const kind = await deps.clusterKind(key).catch(() => null);
  if (!kind) return { ok: false, state: err("That cause isn't in the queue any more. Reload the page.") };
  return { ok: true, issue: freshIssue(key, kind, deps.data.ops.now().toISOString()) };
}

/** Leave a cause: the issue document `left` with the admin's reason (created when the Steward hasn't written one). */
export async function leaveIssue(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const key = keyFromForm(form, "issue");
  if (!key) return BAD_FORM;
  const reason = lineFromForm(form, "reason");
  if (!reason) return err("Say why it stays queued (up to 500 characters).");
  const found = await issueFor(deps, key);
  if (!found.ok) return found.state;
  if (found.issue.status === "left") return err("This cause is left already.");
  const next: IssueDoc = { ...found.issue, status: "left", reason, updated: deps.data.ops.now().toISOString() };
  const failed = await save(deps, STEWARD_COLLECTIONS.issues, key, next, logNote("steward.leave", reason));
  return failed ?? done("Left. The Steward skips this cause until you change it.");
}

/**
 * Leave one item, from the college's Review page: a finding on its cause's issue document ("Left by the owner …"),
 * so the Steward reads the reason with the cause. The item stays queued. The cause must be one of the item's own.
 */
export async function leaveReviewItem(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const itemKey = reviewKeyFromForm(form);
  const key = keyFromForm(form, "issue");
  if (!itemKey || !key) return BAD_FORM;
  const reason = lineFromForm(form, "reason");
  if (!reason) return err("Say why it stays queued (up to 500 characters).");
  let item: ReviewItem | undefined;
  try {
    item = (await deps.data.readItems([itemKey])).get(itemKey);
  } catch (e) {
    return err(`Couldn't read the item: ${e instanceof Error ? e.message : String(e)}.`);
  }
  if (!item || item.resolved) return err("That item is no longer queued. Reload the page.");
  if (!item.failures.some((f) => f.check === checkOfKey(key))) return BAD_FORM;
  const found = await issueFor(deps, key);
  if (!found.ok) return found.state;
  const shows = `Left by the owner (${item.code ?? "C1"}): ${reason}`;
  const findings = [
    ...found.issue.findings.filter((f) => !(f.unit_id === item.unit_id && f.edition === (item.edition ?? null) && f.shows.startsWith(`Left by the owner (${item.code ?? "C1"})`))),
    { unit_id: item.unit_id, edition: item.edition ?? null, sha256: item.sha256 ?? null, url: item.urls[0] ?? null, page: null, line: null, shows },
  ];
  const next: IssueDoc = { ...found.issue, findings, updated: deps.data.ops.now().toISOString() };
  const failed = await save(deps, STEWARD_COLLECTIONS.issues, key, next, logNote("steward.leave", `${itemKey}: ${reason}`));
  return failed ?? done("Left, with your reason on the cause. The item stays queued.");
}

/* ------------------------------------------------------------------ */
/* To do: Found, No document published, Done                           */
/* ------------------------------------------------------------------ */

async function updateTodo(deps: StewardDeps, form: StewardFormLike, change: (row: TodoDoc, at: string) => TodoDoc | { refused: string }, what: string, message: string): Promise<AdminActionState> {
  const key = keyFromForm(form, "todo");
  if (!key) return BAD_FORM;
  let row: TodoDoc | null;
  try {
    row = await deps.todoRow(key);
  } catch (e) {
    return err(`Couldn't read the row: ${e instanceof Error ? e.message : String(e)}.`);
  }
  if (!row) return err("That row isn't on the list any more. Reload the page.");
  const at = deps.data.ops.now().toISOString();
  const next = change(row, at);
  if ("refused" in next) return err(next.refused);
  const failed = await save(deps, STEWARD_COLLECTIONS.todo, key, next, logNote("steward.todo", what));
  return failed ?? done(message);
}

const httpUrl = (raw: unknown): string | null => {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length > 2000 || !/^https?:\/\/[^\s]+$/i.test(text)) return null;
  try {
    return new URL(text).href;
  } catch {
    return null;
  }
};

/** Found: the document's URL, so the next run fetches it. */
export async function todoFound(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const url = httpUrl(form.get("url"));
  if (!url) return err("Paste the document's address, starting https://.");
  const note = lineFromForm(form, "note");
  return updateTodo(
    deps,
    form,
    (row, at) => ({ ...row, status: "found", document_url: url, route: "person", note: note ?? row.note, attempts: [...row.attempts, { at, route: "person", result: `found ${url}` }], updated: at }),
    `found ${url}`,
    "Found. The next run of this college fetches it.",
  );
}

/** No document published: the college publishes none, so the row closes and nothing asks for it again. */
export async function todoNoDocument(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const note = lineFromForm(form, "note");
  return updateTodo(
    deps,
    form,
    (row, at) => (row.status === "no-document" ? { refused: "This row says so already." } : { ...row, status: "no-document", note: note ?? row.note, attempts: [...row.attempts, { at, route: "person", result: "no document published" }], updated: at }),
    "no document published",
    "Recorded: no document published.",
  );
}

/** Done: the document arrived (or the row no longer matters). */
export async function todoDone(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const note = lineFromForm(form, "note");
  return updateTodo(
    deps,
    form,
    (row, at) => (row.status === "done" ? { refused: "This row is done already." } : { ...row, status: "done", note: note ?? row.note, updated: at }),
    "done",
    "Done.",
  );
}

/* ------------------------------------------------------------------ */
/* Decisions: Decide                                                   */
/* ------------------------------------------------------------------ */

/** Decide: one of the question's options, with an optional note; deciding again records the new answer. */
export async function decidePolicy(deps: StewardDeps, form: StewardFormLike): Promise<AdminActionState> {
  const key = keyFromForm(form, "decision");
  if (!key) return BAD_FORM;
  const read = await readDoc<DecisionDoc>(deps, STEWARD_COLLECTIONS.decisions, key);
  if (!read.ok) return read.state;
  if (!read.doc) return err("That question doesn't exist any more. Reload the page.");
  const answer = typeof form.get("answer") === "string" ? (form.get("answer") as string) : "";
  if (!read.doc.options.some((o) => o.answer === answer)) return err("Pick one of the answers.");
  const note = lineFromForm(form, "note");
  const next: DecisionDoc = { ...read.doc, answer, note, ...(await decider(deps)) };
  const failed = await save(deps, STEWARD_COLLECTIONS.decisions, key, next, logNote("steward.decide", `${answer}${note ? `; ${note}` : ""}`));
  return failed ?? done("Decided. The Steward follows it from the next run.");
}
