"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Info, OctagonAlert } from "lucide-react";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import type { AnyCited } from "@/lib/lineage";
import type { ListRound } from "@/lib/list-rules";
import { money as usd } from "@/lib/format";
import { acceptRoundsPlan } from "@/lib/planner/store-rounds";
import {
  BINDING,
  CHECK_QUESTIONS,
  ROUND_SHORT,
  bindingChecklist,
  conflicts,
  cycleLabel,
  earlyFor,
  interestLabel,
  lastCycleNote,
  roundDates,
  roundsOffered,
  roundsSummary,
  type CheckState,
  type MoneyInput,
  type Proposal,
  type RoundsItem,
  type RoundsSchool,
  type Standing,
} from "@/lib/planner/rounds";
import type { PlanSchool } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

type TableSchool = RoundsSchool & Pick<PlanSchool, "brand" | "avgCostCite">;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const cited = (s: TableSchool | undefined, field: string | null) => (s && field ? (s.cites[field] as AnyCited | undefined) : undefined);

/** The glossary term for each round's chip. */
const ROUND_TERM = { ed: "early-decision", ed2: "early-decision-ii", ea: "early-action", rea: "single-choice-early-action", rd: "regular-decision", rolling: "rolling-admission" } as const;

const STATE_ICON: Record<CheckState, typeof Info> = { green: CheckCircle2, amber: AlertTriangle, red: OctagonAlert, info: Info };
const STATE_CLASS: Record<CheckState, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-destructive",
  info: "text-muted-foreground",
};

/**
 * The rounds table, the proposal, its checklist, and the conflicts (specs/planner/early-rounds.md "The rounds table",
 * "The proposal", "Conflicts"). One row per college in priority order: rounds offered, dates, the early advantage, the
 * share of the class filled early, interest, standing, money, and the round picker (limited to the rounds offered). On
 * phones each row is a card. The rounds start as the proposal (or the saved rounds once accepted); edits re-check the
 * conflicts live and nothing is written until "Use this plan".
 */
export function RoundsTable({
  listId,
  items,
  schools,
  standing,
  money,
  proposal,
  accepted,
  canEdit,
}: {
  listId: string;
  items: RoundsItem[];
  schools: Record<string, TableSchool>;
  standing: Record<string, Standing>;
  money: MoneyInput;
  proposal: Proposal;
  accepted: boolean;
  canEdit: boolean;
}) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const ordered = proposal.order.map((id) => byId.get(id)!).filter(Boolean);
  const proposed = useMemo(() => Object.fromEntries(proposal.lines.map((l) => [l.itemId, l])), [proposal]);
  const initial = () => Object.fromEntries(ordered.map((i) => [i.id, accepted ? i.round : (proposed[i.id]?.round ?? i.round)])) as Record<string, ListRound | null>;
  const [draft, setDraft] = useState<Record<string, ListRound | null>>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const drafted = ordered.map((i) => ({ ...i, round: draft[i.id] ?? null }));
  const found = conflicts(drafted, schools, money);
  const red = found.filter((c) => c.severity === "red").length;
  const binding = drafted.filter((i) => i.round !== null && BINDING.includes(i.round) && i.status !== "decided");
  const matchesProposal = ordered.every((i) => (draft[i.id] ?? null) === (proposed[i.id]?.round ?? null));
  const changed = ordered.some((i) => (draft[i.id] ?? null) !== i.round);
  const summary = roundsSummary(drafted, schools);
  const cycle = Object.values(schools)[0]?.cycleStartYear ?? null;

  const accept = () => {
    setError(null);
    startTransition(async () => {
      const result = await acceptRoundsPlan({ listId, order: proposal.order, rounds: draft });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(true);
      track("plan_rounds_accepted", { ed: drafted.some((i) => i.round === "ed"), ed2: drafted.some((i) => i.round === "ed2") });
    });
  };

  return (
    <div className="space-y-4">
      {!accepted && (
        <p className="text-sm text-muted-foreground">
          A draft: each college&apos;s round with the reason for it. Change any of them; nothing is saved until you use the plan.
          {proposal.note && ` ${proposal.note}.`}
        </p>
      )}

      <div className="space-y-3 lg:space-y-0" role="list" aria-label="Rounds by college">
        <div aria-hidden className="hidden gap-3 border-b px-3 pb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_9rem]">
          <span>College</span>
          <span>Rounds offered</span>
          <span>Dates</span>
          <span>Early advantage</span>
          <span>Interest · standing</span>
          <span>Money</span>
          <span>Round</span>
        </div>
        {drafted.map((item) => {
          const s = schools[item.unit_id];
          const offered = roundsOffered(s);
          const early = earlyFor(s);
          const st = standing[item.id];
          const line = proposed[item.id];
          const fixed = item.status === "applied" || item.status === "decided";
          const datesFor = [...new Set([...offered.offered, ...(item.round ? [item.round] : [])])].map((r) => ({ r, d: roundDates(s, r) })).filter((x) => x.d.closing || x.d.notification);
          const note = datesFor.length > 0 && cycle !== null ? lastCycleNote(datesFor[0].d, s?.cycleStartYear ?? cycle) : null;
          const interest = interestLabel(s);
          const est = money.estimates[item.id] ?? null;
          return (
            <div key={item.id} role="listitem" className="rounded-2xl border p-3 lg:rounded-none lg:border-0 lg:border-b lg:py-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_9rem]">
                <div className="min-w-0">
                  {s ? <CollegeChip school={s} link /> : <span className="text-sm font-semibold">{item.unit_id}</span>}
                  {item.dream && <p className="mt-0.5 text-xs font-semibold text-primary">Dream</p>}
                </div>

                <Cell label="Rounds offered">
                  {offered.published ? (
                    offered.offered.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {offered.offered.map((r) => (
                          <span key={r} className="rounded-full border px-2 py-0.5 text-xs font-semibold">
                            <Term term={ROUND_TERM[r]}>{ROUND_SHORT[r]}</Term>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">None listed</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">The college hasn&apos;t published its rounds</span>
                  )}
                </Cell>

                <Cell label="Dates">
                  {datesFor.length === 0 ? (
                    <span className="text-muted-foreground">Not published</span>
                  ) : (
                    <span className="flex flex-col gap-0.5">
                      {datesFor.map(({ r, d }) => (
                        <MetricLabel key={r} cited={cited(s, d.closing?.field ?? d.notification?.field ?? null)}>
                          <span>
                            {ROUND_SHORT[r]}: {d.closing ? day(d.closing.iso) : "?"} → {d.notification ? day(d.notification.iso) : "?"}
                          </span>
                        </MetricLabel>
                      ))}
                      {note && <span className="text-xs text-amber-700 dark:text-amber-400">{note}</span>}
                    </span>
                  )}
                </Cell>

                <Cell label="Early advantage">
                  {early.line ? (
                    <span className="flex flex-col gap-0.5">
                      <MetricLabel term="early-decision" cited={cited(s, early.field)}>
                        <span>{early.line}</span>
                      </MetricLabel>
                      {early.share && <span className="text-xs text-muted-foreground">Filled early: {early.share}</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{early.offered === false ? "No early decision" : "—"}</span>
                  )}
                </Cell>

                <Cell label="Interest · standing">
                  <span className="flex flex-col gap-0.5">
                    {interest && (
                      <MetricLabel cited={cited(s, "reported.admission_profile.factors.interest")}>
                        <span>Interest: {interest}</span>
                      </MetricLabel>
                    )}
                    {st && (
                      <span>
                        <span className="font-semibold">{st.label}</span>
                        <span className="block text-xs text-muted-foreground">{st.reason}</span>
                      </span>
                    )}
                  </span>
                </Cell>

                <Cell label="Money">
                  <span className="flex flex-col gap-0.5">
                    {est ? (
                      <span>
                        Estimate ${Math.round(est.low / 1000)}–{Math.round(est.high / 1000)}K/yr{est.sharedBy ? `, shared by ${est.sharedBy}` : ""}
                      </span>
                    ) : s?.links?.price_calculator ? (
                      <MetricLabel cited={cited(s, "links.price_calculator")}>
                        <span>
                          No estimate yet:{" "}
                          <a href={s.links.price_calculator} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">
                            run the college&apos;s calculator
                          </a>
                        </span>
                      </MetricLabel>
                    ) : (
                      <span className="text-muted-foreground">No estimate yet</span>
                    )}
                    {s?.avgCost != null && (
                      <MetricLabel cited={s.avgCostCite as AnyCited | undefined} className="text-xs text-muted-foreground">
                        <span>
                          Average cost {usd(s.avgCost)}
                          {money.limit !== null && (s.avgCost > money.limit ? `, above your ${usd(money.limit)}` : `, within your ${usd(money.limit)}`)}
                        </span>
                      </MetricLabel>
                    )}
                  </span>
                </Cell>

                <Cell label="Round">
                  <select
                    value={item.round ?? ""}
                    disabled={!canEdit || fixed || pending}
                    onChange={(e) => {
                      setSaved(false);
                      setDraft((d) => ({ ...d, [item.id]: (e.target.value || null) as ListRound | null }));
                    }}
                    aria-label={`Round for ${s?.name ?? "this college"}`}
                    className="h-11 w-full rounded-full border bg-background px-3 text-sm font-semibold disabled:opacity-70 lg:h-9"
                  >
                    <option value="">No round yet</option>
                    {offered.pickable.map((r) => (
                      <option key={r} value={r}>
                        {ROUND_SHORT[r]}
                      </option>
                    ))}
                    {item.round && !offered.pickable.includes(item.round) && <option value={item.round}>{ROUND_SHORT[item.round]} (not offered)</option>}
                  </select>
                </Cell>
              </div>
              {line && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {line.round === item.round ? line.reason : `Proposed: ${line.round ? ROUND_SHORT[line.round] : "no round"}. ${line.reason}`}
                  {line.flag && line.round === item.round && <span className="ml-1 font-semibold text-amber-700 dark:text-amber-400">{line.flag}.</span>}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {binding.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display text-base font-bold">
            Before a <Term term="binding">binding</Term> round
          </h3>
          {binding.map((item) => {
            const s = schools[item.unit_id];
            const lines = bindingChecklist(item, s, standing[item.id], money, found);
            return (
              <div key={item.id} className="rounded-2xl border p-3">
                <p className="text-sm font-semibold">
                  {ROUND_SHORT[item.round!]} at {s?.name ?? "this college"}
                </p>
                <ul className="mt-2 space-y-2">
                  {lines.map((l) => {
                    const Icon = STATE_ICON[l.state];
                    return (
                      <li key={l.question} className="flex gap-2 text-sm">
                        <Icon className={cn("mt-0.5 size-4 shrink-0", STATE_CLASS[l.state])} aria-hidden />
                        <span className="min-w-0">
                          <span className="block font-semibold">{CHECK_QUESTIONS[l.question]}</span>
                          <span className="text-muted-foreground">{l.text}</span>
                          {l.link && (
                            <a href={l.link} target="_blank" rel="noopener noreferrer" className="ml-1 font-semibold text-primary underline-offset-2 hover:underline">
                              {l.question === "money" ? "Run the calculator" : "The college's page"}
                            </a>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {found.length > 0 && (
        <ul className="space-y-1.5" aria-label="Conflicts">
          {found.map((c, i) => (
            <li key={`${c.kind}-${i}`} className={cn("flex gap-2 text-sm", c.severity === "red" ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
              {c.severity === "red" ? <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-label="Conflict" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-label="Check" />}
              <span className="min-w-0">
                {c.text}
                {c.link && (
                  <a href={c.link} target="_blank" rel="noopener noreferrer" className="ml-1 font-semibold underline underline-offset-2">
                    Check
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={accept}
            disabled={pending || (accepted && !changed)}
            className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : accepted ? "Save these rounds" : "Use this plan"}
          </button>
          {!matchesProposal && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setDraft(Object.fromEntries(ordered.map((i) => [i.id, proposed[i.id]?.round ?? i.round])))}
              className="h-11 rounded-full border px-4 text-sm font-semibold hover:bg-muted"
            >
              Back to the proposal
            </button>
          )}
          {red > 0 && <span className="text-sm text-destructive">{red === 1 ? "1 conflict" : `${red} conflicts`}: you can still save it</span>}
          {saved && !pending && <span className="text-sm text-muted-foreground">Saved. The timeline follows these rounds.</span>}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {summary && !accepted && <p className="text-sm text-muted-foreground">This plan: {summary}</p>}
      {cycle !== null && <p className="text-xs text-muted-foreground">Dates are for the {cycleLabel(cycle)} cycle, from each college&apos;s Common Data Set (ⓘ for the edition).</p>}
    </div>
  );
}

/** A cell with its column name shown on phones (the table's header row shows it from lg). */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-sm">
      <span className="mb-0.5 block text-xs font-bold tracking-wide text-muted-foreground uppercase lg:sr-only">{label}</span>
      {children}
    </div>
  );
}
