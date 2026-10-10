"use client";

import { useState } from "react";
import { ChevronDown, Heart, Info, RotateCcw, Sparkles, TrendingUp } from "lucide-react";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { InfoTip, SourceTip } from "@/components/ui/info-tip";
import { ROUND_SHORT } from "@/lib/planner/rounds";
import { TEST_LABEL, type Fit } from "@/lib/planner/standing";
import type { ListRound } from "@/lib/list-rules";
import { cn } from "@/lib/utils";
import type { Derived, KidState, Row } from "./derive";
import { ROUND_NAME, ROUND_VAR, STRIPED, dayLabel, type PreviewKid } from "./types";

export const FIT_LABEL: Record<Fit, string> = { reach: "Reach", target: "Target", likely: "Likely" };
export const FIT_CLASS: Record<Fit, string> = {
  reach: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  target: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  likely: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};
const NEXT_FIT: Record<Fit, Fit> = { reach: "target", target: "likely", likely: "reach" };

/**
 * The list is the plan (specs/planner/redesign/list.md): one row per college with the Dream heart, the group (sorted
 * for you, tap to change), the round (started for you, tap to change), and the deadline. Reasons sit behind ⓘ; no
 * admit rates, no ranking, no table of numbers.
 */
export function ListView({
  kid,
  derived,
  today,
  isParent,
  onState,
  onScores,
}: {
  kid: PreviewKid;
  derived: Derived;
  today: string;
  isParent: boolean;
  onState: (f: (s: KidState) => KidState) => void;
  onScores: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const order: Fit[] = ["reach", "target", "likely"];
  const rows = [...derived.rows].sort((a, b) => Number(b.dream) - Number(a.dream) || order.indexOf(a.fit ?? "likely") - order.indexOf(b.fit ?? "likely"));
  const b = derived.balance;
  const anyAuto = derived.rows.some((r) => r.fitAuto || r.roundAuto);
  const who = isParent ? kid.name : "you";

  return (
    <div className="space-y-4">
      {derived.problems.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40" role="status">
          {derived.problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold">{derived.rows.length} colleges</span>
            <span className="text-muted-foreground">
              {" "}
              · {b.reach} Reach · {b.target} Target · {b.likely} Likely
            </span>
          </p>
          {anyAuto && (
            <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Sparkles className="size-3.5" /> = sorted for {who === "you" ? "you" : who}; tap to change
            </p>
          )}
        </div>
        <ul className="divide-y">
          {rows.map((r) => (
            <ListRow
              key={r.school.id}
              row={r}
              open={open === r.school.id}
              onOpen={() => setOpen(open === r.school.id ? null : r.school.id)}
              onDream={() => onState((s) => ({ ...s, dream: s.dream === r.school.id ? null : r.school.id }))}
              onFit={(f) => onState((s) => ({ ...s, fits: { ...s.fits, [r.school.id]: f } }))}
              onFitReset={() => onState((s) => ({ ...s, fits: Object.fromEntries(Object.entries(s.fits).filter(([k]) => k !== r.school.id)) }))}
              onRound={(round) => onState((s) => ({ ...s, rounds: { ...s.rounds, [r.school.id]: round } }))}
              onRoundReset={() => onState((s) => ({ ...s, rounds: Object.fromEntries(Object.entries(s.rounds).filter(([k]) => k !== r.school.id)) }))}
              today={today}
            />
          ))}
        </ul>
        {b.likely < 2 && <p className="border-t px-4 py-3 text-sm text-muted-foreground">Counselors suggest at least two Likely colleges {who === "you" ? "you'd" : `${kid.name}'d`} be happy to attend.</p>}
      </section>

      {derived.edTwo && (
        <p className="rounded-2xl bg-muted/60 px-4 py-3 text-sm">
          <span className="font-semibold">A second early shot, if you want one:</span> {derived.edTwo.name} has an ED II round
          {derived.edTwo.dates.ed2.closing ? ` (due ${dayLabel(derived.edTwo.dates.ed2.closing.iso)})` : ""}, after your Dream answers. It&apos;s binding too.{" "}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onState((s) => ({ ...s, rounds: { ...s.rounds, [derived.edTwo!.id]: "ed2" } }))}>
            Use ED II there
          </button>
        </p>
      )}

      {derived.retake && (
        <button type="button" onClick={onScores} className="flex w-full items-start gap-3 rounded-3xl border bg-card p-4 text-left hover:bg-muted/50">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pop text-pop-foreground">
            <TrendingUp className="size-5" />
          </span>
          <span className="text-sm">
            <span className="block font-semibold">
              {derived.retake.delta} more {TEST_LABEL[derived.retake.kind]} points would move{" "}
              {derived.retake.moves.length === 1
                ? `${derived.rows.find((r) => r.school.id === derived.retake!.moves[0].id)?.school.name} up to ${FIT_LABEL[derived.retake.moves[0].to]}.`
                : `${derived.retake.moves.length} colleges up a group.`}
            </span>
            <span className="text-muted-foreground">See which ones and the next test dates →</span>
          </span>
        </button>
      )}
    </div>
  );
}

function ListRow({
  row,
  open,
  onOpen,
  onDream,
  onFit,
  onFitReset,
  onRound,
  onRoundReset,
  today,
}: {
  row: Row;
  open: boolean;
  onOpen: () => void;
  onDream: () => void;
  onFit: (f: Fit) => void;
  onFitReset: () => void;
  onRound: (r: ListRound) => void;
  onRoundReset: () => void;
  today: string;
}) {
  const { school, fit, round, deadline } = row;
  const past = deadline && deadline.iso < today;
  return (
    <li>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_7rem_auto]">
        <button type="button" onClick={onDream} aria-pressed={row.dream} aria-label={row.dream ? "Your Dream (tap to unmark)" : "Mark as your Dream"} className="flex size-9 items-center justify-center rounded-full hover:bg-muted">
          <Heart className={cn("size-5", row.dream ? "fill-rose-500 text-rose-500" : "text-muted-foreground/60")} />
        </button>
        <div className="min-w-0">
          <CollegeChip school={{ unit_id: school.id, name: school.name, brand: school.brand }} size="sm" link />
          {row.dream && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">Dream</p>}
        </div>

        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:contents">
          {fit ? (
            <button
              type="button"
              onClick={() => onFit(NEXT_FIT[fit])}
              title="Tap to change"
              className={cn("inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-bold", FIT_CLASS[fit])}
            >
              {row.fitAuto && <Sparkles className="size-3" aria-label="sorted for you" />}
              {FIT_LABEL[fit]}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Add a number</span>
          )}

          <label className="relative inline-flex h-8 items-center">
            <span className="sr-only">Round at {school.name}</span>
            <span
              className={cn("pointer-events-none absolute left-2.5 size-2.5 rounded-full", STRIPED.has(round) && "ring-2 ring-offset-1 ring-offset-card")}
              style={{ background: ROUND_VAR[round], ...(STRIPED.has(round) ? { ["--tw-ring-color" as string]: ROUND_VAR[round] } : {}) }}
            />
            <select
              value={round}
              onChange={(e) => onRound(e.target.value as ListRound)}
              className={cn("h-8 appearance-none rounded-full border bg-background pl-7 text-xs font-bold", row.roundAuto ? "pr-11" : "pr-7")}
            >
              {row.pickable.map((r) => (
                <option key={r} value={r}>
                  {ROUND_SHORT[r]}
                </option>
              ))}
            </select>
            {row.roundAuto && <Sparkles className="pointer-events-none absolute right-6 size-3 text-muted-foreground" aria-label="started for you" />}
            <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" />
          </label>

          <span className={cn("text-sm font-semibold tabular-nums sm:text-right", past && "text-muted-foreground line-through")}>
            {deadline ? (
              <span className="inline-flex items-center gap-1">
                {dayLabel(deadline.iso)}
                <SourceTip cited={deadline.cite} />
              </span>
            ) : (
              <span className="text-xs font-normal text-muted-foreground">no date on record</span>
            )}
          </span>

          <button type="button" onClick={onOpen} aria-expanded={open} aria-label={`Why, for ${school.name}`} className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <Info className="size-4" />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-2 bg-muted/40 px-4 py-3 pl-16 text-sm">
          <p>
            <span className="font-semibold">{fit ? FIT_LABEL[fit] : "No group yet"}:</span>{" "}
            {row.fitAuto ? row.standing.reasons.join(" ") || "Add a GPA or a score to sort this one." : "You picked this group."}
            {row.fitAuto && row.standing.gpaNote?.cite && school.cites.gpa && (
              <InfoTip term={row.standing.gpaNote.cite === "derived.gpa_estimate" ? "gpa-estimate" : "high-school-gpa"} cited={school.cites.gpa} className="ml-1 align-middle" />
            )}{" "}
            {!row.fitAuto && (
              <button type="button" onClick={onFitReset} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                <RotateCcw className="size-3" /> Use the suggestion
              </button>
            )}
          </p>
          <p>
            <span className="font-semibold">{ROUND_NAME[round]}:</span> {row.roundWhy}{" "}
            {!row.roundAuto && (
              <button type="button" onClick={onRoundReset} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                <RotateCcw className="size-3" /> Use the starting round
              </button>
            )}
          </p>
          {row.decision && <p className="text-muted-foreground">Decision expected around {dayLabel(row.decision.iso)}.</p>}
          {row.moveUp && (
            <p className="text-muted-foreground">
              A {row.moveUp.score} would make this a {FIT_LABEL[row.moveUp.to]}.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
