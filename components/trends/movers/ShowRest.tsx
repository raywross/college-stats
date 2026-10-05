"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * "Show 25" for a movers list (specs/trends/top-10-lists.md): the rows past the tenth stay in the server HTML,
 * hidden until asked for, so the list extends in place without a fetch or a layout shift on load.
 */
export function ShowRest({ count, total, children }: { count: number; total: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <>
      <div hidden={!open}>{children}</div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold text-primary hover:underline"
      >
        {open ? (
          <>
            Show fewer <ChevronUp className="size-3.5" aria-hidden />
          </>
        ) : (
          <>
            Show {total} <ChevronDown className="size-3.5" aria-hidden />
          </>
        )}
      </button>
    </>
  );
}
