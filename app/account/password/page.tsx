import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { Term } from "@/components/ui/info-tip";
import { authConfigured, requireUser } from "@/lib/auth";
import { parseWelcome } from "@/lib/household-hub";
import { SetPasswordForm } from "./SetPasswordForm";
import { welcomeInvitation } from "./welcome";

export const metadata: Metadata = { title: "Your password", robots: { index: false } };

/**
 * Set or change the password (specs/product/accounts.md, "Passwords"); "Forgot password" links land here signed in.
 * `?welcome=<invitation id>` (or `=1`) is an invited person's first visit (specs/product/household-hub.md): the invite
 * Edge Function's link signed them in, so all that's left is a password, and saving it joins the household.
 */
export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ welcome?: string | string[] }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { welcome: welcomeParam } = await searchParams;
  const welcome = parseWelcome(welcomeParam);
  const user = await requireUser(welcome ? `/account/password?welcome=${welcome.invitation ?? "1"}` : "/account/password");
  const invitation = welcome ? await welcomeInvitation(user.id, welcome.invitation) : null;

  if (invitation) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Choose a password</h1>
        <p className="mt-2 mb-6 text-muted-foreground">
          Choose a password to finish joining your <Term term="household">household</Term>. Next time, sign in with {user.email ?? "your email"} and this
          password.
        </p>
        <SetPasswordForm email={user.email ?? ""} welcome={invitation.id} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <Link href="/account" className="text-sm font-semibold text-muted-foreground hover:text-foreground">
        ← Your account
      </Link>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight">Your password</h1>
      <p className="mt-2 mb-6 text-muted-foreground">
        Choose a password to sign in with your email. You can still ask for an emailed sign-in link any time.
      </p>
      <SetPasswordForm email={user.email ?? ""} />
    </div>
  );
}
