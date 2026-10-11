"use client";

import Link from "next/link";
import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { KID_VARS } from "@/lib/planner/colors";
import { planHref } from "@/lib/planner/plan-tabs";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "plan:lastChild";

export interface SwitcherChild {
  studentId: string;
  name: string | null;
  gradYear: number | null;
  colorSlot: 0 | 1 | 2;
  /** The shortened summary line (lib/planner/plan-frame.ts shortSummaryLine). */
  summary: string;
}

/**
 * The child switcher (specs/planner/redesign/page.md "The child switcher"): one pill per child plus Everyone
 * (skipped when there's only one child), the selected pill filled, each pill's second line the child's shortened
 * summary. Remembers the last choice in `localStorage` (a per-viewer convenience only, never read by the server);
 * when the URL didn't name a child, this restores the last one chosen.
 */
export function ChildSwitcher({ kids, selected, forExplicit }: { kids: SwitcherChild[]; selected: string | null; forExplicit: boolean }) {
  useEffect(() => {
    if (forExplicit || kids.length <= 1) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!last || last === "everyone" || last === selected) return;
    if (kids.some((c) => c.studentId === last)) window.location.replace(planHref({ person: last }));
  }, [forExplicit, selected, kids]);

  if (kids.length === 0) return null;

  const remember = (id: string | null) => {
    try {
      localStorage.setItem(STORAGE_KEY, id ?? "everyone");
    } catch {
      /* a private window or blocked storage: the choice just isn't remembered next time */
    }
    track("plan_switch_child", { to: id ? "child" : "everyone" });
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Whose plan">
      {kids.map((c) => {
        const on = c.studentId === selected;
        const name = c.name ?? "Student";
        return (
          <Link
            key={c.studentId}
            href={planHref({ person: c.studentId })}
            role="radio"
            aria-checked={on}
            onClick={() => remember(c.studentId)}
            className={cn(
              "flex items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-colors",
              on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: KID_VARS[c.colorSlot] }} aria-hidden>
              {name[0]?.toUpperCase() ?? "?"}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold leading-tight">
                {name}
                {c.gradYear ? <span className="ml-1 font-normal opacity-70">Class of {c.gradYear}</span> : null}
              </span>
              <span className={cn("block truncate text-[11px] leading-tight", on ? "opacity-80" : "text-muted-foreground")}>{c.summary}</span>
            </span>
          </Link>
        );
      })}
      {kids.length > 1 && (
        <Link
          href={planHref({})}
          role="radio"
          aria-checked={selected === null}
          onClick={() => remember(null)}
          className={cn(
            "flex items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-colors",
            selected === null ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
          )}
        >
          <span className="flex -space-x-1" aria-hidden>
            {kids.map((c) => (
              <span key={c.studentId} className="size-3 rounded-full ring-2 ring-card" style={{ background: KID_VARS[c.colorSlot] }} />
            ))}
          </span>
          <span>
            <span className="block text-sm font-bold leading-tight">Everyone</span>
            <span className={cn("block text-[11px] leading-tight", selected === null ? "opacity-80" : "text-muted-foreground")}>One calendar</span>
          </span>
        </Link>
      )}
    </div>
  );
}
