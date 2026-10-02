import type { ReactNode } from "react";
import { getData } from "@/lib/data";
import type { FieldPath } from "@/lib/fields";
import type { TermKey } from "@/lib/glossary";
import type { School } from "@/lib/types";
import { MetricLabel } from "@/components/ui/info-tip";

/** One overview tile: a cited label (glossary term + source popover) over its figure. */
export async function Tile({
  label,
  term,
  field,
  school,
  children,
  className,
}: {
  label: string;
  term?: TermKey;
  /** The value this tile shows; its source appears in the (i) popover. */
  field: FieldPath;
  school: School;
  children: ReactNode;
  className?: string;
}) {
  const { citeField } = await getData();
  return (
    <div className={`flex flex-col rounded-3xl border bg-card p-4 sm:p-5 ${className ?? ""}`}>
      <MetricLabel term={term} cited={citeField(field, school)} className="flex-wrap text-xs font-semibold text-muted-foreground">
        {label}
      </MetricLabel>
      <div className="mt-3 flex flex-1 flex-col justify-between gap-3">{children}</div>
    </div>
  );
}
