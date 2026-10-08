"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { ROLE_HINTS } from "@/lib/accounts";
import { SITE_NAME } from "@/lib/brand";
import { PASSWORD_MIN, passwordProblems, passwordStrength } from "@/lib/password";
import { cn } from "@/lib/utils";
import {
  requestMagicLink,
  requestPasswordReset,
  resendConfirmation,
  signInWithPassword,
  signUpWithPassword,
  type LoginState,
  type PasswordState,
} from "./actions";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const primaryBtn =
  "mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60";
const linkBtn = "font-semibold text-primary hover:underline";

type Mode = "signin" | "signup" | "forgot" | "magic";

/**
 * Sign in with email and password by default; create an account (with a strong password, a birth year, and who they
 * are), reset a forgotten password, or use an emailed magic link instead. One card, switching modes in place.
 */
export function LoginForm({ next, refused, initialError }: { next: string; refused: boolean; initialError?: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");

  if (refused) return <Refused />;
  const switchTo = (m: Mode) => () => setMode(m);
  const props = { next, email, setEmail, switchTo };
  return (
    <div className="rounded-3xl border bg-card p-5 sm:p-8">
      {/* Other sign-in methods (Google) go here, above the forms, when they're turned on. */}
      {mode === "signin" && <SignIn {...props} initialError={initialError} />}
      {mode === "signup" && <SignUp {...props} />}
      {mode === "forgot" && <Forgot {...props} />}
      {mode === "magic" && <Magic {...props} />}
    </div>
  );
}

type ModeProps = { next: string; email: string; setEmail: (e: string) => void; switchTo: (m: Mode) => () => void };

function EmailField({ email, setEmail, autoFocus }: { email: string; setEmail: (e: string) => void; autoFocus?: boolean }) {
  return (
    <>
      <label className="block text-sm font-semibold" htmlFor="login-email">
        Email
      </label>
      <input
        id="login-email"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus={autoFocus}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={`${inputCls} mt-1.5`}
        placeholder="you@example.com"
      />
    </>
  );
}

function PasswordField({ id, autoComplete, value, onChange }: { id: string; autoComplete: string; value?: string; onChange?: (v: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative mt-1.5">
      <input
        id={id}
        name="password"
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        required
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={`${inputCls} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="mt-4 text-sm font-medium text-destructive" role="alert">
      {message}
    </p>
  );
}

function Sent({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="text-center" role="status">
      <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
        <MailCheck className="size-6" />
      </span>
      <h2 className="mt-4 font-display text-2xl font-bold">{title}</h2>
      <div className="mt-2 text-muted-foreground">{children}</div>
      <p className="mt-4 text-sm text-muted-foreground">Nothing there? Check spam, or wait a minute and try again.</p>
    </div>
  );
}

function SignIn({ next, email, setEmail, switchTo, initialError }: ModeProps & { initialError?: string }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(
    signInWithPassword,
    initialError ? { status: "error", message: initialError } : { status: "idle" },
  );
  const [resendState, resend, resending] = useActionState<PasswordState, FormData>(resendConfirmation, { status: "idle" });
  if (resendState.status === "email-sent")
    return (
      <Sent title="Check your email">
        We sent a new confirmation link to <strong className="break-all text-foreground">{resendState.email}</strong>. Open it to finish
        creating your account.
      </Sent>
    );
  return (
    <>
      <form action={action}>
        <input type="hidden" name="next" value={next} />
        <EmailField email={email} setEmail={setEmail} />
        <div className="mt-4 flex items-baseline justify-between">
          <label className="block text-sm font-semibold" htmlFor="login-password">
            Password
          </label>
          <button type="button" onClick={switchTo("forgot")} className={cn(linkBtn, "text-sm")}>
            Forgot password?
          </button>
        </div>
        <PasswordField id="login-password" autoComplete="current-password" />
        {state.status === "error" && <ErrorLine message={state.message} />}
        {state.status === "unconfirmed" && (
          <p className="mt-4 rounded-xl bg-muted/70 px-3.5 py-3 text-sm" role="alert">
            Confirm your email first: open the link we sent when you created the account.
          </p>
        )}
        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {state.status === "unconfirmed" && (
        <form action={resend} className="mt-2 text-center text-sm">
          <input type="hidden" name="email" value={state.email} />
          <input type="hidden" name="next" value={next} />
          <button type="submit" disabled={resending} className={linkBtn}>
            {resending ? "Sending…" : "Send the confirmation email again"}
          </button>
          {resendState.status === "error" && <ErrorLine message={resendState.message} />}
        </form>
      )}
      <p className="mt-5 text-center text-sm">
        New here?{" "}
        <button type="button" onClick={switchTo("signup")} className={linkBtn}>
          Create an account
        </button>
      </p>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Or{" "}
        <button type="button" onClick={switchTo("magic")} className={linkBtn}>
          email me a sign-in link
        </button>{" "}
        instead of a password.
      </p>
    </>
  );
}

function StrengthMeter({ password, email }: { password: string; email: string }) {
  const strength = passwordStrength(password, email);
  const problems = password ? passwordProblems(password, email) : [];
  const label = ["", "Too weak", "Good", "Strong"][strength];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
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
      <p className="mt-1.5 text-xs text-muted-foreground">
        {password ? (
          <>
            <span className="font-semibold text-foreground">{label}.</span> {problems.join(" ")}
          </>
        ) : (
          `At least ${PASSWORD_MIN} characters, mixing letters, numbers, or symbols. A long passphrase works too.`
        )}
      </p>
    </div>
  );
}

function SignUp({ next, email, setEmail, switchTo }: ModeProps) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(signUpWithPassword, { status: "idle" });
  const [password, setPassword] = useState("");
  if (state.status === "refused") return <Refused />;
  if (state.status === "confirm-email")
    return (
      <Sent title="Confirm your email">
        We sent a link to <strong className="break-all text-foreground">{state.email}</strong>. Open it once to confirm your address;
        after that, sign in with your email and password.
      </Sent>
    );
  const ok = passwordProblems(password, email).length === 0;
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <h2 className="mb-4 font-display text-xl font-bold">Create an account</h2>
      <EmailField email={email} setEmail={setEmail} autoFocus />
      <label className="mt-4 block text-sm font-semibold" htmlFor="signup-password">
        Password
      </label>
      <PasswordField id="signup-password" autoComplete="new-password" value={password} onChange={setPassword} />
      <StrengthMeter password={password} email={email} />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold" htmlFor="signup-birth-year">
            Birth year
          </label>
          <input
            id="signup-birth-year"
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
          <label className="block text-sm font-semibold" htmlFor="signup-role">
            I&apos;m
          </label>
          <select id="signup-role" name="role_hint" defaultValue="student" className={`${inputCls} mt-1.5`}>
            {ROLE_HINTS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {state.status === "error" && <ErrorLine message={state.message} />}
      <button type="submit" disabled={pending || !ok} className={primaryBtn}>
        {pending ? "Creating…" : "Create account"}
      </button>
      <p className="mt-4 text-center text-sm">
        Have an account?{" "}
        <button type="button" onClick={switchTo("signin")} className={linkBtn}>
          Sign in
        </button>
      </p>
    </form>
  );
}

function Forgot({ email, setEmail, switchTo }: ModeProps) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(requestPasswordReset, { status: "idle" });
  if (state.status === "email-sent")
    return (
      <Sent title="Check your email">
        If <strong className="break-all text-foreground">{state.email}</strong> has an account, we sent it a link to choose a new
        password. It works once and expires in an hour.
      </Sent>
    );
  return (
    <form action={action}>
      <h2 className="mb-1 font-display text-xl font-bold">Reset your password</h2>
      <p className="mb-4 text-sm text-muted-foreground">We&apos;ll email you a link that signs you in and lets you choose a new one.</p>
      <EmailField email={email} setEmail={setEmail} autoFocus />
      {state.status === "error" && <ErrorLine message={state.message} />}
      <button type="submit" disabled={pending} className={primaryBtn}>
        {pending ? "Sending…" : "Email me a reset link"}
      </button>
      <p className="mt-4 text-center text-sm">
        <button type="button" onClick={switchTo("signin")} className={linkBtn}>
          Back to sign in
        </button>
      </p>
    </form>
  );
}

/** The emailed magic link: an email alone signs in; a new address is asked for a birth year to create an account. */
function Magic({ next, email, setEmail, switchTo }: ModeProps) {
  const [state, action, pending] = useActionState<LoginState, FormData>(requestMagicLink, { status: "idle" });
  if (state.status === "refused") return <Refused />;
  if (state.status === "sent")
    return (
      <Sent title="Check your email">
        We sent a sign-in link to <strong className="break-all text-foreground">{state.email}</strong>. Open it on any device to
        finish signing in. It works once and expires in an hour.
      </Sent>
    );
  const askBirthYear = state.status === "need-birth-year";
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <h2 className="mb-1 font-display text-xl font-bold">Email me a sign-in link</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        A <Term term="magic-link">magic link</Term> signs you in without a password.
      </p>
      <EmailField email={email} setEmail={setEmail} autoFocus />
      {askBirthYear && (
        <>
          <p className="mt-4 rounded-xl bg-muted/70 px-3.5 py-3 text-sm">There&apos;s no account for this email yet. Tell us two things to create one.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold" htmlFor="magic-birth-year">
                Birth year
              </label>
              <input id="magic-birth-year" name="birth_year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="bday-year" className={`${inputCls} mt-1.5`} placeholder="YYYY" />
            </div>
            <div>
              <label className="block text-sm font-semibold" htmlFor="magic-role">
                I&apos;m
              </label>
              <select id="magic-role" name="role_hint" defaultValue="student" className={`${inputCls} mt-1.5`}>
                {ROLE_HINTS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
      {state.status === "error" && <ErrorLine message={state.message} />}
      <button type="submit" disabled={pending} className={primaryBtn}>
        {pending ? "Sending…" : askBirthYear ? "Create account and email me a link" : "Email me a sign-in link"}
      </button>
      <p className="mt-4 text-center text-sm">
        <button type="button" onClick={switchTo("signin")} className={linkBtn}>
          Sign in with a password instead
        </button>
      </p>
    </form>
  );
}

function Refused() {
  return (
    <div role="status">
      <h2 className="font-display text-2xl font-bold">Sorry, you can&apos;t make an account yet</h2>
      <p className="mt-2 text-muted-foreground">
        Accounts are for people 13 and older. Everything on {SITE_NAME} still works without one: search, explore, and compare colleges as
        much as you like.
      </p>
      <Link href="/explore" className="mt-5 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
        Explore colleges
      </Link>
    </div>
  );
}
