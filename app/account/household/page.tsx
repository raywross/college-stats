import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AccountSection } from "@/components/account/AccountSection";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { HouseholdCard } from "@/components/account/HouseholdCard";
import { CreateHouseholdForm } from "@/components/account/HouseholdForms";
import { Term } from "@/components/ui/info-tip";
import { AccountsSetupError, authConfigured, getAccount, requireUser } from "@/lib/auth";
import { myHouseholds } from "@/lib/households";
import { HOUSEHOLD_MAX_MEMBERS } from "@/lib/household-rules";

export const metadata: Metadata = { title: "Your household", robots: { index: false } };

/**
 * /account/household (specs/product/accounts.md "Roles and households"): the user's household with its members,
 * seats, pending invitations, edit access, and managed students; or a form to start one. An account is in one
 * household at a time (an account from before that rule still sees each of its households here).
 */
export default async function HouseholdPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/account/household");

  let account;
  try {
    account = await getAccount();
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }
  if (!account) return null;
  if (account.profile.deleted_at) redirect("/account");

  const households = await myHouseholds();
  const defaultRole = account.profile.role_hint === "guardian" || account.profile.role_hint === "counselor" ? "guardian" : "student";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <Link href="/account" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Your account
        </Link>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Your <Term term="household">household</Term>
        </h1>
        <p className="mt-1 text-muted-foreground">
          Up to {HOUSEHOLD_MAX_MEMBERS} people in any mix of parents and students. Guardians see their students&apos; lists and plans; students never see
          a guardian&apos;s finances. Anyone can leave at any time.
        </p>
      </header>

      {households.map((h) => (
        <HouseholdCard key={h.id} h={h} />
      ))}

      {households.length === 0 && (
        <AccountSection id="new" title="Start a household" description="Then invite the others with a link. If someone invited you, open the link they sent instead.">
          <CreateHouseholdForm defaultRole={defaultRole} />
        </AccountSection>
      )}
    </div>
  );
}
