"use server";

import { refresh } from "next/cache";
import { callAdminRpc, withAdmin } from "@/lib/admin/console-actions";
import {
  BAD_FORM_MESSAGE,
  CONFIRM_DELETE_RECORD,
  formId,
  parseStudentEdit,
  typedMatches,
  type AdminActionState,
} from "@/lib/admin/console";

/** A student record's actions (specs/product/admin.md "A student record"). */

const badForm: AdminActionState = { status: "error", message: BAD_FORM_MESSAGE };

/** Edit the record's name, graduation year, phone. */
export async function editStudent(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("student edit", async (ctx) => {
    const student = formId(form, "student");
    if (!student) return badForm;
    const parsed = parseStudentEdit(form);
    if (!parsed.ok) return { status: "error", message: parsed.message };
    const failed = await callAdminRpc(ctx, "student edit", "admin_update_student", { p_student: student, p_patch: parsed.value });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Saved." };
  });
}

/** Attach a managed record to an account (the merge_managed_student path). Refused, with the reason, when they have a record. */
export async function attachStudent(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("student attach", async (ctx) => {
    const student = formId(form, "student");
    const user = formId(form, "user");
    if (!student || !user) return badForm;
    const failed = await callAdminRpc(ctx, "student attach", "admin_claim_student", { p_student: student, p_user: user });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Attached. The record now belongs to that account." };
  });
}

/** Delete the record: a soft delete, typed. For a child a family added by mistake; refused for a record with an account. */
export async function deleteStudent(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("student delete", async (ctx) => {
    const student = formId(form, "student");
    if (!student) return badForm;
    if (!typedMatches(form.get("confirm"), CONFIRM_DELETE_RECORD)) return { status: "error", message: `Type "${CONFIRM_DELETE_RECORD}" to confirm.` };
    const failed = await callAdminRpc(ctx, "student delete", "admin_delete_student", { p_student: student });
    if (failed) return failed;
    refresh();
    return { status: "done", message: "Record deleted. It is removed for good after 30 days." };
  });
}
