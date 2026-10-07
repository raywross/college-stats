import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { AddPersonDialog } from "@/components/account/AddPersonDialog";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { addPersonProps, soloRole } from "@/components/account/addPersonProps";
import { AccountsSetupError, authConfigured, currentStudent, getAccount, requireUser } from "@/lib/auth";
import { myHouseholds } from "@/lib/households";
import { defaultHouseholdName, hubLanding, ownPersonPath } from "@/lib/household-hub";

export const metadata: Metadata = { title: "Your household", robots: { index: false } };

/**
 * /household (specs/product/household-hub.md "Redesign (2026-10-06)"): the people strip and settings come from
 * app/household/layout.tsx, so this page has no content of its own once there is a household. It redirects to the
 * viewer's own person page, or the first student's when the viewer has none (hubLanding()); a hash such as #home
 * carries over an HTTP redirect. With no household yet it is the "add the first person" state, under a strip of just
 * the viewer and the "+".
 */
export default async function HouseholdPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/household");

  let account, households, ownStudent;
  try {
    [account, households, ownStudent] = await Promise.all([getAccount(), myHouseholds(), currentStudent()]);
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }
  if (!account) return null;
  if (account.profile.deleted_at) redirect("/account");

  const landing = hubLanding(households);
  if (landing) redirect(landing);

  const role = soloRole(account.profile.role_hint, ownStudent !== null);
  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-8">
      <h2 className="font-display text-xl font-bold sm:text-2xl">Start your household</h2>
      <p className="mt-1.5 max-w-prose text-sm text-muted-foreground sm:text-base">
        Add the people who help with college: parents, guardians, and students. Everyone gets a list of colleges, students have their numbers too, and
        guardians see their students&apos; lists and numbers (students never see a guardian&apos;s finances).
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <AddPersonDialog {...addPersonProps(null, role, defaultHouseholdName(account.profile.display_name))} variant="button" />
        <Link
          href={ownPersonPath(ownStudent?.id ?? null, account.user.id)}
          className="inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold hover:bg-muted"
        >
          Your list
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
