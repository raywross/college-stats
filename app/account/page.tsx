import type { Metadata } from "next";
import { connection } from "next/server";
import { AccountSection, ComingSoon } from "@/components/account/AccountSection";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { SignOutButton } from "@/components/account/SignOutButton";
import { Term } from "@/components/ui/info-tip";
import { AccountsSetupError, authConfigured, getAccount, requireUser } from "@/lib/auth";
import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

/**
 * /account (specs/product/accounts.md): profile, then households, data export, and deletion. This shell is the
 * foundation's; the household, export, delete, and access-log sections are filled in by the households build.
 */
export default async function AccountPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/account");

  let account;
  try {
    account = await getAccount();
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }
  if (!account) return null;
  const { profile, user } = account;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Your account</h1>
          <p className="mt-1 text-muted-foreground">{profile.display_name ? `Signed in as ${profile.display_name}.` : "You're signed in."}</p>
        </div>
        <SignOutButton className="h-10 rounded-full border px-4 text-sm font-semibold hover:bg-muted" />
      </header>

      {profile.birth_year === null && (
        <p className="rounded-2xl border border-pop bg-pop/15 px-4 py-3 text-sm" role="status">
          Add your birth year below to finish setting up your account.
        </p>
      )}

      <AccountSection id="profile" title="Profile">
        <ProfileForm profile={profile} email={user.email} />
      </AccountSection>

      <AccountSection
        id="household"
        title={<Term term="household">Household</Term>}
        description="Link a parent or guardian and the students they help. Students never see a guardian's finances."
      >
        <ComingSoon>Households and invitations are coming soon.</ComingSoon>
      </AccountSection>

      <AccountSection id="data" title="Your data" description="Download everything we keep about you as one file.">
        <ComingSoon>Data export is coming soon.</ComingSoon>
      </AccountSection>

      <AccountSection id="delete" title="Delete your account" description="Removes your profile and memberships. You can change your mind for 30 days.">
        <ComingSoon>Account deletion is coming soon.</ComingSoon>
      </AccountSection>
    </div>
  );
}
