"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { realOpsDeps } from "@/lib/admin/ops";
import { adminSupabase } from "@/lib/admin/people";
import { adminErrorMessage, type AdminActionState } from "@/lib/admin/console";
import { REVIEW_QUEUE_COLLECTION, readDocuments, resetQueueCache, type StoreClient } from "@/lib/admin/review-queue";
import { readClusters, readTodo } from "@/lib/admin/steward-reads";
import type { DataActionDeps } from "@/lib/admin/data-actions";
import type { ReviewItem } from "@/lib/reported";
import {
  approveProposal,
  askProposal,
  decidePolicy,
  decideProposalRow,
  declineProposal,
  leaveIssue,
  leaveReviewItem,
  startProposalJob,
  todoDone,
  todoFound,
  todoNoDocument,
  type StewardDeps,
} from "@/lib/admin/steward-actions";

/**
 * The Data Steward's Server Actions (specs/product/data-steward.md "The console: where it all shows"). Each calls
 * `requireAdmin()` first, then builds the real dependencies (the admin's own session for `admin_steward_write`,
 * `admin_data_edit`, `admin_data_resolve_review` and the reads; GitHub through lib/admin/ops.ts) and hands the form to
 * lib/admin/steward-actions.ts, which tests/admin-steward.test.mts runs over fakes.
 */

async function realDeps(admin: { userId: string }): Promise<StewardDeps> {
  const supabase = await adminSupabase();
  const client = supabase as unknown as StoreClient;
  const data: DataActionDeps = {
    ops: realOpsDeps(admin),
    async pointSnapshot() {
      return { ok: false, message: "Not available here." };
    },
    async rpc(fn, args) {
      const { data: out, error } = await supabase.rpc(fn, args);
      if (error) console.error(`admin: ${fn} failed: ${error.message}`);
      return error ? { ok: false, error: error.message } : { ok: true, data: out };
    },
    readItems: (keys) => readDocuments<ReviewItem>(client, REVIEW_QUEUE_COLLECTION, keys),
  };
  return {
    data,
    async write(collection, key, body, note) {
      const { data: id, error } = await supabase.rpc("admin_steward_write", { p_collection: collection, p_key: key, p_body: JSON.stringify(body), p_note: note });
      if (error) console.error(`admin: admin_steward_write ${collection}/${key} failed: ${error.message}`);
      return error ? { ok: false, error: error.message || adminErrorMessage(error) } : { ok: true, changeSet: Number(id) };
    },
    async read<T>(collection: string, key: string) {
      return (await readDocuments<T>(client, collection, [key])).get(key) ?? null;
    },
    async todoRow(key) {
      return (await readTodo(client)).find((t) => t.key === key) ?? null;
    },
    async clusterKind(key) {
      const read = await readClusters(client);
      return read.ok ? (read.clusters.find((c) => c.cluster.key === key)?.kind ?? null) : null;
    },
  };
}

/** A finished action shows its result; the page re-reads so the lists catch up. */
function finish(result: AdminActionState, queueChanged = false): AdminActionState {
  if (result.status === "done") {
    if (queueChanged) resetQueueCache();
    refresh();
  }
  return result;
}

export async function approveProposalAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await approveProposal(await realDeps(admin), form), true);
}

export async function startProposalJobAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await startProposalJob(await realDeps(admin), form));
}

export async function declineProposalAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await declineProposal(await realDeps(admin), form));
}

export async function askProposalAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await askProposal(await realDeps(admin), form));
}

export async function decideRowAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await decideProposalRow(await realDeps(admin), form));
}

export async function leaveIssueAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await leaveIssue(await realDeps(admin), form));
}

export async function leaveItemAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await leaveReviewItem(await realDeps(admin), form));
}

export async function todoFoundAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await todoFound(await realDeps(admin), form));
}

export async function todoNoDocumentAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await todoNoDocument(await realDeps(admin), form));
}

export async function todoDoneAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await todoDone(await realDeps(admin), form));
}

export async function decideAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await decidePolicy(await realDeps(admin), form));
}
