"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { track } from "@/lib/analytics";
import { KID_VARS } from "@/lib/planner/colors";
import { initialsOf } from "@/lib/planner/plan-frame";
import { setPendingPeople } from "@/lib/planner/people-snapshot";
import { cn } from "@/lib/utils";

/** Set on every pick, read server-side by `app/plan/page.tsx` so a guardian's next `/plan` open lands on the same
 * child (page.md "Routes", decision 2026-10-11). A plain cookie, a year out: a per-viewer convenience. */
const PLAN_CHILD_COOKIE = "plan_child";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Top-level, not a hook: the compiler's immutability check flags a direct global write made inside a component. */
function rememberChild(id: string) {
  try {
    document.cookie = `${PLAN_CHILD_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    /* a private window or blocked storage: the choice just isn't remembered next time */
  }
}

export interface PlanPerson {
  /** The student id (the `?for=` value), or null for a student's own plan. */
  studentId: string | null;
  name: string | null;
  gradYear: number | null;
  /** The household color slot (lib/planner/colors.ts KID_VARS). */
  colorSlot: 0 | 1 | 2;
  /** Where tapping this person goes (their plan). */
  href: string;
}

export interface PlanPersonDetail {
  /** How many profile sections are in, of how many (lib/planner/profile-progress.ts); a plain count, never a score. */
  progress: { done: number; total: number; nextLabel: string | null };
  /** Where the next step is entered (the intake on that step, or the Numbers page), or null for a read-only viewer. */
  nextHref: string | null;
  /** The intake guide in edit mode (`?setup=1`), or null for a read-only viewer. */
  editHref: string | null;
}

/** A small ring filled by the share of sections entered; its label says the count in words. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const filled = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 -rotate-90" role="img" aria-label={`Profile: ${done} of ${total} sections in`}>
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" className="stroke-muted-foreground/25" />
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-primary" strokeDasharray={`${c * filled} ${c}`} />
    </svg>
  );
}

/**
 * The plan's one top line (specs/planner/redesign/page.md "The people line"; owner, 2026-10-12): an initials circle
 * per student in their household color, the selected one expanded in place into a chip with the name, class year, a
 * quiet progress ring with the one next step ("Next: add clubs", linking to that intake step), and Edit (the intake
 * guide). No GPA or test score (owner: "a relic of older thinking"), the others shifted left as circles. Tapping another student's circle switches
 * to their plan (and expands it at once while the page loads); tapping the selected circle folds or unfolds its chip.
 * A student's own plan is the same line with just their chip. Never wraps: the name and next step truncate instead, so
 * four students plus one chip fit at 390px. The status text, the big name heading, and "Your part" are no longer
 * shown here (their helpers stay in lib/planner).
 */
export function PlanPeople({
  people,
  selected,
  detail,
  details,
}: {
  people: PlanPerson[];
  selected: string | null;
  detail: PlanPersonDetail | null;
  /** Every child's chip details (from their profiles), so a tapped child's chip and Edit show before their plan does. */
  details?: Record<string, PlanPersonDetail>;
}) {
  const [open, setOpen] = useState(true);
  // The line has arrived: nothing is pending any more (app/plan/loading.tsx drew it from the snapshot meanwhile).
  useEffect(() => setPendingPeople(null), [selected]);
  const [pending, setPending] = useState<string | null>(null);
  const [selectedSeen, setSelectedSeen] = useState(selected);
  if (selected !== selectedSeen) {
    setSelectedSeen(selected);
    setPending(null);
    setOpen(true);
  }
  const current = pending ?? selected;

  return (
    <div className="flex min-w-0 items-center gap-2" role="group" aria-label="Whose plan">
      {people.map((p) => {
        const name = p.name?.trim() || "Student";
        const isCurrent = p.studentId === current;
        const circle = (
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: KID_VARS[p.colorSlot] }}
            aria-hidden
          >
            {initialsOf(p.name)}
          </span>
        );
        if (!isCurrent) {
          return (
            <Link
              key={p.studentId ?? "self"}
              href={p.href}
              aria-label={`Show ${name}'s plan`}
              title={name}
              onClick={() => {
                if (p.studentId) {
                  rememberChild(p.studentId);
                  setPending(p.studentId);
                  setPendingPeople({ people, selected: p.studentId, detail: details?.[p.studentId] ?? null, details: details ?? {} });
                  track("plan_switch_child", { to: "child" });
                }
              }}
              className="shrink-0 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            >
              {circle}
            </Link>
          );
        }
        const showDetail = open;
        // While another child's plan loads, their chip reads from `details` (the page sends every child's).
        const shown = pending === null ? detail : (details?.[pending] ?? null);
        return (
          <div
            key={p.studentId ?? "self"}
            className={cn("flex min-w-0 items-center gap-2 rounded-full transition-colors", showDetail && "flex-1 border bg-card pr-1 sm:flex-none")}
          >
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={showDetail}
              aria-label={name}
              title={showDetail ? `Fold ${name}'s details` : `Show ${name}'s details`}
              // Folded, the selected circle keeps a ring so it still reads as the plan being shown.
              className={cn("shrink-0 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring", !showDetail && "ring-2 ring-foreground ring-offset-2 ring-offset-background")}
            >
              {circle}
            </button>
            {showDetail && (
              <>
                {(() => {
                  const progress = shown ? shown.progress : null;
                  const nextText = progress ? (progress.nextLabel ? `Next: ${progress.nextLabel}` : "Profile complete") : null;
                  const body = (
                    <>
                      <span className="block truncate text-sm font-bold">
                        {name}
                        {p.gradYear ? <span className="ml-1 font-normal text-muted-foreground">Class of {p.gradYear}</span> : null}
                      </span>
                      {progress && (
                        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <ProgressRing done={progress.done} total={progress.total} />
                          <span className={cn("truncate", progress.nextLabel && shown?.nextHref && "font-semibold text-primary")}>{nextText}</span>
                        </span>
                      )}
                    </>
                  );
                  // The whole text block is the next step's link, so the tap target is the chip's full height.
                  return progress?.nextLabel && shown?.nextHref ? (
                    <Link
                      href={shown.nextHref}
                      aria-label={`${name}: next, ${progress.nextLabel}`}
                      className="flex min-h-11 min-w-0 flex-1 flex-col justify-center leading-tight hover:opacity-80"
                    >
                      {body}
                    </Link>
                  ) : (
                    <span className="flex min-h-11 min-w-0 flex-1 flex-col justify-center leading-tight">{body}</span>
                  );
                })()}
                {shown?.editHref && (
                  <Link
                    href={shown.editHref}
                    aria-label={`Edit ${name}'s grades, test, and courses`}
                    className="inline-flex size-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground sm:h-9 sm:w-auto sm:px-3.5"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    <span className="hidden sm:inline">Edit</span>
                  </Link>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
