import type { School } from "@/lib/types";
import { money, moneyCompact, pct } from "@/lib/format";
import { MetricLabel } from "@/components/ui/info-tip";

const PARTS = [
  { key: "tuition_fees", label: "Tuition & fees", color: "var(--cost-1)" },
  { key: "room_board", label: "Room & board", color: "var(--cost-2)" },
  { key: "books", label: "Books & supplies", color: "var(--cost-3)" },
  { key: "other", label: "Other expenses", color: "var(--cost-4)" },
] as const;

/**
 * How the all-student average is built, as a small waterfall on one scale:
 * full price (stacked by what it's for) − average grant per student = average total cost.
 * All pieces come from the sync already rounded, so they add up exactly.
 */
export function CostBreakdown({ school }: { school: School }) {
  const b = school.cost?.breakdown;
  if (!b) return null;
  const isPublic = school.type === "public";
  const res = school.cost?.residency;
  const paid = b.full_price - b.grant_per_student;
  const w = (v: number) => `${(v / b.full_price) * 100}%`;
  const share = school.aid?.grant_pct ?? null;
  const avgGrant = school.aid?.grant_avg ?? null;
  const mixed = isPublic && (res?.out_of_state ?? 0) > 0 && (res?.out_of_state ?? 0) < 1;

  return (
    <figure className="space-y-3" aria-label={`Full price ${money(b.full_price)} minus average grant per student ${money(b.grant_per_student)} equals average total cost ${money(paid)}`}>
      {/* 1. Full price, stacked */}
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <MetricLabel term="cost-of-attendance" className="font-semibold">
            Full price{mixed ? ", averaged across in-state & out-of-state" : ""}
          </MetricLabel>
          <span className="font-bold tabular-nums">{money(b.full_price)}</span>
        </div>
        <div className="flex h-5 gap-[2px] overflow-hidden rounded-md">
          {PARTS.map((p, i) => (
            <div
              key={p.key}
              className="h-full origin-left animate-grow-x first:rounded-l-md last:rounded-r-md"
              style={{ width: w(b[p.key]), backgroundColor: p.color, animationDelay: `${i * 60}ms` }}
              title={`${p.label}: ${money(b[p.key])}`}
            />
          ))}
        </div>
      </div>

      {/* 2. Minus grants, drawn under the part of the price it removes */}
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <MetricLabel term="grant-aid" className="font-semibold">
            − Grants, averaged over every first-year
          </MetricLabel>
          <span className="font-bold tabular-nums">−{money(b.grant_per_student)}</span>
        </div>
        <div className="relative h-5 rounded-md bg-muted/50">
          <div
            className="absolute inset-y-0 rounded-md border-2 border-foreground/35 bg-[repeating-linear-gradient(135deg,transparent_0_5px,color-mix(in_oklch,var(--foreground)_12%,transparent)_5px_7px)]"
            style={{ left: w(paid), width: w(b.grant_per_student) }}
          />
        </div>
        {share !== null && avgGrant !== null && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {pct(share)} got grants averaging {money(avgGrant)}; {pct(1 - share)} got none.
          </p>
        )}
      </div>

      {/* 3. Result */}
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold">= Average total cost</span>
          <span className="font-bold tabular-nums">{money(paid)}</span>
        </div>
        <div className="h-5 rounded-md bg-muted/50">
          {/* Neutral ink: the total isn't a cost item, so it shouldn't share a legend color. */}
          <div className="h-full origin-left animate-grow-x rounded-md" style={{ width: w(paid), backgroundColor: "color-mix(in oklch, var(--foreground) 78%, transparent)" }} />
        </div>
      </div>

      {/* Legend with amounts (identity never relies on color alone) */}
      <figcaption className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 text-xs">
        {PARTS.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="ml-auto font-semibold tabular-nums">{moneyCompact(b[p.key])}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
