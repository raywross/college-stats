import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Download, KeyRound, Trash2 } from "lucide-react";
import { AccessLogList } from "@/components/account/AccessLogList";
import { AccountSection } from "@/components/account/AccountSection";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { HouseholdSummary } from "@/components/account/HouseholdSummary";
import { SignOutButton } from "@/components/account/SignOutButton";
import { Term } from "@/components/ui/info-tip";
import { AccountsSetupError, authConfigured, currentStudent, getAccount, requireUser } from "@/lib/auth";
import { myAccessLog, myHouseholds } from "@/lib/households";
import { myHome } from "@/lib/home-store";
import { DELETE_GRACE_DAYS, shortDate } from "@/lib/household-rules";
import { restoreAccount } from "./delete/actions";
import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

/**
 * /account (specs/product/accounts.md): profile, households, who viewed your information, data export, and
 * deletion. An account scheduled for deletion sees only the way back.
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

  if (profile.deleted_at) return <ScheduledForDeletion deletedAt={profile.deleted_at} />;

  const [households, student, home] = await Promise.all([myHouseholds(), currentStudent(), myHome()]);
  const accessLog = student ? await myAccessLog() : [];
  const defaultRole = profile.role_hint === "guardian" || profile.role_hint === "counselor" ? "guardian" : "student";

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

      <AccountSection id="password" title="Password" description="Sign in with your email and a password, or with an emailed link.">
        <Link href="/account/password" className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
          <KeyRound className="size-4" />
          Set or change your password
        </Link>
      </AccountSection>

      <AccountSection
        id="household"
        title={<Term term="household">Household</Term>}
        description="Parents or guardians and the students they help, up to six people in any mix, sharing one home address for distances. Students never see a guardian's finances."
      >
        <HouseholdSummary households={households} home={home} defaultRole={defaultRole} />
      </AccountSection>

      <AccountSection id="following" title={<Term term="follow">Following</Term>} description="Colleges you follow, and your update-email setting.">
        <Link href="/me/following" className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
          Manage what you follow
        </Link>
      </AccountSection>

      {student && (
        <AccountSection
          id="access"
          title={<Term term="access-log">Who viewed your information</Term>}
          description="Guardians in your households use their own sign-in, so each time one looks at your list or profile, it shows up here."
        >
          <AccessLogList rows={accessLog} />
        </AccountSection>
      )}

      <AccountSection id="data" title="Your data" description="Download everything we keep about you as one file.">
        <a
          href="/account/export"
          download
          className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted"
        >
          <Download className="size-4" />
          Download my data (JSON)
        </a>
        <p className="mt-2 text-xs text-muted-foreground">
          Your profile, your household&apos;s home address and its members&apos; names, the students you own or manage, invitations you sent, and
          who viewed your information.
        </p>
      </AccountSection>

      <AccountSection
        id="delete"
        title="Delete your account"
        description={`Removes your profile and memberships. You can change your mind for ${DELETE_GRACE_DAYS} days.`}
      >
        <Link
          href="/account/delete"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-destructive/40 px-4 text-sm font-semibold text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="size-4" />
          Delete my account…
        </Link>
      </AccountSection>
    </div>
  );
}

function ScheduledForDeletion({ deletedAt }: { deletedAt: string }) {
  const until = shortDate(new Date(new Date(deletedAt).getTime() + DELETE_GRACE_DAYS * 86_400_000).toISOString());
  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:py-20">
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Your account is scheduled for deletion</h1>
      <p className="mt-3 text-muted-foreground">
        It will be deleted for good on {until}. Until then you can restore it. Households you were in won&apos;t come back: ask for a new
        invitation.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <form action={restoreAccount}>
          <button type="submit" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
            Restore my account
          </button>
        </form>
        <SignOutButton className="h-10 rounded-full border px-4 text-sm font-semibold hover:bg-muted" />
      </div>
    </div>
  );
}
