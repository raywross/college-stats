"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/auth";
import { checkoutSentence, isProduct, trialEndFrom, TRIAL_DAYS } from "@/lib/billing";
import { billingService, familyStudentsOf } from "@/lib/billing-server";
import { canStart, startOffer } from "@/lib/billing-start";
import { createTrialCheckout, ensureCustomer } from "@/lib/stripe";
import { requestOrigin } from "@/lib/household-hub";

export type StartState = { status: "idle" } | { status: "error"; message: string };

/**
 * Start the trial (specs/product/advisor.md "2. The trial"): checks who may start what again (lib/billing-start.ts),
 * makes or finds the Stripe customer, and sends the browser to Stripe Checkout. The subscription's metadata names the
 * account, the product, the student, and the students the trial covers; the webhook and the return page read it. A
 * student who has used a trial before gets the plan without one (one trial per student).
 */
export async function startCheckout(_prev: StartState, form: FormData): Promise<StartState> {
  const product = form.get("product");
  if (!isProduct(product)) return { status: "error", message: "Pick one student or the family." };
  const studentId = String(form.get("student_id") ?? "").trim() || null;
  const account = await getAccount();
  if (!account) return { status: "error", message: "Your session ended. Sign in again to continue." };
  const offer = await startOffer();
  const check = canStart(offer, product, studentId);
  if (!check.ok) return { status: "error", message: check.reason };
  if (offer.rule?.ok && offer.rule.confirmPermission && form.get("permission") !== "on") {
    return { status: "error", message: "Confirm that a parent or guardian said yes." };
  }

  const service = billingService();
  const covered = product === "family" ? await familyStudentsOf(service, account.user.id) : [check.student!.studentId];
  // One trial per student: a plan whose every covered student has already had one starts without a trial.
  const used = product === "family" ? offer.students.filter((s) => covered.includes(s.studentId)).map((s) => s.billing.trialUsed) : [check.student!.billing.trialUsed];
  const trial = !(used.length > 0 && used.every(Boolean));

  const origin = requestOrigin(await headers());
  const customerId = await ensureCustomer(service, account.user);
  const url = await createTrialCheckout({
    customerId,
    user: account.user,
    product,
    studentId: product === "student" ? check.student!.studentId : null,
    coveredStudentIds: covered,
    trial,
    sentence: trial ? checkoutSentence(product, trialEndFrom(new Date())) : `Billed yearly. Your ${TRIAL_DAYS}-day trial was used before, so this starts at once.`,
    origin,
    successPath: "/advisor/start/return?session_id={CHECKOUT_SESSION_ID}",
    cancelPath: "/advisor/start?cancelled=1",
  });
  redirect(url);
}
