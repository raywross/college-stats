"use client";

import { Sparkles } from "lucide-react";
import { ROUND_SHORT } from "@/lib/planner/rounds";
import { roundOptionLabel } from "@/lib/planner/list-row";
import { ROUND_VAR, STRIPED } from "@/lib/planner/colors";
import type { ListRound } from "@/lib/list-rules";
import { cn } from "@/lib/utils";

/**
 * The list row's round chip (specs/planner/redesign/rounds.md "The round chip"): the round's color dot, its short
 * name, ✦ while it's the starting round. The menu offers every round the chip's `pickable` list carries (the
 * college's offered rounds, or everything when its record is incomplete), each labeled "EA · Nov 1". A native
 * `<select>` inside a `<label>` so the whole 44px row is the tap target, not just the small visible chip.
 */
export function RoundChip({
  round,
  auto,
  pickable,
  dates,
  canEdit,
  onChange,
  className,
}: {
  round: ListRound;
  /** True while this is the starting round rather than one the student picked. */
  auto: boolean;
  pickable: ListRound[];
  /** Each pickable round's closing date (yyyy-mm-dd), for the menu's "EA · Nov 1" label; null when undated. */
  dates: Record<ListRound, string | null>;
  canEdit: boolean;
  onChange: (round: ListRound) => void;
  className?: string;
}) {
  return (
    <label className={cn("relative inline-flex h-11 shrink-0 items-center", className)}>
      <span className="sr-only">Round{auto ? " (started for you)" : ""}</span>
      <span
        aria-hidden
        className={cn("pointer-events-none absolute left-2.5 size-2.5 rounded-full", STRIPED.has(round) && "ring-2 ring-offset-1 ring-offset-card")}
        style={{ background: ROUND_VAR[round], ...(STRIPED.has(round) ? { ["--tw-ring-color" as string]: ROUND_VAR[round] } : {}) }}
      />
      <select
        value={round}
        disabled={!canEdit}
        onChange={(e) => onChange(e.target.value as ListRound)}
        title={auto ? "Started for you; tap to change" : "You picked this round"}
        className={cn("h-8 appearance-none rounded-full border bg-background pl-7 text-xs font-bold disabled:opacity-80", auto ? "pr-7" : "pr-3")}
      >
        {pickable.map((r) => (
          <option key={r} value={r}>
            {roundOptionLabel(r, dates[r] ?? null)}
          </option>
        ))}
        {!pickable.includes(round) && <option value={round}>{ROUND_SHORT[round]} (not offered)</option>}
      </select>
      {auto && <Sparkles aria-hidden className="pointer-events-none absolute right-2 size-3 text-muted-foreground" />}
    </label>
  );
}
