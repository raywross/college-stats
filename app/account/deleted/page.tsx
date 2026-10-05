import type { Metadata } from "next";
import Link from "next/link";
import { DELETE_GRACE_DAYS } from "@/lib/household-rules";

export const metadata: Metadata = { title: "Account deleted", robots: { index: false } };

/** Where the delete flow lands, already signed out. Static: it says the same thing to everyone. */
export default function AccountDeletedPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center sm:py-20">
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Your account is scheduled for deletion</h1>
      <p className="mt-3 text-muted-foreground">
        You&apos;ve been signed out. Changed your mind? Sign in with the same email within {DELETE_GRACE_DAYS} days and restore it from your account
        page. Everything public on the site still works without an account.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/explore" className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
          Explore colleges
        </Link>
        <Link href="/login?next=/account" className="rounded-full border px-5 py-2.5 text-sm font-semibold hover:bg-muted">
          Sign in to restore
        </Link>
      </div>
    </div>
  );
}
