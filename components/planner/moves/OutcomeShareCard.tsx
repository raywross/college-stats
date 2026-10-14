"use client";

/**
 * "Tell us where you landed" (specs/planner/next-steps/applying.md "The moves"; kind `outcome_share`,
 * generators/offers.ts): why (it helps the next class's estimate), what's shared (the college, the round, the
 * outcome, whether enrolled, a standing bucket, and the state — never a name or a number), "Yes, share" (built
 * `consentOutcomeShare`) and "No thanks". The generator can't read the list's consent column (pure, no I/O) and that
 * column can't tell "answered no" from "never asked" either way, so this card does the remembering itself: "Yes"
 * ticks the move (onDone, the built tick) and "No thanks" dismisses it (onSkip) — both persist through regeneration.
 *
 * Not built: a free college pick for a student with no recorded decision (applying.md "Open questions" #2). `choose`
 * (lib/planner/store-offers.ts) only accepts an admitted list item, so sharing "I went to a college that was never
 * on the list" would need a new way to record that fact, not a simple reuse of what's here. Left for the owner.
 */
import { useState, useTransition } from "react";
import { track } from "@/lib/analytics";
import { consentOutcomeShare } from "@/lib/planner/store-offers";
import type { MoveCardProps } from "./types";

export function OutcomeShareCard({ task, ctx, onDone, onSkip, pending }: MoveCardProps) {
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const canEdit = ctx.viewer.canEdit;

  const share = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await consentOutcomeShare(ctx.list.id, true);
      if (!r.ok) return setMessage(r.message);
      track("plan_outcome_shared", { yes: true });
      onDone(task);
    });

  const decline = () => {
    track("plan_outcome_shared", { yes: false });
    onSkip(task);
  };

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border">
      <p className="font-semibold">Tell us where you landed</p>
      <p className="mt-1 text-sm text-muted-foreground">It helps the next class&apos;s estimate.</p>
      <p className="mt-2 text-xs text-muted-foreground">
        What&apos;s shared: the college, the round, the outcome, whether you enrolled, a broad standing band, and your state.
        Never your name or a number.
      </p>
      {message && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {message}
        </p>
      )}
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy || pending}
            onClick={share}
            className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60"
          >
            Yes, share
          </button>
          <button type="button" disabled={busy || pending} onClick={decline} className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-border">
            No thanks
          </button>
        </div>
      )}
    </div>
  );
}

export default OutcomeShareCard;
