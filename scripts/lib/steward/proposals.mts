/**
 * A proposal's status written from a script (`steward.proposals`): `declined` (a person closed it, as the console's
 * Decline does: undecided rows declined with the note, `decided_by`/`decided_at`/`decision_note` set) or `failed` (the
 * apply job refused or broke part way: `failed_reason` holds its message; the decision fields stay). The console's own
 * actions (lib/admin/steward-actions.ts) write through `admin_steward_write`; this is the same change for the apply job
 * (scripts/steward.mts `runApply`), `npm run drop-document`'s follow-up, and the console action that reuses it.
 *
 * With `handle` the write goes into the caller's change set; without one it opens its own (kind pipeline, source
 * `steward-status`) and closes it applied. Steward documents are never composed into a snapshot.
 */
import type { ProposalDoc } from "../../../lib/steward/types.ts";
import { COLLECTIONS } from "../data-platform/layers.mts";
import type { ChangeSetHandle, DataStore } from "../data-platform/store.mts";

export const PROPOSAL_STATUS_SOURCE = "steward-status";

/** The statuses a script sets: the console's `declined` (Decline), and `failed` for an apply that didn't go through. */
export type ScriptProposalStatus = "declined" | "failed";

export interface SetStatusOptions {
  handle?: ChangeSetHandle;
  /** Who decided, for `declined` (default "owner"). */
  by?: string;
  now?: () => Date;
  log?: (line: string) => void;
}

/** The proposal with the new status, as `setProposalStatus` writes it (pure; exported for tests and the console). */
export function proposalWithStatus(p: ProposalDoc, status: ScriptProposalStatus, note: string, at: string, by = "owner"): ProposalDoc {
  const text = note.trim().slice(0, 500);
  if (status === "failed") return { ...p, status: "failed", failed_reason: text };
  const rows = p.rows.map((r) => (r.decision ? r : { ...r, decision: "declined" as const, decisionNote: text }));
  return { ...p, rows, status: "declined", decided_by: by, decided_at: at, decision_note: text };
}

/** Writes a proposal's new status; throws when there's no such proposal or no note. Returns what it wrote. */
export async function setProposalStatus(store: DataStore, key: string, status: ScriptProposalStatus, note: string, opts: SetStatusOptions = {}): Promise<ProposalDoc> {
  if (status !== "declined" && status !== "failed") throw new Error(`a script sets a proposal declined or failed, not ${status}`);
  if (!note?.trim()) throw new Error("a proposal's new status needs a note");
  const p = await store.readOne<ProposalDoc>(COLLECTIONS.steward.proposals, key);
  if (!p) throw new Error(`no proposal ${key}`);
  const next = proposalWithStatus(p, status, note, (opts.now ?? (() => new Date()))().toISOString(), opts.by);
  const handle = opts.handle ?? (await store.open("pipeline", PROPOSAL_STATUS_SOURCE, `${PROPOSAL_STATUS_SOURCE}-${key}`.slice(0, 200), { proposal: key, status }));
  await handle.write(COLLECTIONS.steward.proposals, [{ key, body: next }]);
  if (!opts.handle) await handle.close("applied");
  opts.log?.(`proposal ${key}: ${p.status} → ${status} (${next.status === "failed" ? next.failed_reason : next.decision_note})`);
  return next;
}
