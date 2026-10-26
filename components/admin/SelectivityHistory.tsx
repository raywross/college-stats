import { ELITE_INDEX, TIER_CUTOFFS } from "@/lib/selectivity";
import { SELECTIVITY_TIER_LABELS } from "@/lib/chances/levels";
import type { SelectivityTier } from "@/lib/chances/types";
import { CAUSE_LABELS, DISPLAY_MOVE_MIN, POOLS, POOL_LABELS, inputChanges, isDrift, withPrevious, type Pool, type PoolValue, type SelectivityPoint } from "@/lib/admin/selectivity-history-view";

/**
 * One college's selectivity history on its console page (specs/chances/selectivity-history.md "The admin screens"):
 * per pool, the score over each recorded publish with today's tier bands shaded, tier changes ringed, and method
 * changes as a dashed line (a jump there is the method, not the college); then one row per recorded publish, newest
 * first, with all applicants, in-state, and out-of-state side by side and the inputs that changed in words. Only
 * publishes that changed something about the college are recorded. Server-rendered; each point's <title> is its hover
 * label, and the table is the same data in text.
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

/** One pool's trail: a point per recorded publish (the pool's value at that publish). */
type Trail = { point: SelectivityPoint; value: PoolValue }[];

function ScoreTrail({ trail }: { trail: Trail }) {
  const W = 320;
  const H = 120;
  const pad = { l: 6, r: 92, t: 8, b: 8 };
  const scores = trail.map((t) => t.value.score).filter((s): s is number => s !== null);
  const lo = Math.max(0, Math.floor((scores.length ? Math.min(...scores) : 0) - 6));
  const hi = Math.min(100, Math.ceil((scores.length ? Math.max(...scores) : 100) + 6));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / Math.max(1, hi - lo));
  const x = (i: number) => pad.l + (trail.length < 2 ? (W - pad.l - pad.r) / 2 : ((W - pad.l - pad.r) * i) / (trail.length - 1));
  const visible = BANDS.map((b, i) => ({ ...b, to: i === 0 ? 100 : BANDS[i - 1].from })).filter((b) => b.to > lo && b.from < hi);
  const path = trail
    .map((t, i) => (t.value.score === null ? null : `${x(i)},${y(t.value.score)}`))
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
      {trail.map((t, i) =>
        t.point.cause === "method" && i > 0 ? (
          <line key={`m${i}`} x1={(x(i - 1) + x(i)) / 2} x2={(x(i - 1) + x(i)) / 2} y1={pad.t} y2={H - pad.b} className="stroke-muted-foreground" strokeDasharray="3 3" strokeWidth={1} />
        ) : null,
      )}
      {path && <path d={`M ${path}`} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" />}
      {trail.map((t, i) => {
        const score = t.value.score;
        if (score === null) return null;
        const moved = i > 0 && trail[i - 1].value.tier !== t.value.tier;
        return (
          <g key={`p${i}`}>
            <circle cx={x(i)} cy={y(score)} r={moved ? 6 : 4} fill="var(--s1)" stroke="var(--card)" strokeWidth={2} />
            {moved && <circle cx={x(i)} cy={y(score)} r={8.5} fill="none" stroke="var(--s1)" strokeWidth={1.5} />}
            <title>{`${day(t.point.publishedAt)}: ${score.toFixed(2)}, ${tierWord(t.value.tier)}${t.value.held ? " (held)" : ""} · ${CAUSE_LABELS[t.point.cause]} · method ${t.point.method}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

/** One pool's cell: the score with its change since the previous row, and the tier ("held" when hysteresis kept it). */
function PoolCell({ value, prev }: { value: PoolValue; prev: PoolValue | null }) {
  if (value.score === null) return <span className="text-muted-foreground">{prev?.score != null ? "No longer rated" : "—"}</span>;
  const delta = prev?.score != null ? value.score - prev.score : null;
  return (
    <>
      <span className="tabular-nums">{value.score.toFixed(2)}</span>
      {delta !== null && Math.abs(delta) >= 0.005 && (
        <span className="ml-1 text-xs text-muted-foreground tabular-nums">
          {delta > 0 ? "+" : "−"}
          {Math.abs(delta).toFixed(2)}
        </span>
      )}
      {prev && prev.score === null && <span className="ml-1 text-xs text-muted-foreground">new</span>}
      <span className="block text-xs">
        {prev && prev.tier !== value.tier && prev.tier ? `${tierWord(prev.tier)} → ` : ""}
        {tierWord(value.tier)}
        {value.held && <span className="ml-1 text-muted-foreground">held</span>}
      </span>
    </>
  );
}

export function SelectivityHistory({ points, repoUrl, every, toggleHref }: { points: SelectivityPoint[]; repoUrl: string; every: boolean; toggleHref: string }) {
  const pools = POOLS.filter((pool) => points.some((p) => p.pools[pool].score !== null));
  const all = withPrevious(points);
  // Every change is recorded; by default the table hides rows where every pool kept its tier and moved under
  // DISPLAY_MOVE_MIN (a display filter).
  const rows = every ? all : all.filter(({ point, prev }) => !isDrift(point, prev));
  const hidden = all.length - rows.length;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {pools.map((pool: Pool) => {
          const trail: Trail = points.map((point) => ({ point, value: point.pools[pool] }));
          const last = trail.at(-1)!.value;
          return (
            <figure key={pool} className="space-y-1">
              <figcaption className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold">{POOL_LABELS[pool]}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{last.score === null ? "not rated" : `${last.score.toFixed(2)} · ${tierWord(last.tier)}`}</span>
              </figcaption>
              <ScoreTrail trail={trail} />
            </figure>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Bands are today&apos;s tier cutoffs. A ringed point is a tier change; a dashed line is a method change, so a jump there is the method, not the college. A row is
        recorded only when something about the college changed.
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
              {pools.map((pool) => (
                <th key={pool} className="py-1.5 pr-3 font-medium">
                  {POOL_LABELS[pool]}
                </th>
              ))}
              <th className="py-1.5 pr-3 text-right font-medium">Rank</th>
              <th className="py-1.5 pr-3 font-medium">Cause</th>
              <th className="py-1.5 font-medium">What changed</th>
            </tr>
          </thead>
          <tbody className="divide-y align-top">
            {rows.map(({ point: p, prev }) => {
              const changed = inputChanges(prev?.inputs ?? null, p.inputs);
              return (
                <tr key={`${p.publishedAt}-${p.gitCommit}`}>
                  <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">
                    {p.gitCommit ? (
                      <a href={`${repoUrl}/commit/${p.gitCommit}`} className="underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
                        {day(p.publishedAt)}
                      </a>
                    ) : (
                      day(p.publishedAt)
                    )}
                    {p.tierYear && <span className="block text-xs text-muted-foreground">{p.tierYear}</span>}
                  </td>
                  {pools.map((pool) => (
                    <td key={pool} className="py-1.5 pr-3 whitespace-nowrap">
                      <PoolCell value={p.pools[pool]} prev={prev?.pools[pool] ?? null} />
                    </td>
                  ))}
                  <td className="py-1.5 pr-3 text-right tabular-nums">{p.rank ?? "—"}</td>
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
