"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { realOpsDeps } from "@/lib/admin/ops";
import { adminSupabase } from "@/lib/admin/people";
import { adminErrorMessage, type AdminActionState } from "@/lib/admin/console";
import { REVIEW_QUEUE_COLLECTION, readDocuments, resetQueueCache, type StoreClient } from "@/lib/admin/review-queue";
import type { ReviewItem } from "@/lib/reported";
import {
  acceptHeldItem,
  holdChangeSet,
  pointBackHere,
  publishAnyway,
  publishNow,
  rediscoverHeldItem,
  rejectHeldItem,
  revertChangeSet,
  type DataActionDeps,
} from "@/lib/admin/data-actions";

/**
 * The Data console's Server Actions (specs/data-platform/change-sets.md "The console"; specs/data-platform/publish.md
 * "The admin's publish controls"). Each calls `requireAdmin()` itself, the way Operations' actions do (not
 * `withAdmin()`: several also dispatch a workflow, which needs the GitHub dependencies `lib/admin/ops.ts` builds). The
 * work, including logging before sending, is in `lib/admin/data-actions.ts`, which `tests/admin-data.test.mts`
 * exercises with fake dependencies.
 */

async function realDeps(admin: { userId: string }): Promise<DataActionDeps> {
  return {
    ops: realOpsDeps(admin),
    async pointSnapshot(id) {
      const supabase = await adminSupabase();
      const { error } = await supabase.rpc("admin_data_point_snapshot", { p_snapshot: id });
      if (error) console.error(`admin: point back to snapshot ${id} failed: ${error.message}`);
      return error ? { ok: false, message: adminErrorMessage(error) } : { ok: true };
    },
    async rpc(fn, args) {
      const supabase = await adminSupabase();
      const { data, error } = await supabase.rpc(fn, args);
      if (error) console.error(`admin: ${fn} failed: ${error.message}`);
      return error ? { ok: false, error: error.message } : { ok: true, data };
    },
    async readItems(keys) {
      const supabase = await adminSupabase();
      return readDocuments<ReviewItem>(supabase as unknown as StoreClient, REVIEW_QUEUE_COLLECTION, keys);
    },
  };
}

/** A finished action shows its result; the page re-reads so the lists catch up. */
function finish(result: AdminActionState): AdminActionState {
  if (result.status === "done") refresh();
  return result;
}

export async function publishNowAction(_previous: AdminActionState, _form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await publishNow(await realDeps(admin)));
}

export async function pointBackAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await pointBackHere(await realDeps(admin), form));
}

export async function holdChangeSetAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await holdChangeSet(await realDeps(admin), form));
}

export async function publishAnywayAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await publishAnyway(await realDeps(admin), form));
}

export async function revertChangeSetAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await revertChangeSet(await realDeps(admin), form));
}

export async function acceptHeldAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const result = await acceptHeldItem(await realDeps(admin), form);
  if (result.status === "done") resetQueueCache();
  return finish(result);
}

export async function rejectHeldAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const result = await rejectHeldItem(await realDeps(admin), form);
  if (result.status === "done") resetQueueCache();
  return finish(result);
}

export async function rediscoverHeldAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  return finish(await rediscoverHeldItem(await realDeps(admin), form));
}
