"use client";

import { useState } from "react";
import { AWARDS_MAX } from "@/lib/chances/levels";
import { allAwards } from "@/lib/chances/awards-catalog";
import type { AwardEntry, HsYear, RecognitionTier } from "@/lib/chances/types";
import { AWARD_NAME_MAX, sanitizeAwards } from "@/lib/student-profile";

const YEARS: HsYear[] = [9, 10, 11, 12];
const YEAR_LABELS: Record<HsYear, string> = { 9: "9th", 10: "10th", 11: "11th", 12: "12th" };
/** The same four tiers as the activities recognition picker (depth.md "The reading"). */
const TIER_OPTIONS: { value: RecognitionTier; label: string; examples: string }[] = [
  { value: 1, label: "National or international", examples: "a national award, a published paper, a national-level team" },
  { value: 2, label: "State or regional", examples: "all-state, state champion, a state science fair place, a regional competition win" },
  { value: 3, label: "School-level distinction", examples: "varsity letter, a school award, a lead role" },
  { value: 4, label: "Took part", examples: "" },
];
const SOMETHING_ELSE = "__other__";

let nextId = 1;
function blankAward(): AwardEntry {
  return { id: `new-${nextId++}`, key: null, name: "", tier: 4, year: null };
}

const catalog = allAwards();

function AwardRow({ value, onChange, onRemove, disabled }: { value: AwardEntry; onChange: (next: AwardEntry) => void; onRemove: () => void; disabled?: boolean }) {
  const pickedKey = value.key ?? SOMETHING_ELSE;
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <select
          value={pickedKey}
          disabled={disabled}
          onChange={(e) => {
            if (e.currentTarget.value === SOMETHING_ELSE) {
              onChange({ ...value, key: null, name: value.key ? "" : value.name, tier: value.key ? 4 : value.tier });
              return;
            }
            const entry = catalog.find((a) => a.key === e.currentTarget.value);
            if (entry) onChange({ ...value, key: entry.key, name: entry.name, tier: entry.tier });
          }}
          className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3.5 text-base outline-none dark:bg-input/30 disabled:opacity-60"
          aria-label="Award"
        >
          <option value={SOMETHING_ELSE}>Something else…</option>
          {catalog.map((a) => (
            <option key={a.key} value={a.key}>
              {a.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={onRemove} disabled={disabled} className="h-11 shrink-0 rounded-xl border px-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50">
          Remove
        </button>
      </div>
      {value.key === null && (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            placeholder="Award name"
            maxLength={AWARD_NAME_MAX}
            disabled={disabled}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.currentTarget.value })}
            className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none dark:bg-input/30 disabled:opacity-60"
          />
          <div className="flex flex-col gap-1">
            {TIER_OPTIONS.map((t) => (
              <label key={t.value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`tier-${value.id}`}
                  disabled={disabled}
                  checked={value.tier === t.value}
                  onChange={() => onChange({ ...value, tier: t.value })}
                  className="mt-0.5 size-4"
                />
                <span>
                  <span className="font-medium">{t.label}</span>
                  {t.examples && <span className="text-muted-foreground"> — {t.examples}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        Year (optional)
        <select
          value={value.year ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, year: e.currentTarget.value === "" ? null : (Number(e.currentTarget.value) as HsYear) })}
          className="h-9 rounded-lg border border-input bg-background px-2 text-base outline-none dark:bg-input/30 disabled:opacity-60"
        >
          <option value="">Not set</option>
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {YEAR_LABELS[y]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * The awards list (inputs-beyond-academics.md "Awards"): pick from the reviewed catalog (its tier comes along), or
 * "Something else" with a typed name and the same tier picker as activities. At most AWARDS_MAX entries. Controlled:
 * posts the whole list as a hidden "awards" JSON field, like `ActivitiesForm` posts "activities".
 */
export function AwardsForm({ awards, disabled }: { awards: AwardEntry[]; disabled?: boolean }) {
  const [value, setValue] = useState<AwardEntry[]>(() => sanitizeAwards(awards));

  const update = (id: string, next: AwardEntry) => setValue((v) => v.map((a) => (a.id === id ? next : a)));
  const remove = (id: string) => setValue((v) => v.filter((a) => a.id !== id));
  const add = () => setValue((v) => (v.length >= AWARDS_MAX ? v : [...v, blankAward()]));

  return (
    <div className="sm:col-span-2">
      <span className="block text-sm font-semibold">Awards (optional, up to {AWARDS_MAX})</span>
      <p className="mb-2 mt-0.5 text-xs text-muted-foreground">Pick it from the list so the tier is consistent; not listed? Add it as &quot;Something else.&quot;</p>
      <div className="space-y-3">
        {value.map((a) => (
          <AwardRow key={a.id} value={a} onChange={(next) => update(a.id, next)} onRemove={() => remove(a.id)} disabled={disabled} />
        ))}
      </div>
      {value.length < AWARDS_MAX && (
        <button type="button" onClick={add} disabled={disabled} className="mt-2 inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50">
          + Add an award
        </button>
      )}
      <input type="hidden" name="awards" value={JSON.stringify(value)} />
    </div>
  );
}
