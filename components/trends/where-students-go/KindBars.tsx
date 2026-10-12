import { pct } from "@/lib/format";

export interface KindSegment {
  key: string;
  label: string;
  color: string;
  n: number;
  share: [number, number];
}

/**
 * Study 7's "by kind" bar (specs/trends/where-students-go.md, section 2): the whole 300-floor panel's undergraduates
 * as one stacked bar then and one now, a segment per kind of college, so the campus-based cut the rest of the page
 * uses is visible. Values are printed in the legend, so nothing needs hover.
 */
export function KindBars({ segments, thenLabel, nowLabel }: { segments: KindSegment[]; thenLabel: string; nowLabel: string }) {
  const rows = [
    { label: thenLabel, i: 0 as const },
    { label: nowLabel, i: 1 as const },
  ];
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs font-semibold text-muted-foreground sm:w-20">{r.label}</span>
            <div className="flex h-7 min-w-0 flex-1 overflow-hidden rounded-lg border" role="img" aria-label={`${r.label}: ${segments.map((s) => `${s.label} ${pct(s.share[r.i], 1)}`).join(", ")}`}>
              {segments.map((s) => (
                <div
                  key={s.key}
                  className="h-full border-r-2 border-card last:border-r-0"
                  style={{ width: `${s.share[r.i] * 100}%`, backgroundColor: s.color }}
                  title={`${s.label}: ${pct(s.share[r.i], 1)}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" aria-label="Legend">
        {segments.map((s) => (
          <li key={s.key} className="flex items-start gap-2">
            <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="min-w-0">
              <span className="font-semibold">{s.label}</span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {s.n.toLocaleString("en-US")} colleges · {pct(s.share[0], 1)} → {pct(s.share[1], 1)} of students
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
