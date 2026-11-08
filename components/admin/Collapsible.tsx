"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

/** Below `md`: a panel's body collapses to its first line with a Show/Hide control (FieldEditor's `usePhone`, widened to `md`). */
const BELOW_MD = "(max-width: 767px)";
function subscribeBelowMd(onChange: () => void) {
  const mq = window.matchMedia(BELOW_MD);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const useBelowMd = () => useSyncExternalStore(subscribeBelowMd, () => window.matchMedia(BELOW_MD).matches, () => false);

/**
 * Wraps a panel's body (specs/product/admin-redesign.md "Phones"): open by default from `md` (no `details` chrome
 * shown there at all), collapsed to `firstLine` with "Show" below `md`. The body stays in the server HTML either way
 * (a native `<details>`, not unmounted), so nothing shifts on hydration and the server-rendered page still has it.
 */
export function Collapsible({ firstLine, children }: { firstLine: ReactNode; children: ReactNode }) {
  const belowMd = useBelowMd();
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? !belowMd;
  return (
    <details open={open} onToggle={(e) => setToggled(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 py-1 text-sm font-medium md:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">{firstLine}</span>
        <span className="shrink-0 font-semibold text-primary">{open ? "Hide" : "Show"}</span>
      </summary>
      <div className="md:mt-0">{children}</div>
    </details>
  );
}
