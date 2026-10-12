"use server";

import { refresh } from "next/cache";
import { callAdminRpc, withAdmin } from "@/lib/admin/console-actions";
import { BAD_FORM_MESSAGE, formId, parseGrantNote, type AdminActionState } from "@/lib/admin/console";

/** Who is an admin (specs/product/admin.md "Who is an admin"): grant and revoke. The database keeps the rules. */

const badForm: AdminActionState = { status: "error", message: BAD_FORM_MESSAGE };

/** Make a person an admin (they enroll their own second factor at their next visit). */
export async function grantAdmin(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("admin grant", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    const failed = await callAdminRpc(ctx, "admin grant", "admin_grant", { p_user: user, p_note: parseGrantNote(form) });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Now an admin. They set up their authenticator app the first time they open the console." };
  });
}

/** Revoke. Not yourself, and never the last admin (both refused by the database with the reason). */
export async function revokeAdmin(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("admin revoke", async (ctx) => {
    const user = formId(form, "user");
    if (!user) return badForm;
    const failed = await callAdminRpc(ctx, "admin revoke", "admin_revoke", { p_user: user });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Admin access revoked." };
  });
}
