import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { SignOutButton } from "@/components/account/SignOutButton";
import { accountPaused, authConfigured, getUser } from "@/lib/auth";
import { AGE_GATE_COOKIE, isRoleHint, safeNextPath } from "@/lib/accounts";
import { pausedNotice } from "@/lib/admin/constants";
import { SITE_NAME } from "@/lib/brand";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Send yourself a new one.",
};

/**
 * Email magic-link sign-in (specs/product/accounts.md). `?next=` (a same-origin path) is where to return after.
 * `?mode=signup` opens on Create an account and `?role=` picks its "I'm" (the join page's links). `?paused=1` is where requireUser() sends a paused account (specs/product/admin.md "What deactivate means"): the
 * notice says so. A paused person whose last token still lives stays here (sending them on would loop back) with a
 * Sign out button instead of the form.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; paused?: string; mode?: string; role?: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const params = await searchParams;
  const next = safeNextPath(params.next, "/account");
  const user = await getUser();
  const pausedNow = user !== null && (await accountPaused());
  if (user && !pausedNow) redirect(next);
  const paused = pausedNow || params.paused === "1";
  const refused = (await cookies()).get(AGE_GATE_COOKIE)?.value === "refused";

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-20">
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
        Sign in to <span className="highlight">{SITE_NAME}</span>
      </h1>
      <p className="mt-2 text-muted-foreground">Keep your colleges, your numbers, and your family&apos;s planning in one place. Everything else works without an account.</p>
      {paused && (
        <p className="mt-6 rounded-2xl border border-pop bg-pop/15 px-4 py-3 text-sm" role="status">
          {pausedNotice()}
        </p>
      )}
      <div className="mt-8">
        {pausedNow ? (
          <SignOutButton className="h-10 rounded-full border px-4 text-sm font-semibold hover:bg-muted" />
        ) : (
          <LoginForm
            next={next}
            refused={refused}
            initialError={params.error ? ERRORS[params.error] ?? ERRORS.link : undefined}
            initialMode={params.mode === "signup" ? "signup" : "signin"}
            initialRole={isRoleHint(params.role) ? params.role : "student"}
          />
        )}
      </div>
    </div>
  );
}
