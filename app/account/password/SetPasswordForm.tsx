"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { PASSWORD_MIN, passwordProblems, passwordStrength } from "@/lib/password";
import { cn } from "@/lib/utils";
import { setPassword, type SetPasswordState } from "./actions";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function SetPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, { status: "idle" });
  const [password, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  if (state.status === "saved")
    return (
      <div className="rounded-3xl border bg-card p-6 text-center" role="status">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
          <Check className="size-6" />
        </span>
        <h2 className="mt-4 font-display text-2xl font-bold">Password saved</h2>
        <p className="mt-2 text-muted-foreground">Next time, sign in with your email and this password.</p>
        <Link href="/account" className="mt-5 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
          Back to your account
        </Link>
      </div>
    );
  const strength = passwordStrength(password, email);
  const problems = password ? passwordProblems(password, email) : [];
  const ok = problems.length === 0 && password.length > 0 && password === confirm;
  return (
    <form action={action} className="rounded-3xl border bg-card p-5 sm:p-8">
      {/* Lets password managers save it against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <label className="block text-sm font-semibold" htmlFor="new-password">
        New password
      </label>
      <input
        id="new-password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPw(e.target.value)}
        className={`${inputCls} mt-1.5`}
      />
      <div className="mt-2 flex gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full bg-muted",
              strength >= i && (strength === 1 ? "bg-destructive" : strength === 2 ? "bg-amber-500" : "bg-emerald-600"),
            )}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground" aria-live="polite">
        {password
          ? `${["", "Too weak.", "Good.", "Strong."][strength]} ${problems.join(" ")}`
          : `At least ${PASSWORD_MIN} characters, mixing letters, numbers, or symbols. A long passphrase works too.`}
      </p>
      <label className="mt-4 block text-sm font-semibold" htmlFor="confirm-password">
        Type it again
      </label>
      <input
        id="confirm-password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className={`${inputCls} mt-1.5`}
      />
      {confirm && password !== confirm && <p className="mt-1.5 text-xs text-destructive">The two don&apos;t match yet.</p>}
      {state.status === "error" && (
        <p className="mt-4 text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !ok}
        className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
