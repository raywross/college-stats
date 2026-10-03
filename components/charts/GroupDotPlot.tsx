import { MIN_GROUP_COHORT } from "@/lib/graduation-groups";

export interface GroupDotRow {
  key: string;
  label: string;
  /** Null when not reported or suppressed (cohort under MIN_GROUP_COHORT). */
  value: number | null;
  /** Students in the group's entering class, shown under the label. */
  cohort: number | null;
  /** The gap label, e.g. "5 points below students with neither". */
  note?: string;
  /** The comparison group: drawn hollow, so the eye reads the others against it. */
  reference?: boolean;
  /**
   * A second, lighter mark on the same scale for the same students (specs/data-expansion/cds-student-body-and-outcomes.md:
   * "within 4 years" beside the 6-year dot), printed beside the main value with `secondaryLabel`.
   */
  secondary?: number | null;
}

/**
 * Graduation rates by group on one shared scale (specs/data-expansion/graduation-by-group.md): one row per group with a
 * dot in a single hue (rows are labeled, so color carries no identity), the overall rate as a dashed vertical line,
 * and every value and gap printed beside it, so no hover is needed. The scale is a dot plot's, not a bar's: it starts
 * at the nearest 10% below the lowest value (labeled ticks keep it honest) so 5-point gaps stay visible.
 */
export function GroupDotPlot({
  rows,
  overall,
  color,
  label,
  secondaryLabel = "within 4 years",
}: {
  rows: GroupDotRow[];
  overall: { label: string; value: number } | null;
  color: string;
  /** Accessible name for the figure. */
  label: string;
  /** How the rows' `secondary` values read beside the main value. */
  secondaryLabel?: string;
}) {
  const vals = [...rows.map((r) => r.value), ...rows.map((r) => (r.value !== null ? (r.secondary ?? null) : null)), overall?.value ?? null].filter((v): v is number => v !== null);
  if (!vals.length) return null;
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 0.05) * 10) / 10);
  const hi = 1;
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  // Every 10 points on a short scale, every 20 on a long one (phones have about 200px for the track).
  const step = hi - lo > 0.5 ? 0.2 : 0.1;
  const ticks = Array.from({ length: Math.floor((hi - lo) / step + 1e-9) + 1 }, (_, i) => Math.round((hi - (Math.floor((hi - lo) / step + 1e-9) - i) * step) * 10) / 10);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <figure aria-label={label} className="text-xs">
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[7.5rem_1fr] items-start gap-3 sm:grid-cols-[11rem_1fr]">
            <span className="pt-0.5">
              <span className="block font-medium text-foreground">{r.label}</span>
              {r.cohort !== null && <span className="block text-[11px] text-muted-foreground tabular-nums">{r.cohort.toLocaleString("en-US")} students</span>}
            </span>
            <div>
              <div className="relative h-4">
                <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                {overall && (
                  <div className="absolute inset-y-[-6px] border-l border-dashed border-foreground/40" style={{ left: pos(overall.value) }} aria-hidden />
                )}
                {r.value !== null && r.secondary != null && (
                  <span
                    className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40"
                    style={{ left: pos(r.secondary), backgroundColor: color }}
                    aria-hidden
                  />
                )}
                {r.value !== null &&
                  (r.reference ? (
                    <span
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-card"
                      style={{ left: pos(r.value), borderColor: color }}
                    />
                  ) : (
                    <span
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                      style={{ left: pos(r.value), backgroundColor: color }}
                    />
                  ))}
              </div>
              <p className="mt-0.5 text-muted-foreground tabular-nums">
                {r.value !== null ? (
                  <>
                    <b className="text-foreground">{pct(r.value)}</b>
                    {r.secondary != null ? ` · ${pct(r.secondary)} ${secondaryLabel}` : ""}
                    {r.note ? ` · ${r.note}` : ""}
                  </>
                ) : r.cohort !== null && r.cohort > 0 && r.cohort < MIN_GROUP_COHORT ? (
                  `Not shown: under ${MIN_GROUP_COHORT} students`
                ) : (
                  "Not reported"
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 grid grid-cols-[7.5rem_1fr] gap-3 sm:grid-cols-[11rem_1fr]">
        <span />
        <div className="relative h-4 text-[10px] text-muted-foreground tabular-nums" aria-hidden>
          {ticks.map((t, i) => (
            // End ticks align inward so they never overflow the card on a phone.
            <span key={t} className={Math.abs(t - lo) < 1e-9 ? "absolute" : i === ticks.length - 1 ? "absolute -translate-x-full" : "absolute -translate-x-1/2"} style={{ left: pos(t) }}>
              {pct(t)}
            </span>
          ))}
        </div>
      </div>
      {overall && (
        <figcaption className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-3 border-l border-dashed border-foreground/40" aria-hidden />
          {overall.label}: <b className="text-foreground tabular-nums">{pct(overall.value)}</b>
        </figcaption>
      )}
    </figure>
  );
}
