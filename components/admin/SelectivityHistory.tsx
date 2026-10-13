import { ELITE_INDEX, TIER_CUTOFFS } from "@/lib/selectivity";
import { SELECTIVITY_TIER_LABELS } from "@/lib/chances/levels";
import type { SelectivityTier } from "@/lib/chances/types";
import { CAUSE_LABELS, DISPLAY_MOVE_MIN, POOL_LABELS, inputChanges, isDrift, withPrevious, type Pool, type SelectivityPoint } from "@/lib/admin/selectivity-history-view";

/**
 * One college's selectivity history on its console page (specs/chances/selectivity-history.md "The admin screens"):
 * per pool, the score over each recorded publish with today's tier bands shaded, tier changes ringed, and method
 * changes as a dashed line (a jump there is the method, not the college); then every row, newest first, with the
 * inputs that changed in words. Server-rendered; each point's <title> is its hover label, and the table is the same
 * data in text.
 */

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const day = (iso: string) => dayFmt.format(new Date(iso));
const tierWord = (t: SelectivityTier | null) => (t ? SELECTIVITY_TIER_LABELS[t] : "Not rated");

/** Today's cutoffs, top down: where each tier starts. */
const BANDS: { tier: SelectivityTier; from: number }[] = [
  { tier: "elite", from: ELITE_INDEX },
  { tier: "highly_selective", from: TIER_CUTOFFS.highly_selective },
  { tier: "very_selective", from: TIER_CUTOFFS.very_selective },
  { tier: "selective", from: TIER_CUTOFFS.selective },
  { tier: "accessible", from: TIER_CUTOFFS.accessible },
  { tier: "open", from: 0 },
];

function ScoreTrail({ points }: { points: SelectivityPoint[] }) {
  const W = 320;
  const H = 120;
  const pad = { l: 6, r: 92, t: 8, b: 8 };
  const scored = points.filter((p) => p.score !== null);
  const scores = scored.map((p) => p.score!);
  const lo = Math.max(0, Math.floor((scores.length ? Math.min(...scores) : 0) - 6));
  const hi = Math.min(100, Math.ceil((scores.length ? Math.max(...scores) : 100) + 6));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / Math.max(1, hi - lo));
  const x = (i: number) => pad.l + (points.length < 2 ? (W - pad.l - pad.r) / 2 : ((W - pad.l - pad.r) * i) / (points.length - 1));
  const visible = BANDS.map((b, i) => ({ ...b, to: i === 0 ? 100 : BANDS[i - 1].from })).filter((b) => b.to > lo && b.from < hi);
  const path = points
    .map((p, i) => (p.score === null ? null : `${x(i)},${y(p.score)}`))
    .filter(Boolean)
    .join(" L ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-md" role="img" aria-label="Score at each recorded publish, over today's tier bands">
      {visible.map((b, i) => {
        const top = y(Math.min(b.to, hi));
        const bottom = y(Math.max(b.from, lo));
        return (
          <g key={b.tier}>
            <rect x={pad.l} y={top} width={W - pad.l - pad.r} height={Math.max(0, bottom - top)} className={i % 2 === 0 ? "fill-muted" : "fill-muted/40"} />
            <text x={W - pad.r + 6} y={(top + bottom) / 2 + 3} className="fill-muted-foreground text-[9px]">
              {SELECTIVITY_TIER_LABELS[b.tier]}
            </text>
          </g>
        );
      })}
      {points.map((p, i) =>
        p.cause === "method" && i > 0 ? (
          <line key={`m${i}`} x1={(x(i - 1) + x(i)) / 2} x2={(x(i - 1) + x(i)) / 2} y1={pad.t} y2={H - pad.b} className="stroke-muted-foreground" strokeDasharray="3 3" strokeWidth={1} />
        ) : null,
      )}
      {path && <path d={`M ${path}`} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" />}
      {points.map((p, i) => {
        if (p.score === null) return null;
        const moved = i > 0 && points[i - 1].tier !== p.tier;
        return (
          <g key={`p${i}`}>
            <circle cx={x(i)} cy={y(p.score)} r={moved ? 6 : 4} fill="var(--s1)" stroke="var(--card)" strokeWidth={2} />
            {moved && <circle cx={x(i)} cy={y(p.score)} r={8.5} fill="none" stroke="var(--s1)" strokeWidth={1.5} />}
            <title>{`${day(p.publishedAt)}: ${p.score.toFixed(2)}, ${tierWord(p.tier)}${p.held ? " (held)" : ""} · ${CAUSE_LABELS[p.cause]} · method ${p.method}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

export function SelectivityHistory({ points, repoUrl, every, toggleHref }: { points: SelectivityPoint[]; repoUrl: string; every: boolean; toggleHref: string }) {
  const pools = (["all", "in_state", "out_of_state"] as Pool[]).filter((pool) => points.some((p) => p.pool === pool));
  const all = withPrevious(points);
  // Every change is recorded; by default the table hides same-tier moves under DISPLAY_MOVE_MIN (a display filter).
  const rows = every ? all : all.filter(({ point, prev }) => !isDrift(point, prev));
  const hidden = all.length - rows.length;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {pools.map((pool) => {
          const mine = points.filter((p) => p.pool === pool);
          const last = mine.at(-1)!;
          return (
            <figure key={pool} className="space-y-1">
              <figcaption className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold">{POOL_LABELS[pool]}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {last.score === null ? "not rated" : `${last.score.toFixed(2)} · ${tierWord(last.tier)}`}
                </span>
              </figcaption>
              <ScoreTrail points={mine} />
            </figure>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Bands are today&apos;s tier cutoffs. A ringed point is a tier change; a dashed line is a method change, so a jump there is the method, not the college.
      </p>
      <p className="text-xs text-muted-foreground">
        {every ? `Showing every change (${all.length}).` : hidden > 0 ? `${hidden} same-tier ${hidden === 1 ? "move" : "moves"} under ${DISPLAY_MOVE_MIN} points hidden.` : "Every change is shown."}{" "}
        {(every || hidden > 0) && (
          <a href={toggleHref} className="font-semibold text-primary underline-offset-4 hover:underline">
            {every ? "Hide small moves" : "Show every change"}
          </a>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Date</th>
              <th className="py-1.5 pr-3 font-medium">Pool</th>
              <th className="py-1.5 pr-3 text-right font-medium">Score</th>
              <th className="py-1.5 pr-3 text-right font-medium">Rank</th>
              <th className="py-1.5 pr-3 font-medium">Tier</th>
              <th className="py-1.5 pr-3 font-medium">Cause</th>
              <th className="py-1.5 font-medium">What changed</th>
            </tr>
          </thead>
          <tbody className="divide-y align-top">
            {rows.map(({ point: p, prev }, i) => {
              const delta = p.score !== null && prev?.score != null ? p.score - prev.score : null;
              const changed = inputChanges(prev?.inputs ?? null, p.inputs);
              return (
                <tr key={`${p.publishedAt}-${p.pool}-${i}`}>
                  <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">
                    {p.gitCommit ? (
                      <a href={`${repoUrl}/commit/${p.gitCommit}`} className="underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
                        {day(p.publishedAt)}
                      </a>
                    ) : (
                      day(p.publishedAt)
                    )}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{POOL_LABELS[p.pool]}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap tabular-nums">
                    {p.score === null ? "—" : p.score.toFixed(2)}
                    {delta !== null && Math.abs(delta) >= 0.005 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {delta > 0 ? "+" : "−"}
                        {Math.abs(delta).toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{p.rank ?? "—"}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {tierWord(p.tier)}
                    {p.held && <span className="ml-1 text-xs text-muted-foreground">held</span>}
                    {p.tierYear && <span className="block text-xs text-muted-foreground">{p.tierYear}</span>}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {CAUSE_LABELS[p.cause]}
                    <span className="block text-xs text-muted-foreground">method {p.method}</span>
                  </td>
                  <td className="py-1.5 text-xs">{changed.length ? changed.join("; ") : <span className="text-muted-foreground">{prev ? "No input changed" : "First record"}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
