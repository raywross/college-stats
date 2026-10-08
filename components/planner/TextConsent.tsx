"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import { formatPhone } from "@/lib/household-rules";
import { revokeSmsConsent, setSmsConsent, type ConsentTarget, type ConsentView } from "@/lib/planner/store-timeline";

/**
 * The texts switch (specs/planner/timeline.md "Texts"): explicit opt-in with what it means spelled out, the number
 * it goes to (the household record's), and who turned it on. For a student under 18 only a guardian can turn it on;
 * the student sees that it's on and who did it. Used on /account (the person's own) and in the Plan menu (a
 * student's, for a guardian or an adult student).
 */
export function TextConsent({ view, target, studentName }: { view: ConsentView; target: ConsentTarget; studentName?: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const whose = target.kind === "self" ? "you" : (studentName ?? "them");

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.message ?? "That didn't work.");
      else router.refresh();
    });
  };

  return (
    <div className="space-y-2 text-sm">
      <p className="flex items-start gap-2">
        <MessageSquareText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          {view.active ? (
            <>
              Texts are <strong>on</strong> to {formatPhone(view.active.phone)}
              {view.active.consentedBy ? `, turned on by ${view.active.consentedBy}` : ""}.
            </>
          ) : view.stoppedByReply ? (
            <>Texts are off: a STOP reply turned them off.</>
          ) : (
            <>Texts are off.</>
          )}{" "}
          A text on Sunday evening with the week&apos;s first three steps, and one the evening before an application, reply, or deposit is
          due. At most one a day, never between 9 pm and 8 am, never a note or a number. Reply STOP to any text to end them.
        </span>
      </p>
      {!view.configured && <p className="text-xs text-muted-foreground">Texts aren&apos;t switched on for this site yet; your choice is saved for when they are.</p>}
      {view.canChange ? (
        view.active ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => revokeSmsConsent(target))}
            className="inline-flex h-11 items-center rounded-full border px-4 font-semibold hover:bg-muted disabled:opacity-60 sm:h-10"
          >
            Turn off texts
          </button>
        ) : view.phone ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => setSmsConsent(target))}
            className="inline-flex h-11 items-center rounded-full bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60 sm:h-10"
          >
            Text {whose} at {formatPhone(view.phone)}
          </button>
        ) : (
          <p className="text-muted-foreground">Add a phone number on the household page first.</p>
        )
      ) : (
        <p className="text-muted-foreground">
          {view.who === "guardian"
            ? "For students under 18, a parent or guardian turns texts on from the student's plan."
            : "Students 18 and older turn texts on for themselves."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
