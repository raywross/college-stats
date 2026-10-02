"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Disclosure for deep-dive content on small screens (specs/mobile.md). Below `until` (`sm` by default: phones; `lg`
 * folds tablets too) the children start hidden behind a "Show …" button; wider screens always show them. The
 * children are in the server HTML either way (and hidden with CSS, not unmounted), so nothing shifts on load and
 * citations stay in the page.
 */
export function ShowMore({
  label,
  hint,
  children,
  className,
  until = "sm",
  id,
}: {
  /** Button text, e.g. "Show the aid breakdown". */
  label: string;
  /** One line under the label saying what's inside. */
  hint?: string;
  children: ReactNode;
  className?: string;
  /** The breakpoint from which the children always show. */
  until?: "sm" | "lg";
  /** Id for the content wrapper (an "On this page" target); the button carries `{id}-toggle`. */
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const fold = until === "lg" ? { button: "lg:hidden", hidden: "max-lg:hidden" } : { button: "sm:hidden", hidden: "max-sm:hidden" };
  return (
    <>
      {!open && (
        <button
          type="button"
          id={id ? `${id}-toggle` : undefined}
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className={cn(
            "flex w-full items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-4 py-3 text-left transition-colors active:bg-muted",
            fold.button,
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
      <div id={id} className={cn(!open && fold.hidden, className)}>
        {children}
      </div>
    </>
  );
}
