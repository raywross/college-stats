"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { INVITATION_ERRORS } from "@/lib/accounts";
import { errorMessage, isInvitationToken } from "@/lib/household-rules";
import { inviteRedirectTo, requestOrigin } from "@/lib/household-hub";
import { inviteUser } from "@/lib/invite-function";

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
  redirect("/household");
}

/**
 * What "Continue" found when it couldn't sign the visitor straight in: they already have an account (sign in, then
 * accept), the invitation is gone, or the invite function isn't reachable (sign in the ordinary way instead).
 */
export type ContinueState = { status: "idle" } | { status: "existing" } | { status: "fallback" } | { status: "error"; message: string };

/**
 * "Continue" on /invite/[token] for a signed-out visitor (specs/product/household-hub.md "The invited person's first
 * visit"): the invite Edge Function creates their account (email already confirmed) and returns a one-time sign-in
 * link, which lands on /auth/confirm and then the "choose a password" step, where saving accepts the invitation.
 * Called only now, at click time, because that link lasts about an hour and each new one cancels the last; the link
 * people are sent is always this page's.
 */
export async function continueInvitation(_prev: ContinueState, form: FormData): Promise<ContinueState> {
  const token = form.get("token");
  if (!isInvitationToken(token)) return { status: "error", message: INVITATION_ERRORS.invitation_not_found };
  // Someone already signed in accepts with the button the page shows them.
  if (await getUser()) return { status: "fallback" };
  const result = await inviteUser({ token, redirectTo: inviteRedirectTo(requestOrigin(await headers())) });
  if (result.ok) redirect(result.link);
  if (result.reason === "already_registered") return { status: "existing" };
  if (result.reason === "not_found") return { status: "error", message: INVITATION_ERRORS.invitation_not_found };
  return { status: "fallback" };
}
