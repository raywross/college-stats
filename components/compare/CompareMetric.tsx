import type { School } from "@/lib/types";
import type { TermKey } from "@/lib/glossary";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { MetricLabel } from "@/components/ui/info-tip";

/**
 * One metric, one bar per school. Bars wear the school's slot color;
 * text stays in ink. The extreme value gets a neutral label (not a trophy):
 * "higher" isn't automatically "better" for things like selectivity.
 */
export function CompareMetric({
  label,
  term,
  schools,
  get,
  format,
  max,
  flag,
}: {
  label: string;
  term: TermKey;
  schools: School[];
  get: (s: School) => number | null;
  format: (v: number) => string;
  max?: number;
  flag?: { which: "max" | "min"; text: string };
}) {
  const values = schools.map(get);
  const present = values.filter((v): v is number => v !== null);
  const top = max ?? Math.max(1e-9, ...present);
  const target =
    flag && present.length > 1 ? (flag.which === "max" ? Math.max(...present) : Math.min(...present)) : null;

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-5">
      <MetricLabel term={term} className="mb-4 font-display text-base font-bold">
        {label}
      </MetricLabel>
      <div className="space-y-2.5">
        {schools.map((s, i) => {
          const v = values[i];
          const isFlag = target !== null && v === target && new Set(present).size > 1;
          return (
            <div key={s.unit_id} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[6rem_1fr_auto]">
              <span className="truncate text-xs font-semibold">{shortName(s)}</span>
              <span className="h-3 overflow-hidden rounded-full bg-muted">
                {v !== null && (
                  <span
                    className="block h-full origin-left animate-grow-x rounded-full"
                    style={{ width: `${Math.max(2, Math.min(100, (v / top) * 100))}%`, backgroundColor: SLOT_COLORS[i], animationDelay: `${i * 80}ms` }}
                  />
                )}
              </span>
              <span className="flex items-center gap-1.5 text-right text-sm font-bold tabular-nums">
                {v === null ? <span className="font-normal text-muted-foreground">Not reported</span> : format(v)}
                {isFlag && flag && (
                  <span className="hidden rounded-full bg-pop px-1.5 py-0.5 text-[10px] font-bold text-pop-foreground sm:inline">
                    {flag.text}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
