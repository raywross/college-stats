"use server";

import { refresh, revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { withAdmin, type AdminContext } from "@/lib/admin/console-actions";
import type { AdminActionState } from "@/lib/admin/console";
import { readEdit } from "@/lib/admin/edits-reads";
import { forgetLiveEdits } from "@/lib/data-platform/live-edits";
import { releaseEdit, revertToEdit, saveEdit, type EditActionDeps } from "@/lib/admin/edits-actions";

/**
 * The field editor's Server Actions (specs/data-platform/change-sets.md "Admin edits"). Each calls `requireAdmin()`
 * first (an admin at aal2, else a 404), then runs inside `withAdmin()` for the admin's session and its error handling.
 * The work, including the registry and value checks before any database call, is in `lib/admin/edits-actions.ts`,
 * which tests/admin-edits.test.mts exercises with fake dependencies.
 */

function realDeps(ctx: AdminContext): EditActionDeps {
  return {
    async rpc(fn, args) {
      const { data, error } = await ctx.supabase.rpc(fn, args);
      if (error) console.error(`admin: ${fn} failed: ${error.message}`);
      return error ? { ok: false, error: error.message } : { ok: true, data };
    },
    readEdit: (id) => readEdit(ctx.supabase, id),
    forget: forgetLiveEdits,
    revalidate(paths) {
      for (const path of paths) revalidatePath(path, "layout");
    },
  };
}

/** A finished action shows its result; the page re-reads so the row catches up. */
function finish(result: AdminActionState): AdminActionState {
  if (result.status === "done") refresh();
  return result;
}

export async function saveEditAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  await requireAdmin();
  return withAdmin("save edit", async (ctx) => finish(await saveEdit(realDeps(ctx), form)));
}

export async function releaseEditAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  await requireAdmin();
  return withAdmin("release edit", async (ctx) => finish(await releaseEdit(realDeps(ctx), form)));
}

export async function revertEditAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  await requireAdmin();
  return withAdmin("revert edit", async (ctx) => finish(await revertToEdit(realDeps(ctx), form)));
}
