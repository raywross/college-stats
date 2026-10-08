"use client";

import { Check, Plus } from "lucide-react";
import { MAX_COMPARE, toggleCompare, useCompareIds } from "@/lib/compare";
import { cn } from "@/lib/utils";
import posthog from "posthog-js";

export function CompareButton({
  id,
  variant = "pill",
  className,
}: {
  id: string;
  variant?: "pill" | "icon" | "large";
  className?: string;
}) {
  const ids = useCompareIds();
  const active = ids.includes(id);
  const full = !active && ids.length >= MAX_COMPARE;
  const label = active ? "Added to compare" : full ? `Compare is full (${MAX_COMPARE})` : "Add to compare";

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={full}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const compareIds = toggleCompare(id);
        posthog.capture(active ? "compare_school_removed" : "compare_school_added", {
          compare_count: compareIds.length,
        });
      }}
      className={cn(
        "relative z-20 inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold transition-all outline-none select-none",
        "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95",
        variant === "icon" && "size-8 rounded-full border",
        variant === "pill" && "h-8 rounded-full border px-3 text-xs",
        variant === "large" && "h-10 rounded-full border px-2.5 text-xs whitespace-nowrap sm:px-4 sm:text-sm",
        active
          ? "border-transparent bg-pop text-pop-foreground shadow-sm"
          : "border-border bg-card text-foreground hover:border-primary/40 hover:text-primary",
        className
      )}
    >
      {active ? (
        <Check className={cn(variant === "large" ? "size-3.5 sm:size-4" : "size-3.5")} strokeWidth={3} />
      ) : (
        <Plus className={cn(variant === "large" ? "size-3.5 sm:size-4" : "size-3.5")} strokeWidth={2.5} />
      )}
      {variant !== "icon" && <span>{active ? "Comparing" : "Compare"}</span>}
    </button>
  );
}
