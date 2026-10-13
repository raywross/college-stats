"use client";
/**
 * "Which years?" on an activity card (specs/planner/redesign/intake.md "Activities, four steps"): four one-tap year
 * chips, then for each checked year a row of title chips (JV · Varsity · Captain for a sport; Member · Vice President ·
 * President · Founder for a club), the rarer titles behind "More". A newly checked year starts with the nearest year's
 * title (lib/planner/activity-steps.ts toggleYear).
 */
import { useState } from "react";
import { Chip, FieldLabel } from "@/components/activities/chips";
import { setYearTitle, titleChoices, toggleYear, yearChips, yearTitle } from "@/lib/planner/activity-steps";
import type { ActivityEntry, HsYear } from "@/lib/chances/types";
import { cn } from "@/lib/utils";

export function YearTitles({
  value,
  classYear,
  onChange,
  disabled,
  titleLabel = "Title",
}: {
  value: ActivityEntry;
  classYear: number | null;
  onChange: (next: ActivityEntry) => void;
  disabled?: boolean;
  /** What the title rows are called on this card ("Level" for a sport). */
  titleLabel?: string;
}) {
  const [moreFor, setMoreFor] = useState<HsYear | null>(null);
  const chips = yearChips(classYear);
  const { primary, more } = titleChoices(value.kind);

  return (
    <div className="space-y-2.5">
      <FieldLabel>Which years?</FieldLabel>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Which years">
        {chips.map((c) => {
          const on = value.years.includes(c.year);
          return (
            <button
              key={c.year}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(toggleYear(value, c.year))}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center rounded-xl border px-1 py-1 text-sm font-semibold disabled:opacity-50",
                on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {c.label}
              {c.sub && <span className={cn("text-[11px] font-normal", on ? "text-background/70" : "text-muted-foreground/80")}>{c.sub}</span>}
            </button>
          );
        })}
      </div>

      {value.years.length > 0 && primary.length > 1 && (
        <div className="space-y-2">
          <FieldLabel>{titleLabel} each year</FieldLabel>
          {value.years.map((y) => {
            const current = yearTitle(value, y);
            const showMore = moreFor === y || (current !== null && more.includes(current));
            const shown = showMore ? [...primary, ...more] : primary;
            return (
              <div key={y} className="flex items-start gap-2">
                <span className="w-10 shrink-0 pt-2.5 text-xs font-semibold text-muted-foreground">{chips.find((c) => c.year === y)?.label}</span>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5" role="radiogroup" aria-label={`${titleLabel}, ${chips.find((c) => c.year === y)?.label}`}>
                  {shown.map((t) => (
                    <Chip key={t} selected={current === t} disabled={disabled} onClick={() => onChange(setYearTitle(value, y, t))}>
                      {t}
                    </Chip>
                  ))}
                  {more.length > 0 && !showMore && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setMoreFor(y)}
                      className="min-h-10 rounded-full border border-dashed px-3.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
                    >
                      More…
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
