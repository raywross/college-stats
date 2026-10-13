"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { startEnrollment, verifyCode, type MfaState } from "@/app/admin/mfa/actions";

const inputCls =
  "h-12 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-center font-mono text-xl tracking-[0.4em] outline-none transition-colors placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * The console's second factor (specs/product/admin.md "Who is an admin"): an admin whose session is aal1 sees this
 * instead of the console. First time: start setup, scan the QR code (or type the key) into an authenticator app, enter
 * the 6-digit code. After that: just the code. The work is in Server Actions (app/admin/mfa/actions.ts), because the
 * browser never talks to Supabase on this site; when the code checks out the session is aal2 and router.refresh()
 * re-renders the layout, which then shows the console.
 */
export function MfaStep({ enrolled }: { enrolled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Extract<MfaState, { status: "enrolled" }> | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();
  const [state, verify, verifying] = useActionState<MfaState, FormData>(verifyCode, { status: "idle" });

  useEffect(() => {
    if (state.status === "verified") router.refresh();
  }, [state, router]);

  function begin() {
    setSetupError(null);
    startTransition(async () => {
      const result = await startEnrollment();
      if (result.status === "enrolled") setSetup(result);
      else setSetupError(result.status === "error" ? result.message : "That didn't work. Try again in a moment.");
    });
  }

  const showCode = enrolled || setup !== null;
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
        <ShieldCheck className="size-6" aria-hidden />
      </span>
      <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{enrolled ? "Enter your code" : "Set up your second factor"}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {enrolled
          ? "The console asks for the 6-digit code from your authenticator app each time you sign in."
          : "The console can read every family's information, so a password alone isn't enough. Use an authenticator app (1Password, Google Authenticator, Authy). You set this up once."}
      </p>

      {!enrolled && setup === null && (
        <div className="mt-6">
          <button
            type="button"
            onClick={begin}
            disabled={starting}
            className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {starting ? "Starting…" : "Start setup"}
          </button>
          {setupError && (
            <p className="mt-3 text-sm font-medium text-destructive" role="alert">
              {setupError}
            </p>
          )}
        </div>
      )}

      {setup && (
        <div className="mt-6 space-y-3">
          <p className="text-sm font-semibold">1. Scan this with your authenticator app</p>
          {/* A data: URI SVG from Supabase Auth; next/image has nothing to optimize. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" width={192} height={192} className="size-48 rounded-xl border bg-white p-2" />
          <p className="text-xs text-muted-foreground">
            Can&apos;t scan it? Enter this key by hand: <span className="font-mono break-all select-all">{setup.secret}</span>
          </p>
          <p className="pt-2 text-sm font-semibold">2. Enter the 6-digit code it shows</p>
        </div>
      )}

      {showCode && (
        <form action={verify} className="mt-4 space-y-3">
          {setup && <input type="hidden" name="factor" value={setup.factorId} />}
          <label className="sr-only" htmlFor="admin-code">
            6-digit code
          </label>
          <input id="admin-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} placeholder="000000" autoFocus className={inputCls} />
          <button
            type="submit"
            disabled={verifying || state.status === "verified"}
            className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {verifying || state.status === "verified" ? "Checking…" : enrolled ? "Continue" : "Finish setup"}
          </button>
          {state.status === "error" && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {state.message}
            </p>
          )}
        </form>
      )}

      <form action="/auth/signout" method="post" className="mt-8">
        <button type="submit" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Sign out
        </button>
      </form>
    </div>
  );
}
