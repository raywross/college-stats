"use client";

import { cn } from "@/lib/utils";

/**
 * A row of mutually exclusive options (radio group) styled as pills: the active one is ink-filled. The same look as the
 * profile's Over time controls. On phones, wrap it in an `overflow-x-auto` row when the options can outgrow the width
 * (specs/mobile.md).
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  /** Accessible name of the group ("Group colleges by"). */
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-full border bg-card p-0.5 text-xs font-semibold", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-3 py-1.5 whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            value === o.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
