import "server-only";
/**
 * Who may start which trial from this account (specs/product/advisor.md "2. The trial"; commercialization.md
 * "Prices"): the one computation the start page renders from and the checkout action checks again before it sends
 * anyone to Stripe. A guardian may start a student plan for a child or the family plan; a student 16 or older their own
 * student plan (confirming a parent's permission under 18); a student under 16 asks a parent. One trial per student:
 * a student a trial has covered before gets the plan without a trial.
 */
import { starterRule, type Product, type StarterRule } from "./billing.ts";
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
  isGuardian: boolean;
  rule: StarterRule | null;
  /** Students a student plan could cover: the viewer's own record, or the children they reach as a guardian. */
  students: StartCandidate[];
  /** The family plan is offered to guardians only. */
  familyOffered: boolean;
  /** The viewer already holds a live family plan. */
  familyHeld: boolean;
}

export async function startOffer(): Promise<StartOffer> {
  const live = billingConfigured() && (await priceLiveAt()) !== null;
  const account = await getAccount();
  if (!account) return { live, signedIn: false, isGuardian: false, rule: null, students: [], familyOffered: false, familyHeld: false };
  const seen = (await studentsICanSee()).filter((a) => a.relation !== "counselor");
  // A guardian here means a parent in a household, not "anyone but the student": counselors were filtered out above.
  const isGuardian = account.profile.role_hint === "guardian" || seen.some((a) => a.relation !== "self");
  const rule = starterRule({ isGuardian, birthYear: account.profile.birth_year });
  const students: StartCandidate[] = await Promise.all(
    seen.map(async (a) => ({ studentId: a.student.id, name: a.student.display_name, self: a.relation === "self", billing: await advisorBillingFor(a.student.id, account.user.id) })),
  );
  const familyHeld = students.some((s) => s.billing.mine && s.billing.product === "family" && s.billing.whole && s.billing.because === "subscription");
  return { live, signedIn: true, isGuardian, rule, students, familyOffered: isGuardian, familyHeld };
}

/** Whether `offer` lets the viewer start `product` for `studentId` (a student plan) now; the reason when not. */
export function canStart(offer: StartOffer, product: Product, studentId: string | null): { ok: true; student: StartCandidate | null } | { ok: false; reason: string } {
  if (!offer.live) return { ok: false, reason: "The Advisor is free right now; there's nothing to start." };
  if (!offer.signedIn || !offer.rule) return { ok: false, reason: "Sign in first." };
  if (!offer.rule.ok) return { ok: false, reason: offer.rule.reason === "under-age" ? "A parent starts the trial for a student under 16." : "Add your birth year to your account first." };
  if (product === "family") {
    if (!offer.familyOffered) return { ok: false, reason: "The family plan is for a parent or guardian's account." };
    if (offer.familyHeld) return { ok: false, reason: "You already have the family plan." };
    return { ok: true, student: null };
  }
  const student = offer.students.find((s) => s.studentId === studentId);
  if (!student) return { ok: false, reason: "Pick a student." };
  if (student.billing.whole && student.billing.because === "subscription") return { ok: false, reason: `${student.name ?? "That student"} already has the advisor.` };
  return { ok: true, student };
}
