"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth";
import { INVITATION_ERRORS } from "@/lib/accounts";
import { errorMessage } from "@/lib/household-rules";
import { parseWelcome } from "@/lib/household-hub";
import { passwordProblems } from "@/lib/password";
import { welcomeInvitation } from "./welcome";

export type SetPasswordState = { status: "idle" } | { status: "saved"; joinError?: string } | { status: "error"; message: string };

/**
 * Sets or changes the signed-in user's password (also where "Forgot password" lands, signed in by the reset link).
 * Checked against lib/password.ts first; Supabase applies its own minimum too.
 *
 * With `welcome` (an invited person's first visit, specs/product/household-hub.md), saving also accepts their
 * invitation (accept_invitation_by_id(), which only the user the invite function created may call) and opens the
 * household page, so there's no second "Accept" click.
 */
export async function setPassword(_prev: SetPasswordState, form: FormData): Promise<SetPasswordState> {
  const user = await getUser();
  if (!user) return { status: "error", message: "Your session ended. Sign in again." };
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const problems = passwordProblems(password, user.email ?? "");
  if (problems.length) return { status: "error", message: problems.join(" ") };
  if (password !== confirm) return { status: "error", message: "The two passwords don't match." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { status: "error", message: "That's already your password. Choose a new one." };
    if (error.code === "reauthentication_needed")
      return { status: "error", message: "For your security, sign in again (or use “Forgot password”), then change it." };
    console.error(`account/password: updateUser failed (${error.code ?? error.status}): ${error.message}`);
    return { status: "error", message: error.code === "weak_password" ? error.message : "We couldn't save it. Try again in a moment." };
  }

  const welcome = parseWelcome(form.get("welcome"));
  if (welcome) {
    const invitation = await welcomeInvitation(user.id, welcome.invitation);
    if (invitation) {
      const accepted = await supabase.rpc("accept_invitation_by_id", { p_invitation: invitation.id });
      if (accepted.error) {
        console.error(`account/password: accept_invitation_by_id refused: ${accepted.error.message}`);
        return { status: "saved", joinError: errorMessage(accepted.error, INVITATION_ERRORS, "We couldn't add you to the household. Try the invitation link again.") };
      }
    }
    redirect("/household");
  }
  return { status: "saved" };
}
