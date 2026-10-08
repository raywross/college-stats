"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShareLetter } from "@/components/planner/ShareLetter";
import { LIST_OUTCOMES, OUTCOME_LABELS, type ListOutcome } from "@/lib/list-rules";
import { recordDecision } from "@/lib/planner/store-offers";
import { cn } from "@/lib/utils";

/**
 * What a college said, in one tap (specs/planner/offers.md "Recording decisions"): Admitted · Denied · Waitlisted ·
 * Deferred, with the date (default today). Deferred returns the college to Applied (the built rule). After an admit or
 * a wait list, the one question about sharing the admission letter. Read-only without edit access: the outcome shows
 * as a chip.
 */
export function OutcomePicker({
  itemId,
  outcome,
  decisionDate,
  today,
  canEdit,
  collegeName,
  compact = false,
}: {
  itemId: string;
  outcome: ListOutcome | null;
  decisionDate: string | null;
  today: string;
  canEdit: boolean;
  collegeName: string;
  compact?: boolean;
}) {
  const [date, setDate] = useState(today);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const router = useRouter();

  if (!canEdit) {
    return outcome ? <OutcomeChip outcome={outcome} date={decisionDate} /> : null;
  }

  const pick = (o: ListOutcome) =>
    startTransition(async () => {
      setMessage(null);
      const r = await recordDecision(itemId, o, date);
      if (!r.ok) return setMessage(r.message);
      setAsk(o === "admitted" || o === "waitlisted");
      if (o === "deferred") setMessage("Recorded: deferred, so the college is back to Applied while you wait.");
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <fieldset className={cn("flex flex-wrap items-center gap-1.5", pending && "opacity-70")}>
        <legend className={cn("mb-1 text-xs font-semibold text-muted-foreground", compact && "sr-only")}>What {collegeName} said</legend>
        {LIST_OUTCOMES.map((o) => (
          <button
            key={o}
            type="button"
            disabled={pending}
            aria-pressed={outcome === o}
            onClick={() => pick(o)}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold sm:min-h-8",
              outcome === o ? "border-transparent bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {OUTCOME_LABELS[o]}
          </button>
        ))}
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>on</span>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} className="min-h-11 rounded-full border bg-background px-2 text-xs sm:min-h-8" />
        </label>
      </fieldset>
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
      {ask && <ShareLetter itemId={itemId} kind="admission" collegeName={collegeName} onDone={() => setAsk(false)} />}
    </div>
  );
}

const CHIP_STYLE: Record<ListOutcome, string> = {
  admitted: "bg-primary text-primary-foreground",
  waitlisted: "bg-muted text-foreground",
  deferred: "bg-muted text-foreground",
  denied: "bg-muted text-muted-foreground",
};

/** An outcome as a chip, with its date ("Admitted · Mar 28"). */
export function OutcomeChip({ outcome, date }: { outcome: ListOutcome; date: string | null }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", CHIP_STYLE[outcome])}>
      {OUTCOME_LABELS[outcome]}
      {date ? ` · ${shortDate(date)}` : ""}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
