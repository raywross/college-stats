import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { SchoolDetail } from "@/lib/detail";
import { topHomeStates } from "@/lib/detail";
import { unknownShare } from "@/lib/residence";
import { stateByPostal, stateName } from "@/lib/states";
import { num, pct, pctSmart } from "@/lib/format";
import { TILES } from "@/components/charts/StateTileMap";
import { InfoTip, SourceChip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * Where first-years come from (specs/data-expansion/residence.md): a 3-part bar (in-state, other states, abroad), the
 * top 5 home states, and a state tile map shaded by each state's share of the class. Parts are ordered from home
 * outward, so they use the sequential ramp (darkest = in-state), never categorical hues.
 */
const PARTS = [
  { key: "in_state", label: "In-state", color: "var(--seq-5)" },
  { key: "out_of_state", label: "Other states", color: "var(--seq-3)" },
  { key: "international", label: "Abroad", color: "var(--seq-2)" },
] as const;

/** Map shading by share of first-years (any student at all, then 1%, 3%, 10%, 25%). */
const LEVELS = [
  { min: 0, label: "Under 1%", bg: "var(--seq-1)", ink: "text-foreground" },
  { min: 0.01, label: "1–3%", bg: "var(--seq-2)", ink: "text-foreground" },
  { min: 0.03, label: "3–10%", bg: "var(--seq-3)", ink: "text-foreground" },
  { min: 0.1, label: "10–25%", bg: "var(--seq-4)", ink: "text-white dark:text-background" },
  { min: 0.25, label: "25%+", bg: "var(--seq-5)", ink: "text-white dark:text-background" },
];
const levelOf = (share: number) => [...LEVELS].reverse().find((l) => share >= l.min)!;

export function Residence({
  school,
  detail,
  cited,
  citedStates,
  rank,
  id,
}: {
  id?: string;
  school: School;
  detail: SchoolDetail | null;
  /** citeField("demographics.residence", school) */
  cited: Cited;
  /** citeField("detail.home_states", school) */
  citedStates: Cited;
  /** Percentile rank of the out-of-state share (rankOf "outOfState"). */
  rank: number | null;
}) {
  const r = school.demographics.residence;
  if (!r) return null;
  const home = stateName(school.location.state);
  const unknown = unknownShare(r);
  const top = topHomeStates(detail, r.first_years);
  const rows = detail?.tables.home_states?.rows ?? {};
  const territories = Object.entries(rows).filter(([k]) => !stateByPostal(k)?.state).reduce((a, [, n]) => a + n, 0);
  const states = Object.keys(rows).filter((k) => stateByPostal(k)?.state).length;
  const maxTop = top[0]?.share ?? 1;

  return (
    <div id={id} className="rounded-3xl border bg-card p-4 sm:p-6 md:col-span-2">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h3 className="flex items-center gap-1 font-display text-lg font-bold">
          Where first-years come from <InfoTip term="in-state-student" cited={cited} />
          <SourceChip cited={cited} />
        </h3>
        <p className="text-sm text-muted-foreground">
          <b className="text-foreground">{num(r.first_years)}</b> first-time students <InfoTip term="first-time-student" />
        </p>
      </div>

      <p className="mb-4 max-w-3xl text-sm">
        <b>{pctSmart(r.out_of_state)}</b> came from other states and <b>{pctSmart(r.international)}</b> from abroad; <b>{pctSmart(r.in_state)}</b> are from {home}.
        {rank !== null && (
          <span className="text-muted-foreground">
            {" "}
            {rank >= 0.5 ? `More from other states than at ${pct(rank)} of colleges.` : `Fewer from other states than at ${pct(1 - rank)} of colleges.`}
          </span>
        )}
      </p>

      {/* 3-part bar: 2px surface gaps between parts; residence not reported stays muted at the end. */}
      <div
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
        role="img"
        aria-label={`First-years: ${PARTS.map((p) => `${p.label} ${pct(r[p.key])}`).join(", ")}${unknown >= 0.005 ? `, not reported ${pct(unknown)}` : ""}`}
      >
        {PARTS.map((p) =>
          r[p.key] > 0 ? <div key={p.key} className="h-full" style={{ width: `${r[p.key] * 100}%`, backgroundColor: p.color }} title={`${p.label}: ${pct(r[p.key])}`} /> : null
        )}
        {unknown >= 0.005 && <div className="h-full bg-muted" style={{ width: `${unknown * 100}%` }} title={`Not reported: ${pct(unknown)}`} />}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        {PARTS.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
            <span className="text-muted-foreground">{p.key === "in_state" ? `In-state (${home})` : p.label}</span>
            <b className="tabular-nums">{pctSmart(r[p.key])}</b>
          </li>
        ))}
        {unknown >= 0.005 && (
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-full bg-muted" aria-hidden />
            <span className="text-muted-foreground">Not reported</span>
            <b className="tabular-nums">{pctSmart(unknown)}</b>
          </li>
        )}
      </ul>

      {top.length > 0 && (
        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div>
            <h4 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              Top home states <SourceChip cited={citedStates} />
            </h4>
            <ol className="space-y-2.5">
              {top.map((t) => (
                <li key={t.state} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate">
                      {stateName(t.state)}
                      {t.state === school.location.state && <span className="ml-1 text-xs text-muted-foreground">(home state)</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <b>{pctSmart(t.share)}</b> <span className="text-xs text-muted-foreground">{num(t.count)}</span>
                    </span>
                  </div>
                  <span className="mt-1 block h-1.5 rounded-full bg-muted">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (t.share / maxTop) * 100)}%`, backgroundColor: "var(--seq-4)" }} />
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              From {states} {states === 1 ? "state" : "states"} (counting DC){territories > 0 ? ` and ${num(territories)} from U.S. territories` : ""}.
            </p>
          </div>

          <div>
            <div className="grid grid-cols-11 gap-0.5 sm:gap-1" role="list" aria-label={`Share of ${school.name} first-years from each state`}>
              {Object.entries(TILES).map(([st, [col, row]]) => {
                const n = rows[st] ?? 0;
                const share = n / r.first_years;
                const lv = n > 0 ? levelOf(share) : null;
                const isHome = st === school.location.state;
                return (
                  <span
                    key={st}
                    role="listitem"
                    title={`${stateName(st)}: ${n ? `${num(n)} first-year${n === 1 ? "" : "s"} (${pctSmart(share)})` : "none"}${isHome ? ", home state" : ""}`}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-[4px] text-[8px] leading-none font-bold sm:text-[10px]",
                      lv ? lv.ink : "bg-muted text-muted-foreground/60",
                      isHome && "ring-2 ring-foreground ring-offset-1 ring-offset-card"
                    )}
                    style={{ gridColumnStart: col + 1, gridRowStart: row + 1, ...(lv ? { backgroundColor: lv.bg } : {}) }}
                  >
                    {st}
                  </span>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
              <span>Share of first-years</span>
              <span className="inline-flex items-center gap-1">
                <span className="size-3 rounded-sm bg-muted" />
                None
              </span>
              {LEVELS.map((l) => (
                <span key={l.min} className="inline-flex items-center gap-1">
                  <span className="size-3 rounded-sm" style={{ backgroundColor: l.bg }} />
                  {l.label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1">
                <span className="size-3 rounded-sm ring-2 ring-foreground" />
                Home state
              </span>
            </div>
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Students starting college for the first time, by where they lived when admitted. Colleges report it every other fall.
      </p>
    </div>
  );
}
