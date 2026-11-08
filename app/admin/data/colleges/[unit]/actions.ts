"use server";

import { refresh, revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { withAdmin } from "@/lib/admin/console-actions";
import { CONFIRM_KEEP, typedMatches, type AdminActionState } from "@/lib/admin/console";
import { keepDocument } from "@/lib/admin/keep-document";
import { dropDocument } from "@/scripts/drop-document.mts";
import { setProposalStatus } from "@/scripts/lib/steward/proposals.mts";
import { dataProjectEnv, supabaseStore } from "@/scripts/lib/data-platform/store.mts";

/**
 * The college page's Server Actions (specs/product/document-collisions.md "Keep this file"). `keepDocumentAction`
 * checks the admin first (`requireAdmin()`: an admin at aal2, else a 404), checks the typed word again, then runs
 * `keepDocument` (lib/admin/keep-document.ts, tested with fakes) over the real dependencies: the data store through the
 * store library with the server's `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (`dataProjectEnv`), since a drop writes four
 * collections in one change set and no `admin_data_*` function does that; the admin log through `admin_note_ops` with
 * the admin's own session, before anything is written.
 */
export async function keepDocumentAction(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  const { userId } = await requireAdmin();
  if (!typedMatches(form.get("confirm"), CONFIRM_KEEP)) return { status: "error", message: `Type ${CONFIRM_KEEP} to keep this file.` };
  const { url, key } = dataProjectEnv(process.env);
  if (!url || !key) return { status: "error", message: "The data store isn't set up for the console here (SUPABASE_URL and SUPABASE_SECRET_KEY), so nothing was changed." };
  return withAdmin("keep document", async (ctx) => {
    const result = await keepDocument(
      {
        store: supabaseStore(url, key),
        drop: dropDocument,
        setStatus: setProposalStatus,
        async note(action, details) {
          const { error } = await ctx.supabase.rpc("admin_note_ops", { p_action: action, p_details: details, p_request_id: null });
          return error ? { ok: false, message: error.message } : { ok: true };
        },
        admin: userId,
        now: () => new Date(),
        revalidate(unit) {
          revalidatePath(`/admin/data/colleges/${unit}`);
          revalidatePath(`/admin/data/colleges/${unit}/review`);
          revalidatePath("/admin");
        },
      },
      form,
    );
    if (result.status === "done") refresh();
    return result;
  });
}
