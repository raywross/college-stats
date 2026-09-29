"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Phone-only disclosure for deep-dive content (specs/mobile.md). Below `sm` the children start hidden behind a
 * "Show …" button; wider screens always show them. The children are in the server HTML either way (and hidden
 * with CSS, not unmounted), so nothing shifts on load and citations stay in the page.
 */
export function ShowMore({
  label,
  hint,
  children,
  className,
}: {
  /** Button text, e.g. "Show the aid breakdown". */
  label: string;
  /** One line under the label saying what's inside. */
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className={cn(
            "flex w-full items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-4 py-3 text-left transition-colors active:bg-muted sm:hidden",
            className
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-primary">{label}</span>
            {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
          </span>
          <ChevronDown className="size-5 shrink-0 text-muted-foreground" />
        </button>
      )}
      <div className={cn(!open && "max-sm:hidden", className)}>{children}</div>
    </>
  );
}
