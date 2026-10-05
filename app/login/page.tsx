import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { authConfigured, getUser } from "@/lib/auth";
import { AGE_GATE_COOKIE, safeNextPath } from "@/lib/accounts";
import { SITE_NAME } from "@/lib/brand";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Send yourself a new one.",
};

/** Email magic-link sign-in (specs/product/accounts.md). `?next=` (a same-origin path) is where to return after. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const params = await searchParams;
  const next = safeNextPath(params.next, "/account");
  if (await getUser()) redirect(next);
  const refused = (await cookies()).get(AGE_GATE_COOKIE)?.value === "refused";

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-20">
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
        Sign in to <span className="highlight">{SITE_NAME}</span>
      </h1>
      <p className="mt-2 text-muted-foreground">Keep your colleges, your numbers, and your family&apos;s planning in one place. Everything else works without an account.</p>
      <div className="mt-8">
        <LoginForm next={next} refused={refused} initialError={params.error ? ERRORS[params.error] ?? ERRORS.link : undefined} />
      </div>
    </div>
  );
}
