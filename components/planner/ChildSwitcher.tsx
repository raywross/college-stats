"use client";

import Link from "next/link";
import { track } from "@/lib/analytics";
import { KID_VARS } from "@/lib/planner/colors";
import { planHref } from "@/lib/planner/plan-tabs";
import { cn } from "@/lib/utils";

/** Set here on every pick, read server-side by `app/plan/page.tsx` so a guardian's next `/plan` open lands on the
 * same child (page.md "Routes", decision 2026-10-11: no Everyone). A plain cookie, a year out: a per-viewer
 * convenience, nothing sensitive. */
const PLAN_CHILD_COOKIE = "plan_child";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Top-level, not a hook: the compiler's immutability check flags a direct global write (`document.cookie = …`)
 * made inside a component or hook body, so the assignment itself lives out here instead. */
function rememberChild(id: string) {
  try {
    document.cookie = `${PLAN_CHILD_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    /* a private window or blocked storage: the choice just isn't remembered next time */
  }
}

export interface SwitcherChild {
  studentId: string;
  name: string | null;
  gradYear: number | null;
  colorSlot: 0 | 1 | 2;
  /** The shortened summary line (lib/planner/plan-frame.ts shortSummaryLine). */
  summary: string;
}

/**
 * The child switcher (specs/planner/redesign/page.md "The child switcher"): one pill per child (the
 * family/"Everyone" view is deferred — decision 2026-10-11), the selected pill filled, each pill's second line the
 * child's shortened summary. Picking a child remembers it in the `plan_child` cookie, so the next `/plan` open
 * (`app/plan/page.tsx` resolveSelectedChild) lands on the same one without `?for=`.
 */
export function ChildSwitcher({ kids, selected }: { kids: SwitcherChild[]; selected: string | null }) {
  if (kids.length <= 1) return null;

  const remember = (id: string) => {
    rememberChild(id);
    track("plan_switch_child", { to: "child" });
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Whose plan">
      <span className="hidden text-sm text-muted-foreground lg:inline">Viewing</span>
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
              "flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-left transition-colors",
              on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: KID_VARS[c.colorSlot] }} aria-hidden>
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
    </div>
  );
}
