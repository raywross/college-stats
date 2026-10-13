"use client";
/**
 * The chip used across the activity cards (components/activities/*): the AP step's chip (ApCourseCard), 40px tall so
 * it's an easy tap on a phone. Selected reads as a filled pill.
 */
import { cn } from "@/lib/utils";

export function Chip({
  selected,
  onClick,
  children,
  disabled,
  role = "radio",
  className,
  ariaLabel,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  /** "radio" in a single-pick group, "checkbox" for a toggle. */
  role?: "radio" | "checkbox";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full border px-3.5 text-sm font-semibold disabled:opacity-50",
        selected ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A small label above a chip row. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-muted-foreground">{children}</p>;
}
