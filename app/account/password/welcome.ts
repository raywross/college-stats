import "server-only";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * The invitation a newly invited person is finishing (specs/product/household-hub.md "The invited person's first
 * visit"): the invite Edge Function recorded their user id in invitations.accepted_by, and a select policy lets them
 * read that row ("Invitations: invited user reads own"). By id when the welcome link carried one; otherwise their
 * newest pending one. Null when there's none left (already accepted, cancelled) or the read fails.
 */
export async function welcomeInvitation(userId: string, invitationId: string | null): Promise<{ id: string; side: "guardian" | "student" } | null> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("invitations")
    .select("id, side")
    .eq("accepted_by", userId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created", { ascending: false })
    .limit(1);
  if (invitationId) query = query.eq("id", invitationId);
  const { data, error } = await query;
  if (error) {
    console.error(`account/password: reading the welcome invitation failed: ${error.message}`);
    return null;
  }
  return ((data ?? [])[0] as { id: string; side: "guardian" | "student" } | undefined) ?? null;
}
