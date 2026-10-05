"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { DELETE_CONFIRMATION, HOUSEHOLD_ERRORS, errorMessage } from "@/lib/household-rules";

export type DeleteState = { status: "idle" } | { status: "error"; message: string };

/**
 * Deletes the signed-in user's account (delete_my_account(): a 30-day soft delete, see
 * specs/product/accounts.md "Data handling"), then signs them out everywhere and shows /account/deleted.
 */
export async function deleteAccount(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const user = await getUser();
  if (!user) return { status: "error", message: HOUSEHOLD_ERRORS.not_signed_in };
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== DELETE_CONFIRMATION) {
    return { status: "error", message: `Type "${DELETE_CONFIRMATION}" to confirm.` };
  }
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    console.error(`account: delete_my_account failed: ${error.message}`);
    return { status: "error", message: errorMessage(error, HOUSEHOLD_ERRORS, "We couldn't delete your account. Try again in a moment.") };
  }
  // Every device: a deleted account shouldn't stay signed in anywhere.
  const signOut = await supabase.auth.signOut({ scope: "global" });
  if (signOut.error) {
    console.error(`account: sign-out after delete failed: ${signOut.error.message}`);
    await supabase.auth.signOut({ scope: "local" });
  }
  redirect("/account/deleted");
}

/** Undoes a delete within the 30 days (restore_my_account()). */
export async function restoreAccount(): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login?next=/account");
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("restore_my_account");
  if (error) {
    console.error(`account: restore_my_account failed: ${error.message}`);
    throw new Error("We couldn't restore your account. Try again in a moment.");
  }
  refresh();
}
