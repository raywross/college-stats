"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { track } from "@/lib/analytics";
import { choose, unchoose } from "@/lib/planner/store-offers";
import { cn } from "@/lib/utils";

/**
 * "I'm going to {College}" (specs/planner/offers.md "The choice"): a confirm sheet that says what happens next (the
 * deposit and housing steps, a withdraw step for each other college, the wait-list decisions, the summer list; after an
 * early decision admit, every other application must come out), then sets enrolling and the commit date and
 * regenerates the plan. `chosen` shows "Change the choice" instead.
 */
export function ChooseButton({
  itemId,
  unitId,
  collegeName,
  ed,
  others,
  chosen = false,
  canEdit,
}: {
  itemId: string;
  unitId: string;
  collegeName: string;
  /** The admit was early decision: the sheet says every other application comes out. */
  ed: boolean;
  /** How many other applications are still open or admitted (the withdraw steps the choice creates). */
  others: number;
  chosen?: boolean;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  if (!canEdit) return null;

  if (chosen) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              const r = await unchoose(itemId);
              if (!r.ok) return setMessage(r.message);
              router.refresh();
            })
          }
          className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold text-muted-foreground hover:bg-muted sm:min-h-9"
        >
          Change the choice
        </button>
        {message && (
          <p role="alert" className="text-xs text-destructive">
            {message}
          </p>
        )}
      </div>
    );
  }

  const go = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await choose(itemId);
      if (!r.ok) return setMessage(r.message);
      track("plan_choice_made", { unit_id: unitId });
      setOpen(false);
      router.refresh();
    });

  return (
    <SheetDialog
      open={open}
      onOpenChange={setOpen}
      title={`I'm going to ${collegeName}`}
      trigger={{
        className: "inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-10",
        label: `I'm going to ${collegeName}`,
        content: <span className="truncate">I&apos;m going to {collegeName}</span>,
      }}
    >
      <div className="space-y-3 text-sm">
        <p>The plan turns to what the choice sets off:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>the enrollment deposit by the reply date, and the housing deposit when the college publishes one;</li>
          {others > 0 && (
            <li className={cn(ed && "font-semibold")}>
              {ed
                ? `early decision is binding: withdraw every other application now (${others})`
                : `telling the ${others === 1 ? "other college" : `other ${others} colleges`} you won't attend, which frees a place for someone`}
              ;
            </li>
          )}
          {!ed && <li>a stay-or-go decision for each wait list you&apos;re on;</li>}
          <li>the summer list: final transcript, orientation, health forms, accepting aid.</li>
        </ul>
        {message && (
          <p role="alert" className="text-destructive">
            {message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={go} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {pending ? "Saving…" : `Yes, ${collegeName}`}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center rounded-full border px-4 font-semibold hover:bg-muted">
            Not yet
          </button>
        </div>
      </div>
    </SheetDialog>
  );
}
