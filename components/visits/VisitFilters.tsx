"use client";
/**
 * The kind chips and travel-calendar state select (specs/product/visit-events.md "Display": Campus tours · Sessions
 * · Near you · Online · Everything). URL-free state: the caller owns the selection and passes it back down, so this
 * works both on the college page's in-place expansion and on /me/visits. Phones: chips scroll (specs/mobile.md).
 */
import { VISIT_CHIPS, type VisitChipKey } from "@/lib/visit-events/view";

export function VisitFilters({
  value,
  onChange,
  states,
  stateValue,
  onStateChange,
  counts,
}: {
  value: VisitChipKey;
  onChange: (chip: VisitChipKey) => void;
  /** States with at least one travel-calendar event, for the state select shown once "Near you" is picked. */
  states?: string[];
  stateValue?: string | null;
  onStateChange?: (state: string | null) => void;
  counts?: Partial<Record<VisitChipKey, number>>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="no-scrollbar flex items-center gap-2 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 sm:flex-wrap [&>*]:shrink-0">
        {VISIT_CHIPS.map((chip) => {
          const count = counts?.[chip.key];
          const disabled = count === 0;
          const active = value === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(chip.key)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
                active ? "bg-foreground text-background" : "border bg-card text-foreground/80 hover:border-primary/40 hover:text-primary"
              } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
            >
              {chip.label}
              {count != null && <span className="tabular-nums opacity-70">{count}</span>}
            </button>
          );
        })}
      </div>
      {value === "travel" && states && states.length > 0 && onStateChange && (
        <select
          value={stateValue ?? ""}
          onChange={(e) => onStateChange(e.target.value || null)}
          aria-label="Filter by state"
          className="h-8 rounded-full border bg-card px-3 text-xs font-semibold"
        >
          <option value="">Every state</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
