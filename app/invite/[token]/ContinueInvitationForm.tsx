"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { SignInPrompt } from "@/components/account/SignInPrompt";
import { loginHref } from "@/lib/accounts";
import { continueInvitation, type ContinueState } from "./actions";

/**
 * A signed-out visitor's way in: "Continue" asks the invite function to sign them in (then they choose a password).
 * If they already have an account, or the function can't be reached, they sign in the ordinary way and accept.
 */
export function ContinueInvitationForm({ token, path }: { token: string; path: string }) {
  const [state, action, pending] = useActionState<ContinueState, FormData>(continueInvitation, { status: "idle" });
  if (state.status === "existing")
    return (
      <div className="space-y-3">
        <p className="rounded-2xl bg-muted/60 px-4 py-3 text-sm font-medium" role="status">
          You already have an account with this email: sign in to accept.
        </p>
        <SignInPrompt reason="accept this invitation" next={path} />
      </div>
    );
  if (state.status === "fallback") return <SignInPrompt reason="accept this invitation" next={path} />;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? "Setting up your account…" : "Continue"}
        {!pending && <ArrowRight className="size-4" />}
      </button>
      <p className="text-sm text-muted-foreground">
        Next you choose a password, and you&apos;re in. Already have an account?{" "}
        <Link href={loginHref(path)} className="font-semibold text-primary hover:underline">
          Sign in
        </Link>{" "}
        to accept.
      </p>
      {state.status === "error" && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
