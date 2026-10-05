import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { authConfigured, requireUser } from "@/lib/auth";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata: Metadata = { title: "Your password", robots: { index: false } };

/** Set or change the password (specs/product/accounts.md, "Passwords"); "Forgot password" links land here signed in. */
export default async function PasswordPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const user = await requireUser("/account/password");
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
