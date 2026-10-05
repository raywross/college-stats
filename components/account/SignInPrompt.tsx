"use client";

import Link from "next/link";
import { LogIn } from "lucide-react";
import { loginHref } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import { useMe } from "./useMe";

/**
 * "Sign in to …" for a signed-out visitor who tried something that needs an account (Follow, Add to list, /me).
 * `reason` finishes the sentence ("follow colleges"); `next` is the path to come back to after signing in.
 *
 * - `variant="inline"`: one line, for beside a button or inside a popover/sheet.
 * - `variant="card"` (default): a bordered card with a button, for a page or a sheet body.
 *
 * Where sign-in isn't configured it says so instead of linking to a login page that can't work.
 */
export function SignInPrompt({
  reason,
  next,
  variant = "card",
  className,
}: {
  reason: string;
  next: string;
  variant?: "inline" | "card";
  className?: string;
}) {
  const me = useMe();
  const unavailable = me !== null && !me.configured;
  const href = loginHref(next);

  if (variant === "inline") {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {unavailable ? (
          "Sign-in isn't available here."
        ) : (
          <>
            <Link href={href} className="font-semibold text-primary hover:underline">
              Sign in
            </Link>{" "}
            to {reason}.
          </>
        )}
      </p>
    );
  }

  return (
    <div className={cn("rounded-3xl border bg-card p-5 sm:p-6", className)}>
      <p className="font-display text-xl font-bold">Sign in to {reason}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {unavailable ? "Sign-in isn't available on this copy of the site." : "It's free. We'll email you a link: no password needed."}
      </p>
      {!unavailable && (
        <Link
          href={href}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          <LogIn className="size-4" />
          Sign in
        </Link>
      )}
    </div>
  );
}
