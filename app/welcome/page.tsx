import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { householdNameFor, parseSignupMeta, safeNextPath } from "@/lib/accounts";
import { authConfigured, currentStudent, getAccount, requireUser } from "@/lib/auth";
import { checkoutSentence } from "@/lib/billing";
import { billingService } from "@/lib/billing-server";
import { advisorBillingFor } from "@/lib/entitlements";
import { saveHomeAddress } from "@/lib/home-store";
import { requestOrigin } from "@/lib/household-hub";
import { emptyProfile } from "@/lib/student-profile";
import { myOwnProfile, saveProfile } from "@/lib/student-profile-store";
import { createSubscriptionCheckout, ensureCustomer } from "@/lib/stripe";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * /welcome (specs/product/accounts.md "Sign-up", redesigned 2026-11-14): the step after a new account's first sign-in
 * that finishes what the sign-up form collected and sends the person where they were going. Nothing to look at: it
 * applies and redirects.
 * - A student: their record is made (which starts the trial), the high school they picked goes into their profile, and
 *   while the price is live and nothing pays for them yet, they go straight to Stripe to put the card on file (owner,
 *   2026-11-14: a card whenever a student is created; charged when the trial ends unless cancelled). Then the advisor.
 * - A parent: a household named after them, with the home address they gave, then Household.
 * - A counselor: the portal.
 * The `signup` metadata is cleared once applied, so a second visit does nothing but redirect. `?next=` wins over the
 * role's home when it names somewhere specific (an invitation, a join code).
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await connection();
  if (!authConfigured()) redirect("/");
  const user = await requireUser("/welcome");
  const { next: nextParam } = await searchParams;
  const next = safeNextPath(nextParam, "/account");
  const specific = next !== "/account";
  const account = await getAccount();
  if (!account) redirect("/login");
  const role = account.profile.role_hint ?? "student";
  const supabase = await createServerSupabase();
  const { data: fresh } = await supabase.auth.getUser();
  const meta = parseSignupMeta(fresh.user?.user_metadata?.signup);

  if (role === "counselor") redirect(specific ? next : "/org");

  if (role === "guardian") {
    if (meta?.homeAddress) {
      try {
        const { data: householdId, error } = await supabase.rpc("create_household", { p_name: householdNameFor(account.profile.display_name), p_role: "guardian" });
        if (error) console.error(`welcome: create_household failed: ${error.message}`);
        else {
          const saved = await saveHomeAddress(householdId as string, meta.homeAddress);
          if (!saved.ok) console.warn(`welcome: home address not saved: ${saved.message}`);
        }
      } catch (err) {
        console.error(`welcome: household setup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      await clearSignupMeta(supabase);
    }
    redirect(specific ? next : "/household");
  }

  // A student: the record (and with it the trial), the high school, then the card.
  const student = await currentStudent().catch(() => null);
  if (student && meta && (meta.highSchoolId || meta.highSchoolName)) {
    try {
      const current = (await myOwnProfile()) ?? emptyProfile();
      if (!current.basics.highSchoolId && !current.basics.highSchool) {
        const saved = await saveProfile(student.id, { ...current, basics: { ...current.basics, highSchoolId: meta.highSchoolId, highSchool: meta.highSchoolName } });
        if (!saved.ok) console.warn(`welcome: high school not saved: ${saved.message}`);
      }
    } catch (err) {
      console.error(`welcome: profile setup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (meta) await clearSignupMeta(supabase);
  if (student) {
    const billing = await advisorBillingFor(student.id, user.id);
    if (billing.needsCard) {
      try {
        const service = billingService();
        const customerId = await ensureCustomer(service, account.user);
        const url = await createSubscriptionCheckout({
          customerId,
          user: account.user,
          studentId: student.id,
          trialEnd: billing.trialEnd,
          sentence: checkoutSentence(billing.trialEnd),
          origin: requestOrigin(await headers()),
          successPath: "/advisor/start/return?session_id={CHECKOUT_SESSION_ID}",
          cancelPath: "/advisor",
        });
        redirect(url);
      } catch (err) {
        // A redirect is thrown, not an error; anything else means Stripe said no, and the Advisor tab asks again.
        if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw err;
        console.error(`welcome: checkout failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  redirect(specific ? next : "/advisor");
}

/** Forget the sign-up's extras once applied (the trigger already copied name, role, and birth year to the profile). */
async function clearSignupMeta(supabase: Awaited<ReturnType<typeof createServerSupabase>>): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { signup: null } });
  if (error) console.warn(`welcome: clearing sign-up metadata failed: ${error.message}`);
}
