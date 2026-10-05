"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { MailCheck } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { ROLE_HINTS } from "@/lib/accounts";
import { SITE_NAME } from "@/lib/brand";
import { requestMagicLink, type LoginState } from "./actions";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Email magic link, in one or two steps: an email alone signs in an existing account; a new address is asked for a
 * birth year (and who they are) before the account is created. One method today; a second (Google) slots in above
 * the email field when the owner turns it on.
 */
export function LoginForm({ next, refused, initialError }: { next: string; refused: boolean; initialError?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    requestMagicLink,
    refused ? { status: "refused" } : initialError ? { status: "error", message: initialError } : { status: "idle" },
  );
  const [signUp, setSignUp] = useState(false);
  const askBirthYear = signUp || state.status === "need-birth-year";

  if (state.status === "sent") {
    return (
      <div className="rounded-3xl border bg-card p-6 text-center sm:p-8" role="status">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
          <MailCheck className="size-6" />
        </span>
        <h2 className="mt-4 font-display text-2xl font-bold">Check your email</h2>
        <p className="mt-2 text-muted-foreground">
          We sent a sign-in link to <strong className="break-all text-foreground">{state.email}</strong>. Open it on this device and browser to
          finish signing in. It works once and expires in an hour.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">Nothing there? Check spam, or wait a minute and send another.</p>
      </div>
    );
  }

  if (state.status === "refused") {
    return (
      <div className="rounded-3xl border bg-card p-6 sm:p-8" role="status">
        <h2 className="font-display text-2xl font-bold">Sorry, you can&apos;t make an account yet</h2>
        <p className="mt-2 text-muted-foreground">
          Accounts are for people 13 and older. Everything on {SITE_NAME} still works without one: search, explore, and compare
          colleges as much as you like.
        </p>
        <Link href="/explore" className="mt-5 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
          Explore colleges
        </Link>
      </div>
    );
  }

  // React resets the form after each submission; the action hands the email back so it stays filled in.
  const lastEmail = "email" in state ? (state.email ?? "") : "";

  return (
    <form action={action} className="rounded-3xl border bg-card p-5 sm:p-8">
      <input type="hidden" name="next" value={next} />
      {/* Other sign-in methods (Google) go here, above the email field, when they're turned on. */}
      <label className="block text-sm font-semibold" htmlFor="login-email">
        Email
      </label>
      <input
        id="login-email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={lastEmail}
        key={lastEmail}
        className={`${inputCls} mt-1.5`}
        placeholder="you@example.com"
      />

      {state.status === "need-birth-year" && (
        <p className="mt-4 rounded-xl bg-muted/70 px-3.5 py-3 text-sm">
          There&apos;s no account for this email yet. Tell us two things to create one.
        </p>
      )}

      {askBirthYear && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold" htmlFor="login-birth-year">
              Birth year
            </label>
            <input
              id="login-birth-year"
              name="birth_year"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              required
              autoComplete="bday-year"
              className={`${inputCls} mt-1.5`}
              placeholder="YYYY"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold" htmlFor="login-role">
              I&apos;m
            </label>
            <select id="login-role" name="role_hint" defaultValue="student" className={`${inputCls} mt-1.5`}>
              {ROLE_HINTS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <p className="mt-4 text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
      >
        {pending ? "Sending…" : askBirthYear ? "Create account and email me a link" : "Email me a sign-in link"}
      </button>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        We&apos;ll email you a <Term term="magic-link">magic link</Term>: no password to remember.
      </p>
      {!askBirthYear && (
        <p className="mt-2 text-center text-sm">
          <button type="button" onClick={() => setSignUp(true)} className="font-semibold text-primary hover:underline">
            New here? Create an account
          </button>
        </p>
      )}
    </form>
  );
}
