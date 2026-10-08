/**
 * The pure rule behind `signup_completed` (specs/product/telemetry.md): an account counts as newly signed up when the
 * email was confirmed in the last two minutes, i.e. the click that just landed on the auth callback is the one that
 * confirmed it. A later sign-in, or a confirmation from days ago, isn't a sign-up. No server-only import, so tests run
 * it directly; the sending lives in lib/signup-events.ts.
 */

/** How recent the confirmation must be, in milliseconds. */
export const FRESH_CONFIRMATION_MS = 2 * 60 * 1000;

interface ConfirmationDates {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
}

/** True when `email_confirmed_at` (else `confirmed_at`) is within the last two minutes. Missing or unparseable: false. */
export function isFreshConfirmation(user: ConfirmationDates, now: number = Date.now()): boolean {
  const confirmed = user.email_confirmed_at ?? user.confirmed_at;
  if (!confirmed) return false;
  const at = Date.parse(confirmed);
  if (Number.isNaN(at)) return false;
  const age = now - at;
  // A small negative age is clock skew between Supabase and this server; a larger one is nonsense.
  return age >= -FRESH_CONFIRMATION_MS && age <= FRESH_CONFIRMATION_MS;
}
