import type { School } from "@/lib/types";
import { getData } from "@/lib/data";
import { costFacts } from "@/lib/cost-display";
import { MetricLabel } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * The three facts that open the cost page and sit under the overview card's mini curve (specs/product/cost-by-income.md
 * "How cost is shown"): the full price, where need-based aid ends (or why we can't say), and merit aid. Each carries
 * its source (i); an estimated figure says "estimate" beside it (lib/cost-display.ts).
 */
export async function CostFacts({ school, showEstimates, compact = false }: { school: School; showEstimates: boolean; compact?: boolean }) {
  const data = await getData();
  const curve = data.costCurveFor(school);
  const facts = costFacts({ school, curve, merit: data.meritInfoFor(school), showEstimates });
  if (!facts.length) return null;
  return (
    <dl className={cn("grid gap-x-4 gap-y-3", compact ? "grid-cols-1 sm:grid-cols-3" : "sm:grid-cols-3")} data-cost-facts>
      {facts.map((f) => (
        <div key={f.key} className={cn("min-w-0", compact && "max-sm:flex max-sm:flex-wrap max-sm:items-baseline max-sm:gap-x-2")}>
          <dt className={cn("font-semibold text-muted-foreground", compact ? "text-[11px] leading-tight" : "text-xs")}>
            <MetricLabel term={f.term} cited={data.citeField(f.field, school)}>
              {f.label}
            </MetricLabel>
          </dt>
          <dd className={cn("mt-0.5 font-display leading-tight font-extrabold tracking-tight", compact ? "text-base" : f.value.length > 14 ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl")}>{f.value}</dd>
          {f.sub && <dd className={cn("mt-0.5 leading-snug text-muted-foreground", compact ? "text-[10px] max-sm:mt-0 max-sm:basis-full" : "text-xs")}>{f.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
