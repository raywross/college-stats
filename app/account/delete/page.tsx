import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { DeleteAccountForm } from "@/components/account/DeleteAccountForm";
import { AccountsSetupError, authConfigured, getAccount, requireUser } from "@/lib/auth";
import { deletionPreview, myHouseholds } from "@/lib/households";
import { DELETE_GRACE_DAYS } from "@/lib/household-rules";

export const metadata: Metadata = { title: "Delete your account", robots: { index: false } };

/** /account/delete: what deleting removes and what survives (accounts.md "Data handling"), then a typed confirmation. */
export default async function DeleteAccountPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/account/delete");
  let account;
  try {
    account = await getAccount();
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }
  if (!account) return null;
  if (account.profile.deleted_at) redirect("/account");

  const [preview, households] = await Promise.all([deletionPreview(), myHouseholds()]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <Link href="/account" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Your account
        </Link>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Delete your account</h1>
        <p className="mt-1 text-muted-foreground">
          You&apos;ll be signed out everywhere. For {DELETE_GRACE_DAYS} days you can sign in again and restore it; after that it&apos;s gone for good.
        </p>
      </header>

      <section className="rounded-3xl border bg-card p-4 sm:p-6">
        <h2 className="font-display text-xl font-bold">What happens</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          <li>Your profile (name, birth year) is removed.</li>
          {preview.own_student && <li>Your own student record and everything attached to it (your list, your numbers) is removed, and guardians stop seeing it right away.</li>}
          {households.length > 0 && (
            <li>
              You leave {households.length === 1 ? households[0].name : `your ${households.length} households`}. A household with nobody left in it is closed.
              Restoring your account won&apos;t bring memberships back.
            </li>
          )}
          {preview.managed.map((m) => (
            <li key={m.id}>
              {m.kept ? (
                <>
                  <span className="font-semibold">{m.name ?? "A student you added"}</span> stays: {m.kept_by ?? "another guardian"} still has access and takes over
                  managing them.
                </>
              ) : (
                <>
                  <span className="font-semibold">{m.name ?? "A student you added"}</span>, a student you added, is removed too: no other guardian has access.
                </>
              )}
            </li>
          ))}
          <li>Invitations you sent that nobody has used stop working.</li>
          <li>Students&apos; own accounts and their lists are never deleted with yours.</li>
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          Want a copy first?{" "}
          <a href="/account/export" download className="font-semibold text-primary hover:underline">
            Download your data
          </a>
          .
        </p>
      </section>

      <section className="rounded-3xl border border-destructive/30 bg-card p-4 sm:p-6">
        <DeleteAccountForm />
      </section>
    </div>
  );
}
