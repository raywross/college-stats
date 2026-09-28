import { formatBy, type FormatKind } from "@/lib/format";

export interface DumbbellRow {
  label: string;
  from: number | null;
  to: number | null;
}

/**
 * Change per category between two years (net price by family income): a hollow dot for the start, a solid dot in
 * the series color for the end, joined by a hairline. Both values are printed, so no hover is needed; the shared
 * scale starts at zero (or below it, when a value is negative).
 */
export function Dumbbell({
  rows,
  fromLabel,
  toLabel,
  format,
  color,
}: {
  rows: DumbbellRow[];
  fromLabel: string;
  toLabel: string;
  format: FormatKind;
  color: string;
}) {
  const vals = rows.flatMap((r) => [r.from, r.to]).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(1, ...vals);
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 bg-card" style={{ borderColor: color }} /> {fromLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} /> {toLabel}
        </span>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[4.5rem_1fr] items-center gap-3 text-xs">
            <span className="font-medium text-muted-foreground">{r.label}</span>
            <div>
              <div className="relative h-4">
                <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                {r.from !== null && r.to !== null && (
                  <div
                    className="absolute top-1/2 h-0.5 -translate-y-1/2"
                    style={{
                      left: pos(Math.min(r.from, r.to)),
                      width: `calc(${pos(Math.max(r.from, r.to))} - ${pos(Math.min(r.from, r.to))})`,
                      backgroundColor: `color-mix(in oklch, ${color} 45%, transparent)`,
                    }}
                  />
                )}
                {r.from !== null && (
                  <span
                    className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card"
                    style={{ left: pos(r.from), borderColor: color }}
                  />
                )}
                {r.to !== null && (
                  <span
                    className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                    style={{ left: pos(r.to), backgroundColor: color }}
                  />
                )}
              </div>
              <p className="mt-0.5 tabular-nums text-muted-foreground">
                {r.from === null ? "—" : formatBy(format, r.from)} → <b className="text-foreground">{r.to === null ? "—" : formatBy(format, r.to)}</b>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
