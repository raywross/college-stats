"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { realOpsDeps } from "@/lib/admin/ops";
import { adminSupabase } from "@/lib/admin/people";
import { adminErrorMessage, type AdminActionState } from "@/lib/admin/console";
import { publishNow, pointBackHere, type DataActionDeps } from "@/lib/admin/data-actions";

/**
 * The Data console's Server Actions (specs/data-platform/change-sets.md "The console", Overview and Snapshots rows;
 * specs/data-platform/publish.md "The admin's publish controls"). Each calls `requireAdmin()` itself, the way
 * Operations' actions do (not `withAdmin()`: these actions also dispatch a workflow, which needs the GitHub
 * dependencies `lib/admin/ops.ts` builds, not the People family's `AdminContext`). The work, including logging before
 * sending, is in `lib/admin/data-actions.ts`, which `tests/admin-data.test.mts` exercises with fake dependencies.
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
  };
}

export async function publishNowAction(_previous: AdminActionState, _form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const result = await publishNow(await realDeps(admin));
  if (result.status === "done") refresh();
  return result;
}

export async function pointBackAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const result = await pointBackHere(await realDeps(admin), form);
  if (result.status === "done") refresh();
  return result;
}
