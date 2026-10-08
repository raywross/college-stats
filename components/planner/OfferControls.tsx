"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus } from "lucide-react";
import { OfferForm } from "@/components/planner/OfferForm";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import type { FallbackCoa, OfferDraft } from "@/lib/planner/offers";
import { consentOutcomeShare, setProsCons, withdrawCollege } from "@/lib/planner/store-offers";
import { cn } from "@/lib/utils";

const pill = "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60 sm:min-h-9";

/** "Add the offer" / "Edit the offer": the form in a sheet (a bottom sheet on phones). */
export function OfferSheet(props: {
  itemId: string;
  unitId: string;
  collegeName: string;
  awardYear: number;
  initial: OfferDraft | null;
  offerId: string | null;
  fallback: FallbackCoa | null;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = props.offerId ? `Edit ${props.collegeName}'s offer` : `Add ${props.collegeName}'s offer`;
  return (
    <SheetDialog
      open={open}
      onOpenChange={setOpen}
      title={props.offerId ? `${props.collegeName}: the offer` : `${props.collegeName}: add the offer`}
      description="From the award letter or the aid portal, in the federal College Financing Plan's order."
      trigger={{
        className: cn(pill, props.primary && "border-primary bg-primary text-primary-foreground hover:bg-primary/90"),
        label,
        content: (
          <>
            {props.offerId ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            {props.offerId ? "Edit the offer" : "Add the offer"}
          </>
        ),
      }}
    >
      <OfferForm {...props} onClose={() => setOpen(false)} />
    </SheetDialog>
  );
}

/** The student's pros and cons for an admitted college: two free-text boxes, shown beside the numbers, never scored. */
export function ProsCons({ itemId, collegeName, pros, cons, canEdit }: { itemId: string; collegeName: string; pros: string | null; cons: string | null; canEdit: boolean }) {
  const [p, setP] = useState(pros ?? "");
  const [c, setC] = useState(cons ?? "");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  if (!canEdit) {
    if (!pros && !cons) return <p className="text-sm text-muted-foreground">No pros or cons written yet.</p>;
    return (
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-muted-foreground">Pros</dt>
          <dd className="whitespace-pre-line">{pros || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-muted-foreground">Cons</dt>
          <dd className="whitespace-pre-line">{cons || "—"}</dd>
        </div>
      </dl>
    );
  }
  const dirty = p !== (pros ?? "") || c !== (cons ?? "");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setMessage(null);
          const r = await setProsCons(itemId, p, c);
          setMessage(r.ok ? "Saved." : r.message);
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-muted-foreground">
          Pros of {collegeName}
          <textarea value={p} maxLength={2000} rows={3} onChange={(e) => setP(e.target.value)} className="mt-1 block w-full rounded-xl border bg-background p-2 text-sm text-foreground" />
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          Cons
          <textarea value={c} maxLength={2000} rows={3} onChange={(e) => setC(e.target.value)} className="mt-1 block w-full rounded-xl border bg-background p-2 text-sm text-foreground" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending || !dirty} className={pill}>
          Save
        </button>
        {message && (
          <span role="status" className="text-xs text-muted-foreground">
            {message}
          </span>
        )}
      </div>
    </form>
  );
}

/** Marks a college withdrawn after the choice ("Marking it sets withdrawn_on"), ticking its withdraw step. */
export function WithdrawButton({ itemId, collegeName, withdrawnOn }: { itemId: string; collegeName: string; withdrawnOn: string | null }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  if (withdrawnOn) return <p className="mt-1 text-xs text-muted-foreground">Withdrawn {withdrawnOn}.</p>;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await withdrawCollege(itemId);
            if (!r.ok) return setMessage(r.message);
            router.refresh();
          })
        }
        className={pill}
      >
        I&apos;ve withdrawn from {collegeName}
      </button>
      {message && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * The opt-in to add where the student went to the pooled self-reported outcomes (offers.md "Where they went"): one
 * checkbox, revocable. Only the student (or, for a student without an account, an editing guardian) can change it; the
 * database enforces that too.
 */
export function OutcomeShareConsent({ listId, consented, canChange, studentName }: { listId: string; consented: boolean; canChange: boolean; studentName: string | null }) {
  const [on, setOn] = useState(consented);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-1">
      <label className={cn("flex items-start gap-2 text-sm", !canChange && "opacity-70")}>
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0"
          checked={on}
          disabled={!canChange || pending}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            startTransition(async () => {
              setMessage(null);
              const r = await consentOutcomeShare(listId, next);
              if (!r.ok) {
                setOn(!next);
                return setMessage(r.message);
              }
              router.refresh();
            });
          }}
        />
        <span>
          Add where {studentName ?? "I"} went to the site&apos;s pooled results (the college, the round, the outcome, whether you enrolled, a broad standing band, and your state; no name, no money, no notes), so
          next year&apos;s families see real outcomes. You can turn this off any time.
          {!canChange && <span className="block text-xs text-muted-foreground">Only {studentName ?? "the student"} can change this.</span>}
        </span>
      </label>
      {message && (
        <p role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

/** Copies a block of text (the appeal summary). */
export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        })
      }
      className={pill}
    >
      <Copy className="size-4" aria-hidden /> {done ? "Copied" : label}
    </button>
  );
}
