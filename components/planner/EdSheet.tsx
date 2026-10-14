"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, X } from "lucide-react";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import { ED_CAVEAT, ED_PILL_TEXT, edSheetFacts, type EdCandidate, type EdCheckKey } from "@/lib/planner/ed-opportunities";
import { dismissEd, setEdChecks, startEd } from "@/lib/planner/store-ed";
import type { PlanRowView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import type { AnyCited } from "@/lib/lineage";
import { cn } from "@/lib/utils";

/**
 * The ED sheet (specs/planner/next-steps/ed-opportunities.md "The sheet"), on top of the row's drawer: Quad's read,
 * what the college reports (its own numbers, cited), the caveat, the three questions (stored in `ed_checks`; the cost
 * one also reads as ticked once the cost check task for this college is done), the round's dates, and the buttons.
 * The student sets the round (**Start it in ED / ED II**, or **Keep ED** when it's already there) or says **Not for
 * me**; a guardian sees the facts and questions, ticks the cost check as theirs, and reads "{First} picks the round".
 * Nothing here is a number from the estimate: the level is the only thing from it.
 */
export function EdSheet({ row, ctx, candidate, onClose }: { row: PlanRowView; ctx: PlanContext; candidate: EdCandidate; onClose?: () => void }) {
  const router = useRouter();
  const school = row.school ?? undefined;
  const facts = edSheetFacts({ ...row.item, round: row.round }, school, row.estimate ?? undefined, candidate.round);
  const isStudent = !ctx.viewer.isGuardian && ctx.viewer.canEdit;
  const canEdit = ctx.viewer.canEdit;
  const first = ctx.student?.display_name?.trim().split(/\s+/)[0] || "Your student";
  const costTaskDone = ctx.tasks.some((t) => t.kind === "cost_check" && t.item_id === row.item.id && t.done_at !== null);
  const [checks, setChecks] = useState<Record<string, boolean>>(() => ({ ...(row.item.ed_checks ?? {}) }));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const round = candidate.round;

  useEffect(() => {
    track("plan_ed_sheet_opened", { round });
  }, [round]);

  if (!facts || !school) return null;
  const setRound = round === "ed2" ? "ed2" : "ed";
  const cite = (field: string) => school.cites[field] as AnyCited | undefined;

  const toggle = (key: EdCheckKey) => {
    if (!canEdit) return;
    const next = !checks[key];
    const before = checks;
    setChecks({ ...checks, [key]: next });
    setError(null);
    startTransition(async () => {
      const r = await setEdChecks(row.item.id, { [key]: next });
      if (!r.ok) {
        setChecks(before);
        setError(r.message);
      }
    });
  };

  const start = () => {
    setError(null);
    startTransition(async () => {
      const r = await startEd(row.item.id, setRound);
      if (!r.ok) return setError(r.message);
      track("plan_ed_started", { round });
      router.refresh();
    });
  };

  const notForMe = () => {
    setError(null);
    startTransition(async () => {
      const r = await dismissEd(row.item.id);
      if (!r.ok) return setError(r.message);
      track("plan_ed_dismissed", { round });
      onClose?.();
      router.refresh();
    });
  };

  const button = facts.onPlan ? (setRound === "ed2" ? "Keep ED II" : "Keep ED") : setRound === "ed2" ? "Start it in ED II" : "Start it in ED";

  return (
    <section aria-label={ED_PILL_TEXT[round].full} className="space-y-4 rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {ED_PILL_TEXT[round].full}: {facts.name}
          </p>
          {facts.levelLabel && <p className="text-xs text-muted-foreground">{facts.levelLabel} for you</p>}
          {facts.onPlan && <p className="text-xs font-semibold text-primary">On your plan: {setRound === "ed2" ? "ED II" : "ED"}</p>}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close the ED facts" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <p>{facts.read}</p>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground">What {facts.name} reports</p>
        {facts.reported ? (
          <p>
            <MetricLabel term="early-decision" cited={cite(facts.countsField)}>
              <span>
                {facts.reported}
                {` (CDS C21/C1${facts.lineage ? `, ${facts.lineage}` : ""})`}
              </span>
            </MetricLabel>
            {facts.overallFromAdmitRate && school.admitRateCite ? <MetricLabel cited={school.admitRateCite as AnyCited}><span className="sr-only">Overall rate source</span></MetricLabel> : null}
          </p>
        ) : (
          facts.noCounts && <p className="text-muted-foreground">{facts.noCounts}</p>
        )}
        {facts.share && <p className="text-muted-foreground">ED admits fill {facts.share}.</p>}
        {facts.together && <p className="text-muted-foreground">ED I and ED II together.</p>}
      </div>

      <p className="text-muted-foreground">
        {ED_CAVEAT.before}
        <Term term="hooked-applicant">{ED_CAVEAT.term}</Term>
        {ED_CAVEAT.after}
      </p>

      <ul className="space-y-1">
        {facts.questions.map((q) => {
          const ticked = !!checks[q.key] || (q.key === "cost" && costTaskDone);
          // A guardian's own question is the cost check; the other two are the student's to answer.
          const mine = canEdit && (isStudent || q.key === "cost");
          const text = q.key === "cost" && ctx.viewer.isGuardian ? "Have you checked the cost?" : q.text;
          return (
            <li key={q.key} className="flex flex-wrap items-center gap-x-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={ticked}
                disabled={!mine || pending}
                onClick={() => toggle(q.key)}
                className="inline-flex min-h-11 items-center gap-2 text-left disabled:cursor-default"
              >
                <span aria-hidden className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md border-2", ticked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>
                  {ticked && <Check className="size-3.5" />}
                </span>
                <span>{text}</span>
              </button>
              {q.key === "cost" && facts.calculator && (
                <a href={facts.calculator} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">
                  Net price calculator <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </li>
          );
        })}
      </ul>

      {(facts.closing || facts.notification) && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">{setRound === "ed2" ? "ED II" : "ED"} dates</p>
          {facts.closing && (
            <p>
              <MetricLabel cited={cite(facts.closing.field)}>
                <span>Apply by {facts.closing.label}</span>
              </MetricLabel>
            </p>
          )}
          {facts.notification && (
            <p>
              <MetricLabel cited={cite(facts.notification.field)}>
                <span>Decisions by {facts.notification.label}</span>
              </MetricLabel>
            </p>
          )}
          {facts.dateNote && <p className="text-xs text-muted-foreground">{facts.dateNote}</p>}
        </div>
      )}

      {isStudent ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={start} className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60">
            {button}
          </button>
          <button type="button" disabled={pending} onClick={notForMe} className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-border disabled:opacity-60">
            Not for me
          </button>
        </div>
      ) : (
        <p className="text-muted-foreground">{first} picks the round.</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <Link href={facts.profileHref} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
        {facts.profileLabel}
      </Link>
    </section>
  );
}
