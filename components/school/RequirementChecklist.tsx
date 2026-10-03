import { cn } from "@/lib/utils";

/**
 * A "label → one of N levels" list (specs/data-expansion/cds-transfer.md: the transfer application's required
 * materials; the same shape suits a future CDS C7 factors grid). Each level's weight sets its emphasis: strong is
 * filled, medium is outlined, none is muted.
 */
export function RequirementChecklist({
  rows,
}: {
  rows: readonly { key: string; label: string; level: string; weight: "strong" | "medium" | "none" }[];
}) {
  if (!rows.length) return null;
  return (
    <dl className="grid gap-y-1">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-3 border-b border-dashed py-1.5 text-sm last:border-0">
          <dt>{r.label}</dt>
          <dd
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
              r.weight === "strong" && "bg-foreground text-background",
              r.weight === "medium" && "border bg-card",
              r.weight === "none" && "text-muted-foreground"
            )}
          >
            {r.level}
          </dd>
        </div>
      ))}
    </dl>
  );
}
