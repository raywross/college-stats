"use server";

import { redirect } from "next/navigation";
import { currentStudent, getAccount, getUser, studentsICanSee } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { trackServer } from "@/lib/analytics-server";
import { isNewAccount, joinedHref, joinTarget } from "@/lib/join-rules";
import { ORG_ERRORS, orgErrorMessage } from "@/lib/org-rules";
import { CASELOAD_HREF } from "@/lib/org-hrefs";
import { planHref } from "@/lib/planner/plan-tabs";
import { isParent } from "@/lib/viewer-relation";

export type JoinActionState = { status: "idle" } | { status: "error"; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Join on /join/[code] (specs/product/counselor-portal.md "How a student joins"): grants the organization access to
 * the signed-in student's own record, or, with `student`, to a student the signed-in guardian can see
 * (join_organization for a code, accept_org_invitation for an invitation token), then lands on that student's advisor
 * with the one-line notice (`?joined=<grant id>`). A counselor-side invitation makes the signed-in person a member and
 * lands on /org. The database decides who may join for whom; this only picks the call and reports refusals in plain
 * words. Sends `org_student_joined {source, new_account}` for a student's join, never the organization or the student.
 */
export async function joinOrganization(_prev: JoinActionState, form: FormData): Promise<JoinActionState> {
  const segment = String(form.get("segment") ?? "");
  const target = joinTarget(segment);
  if (target.kind === "invalid") return { status: "error", message: ORG_ERRORS.no_such_code };
  const user = await getUser();
  if (!user) return { status: "error", message: ORG_ERRORS.not_signed_in };
  const counselorSide = form.get("side") === "counselor";

  // Whom it's for: a student the guardian picked (one they can see), else the viewer's own record (made now if
  // missing, as /me does: currentStudent()).
  const picked = String(form.get("student") ?? "");
  let studentId: string | null = null;
  let forSelf = false;
  if (!counselorSide) {
    if (picked) {
      if (!UUID_RE.test(picked)) return { status: "error", message: ORG_ERRORS.not_a_student };
      const seen = await studentsICanSee();
      if (!seen.some((a) => a.student.id === picked && isParent(a.relation))) return { status: "error", message: ORG_ERRORS.not_a_student };
      studentId = picked;
    } else {
      const own = await currentStudent().catch(() => null);
      if (!own) return { status: "error", message: ORG_ERRORS.not_a_student };
      studentId = own.id;
      forSelf = true;
    }
  }

  const supabase = await createServerSupabase();
  const { data, error } =
    target.kind === "invitation"
      ? await supabase.rpc("accept_org_invitation", { p_token: target.token, p_student: forSelf ? null : studentId })
      : await supabase.rpc("join_organization", { p_code: target.code, p_student: forSelf ? null : studentId });
  if (error) {
    console.error(`join: ${target.kind === "invitation" ? "accept_org_invitation" : "join_organization"} refused: ${error.message}`);
    if (/does not exist|schema cache/i.test(error.message)) return { status: "error", message: "Joining a counselor isn't available yet. Try again later." };
    return { status: "error", message: orgErrorMessage(error.message) };
  }
  if (counselorSide) redirect(CASELOAD_HREF);

  const grantId = typeof data === "string" ? data : "";
  await trackServer("org_student_joined", { source: target.kind === "invitation" ? "invite" : "code", new_account: await newAccount() });
  const advisor = forSelf ? planHref({}) : planHref({ person: studentId });
  redirect(grantId ? joinedHref(advisor, grantId) : advisor);
}

/** Whether the signed-in account was just made (lib/join-rules.ts isNewAccount). False on any error. */
async function newAccount(): Promise<boolean> {
  try {
    const supabase = await createServerSupabase();
    const [{ data }, account] = await Promise.all([supabase.auth.getUser(), getAccount()]);
    return isNewAccount({
      email_confirmed_at: data.user?.email_confirmed_at ?? null,
      confirmed_at: data.user?.confirmed_at ?? null,
      profileCreated: account?.profile.created ?? null,
    });
  } catch {
    return false;
  }
}
