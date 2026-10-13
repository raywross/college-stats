"use server";

import { refresh } from "next/cache";
import { callAdminRpc, withAdmin } from "@/lib/admin/console-actions";
import {
  BAD_FORM_MESSAGE,
  CONFIRM_REMOVE,
  formId,
  parseHouseholdName,
  typedMatches,
  type AdminActionState,
} from "@/lib/admin/console";

/**
 * A household's actions (specs/product/admin.md "A household"). The database functions keep the rules (six seats, one
 * household per person, the last guardian of a managed student) and say why in words the console shows as written.
 */

const badForm: AdminActionState = { status: "error", message: BAD_FORM_MESSAGE };

/** Rename. */
export async function renameHousehold(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("household rename", async (ctx) => {
    const household = formId(form, "household");
    if (!household) return badForm;
    const parsed = parseHouseholdName(form);
    if (!parsed.ok) return { status: "error", message: parsed.message };
    const failed = await callAdminRpc(ctx, "household rename", "admin_update_household", { p_household: household, p_patch: { name: parsed.value.name } });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Renamed." };
  });
}

/**
 * Add a student record, or a person as a guardian. Someone already in another household is moved (the picker named
 * that household before this button could be pressed); their data is untouched.
 */
export async function addToHousehold(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("household link", async (ctx) => {
    const household = formId(form, "household");
    const student = formId(form, "student");
    const user = formId(form, "user");
    if (!household || (student === null) === (user === null)) return badForm;
    const args: Record<string, unknown> = { p_household: household, p_student: student, p_user: user };
    // Parents edit by default (2026-10-08): the page's box starts ticked, and an unticked box sends nothing.
    if (user) args.p_can_edit = form.get("can_edit") === "on";
    const failed = await callAdminRpc(ctx, "household link", "admin_link", args);
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Added. The household will see a note that Quad support added them." };
  });
}

/** Remove a person (admin_unlink). Typed "remove". A student record is never deleted by an unlink. */
export async function removeMember(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("household unlink", async (ctx) => {
    const member = formId(form, "member");
    if (!member) return badForm;
    if (!typedMatches(form.get("confirm"), CONFIRM_REMOVE)) return { status: "error", message: `Type "${CONFIRM_REMOVE}" to confirm.` };
    const failed = await callAdminRpc(ctx, "household unlink", "admin_unlink", { p_member: member });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Removed. The household will see a note that Quad support removed them." };
  });
}

/** Cancel a pending invitation, as the family's Cancel does. */
export async function cancelInvitation(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("invitation revoke", async (ctx) => {
    const invitation = formId(form, "invitation");
    if (!invitation) return badForm;
    const failed = await callAdminRpc(ctx, "invitation revoke", "admin_revoke_invitation", { p_invitation: invitation });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Invitation cancelled." };
  });
}

/** Close an empty household (a soft delete). */
export async function closeHousehold(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("household close", async (ctx) => {
    const household = formId(form, "household");
    if (!household) return badForm;
    const failed = await callAdminRpc(ctx, "household close", "admin_close_household", { p_household: household });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Household closed." };
  });
}
