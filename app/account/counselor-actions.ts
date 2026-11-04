"use server";

import { refresh } from "next/cache";
import { getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { orgErrorMessage } from "@/lib/org-rules";

export type CounselorActionState = { status: "idle" } | { status: "done" } | { status: "error"; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Your counselors" on /account and on a child's household page (specs/product/counselor-portal.md "The student's
 * side"): Can edit / View only (set_org_student_can_edit) and End access (end_org_access) on one grant. The database
 * decides who may (the student or their family); refusals come back as plain sentences.
 */
async function onGrant(fn: "set_org_student_can_edit" | "end_org_access", form: FormData, extra: Record<string, unknown> = {}): Promise<CounselorActionState> {
  const grant = String(form.get("grant") ?? "");
  if (!UUID_RE.test(grant)) return { status: "error", message: orgErrorMessage("grant_not_found") };
  if (!(await getUser())) return { status: "error", message: orgErrorMessage("not_signed_in") };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc(fn, { p_grant: grant, ...extra });
  if (error) {
    console.error(`account: ${fn} refused: ${error.message}`);
    return { status: "error", message: orgErrorMessage(error.message) };
  }
  refresh();
  return { status: "done" };
}

/** Can edit (`can_edit=1`) or View only (`can_edit=0`) for one counselor organization. */
export async function setCounselorCanEdit(_prev: CounselorActionState, form: FormData): Promise<CounselorActionState> {
  return onGrant("set_org_student_can_edit", form, { p_can_edit: form.get("can_edit") === "1" });
}

/** End access: the organization stops seeing the student at once. */
export async function endCounselorAccess(_prev: CounselorActionState, form: FormData): Promise<CounselorActionState> {
  return onGrant("end_org_access", form);
}
