"use server";

import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { INVITATION_ERRORS } from "@/lib/accounts";
import { errorMessage, isInvitationToken } from "@/lib/household-rules";

export type AcceptState = { status: "idle" } | { status: "error"; message: string };

/** Accepts a household invitation as the signed-in user (accept_invitation()), then opens the household page. */
export async function acceptInvitation(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const token = form.get("token");
  if (!isInvitationToken(token)) return { status: "error", message: INVITATION_ERRORS.invitation_not_found };
  const user = await getUser();
  if (!user) return { status: "error", message: INVITATION_ERRORS.not_signed_in };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) {
    console.error(`invite: accept_invitation refused: ${error.message}`);
    return { status: "error", message: errorMessage(error, INVITATION_ERRORS, "We couldn't accept this invitation. Try again in a moment.") };
  }
  redirect("/account/household");
}
