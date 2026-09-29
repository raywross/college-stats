import type { School } from "@/lib/types";
import { INCOME_BANDS } from "@/lib/metrics";
import { moneyCompact } from "@/lib/format";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { MetricLabel } from "@/components/ui/info-tip";

/**
 * "What would a family like mine pay?" One row per income band, one bar per
 * school in its compare-slot color, all on a shared scale.
 */
export function NetPriceCompare({ schools, year }: { schools: School[]; year?: string | null }) {
  const rows = schools.map((s) => s.cost?.net_price_by_income ?? null);
  const all = rows.flatMap((r) => r ?? []).filter((v): v is number => v !== null);
  if (all.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed p-5 text-sm text-muted-foreground">
        None of these colleges report net price by family income.
      </div>
    );
  }
  const top = Math.max(...all);

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-5">
      <MetricLabel term="net-price-by-income" className="mb-1 font-display text-base font-bold">
        What families at each income level pay
      </MetricLabel>
      <p className="mb-4 text-xs text-muted-foreground">
        Average net price per year for students receiving federal aid{year ? `, ${year}` : ""}. Families who didn&apos;t file the FAFSA aren&apos;t included.
      </p>
      <div className="space-y-4">
        {INCOME_BANDS.map((band, b) => (
          <div key={band} className="grid grid-cols-[4.5rem_1fr] gap-3 sm:grid-cols-[5.5rem_1fr]">
            <span className="pt-0.5 text-xs font-semibold text-muted-foreground">{band}</span>
            <div className="space-y-1">
              {schools.map((s, i) => {
                const v = rows[i]?.[b] ?? null;
                return (
                  <div key={s.unit_id} className="flex items-center gap-2" title={`${shortName(s)}: ${v === null ? "not reported" : moneyCompact(v)}`}>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      {v !== null && (
                        <span
                          className="block h-full origin-left animate-grow-x rounded-full"
                          style={{ width: `${Math.max(2, (v / top) * 100)}%`, backgroundColor: SLOT_COLORS[i] }}
                        />
                      )}
                    </span>
                    <span className="w-12 text-right text-[11px] font-semibold tabular-nums">
                      {v === null ? <span className="font-normal text-muted-foreground">–</span> : moneyCompact(v)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs">
        {schools.map((s, i) => (
          <li key={s.unit_id} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
            {shortName(s)}
          </li>
        ))}
      </ul>
    </div>
  );
}
