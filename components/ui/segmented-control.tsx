"use client";

import Link from "next/link";
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

/**
 * The same pills as links between pages (a person's List | Numbers in the household hub, specs/product/household-hub.md
 * "Redesign (2026-10-06)"): the current page's pill is ink-filled and marked `aria-current="page"`. Full width with
 * 44px pills on phones (each option takes an equal share); its natural width from `sm`.
 */
export function SegmentedLinks({
  value,
  options,
  label,
  className,
}: {
  value: string;
  options: readonly { value: string; label: string; href: string }[];
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("flex rounded-full border bg-card p-0.5 text-sm font-semibold sm:inline-flex", className)}>
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          aria-current={value === o.value ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-5 whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-9 sm:flex-none",
            value === o.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
