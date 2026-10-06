import type { ReactNode } from "react";
import type { TermKey } from "@/lib/glossary";
import type { HsCited } from "@/lib/hs-fields";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * One cited figure, with the state median beside it when there is one (specs/product/high-school-data.md "Display":
 * "Each value against the state median"; describe, don't grade — lib/high-school-ui.ts has no "good"/"bad" wording,
 * just "above"/"below"/"about the same").
 */
export function HsStat({
  label,
  term,
  cited,
  value,
  median,
  sub,
  className,
}: {
  label: string;
  term?: TermKey;
  cited: HsCited;
  value: ReactNode;
  /** Pre-formatted median value text ("18%"), or null/undefined when the state has no median for this measure. */
  median?: string | null;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border bg-card p-4", className)}>
      <MetricLabel term={term} cited={cited} className="text-xs font-semibold text-muted-foreground">
        {label}
      </MetricLabel>
      <p className="mt-1 font-display text-xl font-extrabold">{value}</p>
      {median != null && (
        <p className="mt-1 text-xs text-muted-foreground">
          <Term term="hs-state-median">State median (public high schools)</Term>: {median}
        </p>
      )}
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
