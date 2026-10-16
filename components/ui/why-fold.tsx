"use client";

/**
 * "Why this matters" (specs/planner/record/less-text.md "The rule" #2): a closed-by-default `<details>` that folds
 * explanatory text behind a tap, so a screen opens with a title and one line and nothing else above the first
 * control. Two shapes, one mechanism:
 * - the default, full row: a chevron and the `title`, for a guide section's fold ("Why this shape", "Depth and
 *   breadth", "How much to study", "What to think about", "How to ask", "What {college} reports").
 * - `compact`: a round "?" button (the same shape the record's tour used as a stand-in, components/planner/intake/
 *   {BasicsStep,RecommendersStep}.tsx before this component existed), for a headline row or a section title where
 *   the note is a sentence or two.
 * Both open the same way: tap, no remembered state (closing and reopening starts closed again). Fires
 * `plan_why_opened { screen, section }` once per open (not on close, and not again until the next open), so the
 * telemetry says which explanations get read without double-counting a toggle.
 */
import { useRef } from "react";
import { ChevronDown } from "lucide-react";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export function WhyFold({
  title = "Why this matters",
  screen,
  section,
  defaultOpen = false,
  compact = false,
  className,
  children,
}: {
  /** The summary row's text (ignored, but kept as the accessible label, when `compact`). */
  title?: string;
  /** `plan_why_opened`'s `screen`: which screen this fold is on (the tour, a guide, the ED sheet). */
  screen: string;
  /** `plan_why_opened`'s `section`: which fold on that screen. */
  section: string;
  defaultOpen?: boolean;
  /** A round "?" trigger in place of the chevron-and-title row, for a headline or a section title. */
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const opened = useRef(false);

  return (
    <details
      open={defaultOpen}
      onToggle={(e) => {
        if (e.currentTarget.open && !opened.current) {
          opened.current = true;
          track("plan_why_opened", { screen, section });
        }
      }}
      className={cn(compact ? "inline-block align-middle" : "group", className)}
    >
      <summary
        aria-label={compact ? title : undefined}
        className={cn(
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          compact
            ? "relative inline-flex size-6 min-h-6 items-center justify-center rounded-full border text-xs font-bold text-muted-foreground after:absolute after:-inset-2.5 after:content-['']"
            : "flex min-h-11 items-center gap-1.5 text-sm font-semibold text-foreground",
        )}
      >
        {compact ? (
          "?"
        ) : (
          <>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
            {title}
          </>
        )}
      </summary>
      <div className={cn("text-sm text-muted-foreground", compact ? "mt-1.5 max-w-xs text-xs" : "mt-2 space-y-2")}>{children}</div>
    </details>
  );
}

export default WhyFold;
