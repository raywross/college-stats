import "server-only";
/**
 * Who may pay for which student from this account (specs/product/commercialization.md "Billing"): the one computation
 * the start page renders from and the checkout action checks again before it sends anyone to Stripe. Any student may
 * pay for their own advisor (owner, 2026-11-14: no parent needed); a guardian pays for a child they reach through a
 * household. A student already paid for is never offered again. The trial itself started with the student's record
 * and needs nothing here.
 */
import { getAccount, studentsICanSee } from "./auth.ts";
import { advisorBillingFor, billingConfigured, priceLiveAt, type AdvisorBilling } from "./entitlements.ts";

export interface StartCandidate {
  studentId: string;
  name: string | null;
  /** The viewer's own record. */
  self: boolean;
  billing: AdvisorBilling;
}

export interface StartOffer {
  /** Billing configured and the price live; otherwise the Advisor is free and there is nothing to start. */
  live: boolean;
  signedIn: boolean;
  /** The viewer is a parent in a household (so a saved card pays for each student they add). */
  isGuardian: boolean;
  /** Students a subscription could pay for: the viewer's own record, or the children they reach as a guardian. */
  students: StartCandidate[];
}

export async function startOffer(): Promise<StartOffer> {
  const live = billingConfigured() && (await priceLiveAt()) !== null;
  const account = await getAccount();
  if (!account) return { live, signedIn: false, isGuardian: false, students: [] };
  // Counselors see students but never pay for them (parents and counselors are free; the family pays).
  const seen = (await studentsICanSee()).filter((a) => a.relation !== "counselor");
  const isGuardian = account.profile.role_hint === "guardian" || seen.some((a) => a.relation !== "self");
  const students: StartCandidate[] = await Promise.all(
    seen.map(async (a) => ({ studentId: a.student.id, name: a.student.display_name, self: a.relation === "self", billing: await advisorBillingFor(a.student.id, account.user.id) })),
  );
  return { live, signedIn: true, isGuardian, students };
}

/** Whether `offer` lets the viewer pay for `studentId` now; the reason when not. */
export function canStart(offer: StartOffer, studentId: string | null): { ok: true; student: StartCandidate } | { ok: false; reason: string } {
  if (!offer.live) return { ok: false, reason: "The Advisor is free right now; there's nothing to start." };
  if (!offer.signedIn) return { ok: false, reason: "Sign in first." };
  const student = offer.students.find((s) => s.studentId === studentId);
  if (!student) return { ok: false, reason: "Pick a student." };
  if (student.billing.paid) return { ok: false, reason: `${student.name ?? "That student"} already has the advisor.` };
  return { ok: true, student };
}
