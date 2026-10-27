"use client";

/**
 * The return prompt (specs/planner/v3/guides/show-interest.md "Tracking", layer 2; build-plan.md review note 12): one
 * per guide page. It holds the viewer's pending acts (the server's, plus each new click an `ActButton` arms), and when
 * the tab comes back (`visibilitychange` to visible, or the window's `focus`) after the person left it, asks once about
 * the newest act clicked under five minutes ago (`pendingForPrompt`): `markPrompted` first, so it never asks twice,
 * whatever the answer. **Yes** confirms (`resolveAct(…, "prompt")`); **Not yet** closes and leaves it pending for the
 * morning email; **I picked a different date** opens the visit form prefilled, the date editable, and its save
 * confirms the act with that date. An undated visit act (the college's visit page) asks for the date straight away.
 *
 * The guide's sections read the same pending list for their "Pending: did you register …?" lines (`useInterestActs`),
 * whose Yes goes through here too (`via: "manual"`). Telemetry: the click's `plan_interest_act` is ActButton's; the
 * confirmation's `plan_interest_confirmed` is sent by the server where it is written.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { VisitForm } from "@/components/planner/VisitForm";
import type { VisitFormPrefill } from "@/components/visits/next-events-logic";
import { isVisitAct, localParts, pendingForPrompt, promptQuestion, visitKindForAct, visiblePending, type InterestActRow } from "@/lib/planner/interest-acts";
import { markPrompted, resolveAct } from "@/lib/planner/store-interest";
import type { VisitInput } from "@/lib/planner/store-actions";
import { cn } from "@/lib/utils";

export interface InterestActsContext {
  /** The viewer's own pending acts on this page, newest first. */
  pending: InterestActRow[];
  /** Called by ActButton once its click is recorded. */
  arm: (row: InterestActRow) => void;
  /** "Yes" on a Pending line or the prompt: confirms, or opens the date form for an undated visit act. */
  confirm: (row: InterestActRow, via: "prompt" | "manual") => void;
  /** "Not yet" on a Pending line: hides it on this page; it stays pending. */
  later: (row: InterestActRow) => void;
  /** The question for an act, in the college's name and the event's zone. */
  question: (row: InterestActRow) => string;
  busy: boolean;
  error: string | null;
}

const Ctx = createContext<InterestActsContext | null>(null);

/** The page's pending acts and their answers; null outside a ReturnPrompt. */
export function useInterestActs(): InterestActsContext | null {
  return useContext(Ctx);
}

const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold disabled:opacity-60";
const PRIMARY = cn(BUTTON, "bg-foreground text-background");
const SECONDARY = cn(BUTTON, "ring-1 ring-border hover:bg-muted");

/** The visit form's starting values for a pending visit act (the date editable). */
export function prefillFor(row: InterestActRow, zone: string | null): VisitFormPrefill {
  const parts = row.event_starts_at ? localParts(row.event_starts_at, zone) : null;
  const notes = [row.event_title, row.event_place].map((s) => s?.trim()).filter(Boolean);
  return {
    kind: visitKindForAct(row.act, row.event_place),
    onDate: parts?.date ?? "",
    atTime: parts?.time ?? null,
    registered: true,
    registrationUrl: row.url,
    notesFree: notes.join(", "),
  };
}

export function ReturnPrompt({
  initial,
  collegeName,
  zones,
  householdNames = [],
  children,
}: {
  initial: InterestActRow[];
  collegeName: string | null;
  /** Each event's own zone by event id. */
  zones: Record<string, string>;
  householdNames?: readonly string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<InterestActRow[]>(initial);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<InterestActRow | null>(null);
  const [form, setForm] = useState<{ row: InterestActRow; via: "prompt" | "manual" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  /** Whether the person left this tab since the last act was armed (the prompt asks only on a real return). */
  const left = useRef(false);

  const zoneOf = useCallback((row: InterestActRow) => (row.event_id ? (zones[row.event_id] ?? null) : null), [zones]);
  const question = useCallback((row: InterestActRow) => promptQuestion(row, collegeName, zoneOf(row)), [collegeName, zoneOf]);

  const arm = useCallback((row: InterestActRow) => {
    left.current = document.visibilityState === "hidden" || !document.hasFocus();
    setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)]);
  }, []);

  const drop = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const confirm = useCallback(
    (row: InterestActRow, via: "prompt" | "manual") => {
      setError(null);
      if (isVisitAct(row.act) && !row.event_starts_at) {
        setAsking(null);
        setForm({ row, via });
        return;
      }
      startTransition(async () => {
        const r = await resolveAct(row.id, "confirmed", via);
        if (!r.ok) {
          if (r.needDate) {
            setAsking(null);
            setForm({ row, via });
            return;
          }
          setError(r.message);
          return;
        }
        drop(row.id);
        setAsking(null);
        router.refresh();
      });
    },
    [router],
  );

  const later = useCallback((row: InterestActRow) => setHidden((prev) => new Set([...prev, row.id])), []);

  // Arms on leaving and asks on coming back (review note 12).
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    const onLeave = () => {
      if (document.visibilityState === "hidden") left.current = true;
    };
    const onBlur = () => {
      left.current = true;
    };
    const onReturn = () => {
      if (document.visibilityState !== "visible" || !left.current) return;
      left.current = false;
      const next = pendingForPrompt(rowsRef.current, new Date());
      if (!next) return;
      // Asked once, whatever the answer: stamped here and on the server before the sheet shows.
      setRows((prev) => prev.map((r) => (r.id === next.id ? { ...r, prompted_at: new Date().toISOString() } : r)));
      void markPrompted(next.id);
      setError(null);
      setAsking(next);
    };
    document.addEventListener("visibilitychange", onLeave);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onLeave);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onReturn);
    };
  }, []);

  const pending = useMemo(() => visiblePending(rows, new Date()).filter((r) => !hidden.has(r.id)), [rows, hidden]);
  const value = useMemo<InterestActsContext>(() => ({ pending, arm, confirm, later, question, busy, error }), [pending, arm, confirm, later, question, busy, error]);

  const saveWithDate = (input: VisitInput) =>
    new Promise<{ ok: true } | { ok: false; message: string }>((resolve) => {
      if (!form) return resolve({ ok: false, message: "That didn't work. Try again in a moment." });
      const row = form.row;
      resolveAct(row.id, "confirmed", form.via, { visitDate: input.onDate, visitTime: input.atTime ?? null, kind: input.kind, who: input.who, notes: input.notes })
        .then((r) => {
          if (!r.ok) return resolve({ ok: false, message: r.message });
          drop(row.id);
          router.refresh();
          resolve({ ok: true });
        })
        .catch(() => resolve({ ok: false, message: "That didn't work. Try again in a moment." }));
    });

  const askingVisit = asking ? isVisitAct(asking.act) : false;
  const yesLabel = !asking
    ? "Yes"
    : asking.act === "follow"
      ? "Yes, following"
      : asking.act === "info_request"
        ? "Yes, I sent it"
        : asking.act === "mailing_list"
          ? "Yes, I joined"
          : askingVisit && !asking.event_starts_at
            ? "Yes, pick the date"
            : "Yes, registered";

  return (
    <Ctx.Provider value={value}>
      {children}
      <SheetDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)} title={asking ? question(asking) : ""}>
        {asking && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">We can&apos;t see the college&apos;s page, so we ask. Only a yes goes on your list.</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button type="button" disabled={busy} onClick={() => confirm(asking, "prompt")} className={PRIMARY}>
                {yesLabel}
              </button>
              <button type="button" disabled={busy} onClick={() => setAsking(null)} className={SECONDARY}>
                Not yet
              </button>
              {askingVisit && asking.event_starts_at && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setForm({ row: asking, via: "prompt" });
                    setAsking(null);
                  }}
                  className={SECONDARY}
                >
                  I picked a different date
                </button>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
      </SheetDialog>
      <SheetDialog open={form !== null} onOpenChange={(open) => !open && setForm(null)} title={collegeName ? `Your visit · ${collegeName}` : "Your visit"}>
        {form && form.row.item_id && (
          <VisitForm
            itemId={form.row.item_id}
            householdNames={householdNames}
            prefill={prefillFor(form.row, zoneOf(form.row))}
            onSubmit={saveWithDate}
            onDone={() => setForm(null)}
            onCancel={() => setForm(null)}
          />
        )}
      </SheetDialog>
    </Ctx.Provider>
  );
}

export default ReturnPrompt;
