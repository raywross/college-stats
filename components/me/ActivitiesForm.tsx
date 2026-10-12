"use client";

import { useState } from "react";
import { ACTIVITIES_MAX } from "@/lib/chances/levels";
import type { ActivityEntry, ActivityKind, ActivityRole, HsYear, RecognitionTier } from "@/lib/chances/types";
import { ACTIVITY_NAME_MAX, sanitizeActivities } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<ActivityKind, string> = {
  sport: "Sport",
  club: "Club",
  arts: "Arts",
  service: "Service",
  work: "Work",
  research: "Research",
  family: "Family responsibilities",
  other: "Other",
};
const KINDS = Object.keys(KIND_LABELS) as ActivityKind[];
const YEARS: HsYear[] = [9, 10, 11, 12];
const YEAR_LABELS: Record<HsYear, string> = { 9: "9th", 10: "10th", 11: "11th", 12: "12th" };
/** member -> officer -> leader -> off, tapping a year chip (depth.md "What the student enters"). */
const ROLE_CYCLE: (ActivityRole | null)[] = ["member", "officer", "leader", null];
const ROLE_LABELS: Record<ActivityRole, string> = { member: "Member", officer: "Officer", leader: "Leader" };

/** The same four tiers as the awards picker (inputs-beyond-academics.md "Awards"). */
const RECOGNITION_TIERS: { value: RecognitionTier; label: string; examples: string }[] = [
  { value: 1, label: "National or international", examples: "a national award, a published paper, a national-level team" },
  { value: 2, label: "State or regional", examples: "all-state, state champion, a state science fair place, a regional competition win" },
  { value: 3, label: "School-level distinction", examples: "varsity letter, a school award, a lead role" },
  { value: 4, label: "Took part", examples: "" },
];

let nextId = 1;
/** A fresh, empty row (exported so the intake's "More about you" step, components/planner/intake/MoreAboutYouStep.tsx, can add rows the same way). */
export function blankActivity(): ActivityEntry {
  return { id: `new-${nextId++}`, name: "", kind: "club", years: [], roles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false };
}

function nextRole(current: ActivityRole | undefined): ActivityRole | null {
  const idx = ROLE_CYCLE.indexOf(current ?? "member");
  return ROLE_CYCLE[(idx + 1) % ROLE_CYCLE.length];
}

function YearChip({ year, role, onCycle, disabled }: { year: HsYear; role: ActivityRole | undefined; onCycle: () => void; disabled?: boolean }) {
  const on = role !== undefined;
  return (
    <button
      type="button"
      onClick={onCycle}
      disabled={disabled}
      aria-pressed={on}
      className={cn(
        "inline-flex min-h-10 min-w-16 flex-col items-center justify-center rounded-lg border px-2 py-1 text-xs leading-tight transition-colors disabled:opacity-50",
        on ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-background hover:bg-muted text-muted-foreground",
      )}
    >
      <span>{YEAR_LABELS[year]}</span>
      <span>{on ? ROLE_LABELS[role as ActivityRole] : "—"}</span>
    </button>
  );
}

/** One activity's fields (name, kind, hours, year/role chips, recognition, major checkbox). Exported for MoreAboutYouStep. */
export function ActivityRow({ value, onChange, onRemove, disabled }: { value: ActivityEntry; onChange: (next: ActivityEntry) => void; onRemove: () => void; disabled?: boolean }) {
  const cycleYear = (year: HsYear) => {
    const has = value.years.includes(year);
    const current = value.roles[year];
    const after = has ? nextRole(current) : "member";
    const years = after === null ? value.years.filter((y) => y !== year) : has ? value.years : [...value.years, year].sort((a, b) => a - b);
    const roles = { ...value.roles };
    if (after === null) delete roles[year];
    else roles[year] = after;
    onChange({ ...value, years, roles });
  };
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <input
          type="text"
          placeholder="Varsity soccer, Robotics club, …"
          maxLength={ACTIVITY_NAME_MAX}
          disabled={disabled}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.currentTarget.value })}
          className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 disabled:opacity-60"
        />
        <button type="button" onClick={onRemove} disabled={disabled} className="h-11 shrink-0 rounded-xl border px-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50">
          Remove
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={value.kind}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, kind: e.currentTarget.value as ActivityKind })}
          className="h-9 rounded-lg border border-input bg-background px-2 text-base outline-none dark:bg-input/30 disabled:opacity-60"
          aria-label="Kind"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Hours/week
          <input
            type="number"
            min={1}
            max={60}
            disabled={disabled}
            value={value.hoursPerWeek ?? ""}
            onChange={(e) => onChange({ ...value, hoursPerWeek: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}
            className="h-9 w-16 rounded-lg border border-input bg-background px-2 text-base outline-none dark:bg-input/30 disabled:opacity-60"
          />
        </label>
      </div>
      <div className="mt-2">
        <span className="block text-xs font-medium text-muted-foreground">Which years, and your role (tap to cycle member → officer → leader → off)</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {YEARS.map((y) => (
            <YearChip key={y} year={y} role={value.roles[y]} onCycle={() => cycleYear(y)} disabled={disabled} />
          ))}
        </div>
      </div>
      <div className="mt-2">
        <span className="block text-xs font-medium text-muted-foreground">Recognition (highest you&apos;ve received)</span>
        <div className="mt-1 flex flex-col gap-1">
          {RECOGNITION_TIERS.map((t) => (
            <label key={t.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`recognition-${value.id}`}
                disabled={disabled}
                checked={value.recognition === t.value}
                onChange={() => onChange({ ...value, recognition: t.value })}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="font-medium">{t.label}</span>
                {t.examples && <span className="text-muted-foreground"> — {t.examples}</span>}
              </span>
            </label>
          ))}
          {value.recognition !== null && (
            <button type="button" disabled={disabled} onClick={() => onChange({ ...value, recognition: null })} className="self-start text-xs text-muted-foreground underline">
              Clear
            </button>
          )}
        </div>
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={disabled} checked={value.relatedToMajor} onChange={(e) => onChange({ ...value, relatedToMajor: e.currentTarget.checked })} className="size-4" />
        This is connected to the major I want to study
      </label>
    </div>
  );
}

/**
 * The activities list (depth.md "What the student enters"): at most ACTIVITIES_MAX entries, each with years and a
 * role per year, hours, a recognition pick, and whether it's connected to the intended major. Controlled: posts the
 * whole list as a hidden "activities" JSON field, the same way `CoursePickerField` posts "courses".
 */
export function ActivitiesForm({ activities, disabled }: { activities: ActivityEntry[]; disabled?: boolean }) {
  const [value, setValue] = useState<ActivityEntry[]>(() => sanitizeActivities(activities));

  const update = (id: string, next: ActivityEntry) => setValue((v) => v.map((a) => (a.id === id ? next : a)));
  const remove = (id: string) => setValue((v) => v.filter((a) => a.id !== id));
  const add = () => setValue((v) => (v.length >= ACTIVITIES_MAX ? v : [...v, blankActivity()]));

  return (
    <div className="sm:col-span-2">
      <span className="block text-sm font-semibold">Activities (optional, up to {ACTIVITIES_MAX})</span>
      <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
        Colleges that read activities look for a few things done for years, with a role. Add your two or three biggest.
      </p>
      <div className="space-y-3">
        {value.map((a) => (
          <ActivityRow key={a.id} value={a} onChange={(next) => update(a.id, next)} onRemove={() => remove(a.id)} disabled={disabled} />
        ))}
      </div>
      {value.length < ACTIVITIES_MAX && (
        <button type="button" onClick={add} disabled={disabled} className="mt-2 inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50">
          + Add an activity
        </button>
      )}
      <input type="hidden" name="activities" value={JSON.stringify(value)} />
    </div>
  );
}
