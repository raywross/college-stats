import { INCOME_BANDS } from "@/lib/metrics";
import { money, moneyCompact } from "@/lib/format";

/**
 * What families at each income level actually paid per year (average net
 * price for aided students). One series, so one color; values ride the
 * column caps and a hairline marks the overall average.
 */
export function NetPriceByIncome({
  values,
  average,
  color = "var(--d-value)",
}: {
  values: (number | null)[];
  average: number | null;
  color?: string;
}) {
  const present = values.filter((v): v is number => v !== null);
  const top = Math.max(1, average ?? 0, ...present) * 1.12;
  const pos = (v: number) => (v / top) * 100;

  return (
    <figure className="space-y-3">
      <div className="relative h-48 border-b border-axis" role="img" aria-label={`Net price by family income: ${values
        .map((v, i) => `${INCOME_BANDS[i]} ${v === null ? "not reported" : money(v)}`)
        .join(", ")}`}>
        {average !== null && (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-foreground/50"
            style={{ bottom: `calc(${pos(average)}% * (1 - 20 / 192))` }}
          >
            <span className="absolute right-0 bottom-1 w-14 text-right text-[10px] leading-none font-semibold text-muted-foreground">
              avg {moneyCompact(average)}
            </span>
          </div>
        )}
        {/* Columns leave a right gutter (w-14) for the average line's label. */}
        <div className="absolute inset-y-0 right-14 left-0 flex items-end justify-around gap-2 px-1 sm:gap-4">
          {values.map((v, i) => (
            // pt-5 reserves room for the value label so a tall column never pushes it out of the chart.
            <div key={INCOME_BANDS[i]} className="flex h-full w-full max-w-14 flex-col items-center justify-end pt-5">
              {v === null ? (
                <span className="mb-1 text-[10px] text-muted-foreground">n/a</span>
              ) : (
                <>
                  <span className="relative z-20 mb-1 rounded bg-card px-1 text-[11px] font-bold whitespace-nowrap tabular-nums">
                    {moneyCompact(v)}
                  </span>
                  <div
                    className="w-full max-w-6 origin-bottom animate-grow-y rounded-t-[4px]"
                    style={{ height: `${Math.max(1.5, pos(v))}%`, backgroundColor: color, animationDelay: `${i * 70}ms` }}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mr-14 flex justify-around gap-2 px-1 text-center text-[10px] font-medium text-muted-foreground sm:gap-4">
        {INCOME_BANDS.map((b) => (
          <span key={b} className="w-full max-w-14">
            {b}
          </span>
        ))}
      </figcaption>
      <p className="mr-14 text-center text-[11px] text-muted-foreground">Family income per year</p>
    </figure>
  );
}
