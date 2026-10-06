import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Users } from "lucide-react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { SignInPrompt } from "@/components/account/SignInPrompt";
import { Term } from "@/components/ui/info-tip";
import { authConfigured, getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { INVITATION_ERRORS } from "@/lib/accounts";
import { isInvitationToken, shortDate } from "@/lib/household-rules";
import { AcceptInvitationForm } from "./AcceptInvitationForm";

// The token is a credential: keep it out of search engines and out of Referer headers to other sites.
export const metadata: Metadata = { title: "Household invitation", robots: { index: false }, referrer: "no-referrer" };

interface Preview {
  household_name: string;
  inviter_name: string | null;
  side: "guardian" | "student";
  expires_at: string;
  state: "pending" | "used" | "expired" | "revoked";
}

const STATE_MESSAGES: Record<Exclude<Preview["state"], "pending">, string> = {
  used: INVITATION_ERRORS.invitation_used,
  expired: INVITATION_ERRORS.invitation_expired,
  revoked: INVITATION_ERRORS.invitation_revoked,
};

/**
 * /invite/[token] (specs/product/accounts.md "Roles and households"): what the invitation is (invitation_preview(),
 * which works signed out), then sign in or accept. Every refusal is a plain sentence.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { token } = await params;

  let preview: Preview | null = null;
  if (isInvitationToken(token)) {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("invitation_preview", { p_token: token });
    if (error) {
      console.error(`invite: invitation_preview failed: ${error.message}`);
      if (/does not exist|schema cache/i.test(error.message)) return <AuthUnavailable title="Accounts aren't set up yet" />;
    }
    preview = (data as Preview | null) ?? null;
  }
  const user = await getUser();
  const path = `/invite/${token}`;

  return (
    <div className="mx-auto max-w-lg px-4 py-14 sm:py-20">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
        <Users className="size-7" />
      </span>
      {!preview ? (
        <>
          <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight">This link doesn&apos;t work</h1>
          <p className="mt-3 text-muted-foreground">{INVITATION_ERRORS.invitation_not_found}</p>
          <BackLinks signedIn={Boolean(user)} />
        </>
      ) : (
        <>
          <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight break-words">
            Join {preview.household_name}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {preview.inviter_name?.trim() || "Someone"} invited you to this <Term term="household">household</Term> as{" "}
            {preview.side === "guardian" ? (
              <>
                a <Term term="guardian">guardian</Term>. You&apos;ll see its students&apos; college lists and plans.
              </>
            ) : (
              <>a student. Its guardians will see your college list and plans, and you can leave at any time.</>
            )}
          </p>

          {preview.state !== "pending" ? (
            <>
              <p className="mt-6 rounded-2xl bg-muted/60 px-4 py-3 text-sm font-medium" role="status">
                {STATE_MESSAGES[preview.state]}
              </p>
              <BackLinks signedIn={Boolean(user)} />
            </>
          ) : user ? (
            <div className="mt-6 space-y-3">
              <p className="text-sm text-muted-foreground">
                Signed in as <span className="font-semibold text-foreground">{user.email}</span>. It works only for the email it was sent to, until{" "}
                {shortDate(preview.expires_at)}.
              </p>
              <AcceptInvitationForm token={token} />
            </div>
          ) : (
            <SignInPrompt className="mt-6" reason="accept this invitation" next={path} />
          )}
        </>
      )}
    </div>
  );
}

function BackLinks({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <Link href={signedIn ? "/account/household" : "/"} className="rounded-full border px-5 py-2.5 text-sm font-semibold hover:bg-muted">
        {signedIn ? "Your household" : "Home"}
      </Link>
    </div>
  );
}
