"use client";
/**
 * One activity card (specs/planner/redesign/intake.md "Activities, four steps"), modeled on the AP step's course card:
 * collapsed it shows the name and a summary pill ("3 years · Captain"); open it shows, in order, the name (editable),
 * the family pick for a typed club or the type pick for work and other entries, the years with a title per year, hours
 * a week, recognition, and "connected to my major". Nothing on it is required. Used by the intake's activity steps and
 * `/me` (components/me/ActivitiesForm.tsx).
 */
import { useState } from "react";
import { X } from "lucide-react";
import { Chip, FieldLabel } from "@/components/activities/chips";
import { YearTitles } from "@/components/activities/YearTitles";
import {
  activitySummary,
  asksFamily,
  CLUB_FAMILY_PICKS,
  hoursHint,
  OTHER_TYPES,
  otherTypeOf,
  parseHours,
  recognitionChoices,
  setClubFamily,
  setOtherType,
  setWorkType,
  WORK_TYPES,
  workTypeOf,
  type ActivityStep,
} from "@/lib/planner/activity-steps";
import type { ActivityEntry } from "@/lib/chances/types";
import { cn } from "@/lib/utils";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 disabled:opacity-60";

export function ActivityCard({
  value,
  step,
  classYear,
  open,
  onToggleOpen,
  onChange,
  onRemove,
  disabled,
}: {
  value: ActivityEntry;
  step: ActivityStep;
  classYear: number | null;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (next: ActivityEntry) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const summary = activitySummary(value);
  const [hours, setHours] = useState(value.hoursPerWeek === null ? "" : String(value.hoursPerWeek));
  const hint = hoursHint(hours);
  const recognition = recognitionChoices(step);
  const picked = recognition.find((r) => r.tier === value.recognition) ?? null;
  const displayName = value.name.trim() || "Untitled";

  return (
    <div className={cn("rounded-2xl border bg-card p-3.5 sm:p-4", open && "border-primary")}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onToggleOpen} aria-expanded={open} className="min-h-11 min-w-0 flex-1 rounded-xl py-1 text-left font-semibold">
          <span className="line-clamp-2">{displayName}</span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleOpen}
            className={cn("inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold", summary.incomplete || value.years.length === 0 ? "bg-pop text-pop-foreground" : "bg-muted text-foreground")}
          >
            {summary.text}
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove ${displayName}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-4 border-t pt-3">
          <label className="block space-y-1.5">
            <FieldLabel>{step === "work" ? "Employer or role" : "Name"}</FieldLabel>
            <input
              type="text"
              value={value.name}
              maxLength={60}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, name: e.currentTarget.value })}
              className={inputCls}
            />
          </label>

          {asksFamily(value) && (
            <div className="space-y-1.5">
              <FieldLabel>What&apos;s it about?</FieldLabel>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What it's about">
                {CLUB_FAMILY_PICKS.map((f) => (
                  <Chip key={f.family} selected={value.family === f.family} disabled={disabled} onClick={() => onChange(setClubFamily(value, value.family === f.family ? null : f.family))}>
                    {f.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {step === "work" && (
            <div className="space-y-1.5">
              <FieldLabel>What kind?</FieldLabel>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What kind">
                {WORK_TYPES.map((t) => (
                  <Chip key={t.type} selected={workTypeOf(value) === t.type} disabled={disabled} onClick={() => onChange(setWorkType(value, t.type))}>
                    {t.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {step === "other" && (
            <div className="space-y-1.5">
              <FieldLabel>What kind?</FieldLabel>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What kind">
                {OTHER_TYPES.map((t) => (
                  <Chip key={t.type} selected={otherTypeOf(value) === t.type} disabled={disabled} onClick={() => onChange(setOtherType(value, t.type))}>
                    {t.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <YearTitles value={value} classYear={classYear} onChange={onChange} disabled={disabled} titleLabel={step === "sports" ? "Level" : step === "work" ? "Role" : "Title"} />

          <label className="block space-y-1.5">
            <FieldLabel>{step === "sports" ? "Hours a week in season" : "Hours a week"} (optional)</FieldLabel>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={hours}
              disabled={disabled}
              placeholder="e.g. 10"
              onChange={(e) => {
                const s = e.currentTarget.value;
                setHours(s);
                onChange({ ...value, hoursPerWeek: parseHours(s) });
              }}
              className={cn(inputCls, "w-28")}
            />
            {hint && <span className="block text-xs text-amber-700 dark:text-amber-400">{hint}</span>}
          </label>

          {recognition.length > 0 && (
            <div className="space-y-1.5">
              <FieldLabel>Recognition (optional)</FieldLabel>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Recognition">
                <Chip selected={picked === null} disabled={disabled} onClick={() => onChange({ ...value, recognition: null })}>
                  None
                </Chip>
                {recognition.map((r) => (
                  <Chip key={r.tier} selected={picked?.tier === r.tier} disabled={disabled} onClick={() => onChange({ ...value, recognition: r.tier })}>
                    {r.label}
                  </Chip>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{picked ? `For example: ${picked.example}.` : `Your highest, if any: ${recognition.map((r) => r.example.split(",")[0]).join(", ")}.`}</p>
            </div>
          )}

          {step !== "sports" && (
            <label className="flex min-h-11 items-center gap-2.5 text-sm">
              <input type="checkbox" disabled={disabled} checked={value.relatedToMajor} onChange={(e) => onChange({ ...value, relatedToMajor: e.currentTarget.checked })} className="size-5" />
              Connected to the major I want to study
            </label>
          )}

          <div className="flex justify-end">
            <button type="button" onClick={onToggleOpen} className="min-h-10 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
