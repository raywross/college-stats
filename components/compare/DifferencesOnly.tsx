"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The "Differences only" switch over a comparison table (NN/g's "highlight differences"; specs/compare-redesign.md):
 * on, rows marked `data-same` (every college shows the same value, or only one reports it) are hidden by the
 * `[data-differences-only="true"] tr[data-same]` rule in app/globals.css. Off by default; the rows stay in the HTML.
 */
export function DifferencesOnly({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <button type="button" role="switch" aria-checked={on} onClick={() => setOn((v) => !v)} className="group inline-flex items-center gap-2.5 text-sm font-semibold">
          <span className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")}>
            <span className={cn("absolute left-0.5 size-4 rounded-full bg-background shadow transition-transform", on && "translate-x-4")} />
          </span>
          Differences only
        </button>
        <p className="text-xs text-muted-foreground">
          {on ? "Hiding rows where these colleges match or only one reports." : "Every row, including ones where these colleges match."}
        </p>
      </div>
      <div data-differences-only={on ? "true" : undefined}>{children}</div>
    </div>
  );
}
