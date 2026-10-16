"use client";

/**
 * One recommender (specs/planner/v3/guides/recommenders.md "Your teachers"): collapsed it's a rank, a name ·
 * subject · year line, the status control, and an edit toggle; open, the name, subject (picked from the course list
 * or typed), and years (9th–12th chips) are editable. The status control shows only the next step(s) available from
 * where the entry is (`setStatus`'s one-way ladder): Thinking offers Asked and Agreed; Asked offers Agreed; Agreed
 * offers Invited only once `canInvite` (senior fall on); Invited is terminal, with a small reset back to Thinking.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Chip, FieldLabel } from "@/components/activities/chips";
import { dayLabel } from "@/lib/planner/tasks";
import { yearsLabel } from "@/lib/planner/recommenders";
import type { RecommenderEntry, RecommenderStatus } from "@/lib/student-profile";
import { RECOMMENDER_NAME_MAX } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

const HS_YEARS = [9, 10, 11, 12] as const;
const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 disabled:opacity-60";

function statusLine(entry: RecommenderEntry, today: string): string {
  switch (entry.status) {
    case "thinking":
      return "Thinking";
    case "asked":
      return entry.askedOn ? `Asked ${dayLabel(entry.askedOn, today)}` : "Asked";
    case "agreed":
      return entry.agreedOn ? `Agreed ${dayLabel(entry.agreedOn, today)}` : "Agreed";
    case "invited":
      return entry.invitedOn ? `Invited ${dayLabel(entry.invitedOn, today)}` : "Invited";
  }
}

export function RecommenderRow({
  entry,
  subjects,
  today,
  canInvite,
  editable,
  isFirst,
  isLast,
  onMove,
  onChange,
  onRemove,
  onStatus,
}: {
  entry: RecommenderEntry;
  /** Subject picks from the course list (`subjectsFrom`), for the typed-or-picked chip row. */
  subjects: readonly string[];
  today: string;
  /** Senior fall on: the Invited button shows. */
  canInvite: boolean;
  editable: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onChange: (next: RecommenderEntry) => void;
  onRemove: () => void;
  onStatus: (status: RecommenderStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = [entry.subject, yearsLabel(entry.years)].filter(Boolean).join(" · ");

  return (
    <li className="rounded-2xl border bg-card p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={isFirst}
              aria-label={`Move ${entry.name || "this teacher"} up`}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronUp className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={isLast}
              aria-label={`Move ${entry.name || "this teacher"} down`}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronDown className="size-4" aria-hidden />
            </button>
          </div>
        )}

        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-h-11 min-w-0 flex-1 rounded-xl py-1 text-left">
          <span className="font-semibold">{entry.name || "Untitled"}</span>
          {summary && <span className="text-muted-foreground"> · {summary}</span>}
        </button>

        {editable ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {entry.status === "thinking" && (
              <>
                <button type="button" onClick={() => onStatus("asked")} className="min-h-9 rounded-full border px-3 text-sm font-semibold hover:bg-muted">
                  Asked
                </button>
                <button type="button" onClick={() => onStatus("agreed")} className="min-h-9 rounded-full border px-3 text-sm font-semibold hover:bg-muted">
                  Agreed
                </button>
              </>
            )}
            {entry.status === "asked" && (
              <>
                <span className="text-sm text-muted-foreground">{statusLine(entry, today)}</span>
                <button type="button" onClick={() => onStatus("agreed")} className="min-h-9 rounded-full border px-3 text-sm font-semibold hover:bg-muted">
                  Agreed
                </button>
              </>
            )}
            {entry.status === "agreed" && (
              <>
                <span className="text-sm text-muted-foreground">{statusLine(entry, today)}</span>
                {canInvite && (
                  <button type="button" onClick={() => onStatus("invited")} className="min-h-9 rounded-full border px-3 text-sm font-semibold hover:bg-muted">
                    Invited
                  </button>
                )}
              </>
            )}
            {entry.status === "invited" && <span className="text-sm text-muted-foreground">{statusLine(entry, today)}</span>}
          </div>
        ) : (
          <span className="shrink-0 text-sm text-muted-foreground">{statusLine(entry, today)}</span>
        )}

        {editable && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Edit ${entry.name || "this teacher"}`} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            ✎
          </button>
        )}
      </div>

      {open && editable && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <label className="block space-y-1.5">
            <FieldLabel>Name</FieldLabel>
            <input
              type="text"
              value={entry.name}
              maxLength={RECOMMENDER_NAME_MAX}
              onChange={(e) => onChange({ ...entry, name: e.currentTarget.value })}
              className={inputCls}
            />
          </label>

          <div className="space-y-1.5">
            <FieldLabel>Subject</FieldLabel>
            {subjects.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Subject">
                {subjects.map((s) => (
                  <Chip key={s} selected={entry.subject === s} onClick={() => onChange({ ...entry, subject: entry.subject === s ? null : s })}>
                    {s}
                  </Chip>
                ))}
              </div>
            )}
            <input
              type="text"
              value={entry.subject && !subjects.includes(entry.subject) ? entry.subject : ""}
              placeholder="Or type the subject"
              maxLength={60}
              onChange={(e) => onChange({ ...entry, subject: e.currentTarget.value || null })}
              className={cn(inputCls, "mt-1.5")}
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel>Which year</FieldLabel>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which year">
              {HS_YEARS.map((y) => {
                const selected = entry.years.includes(y);
                return (
                  <Chip
                    key={y}
                    role="checkbox"
                    selected={selected}
                    onClick={() => onChange({ ...entry, years: selected ? entry.years.filter((v) => v !== y) : [...entry.years, y].sort((a, b) => a - b) })}
                  >
                    {YEAR_CHIP[y]}
                  </Chip>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            {entry.status !== "thinking" ? (
              <button type="button" onClick={() => onStatus("thinking")} className="text-sm font-semibold text-muted-foreground underline-offset-2 hover:underline">
                Not asked after all
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${entry.name || "this teacher"}`}
                className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80"
              >
                <X className="size-4" aria-hidden />
              </button>
              <button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

const YEAR_CHIP: Record<9 | 10 | 11 | 12, string> = { 9: "9th", 10: "10th", 11: "11th", 12: "12th" };

export default RecommenderRow;
