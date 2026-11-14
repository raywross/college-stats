"use client";

import { useActionState, useState } from "react";
import { ArrowRight } from "lucide-react";
import { startCheckout, type StartState } from "@/app/advisor/start/actions";
import { START_BUTTON } from "@/components/advisor/sections/Hero";

export interface StartStudentOption {
  studentId: string;
  label: string;
  /** This student already has the advisor through a subscription: not offered again. */
  covered: boolean;
  /** A trial has covered this student before: the year starts at once. */
  trialUsed: boolean;
}

export interface StartCard {
  product: "student" | "family";
  title: string;
  price: string;
  lines: string[];
}

/**
 * The upgrade sheet's form (specs/product/commercialization.md "Gating UX": one sheet, the two prices): a card per
 * product, the student to cover under the student card when there is a choice, the permission line for a student under
 * 18, and one button that goes to Stripe. The server action checks everything again.
 */
export function StartForm({ cards, students, confirmPermission, trialDays }: { cards: StartCard[]; students: StartStudentOption[]; confirmPermission: boolean; trialDays: number }) {
  const [state, action, pending] = useActionState<StartState, FormData>(startCheckout, { status: "idle" });
  const [product, setProduct] = useState<"student" | "family">(cards[0]?.product ?? "student");
  const open = students.filter((s) => !s.covered);
  const [studentId, setStudentId] = useState<string>(open[0]?.studentId ?? "");
  const chosen = open.find((s) => s.studentId === studentId);
  const trial = product === "family" ? !(open.length > 0 && open.every((s) => s.trialUsed)) : !(chosen?.trialUsed ?? false);

  return (
    <form action={action} className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Which advisor</legend>
        {cards.map((c) => {
          const on = product === c.product;
          return (
            <label key={c.product} className={`block cursor-pointer rounded-3xl border p-5 transition ${on ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "bg-card hover:bg-muted/40"}`}>
              <input type="radio" name="product" value={c.product} checked={on} onChange={() => setProduct(c.product)} className="sr-only" />
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-display text-xl font-bold">{c.title}</span>
                <span className="text-sm font-semibold">{c.price}</span>
              </span>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {c.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </label>
          );
        })}
      </fieldset>

      {product === "student" && (
        <div>
          {open.length > 1 ? (
            <>
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
            </>
          ) : (
            <input type="hidden" name="student_id" value={open[0]?.studentId ?? ""} />
          )}
          {students.some((s) => s.covered) && <p className="mt-2 text-xs text-muted-foreground">{students.filter((s) => s.covered).map((s) => s.label).join(", ")} already {students.filter((s) => s.covered).length === 1 ? "has" : "have"} the advisor.</p>}
        </div>
      )}

      {confirmPermission && (
        <label className="flex items-start gap-3 rounded-2xl border bg-card px-4 py-3 text-sm">
          <input type="checkbox" name="permission" className="mt-1 size-4" required />
          <span>A parent or guardian said yes to this. (Under 18, a purchase is made with a guardian&apos;s permission, as the Terms say.)</span>
        </label>
      )}

      {state.status === "error" && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {state.message}
        </p>
      )}

      <div className="flex flex-col items-start gap-2">
        <button type="submit" disabled={pending || (product === "student" && !open.length)} className={`${START_BUTTON} disabled:opacity-60`}>
          {pending ? "Opening checkout…" : trial ? `Start your ${trialDays}-day free trial` : "Continue to checkout"} <ArrowRight className="size-4" aria-hidden />
        </button>
        <p className="text-xs text-muted-foreground">
          {trial ? "Your card is collected now and nothing is charged until the trial ends. Cancel before then and pay nothing." : `A ${trialDays}-day trial was used before for this student, so the year starts at once.`} Payment is handled by Stripe; Quad never sees your card.
        </p>
      </div>
    </form>
  );
}
