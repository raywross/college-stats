"use client";

import { useActionState, useState } from "react";
import { cn } from "@/lib/utils";
import { IDLE, typedMatches, type AdminActionState } from "@/lib/admin/console";

/** One proposal row as the Approve form shows it (plain data from the page). */
export interface ApproveRowView {
  index: number;
  unit: string;
  college: string;
  reviewHref: string;
  label: string;
  now: string;
  proposed: string;
  /** The document at the page, when it is a web address. */
  fromHref: string | null;
  fromLabel: string;
  quote: string | null;
  recommends: "approve" | "your-call";
  why: string | null;
  /** Ticked to begin with: the row's decision when it has one, else the recommendation. */
  ticked: boolean;
}

const buttonCls = "inline-flex h-10 shrink-0 items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const linkCls = "underline decoration-dotted underline-offset-2";

/**
 * A value proposal's rows with a tick each, pre-set from the recommendation (or a decision made on a college's Review
 * page), and **Approve** (specs/product/data-steward.md "Proposals"). Approve applies the ticked rows and records the
 * rest declined with the note; when the proposal changes what a visitor sees, the word `confirmWord` must be typed.
 * A re-read shows the projected cost of the ticked colleges as they are ticked. The Server Action re-checks
 * everything: a tick here is a choice, not a guard.
 */
export function ProposalApprove({
  action,
  proposal,
  rows,
  confirmWord,
  costEach,
}: {
  action: (previous: AdminActionState, form: FormData) => Promise<AdminActionState>;
  proposal: string;
  rows: ApproveRowView[];
  confirmWord: string | null;
  /** A re-read's projected cost per college, in US dollars. */
  costEach: number | null;
}) {
  const [ticks, setTicks] = useState<Set<number>>(() => new Set(rows.filter((r) => r.ticked).map((r) => r.index)));
  const [typed, setTyped] = useState("");
  const [state, run, pending] = useActionState<AdminActionState, FormData>(action, IDLE);
  const ready = ticks.size > 0 && (!confirmWord || typedMatches(typed, confirmWord));
  const colleges = new Set(rows.filter((r) => ticks.has(r.index)).map((r) => r.unit)).size;
  const toggle = (i: number) =>
    setTicks((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="proposal" value={proposal} />
      <input type="hidden" name="rows" value={String(rows.length)} />
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">The proposal&apos;s rows; ticked rows are applied on Approve</caption>
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Approve
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                College
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Field
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                On the site now
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Proposed
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                From
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Recommends
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.index} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    name={`row-${r.index}`}
                    aria-label={`Approve row ${r.index + 1}: ${r.college}, ${r.label}`}
                    checked={ticks.has(r.index)}
                    onChange={() => toggle(r.index)}
                    className="size-5 accent-primary"
                  />
                </td>
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <a href={r.reviewHref} className={linkCls}>
                    {r.college}
                  </a>
                  <span className="block text-xs font-normal text-muted-foreground">{r.unit}</span>
                </th>
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2">{r.now}</td>
                <td className="px-3 py-2 font-medium">{r.proposed}</td>
                <td className="max-w-64 px-3 py-2 text-xs">
                  {r.fromHref ? (
                    <a href={r.fromHref} target="_blank" rel="noopener noreferrer" className={`break-all ${linkCls}`}>
                      {r.fromLabel}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{r.fromLabel}</span>
                  )}
                  {r.quote && <span className="mt-0.5 block break-words">&ldquo;{r.quote}&rdquo;</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.recommends === "approve" ? (
                    <span className="font-semibold">Approve (the Steward checked the document)</span>
                  ) : (
                    <span>
                      <span className="font-semibold">Your call</span>
                      {r.why && <span className="block text-muted-foreground">{r.why}</span>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground" role="status">
        {ticks.size} of {rows.length} ticked
        {costEach !== null ? ` · projected cost of the ticked re-reads: $${(costEach * colleges).toFixed(2)} for ${colleges} college${colleges === 1 ? "" : "s"}` : ""}
      </p>
      <div>
        <label className="block text-sm font-semibold" htmlFor={`${proposal}-note`}>
          Note (kept with the declined rows)
        </label>
        <input id={`${proposal}-note`} name="note" maxLength={500} autoComplete="off" className={`${inputCls} mt-1.5 sm:max-w-xl`} />
      </div>
      {confirmWord && (
        <div>
          <label className="block text-sm font-semibold" htmlFor={`${proposal}-confirm`}>
            This changes what visitors see. Type <span className="font-mono">{confirmWord}</span> to confirm
          </label>
          <input
            id={`${proposal}-confirm`}
            name="confirm"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={`${inputCls} mt-1.5 sm:max-w-sm`}
          />
        </div>
      )}
      <button type="submit" disabled={pending || !ready} className={cn(buttonCls, "bg-primary text-primary-foreground hover:bg-primary/90")}>
        {pending ? "Approving…" : "Approve"}
      </button>
      {state.status === "error" && (
        <p className="max-w-prose text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "done" && state.message && (
        <p className="max-w-prose text-sm font-medium text-emerald-800 dark:text-emerald-300" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
