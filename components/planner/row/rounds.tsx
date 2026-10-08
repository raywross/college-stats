"use client";

import { useState, useTransition } from "react";
import type { RowControlProps } from "@/components/planner/row/props";
import { MetricLabel } from "@/components/ui/info-tip";
import type { AnyCited } from "@/lib/lineage";
import type { ListRound } from "@/lib/list-rules";
import { setRound } from "@/lib/planner/store";
import { ROUND_SHORT, isOffered, roundDates, roundsOffered } from "@/lib/planner/rounds";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/**
 * A list row's round picker inside ListBoard's "More" (specs/planner/early-rounds.md "The rounds table": "a picker
 * limited to the rounds offered"), with the chosen round's deadline and its ⓘ. A round the college no longer offers
 * (an import, a data change) stays selectable so the row shows it, marked "not offered"; the Rounds stage lists it as
 * a conflict. Saving regenerates the plan's dates (lib/planner/store.ts setRound).
 */
export default function RoundsRowControls({ item, school, canEdit }: RowControlProps) {
  const [round, setLocal] = useState<ListRound | null>(item.round);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const offered = roundsOffered(school);
  const dates = round ? roundDates(school, round) : null;
  const notOffered = round !== null && isOffered(school, round) === false;
  const fixed = item.status === "applied" || item.status === "decided";

  const change = (next: ListRound | null) => {
    const before = round;
    setLocal(next);
    setError(null);
    startTransition(async () => {
      const result = await setRound(item.id, next);
      if (!result.ok) {
        setLocal(before);
        setError(result.message);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="font-semibold text-muted-foreground" htmlFor={`plan-round-${item.id}`}>
        Round
      </label>
      <select
        id={`plan-round-${item.id}`}
        value={round ?? ""}
        disabled={!canEdit || fixed || pending}
        onChange={(e) => change((e.target.value || null) as ListRound | null)}
        className="h-9 rounded-full border bg-background px-2.5 text-xs font-semibold disabled:opacity-70"
      >
        <option value="">Not chosen</option>
        {offered.pickable.map((r) => (
          <option key={r} value={r}>
            {ROUND_SHORT[r]}
          </option>
        ))}
        {round && !offered.pickable.includes(round) && <option value={round}>{ROUND_SHORT[round]} (not offered)</option>}
      </select>
      {dates?.closing && (
        <MetricLabel cited={school.cites[dates.closing.field] as AnyCited | undefined} className="text-muted-foreground">
          <span>Apply by {day(dates.closing.iso)}</span>
        </MetricLabel>
      )}
      {!offered.published && <span className="text-muted-foreground">The college hasn&apos;t published its rounds</span>}
      {notOffered && <span className="font-semibold text-destructive">Not offered in its published rounds</span>}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
