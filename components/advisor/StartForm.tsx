"use client";

import { useActionState, useState } from "react";
import { ArrowRight } from "lucide-react";
import { startCheckout, type StartState } from "@/app/advisor/start/actions";
import { START_BUTTON } from "@/components/advisor/links";
import { priceLabel, shortDay, stripeTrialEnd } from "@/lib/billing";

export interface StartStudentOption {
  studentId: string;
  label: string;
  /** A live subscription already pays for this student: not offered again. */
  paid: boolean;
  /** The student's trial end (ISO), or null when the record predates the trials table. */
  trialEnd: string | null;
}

/**
 * The money sheet's form (specs/product/commercialization.md "Gating UX"): the student the subscription pays for (a
 * select when there is a choice), what will be charged and when, and one button: a charge to the card on file when
 * there is one, else on to Stripe. The server action checks everything again.
 */
export function StartForm({ students, card, isGuardian }: { students: StartStudentOption[]; card: { brand: string | null; last4: string | null } | null; isGuardian: boolean }) {
  const [state, action, pending] = useActionState<StartState, FormData>(startCheckout, { status: "idle" });
  const open = students.filter((s) => !s.paid);
  const [studentId, setStudentId] = useState<string>(open[0]?.studentId ?? "");
  const chosen = open.find((s) => s.studentId === studentId) ?? open[0];
  const chargeAt = chosen && stripeTrialEnd(chosen.trialEnd) !== null ? shortDay(chosen.trialEnd!) : null;
  const cardWords = card ? `${card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : "the card"} ending ${card.last4 ?? "····"}` : null;

  return (
    <form action={action} className="space-y-5">
      <div className="rounded-3xl border bg-card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-xl font-bold">{chosen ? (chosen.label === "You" ? "Your advisor" : `${chosen.label}'s advisor`) : "The advisor"}</span>
          <span className="text-sm font-semibold">{priceLabel("student")}</span>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          <li>The whole advisor through senior year: the list with levels, the season&apos;s moves and guides, the calendar, the essays, the offers</li>
          <li>{chargeAt ? `Free until ${chargeAt}, then charged yearly` : "Charged today, then yearly"}</li>
          {isGuardian && <li>Each student in your household has their own subscription; cancel any one from your account page</li>}
        </ul>
      </div>

      {open.length > 1 ? (
        <div>
          <label className="block text-sm font-semibold" htmlFor="start-student">
            Whose advisor
          </label>
          <select id="start-student" name="student_id" value={studentId} onChange={(e) => setStudentId(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base sm:max-w-sm">
            {open.map((s) => (
              <option key={s.studentId} value={s.studentId}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="student_id" value={open[0]?.studentId ?? ""} />
      )}
      {students.some((s) => s.paid) && (
        <p className="text-xs text-muted-foreground">
          {students.filter((s) => s.paid).map((s) => s.label).join(", ")} already {students.filter((s) => s.paid).length === 1 ? "has" : "have"} the advisor.
        </p>
      )}

      {state.status === "error" && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {state.message}
        </p>
      )}

      <div className="flex flex-col items-start gap-2">
        <button type="submit" disabled={pending || !open.length} className={`${START_BUTTON} disabled:opacity-60`}>
          {pending ? "One moment…" : cardWords ? `Use ${cardWords}` : chargeAt ? "Add a card to keep it" : "Subscribe"} <ArrowRight className="size-4" aria-hidden />
        </button>
        <p className="text-xs text-muted-foreground">
          {cardWords
            ? chargeAt
              ? `Nothing is charged until ${chargeAt}. Cancel before then from your account page and pay nothing.`
              : `${priceLabel("student")} is charged to the card on file today.`
            : chargeAt
              ? `Your card is collected now and nothing is charged until ${chargeAt}. Cancel before then and pay nothing.`
              : "The trial has ended, so the year starts as soon as the card is added."}
        </p>
      </div>
    </form>
  );
}
