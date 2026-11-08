/**
 * Keep this file (specs/product/document-collisions.md "Keep this file"): two files of a college collide, the admin keeps
 * one, and the other is dropped. Over injected dependencies so tests/document-collisions.test.mts runs it on a file
 * store with no database; app/admin/data/colleges/[unit]/actions.ts calls `requireAdmin()` first and builds the real
 * ones (the data store from the server's env, `dropDocument`, `setProposalStatus`, the admin log).
 *
 * Rules: the typed word is checked again here (a forged form gets the same refusal); both files must be on the
 * college's record and differ; the log row (`review.keep_file`) is written before anything changes, and a log that
 * fails stops the action. Everything then goes into one change set (kind pipeline, source `keep-document`): the other
 * file dropped, the Steward's refile proposals that name either file declined, and the collision finding settled. A
 * failure before the first write closes the empty set applied (it blocks nothing); one after it closes the set held
 * with the reason, for a person to judge, as the Steward's apply job does.
 */
import type { CollegeRecord, ManifestEntry } from "../cds-sections.ts";
import type { IssueDoc, ProposalDoc, ProposalStatus } from "../steward/types.ts";
import type { dropDocument } from "../../scripts/drop-document.mts";
import type { setProposalStatus } from "../../scripts/lib/steward/proposals.mts";
import type { ChangeSetHandle, DataStore } from "../../scripts/lib/data-platform/store.mts";
import { CONFIRM_KEEP, typedMatches, type AdminActionState } from "./console.ts";
import { collisionIssueKey, findDocument, hostOf, LINK_SHA } from "./document-compare.ts";
import { editionLabel } from "./words.ts";

/** The collections the keep reads and writes (scripts/lib/data-platform/layers.mts `COLLECTIONS`; a test checks they agree). */
export const KEEP_COLLECTIONS = {
  cdsRecords: "reported.cds_records",
  docs: "reported.docs",
  proposals: "steward.proposals",
  issues: "steward.issues",
} as const;

/** The change set's source. */
export const KEEP_SOURCE = "keep-document";

/** Refile proposals still in play: a keep declines them, since the file they move is kept or gone. */
export const LIVE_REFILE: ReadonlySet<ProposalStatus> = new Set(["open", "asked", "approved", "failed"]);

export interface KeepDeps {
  store: Pick<DataStore, "readOne" | "read" | "open">;
  drop: typeof dropDocument;
  setStatus: typeof setProposalStatus;
  /** One `admin_log` row (`admin_note_ops`, a `review.*` action). */
  note(action: string, details: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string }>;
  /** The acting admin's id, recorded as the declined proposals' `decided_by`. */
  admin: string;
  now(): Date;
  revalidate(unit: string): void;
}

/** The slice of a form the action reads (FormData in production). */
export interface KeepFormLike {
  get(name: string): unknown;
}

const text = (form: KeepFormLike, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};
const err = (message: string): AdminActionState => ({ status: "error", message });
const short = (sha: string) => sha.slice(0, LINK_SHA);

/** The `why` the dropped file's recipe entry carries: "Kept 420859b8b6 (www.ucsc.edu, pulled 2026-10-19); …". */
export function keepWhy(kept: { sha256: string; url: string; retrieved: string }, today: string): string {
  return `Kept ${short(kept.sha256)} (${hostOf(kept.url)}, pulled ${kept.retrieved.slice(0, 10)}); the admin chose it over this file on ${today}`;
}

/** A refile proposal that moves one of these files (a row's sha may be a prefix). */
export function namesFile(p: ProposalDoc, unit: string, shas: readonly string[]): boolean {
  return p.kind === "refile" && p.rows.some((r) => r.unit_id === unit && !!r.sha256 && shas.some((s) => s.startsWith(r.sha256!) || r.sha256!.startsWith(s)));
}

/**
 * Keeps `keep` and drops `drop` from the college `unit`. The form carries `unit`, `keep`, `drop` (shas or prefixes of
 * them) and `confirm` (the typed word).
 */
export async function keepDocument(deps: KeepDeps, form: KeepFormLike): Promise<AdminActionState> {
  if (!typedMatches(form.get("confirm"), CONFIRM_KEEP)) return err(`Type ${CONFIRM_KEEP} to keep this file.`);
  const unit = text(form, "unit");
  if (!/^\d{6,8}$/.test(unit)) return err("That college wasn't recognized. Reload the page and try again.");
  const [keepSha, dropSha] = [text(form, "keep").toLowerCase(), text(form, "drop").toLowerCase()];
  if (!keepSha || !dropSha || keepSha === dropSha) return err("Keeping a file needs two different files. Reload the page and try again.");

  const record = await deps.store.readOne<CollegeRecord>(KEEP_COLLECTIONS.cdsRecords, unit);
  const kept = findDocument(record, keepSha);
  const gone = findDocument(record, dropSha);
  if (!record || !kept || !gone) return err("One of the two files is no longer on this college's record. Reload the page to see what it holds now.");
  if (kept === gone) return err("Keeping a file needs two different files. Reload the page and try again.");

  const now = deps.now();
  const today = now.toISOString().slice(0, 10);
  const why = keepWhy(kept, today);
  const details = { unit, kept: kept.sha256, dropped: gone.sha256, kept_edition: kept.edition, dropped_edition: gone.edition, why };
  const logged = await deps.note("review.keep_file", details);
  if (!logged.ok) return err(`Nothing was changed because it could not be logged: ${logged.message}`);

  let handle: ChangeSetHandle | null = null;
  let wrote = false;
  try {
    handle = await deps.store.open("pipeline", KEEP_SOURCE, `${KEEP_SOURCE}-${unit}-${now.toISOString()}`, details);
    const dropped = await deps.drop(deps.store as DataStore, { unit, sha: gone.sha256, why }, { handle, today });
    wrote = true;

    const note = `The admin kept ${short(kept.sha256)} (pulled ${kept.retrieved.slice(0, 10)} from ${hostOf(kept.url)}) and dropped ${short(gone.sha256)} on ${today}; this refile no longer applies.`;
    const proposals = await deps.store.read<ProposalDoc>(KEEP_COLLECTIONS.proposals);
    const declined: string[] = [];
    for (const p of proposals.values()) {
      if (!LIVE_REFILE.has(p.status) || !namesFile(p, unit, [kept.sha256, gone.sha256])) continue;
      await deps.setStatus(deps.store as DataStore, p.key, "declined", note, { handle, by: deps.admin, now: () => now });
      declined.push(p.key);
    }

    // The collision findings the Steward left for either file's edition, or a refile's target, are settled.
    const editions = new Set([kept.edition, gone.edition, ...[...proposals.values()].filter((p) => declined.includes(p.key)).flatMap((p) => p.rows.map((r) => r.edition ?? ""))]);
    const settled: string[] = [];
    for (const edition of editions) {
      if (!edition) continue;
      const key = collisionIssueKey(unit, edition);
      const issue = await deps.store.readOne<IssueDoc>(KEEP_COLLECTIONS.issues, key);
      if (!issue || issue.status === "left") continue;
      const body: IssueDoc = { ...issue, status: "left", reason: `Settled: the admin kept ${short(kept.sha256)} and dropped ${short(gone.sha256)} on ${today}.`, updated: now.toISOString() };
      await handle.write(KEEP_COLLECTIONS.issues, [{ key, body }]);
      settled.push(key);
    }
    await handle.close("applied", undefined, { ...details, queue_removed: dropped.queueRemoved, declined, settled });
    deps.revalidate(unit);
    const also = [declined.length ? `${declined.length} refile proposal${declined.length === 1 ? "" : "s"} declined` : null, settled.length ? "the finding settled" : null].filter(Boolean).join("; ");
    return {
      status: "done",
      message: `Kept the file pulled ${kept.retrieved.slice(0, 10)} from ${hostOf(kept.url)} (${editionLabel(kept.edition)}). The other file is dropped: ${dropped.queueRemoved.toLocaleString("en-US")} queue item${dropped.queueRemoved === 1 ? "" : "s"} gone${also ? `; ${also}` : ""}. It reaches the site at the next publish.`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (handle) await handle.close(wrote ? "held" : "applied", wrote ? `keep-document ${unit} failed part way: ${message}`.slice(0, 500) : undefined, { ...details, failed: message }).catch(() => undefined);
    await deps.note("review.failed", { action: "review.keep_file", unit, reason: message.slice(0, 300) }).catch(() => undefined);
    return err(wrote ? `The file was dropped, but the rest didn't finish (${message}). The change is held for you to look at under Changes.` : `Nothing was changed: ${message}`);
  }
}
