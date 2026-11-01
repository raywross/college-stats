"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import { getData } from "@/lib/data";
import type { AdminActionState } from "@/lib/admin/console";
import { referenceVersionBody } from "@/lib/admin/reference-reads";
import { revertReference, saveReference, type ReferenceActionDeps } from "@/lib/admin/reference-actions";

/**
 * The reference editor's Server Actions (specs/data-platform/change-sets.md "Admin edits" → "Reference documents").
 * Each calls `requireAdmin()` itself, the way the rest of the Data console's actions do; the work is in
 * `lib/admin/reference-actions.ts`, which `tests/admin-reference.test.mts` exercises with fake dependencies.
 */
async function realDeps(): Promise<ReferenceActionDeps> {
  return {
    async rpc(args) {
      const supabase = await adminSupabase();
      const { data, error } = await supabase.rpc("admin_data_set_reference", args);
      if (error) console.error(`admin: admin_data_set_reference failed: ${error.message}`);
      return error ? { ok: false, error: error.message } : { ok: true, data };
    },
    async readVersion(collection, key, version) {
      const supabase = await adminSupabase();
      return referenceVersionBody(supabase, collection, key, version);
    },
    async knownUnitIds() {
      const { getAllSchools } = await getData();
      return new Set(getAllSchools().map((s) => s.unit_id));
    },
  };
}

function finish(result: AdminActionState): AdminActionState {
  if (result.status === "done") refresh();
  return result;
}

export async function saveReferenceAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  await requireAdmin();
  return finish(await saveReference(await realDeps(), form));
}

export async function revertReferenceAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  await requireAdmin();
  return finish(await revertReference(await realDeps(), form));
}
