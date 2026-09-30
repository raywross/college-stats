import { INCOME_BANDS } from "@/lib/metrics";
import { money, moneyCompact } from "@/lib/format";

/**
 * What families at each income level actually paid per year (average net
 * price for aided students), next to a "No grants" column at the full sticker
 * price. When the sticker price is known, each income column is drawn to full
 * price: the solid part is what families paid, the tint above it is what
 * grants covered, so it's clear the income columns are all after grants and
 * the last one isn't. Values ride the solid tops. Both figures are the latest
 * release of each, which can be different years; fine print names them.
 */
export function NetPriceByIncome({
  values,
  sticker = null,
  years,
  color = "var(--d-value)",
}: {
  values: (number | null)[];
  /** Full sticker price (publics: in-state). Adds the "No grants" column. */
  sticker?: number | null;
  /** Years of the net prices and the sticker price, from lineage. */
  years?: { netPrice: string | null; sticker: string | null };
  color?: string;
}) {
  const present = values.filter((v): v is number => v !== null);
  const top = Math.max(1, sticker ?? 0, ...present) * 1.12;
  const pos = (v: number) => (v / top) * 100;
  const tint = `color-mix(in oklch, ${color} 22%, transparent)`;
  const columns = [
    ...values.map((v, i) => ({ key: INCOME_BANDS[i], label: INCOME_BANDS[i], paid: v, full: sticker })),
    ...(sticker !== null ? [{ key: "none", label: "No grants", paid: sticker, full: sticker }] : []),
  ];

  return (
    <figure className="space-y-3">
      <div
        className="relative flex h-48 items-end justify-around gap-2 border-b border-axis px-1 sm:gap-3"
        role="img"
        aria-label={`Net price by family income: ${values
          .map((v, i) => `${INCOME_BANDS[i]} ${v === null ? "not reported" : money(v)}`)
          .join(", ")}${sticker !== null ? `; no grants, full price ${money(sticker)}` : ""}`}
      >
        {columns.map((c, i) => {
          const noGrant = c.key === "none";
          // Grants cover the gap up to full price; clamp in case the two sources disagree slightly.
          const covered = !noGrant && c.paid !== null && c.full !== null ? Math.max(0, c.full - c.paid) : 0;
          return (
            // pt-5 reserves room for the value label so a tall column never pushes it out of the chart.
            <div
              key={c.key}
              className={`flex h-full w-full max-w-14 flex-col items-center justify-end pt-5 ${noGrant ? "border-l border-dashed border-axis pl-2 sm:pl-3" : ""}`}
            >
              {c.paid === null ? (
                <span className="mb-1 text-[10px] text-muted-foreground">n/a</span>
              ) : (
                <div className="relative flex w-full max-w-7 flex-col justify-end" style={{ height: `${pos(c.paid + covered)}%` }}>
                  {covered > 0 && (
                    <div
                      className="w-full origin-bottom animate-grow-y rounded-t-[4px] border border-b-0 border-dashed"
                      style={{ height: `${(covered / (c.paid + covered)) * 100}%`, backgroundColor: tint, borderColor: color, animationDelay: `${i * 70}ms` }}
                      title={`Covered by grants: about ${moneyCompact(covered)}`}
                    />
                  )}
                  <div
                    className={`w-full origin-bottom animate-grow-y ${covered > 0 ? "" : "rounded-t-[4px]"}`}
                    style={{ height: `${Math.max(1.5, (c.paid / (c.paid + covered)) * 100)}%`, backgroundColor: color, animationDelay: `${i * 70}ms` }}
                  />
                  <span
                    className="absolute left-1/2 z-20 -translate-x-1/2 rounded bg-card px-1 text-[11px] font-bold whitespace-nowrap tabular-nums"
                    style={{ bottom: `calc(${Math.max(1.5, (c.paid / (c.paid + covered)) * 100)}% + 4px)` }}
                  >
                    {moneyCompact(c.paid)}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <figcaption className="flex justify-around gap-2 px-1 text-center text-[10px] font-medium text-muted-foreground sm:gap-3">
        {columns.map((c) => (
          <span key={c.key} className={`w-full max-w-14 ${c.key === "none" ? "pl-2 font-semibold text-foreground sm:pl-3" : ""}`}>
            {c.label}
          </span>
        ))}
      </figcaption>
      <div className="flex justify-around gap-2 px-1 text-[11px] text-muted-foreground sm:gap-3">
        <p className="text-center" style={{ flex: values.length }}>
          Family income per year · with grants
        </p>
        {sticker !== null && (
          <p className="pl-2 text-center sm:pl-3" style={{ flex: 1 }}>
            Full price
          </p>
        )}
      </div>
      {sticker !== null && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: color }} /> What families paid
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-dashed" style={{ backgroundColor: tint, borderColor: color }} /> Covered by grants
          </span>
        </p>
      )}
      {sticker !== null && years?.netPrice && years.sticker && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          {years.netPrice === years.sticker
            ? `Prices after grants and the full price are both for ${years.netPrice}.`
            : `Years are mixed: prices after grants are for ${years.netPrice}, the full price is for ${years.sticker} (the latest of each), so the grant shading is approximate.`}
        </p>
      )}
    </figure>
  );
}
