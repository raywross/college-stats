import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { requireAdmin } from "@/lib/admin/auth";
import { getData } from "@/lib/data";
import { ELITE_COUNT_RANGE } from "@/lib/selectivity";
import { SELECTIVITY_TIERS, SELECTIVITY_TIER_LABELS } from "@/lib/chances/levels";
import type { SelectivityTier } from "@/lib/chances/types";
import { followerTierEmails, historyInstalled, movers, runChanges, runs, tierCounts, type Pool } from "@/lib/admin/selectivity-history";
import { CAUSE_LABELS, DISPLAY_MOVE_MIN, POOL_LABELS, tierMoves, type PointCause, type RunChange } from "@/lib/admin/selectivity-history-view";
import { describeChange } from "@/lib/changes";
import type { FieldPath } from "@/lib/fields";

export const metadata: Metadata = { title: "Selectivity history", robots: { index: false, follow: false } };

const BASE = "/admin/selectivity";
const DAYS = [7, 30, 90] as const;
const POOLS: Pool[] = ["all", "in_state", "out_of_state"];

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const day = (iso: string) => dayFmt.format(new Date(iso));
const tierWord = (t: SelectivityTier | null) => (t ? SELECTIVITY_TIER_LABELS[t] : "Not rated");
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /admin/selectivity (specs/chances/selectivity-history.md "Across colleges"): the latest publish's tier moves and
 * Ultra selective count, the biggest movers over 7, 30, or 90 days, tier counts after each publish per pool, and the
 * method log, and the tier changes that went to followers. Filters are GET parameters: days, pool, tier, cause, every=1
 * ("show every change": method changes and moves under DISPLAY_MOVE_MIN), counts (the pool the counts table shows).
 */
export default async function SelectivityPage({ searchParams }: PageProps<"/admin/selectivity">) {
  await connection();
  await requireAdmin();
  const params = await searchParams;
  const days = (DAYS as readonly number[]).includes(Number(first(params.days))) ? (Number(first(params.days)) as 7 | 30 | 90) : 30;
  const poolParam = first(params.pool);
  const pool = POOLS.includes(poolParam as Pool) ? (poolParam as Pool) : undefined;
  const every = first(params.every) === "1";
  const tierParam = first(params.tier);
  const tier = SELECTIVITY_TIERS.includes(tierParam as SelectivityTier) ? (tierParam as SelectivityTier) : undefined;
  const causeParam = first(params.cause);
  const CAUSES: PointCause[] = ["data", "new", "unrated", "method", "backfill"];
  const cause = CAUSES.includes(causeParam as PointCause) ? (causeParam as PointCause) : undefined;
  const countsParam = first(params.counts);
  const countsPool: Pool = POOLS.includes(countsParam as Pool) ? (countsParam as Pool) : "all";

  if (!(await historyInstalled())) {
    return (
      <>
        <PageHeader title="Selectivity history" />
        <Empty>Not set up yet: apply supabase/migrations/20261013150000_selectivity_history.sql and 20261020120000_selectivity_history_one_row.sql, then publish: the publisher records the tiers at each publish.</Empty>
      </>
    );
  }

  const data = await getData();
  const name = (unit: string) => data.getSchoolById(unit)?.name ?? `College ${unit}`;
  const all = await runs();
  const latest = all[0] ?? null;
  const previous = all[1] ?? null;
  const [latestChanges, moved, counts, emails] = await Promise.all([
    latest ? runChanges(latest.id) : Promise.resolve([] as RunChange[]),
    movers({ days, pool, tier, cause, includeMethod: every, minMove: every ? 0 : DISPLAY_MOVE_MIN }),
    tierCounts(countsPool),
    followerTierEmails((c) => describeChange({ ...c, field: c.field as FieldPath, kind: c.kind as Parameters<typeof describeChange>[0]["kind"] })),
  ]);
  const moves = tierMoves(latestChanges);
  // The method log: each method, when it first shipped, and how many tier changes its method-change runs made.
  const methodRuns = all.filter((r) => r.cause === "method" || r === all.at(-1)).reverse();
  const methodChanges = await Promise.all(methodRuns.map(async (r) => ({ run: r, moves: r === all.at(-1) ? null : tierMoves(await runChanges(r.id)) })));
  const methods = [...new Map([...all].reverse().map((r) => [r.method, r])).values()].map((r) => ({ method: r.method, since: r.publishedAt }));

  const href = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { days: String(days), pool, tier, cause, every: every ? "1" : undefined, counts: countsPool === "all" ? undefined : countsPool, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `${BASE}?${s}` : BASE;
  };
  const collegeLink = (unit: string) => (
    <Link href={`/admin/colleges/${unit}#selectivity-history`} className="font-medium underline-offset-4 hover:underline">
      {name(unit)}
    </Link>
  );
  const moveList = (list: RunChange[]) => (
    <ul className="space-y-1">
      {list.map((c) => (
        <li key={`${c.unitId}-${c.pool}`}>
          {collegeLink(c.unitId)} <span className="text-muted-foreground">· {POOL_LABELS[c.pool]} ·</span> {tierWord(c.prevTier)} → {tierWord(c.tier)}
          {c.score !== null && <span className="text-muted-foreground tabular-nums"> ({c.score.toFixed(2)})</span>}
        </li>
      ))}
    </ul>
  );
  const chip = (label: string, active: boolean, to: string) => (
    <Link
      key={label}
      href={to}
      className={`inline-flex h-8 items-center rounded-full border px-3 text-sm ${active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
      aria-current={active ? "true" : undefined}
    >
      {label}
    </Link>
  );
  const [lo, hi] = ELITE_COUNT_RANGE;

  return (
    <>
      <PageHeader
        back={
          <Link href="/admin/colleges" className="text-muted-foreground underline-offset-4 hover:underline">
            Colleges
          </Link>
        }
        title="Selectivity history"
        subtitle={`${all.length} recorded ${all.length === 1 ? "publish" : "publishes"} · hidden values, never on the public site`}
      />
      <div className="space-y-5">
        <Panel title="Latest publish" id="latest">
          {!latest ? (
            <Empty>Nothing recorded yet: the publisher records the tiers at each publish.</Empty>
          ) : (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                {day(latest.publishedAt)} · method {latest.method} · {latest.cause === "method" ? "a method change" : latest.cause === "backfill" ? "backfilled from git" : "new figures"} ·{" "}
                {latest.rowsRecorded} {latest.rowsRecorded === 1 ? "row" : "rows"} recorded · Ultra selective for some pool{" "}
                {previous ? `${previous.eliteAnyPool} → ${latest.eliteAnyPool}` : latest.eliteAnyPool}
              </p>
              {moves.eliteIn.length + moves.eliteOut.length > 0 && (
                <p>
                  {moves.eliteIn.length > 0 && (
                    <>
                      <span className="font-semibold">Entered Ultra selective:</span> {moves.eliteIn.map(name).join(", ")}.{" "}
                    </>
                  )}
                  {moves.eliteOut.length > 0 && (
                    <>
                      <span className="font-semibold">Left Ultra selective:</span> {moves.eliteOut.map(name).join(", ")}.
                    </>
                  )}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-1 font-semibold">Up a tier ({moves.up.length})</h3>
                  {moves.up.length ? moveList(moves.up) : <p className="text-muted-foreground">None</p>}
                </div>
                <div>
                  <h3 className="mb-1 font-semibold">Down a tier ({moves.down.length})</h3>
                  {moves.down.length ? moveList(moves.down) : <p className="text-muted-foreground">None</p>}
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Movers" id="movers">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {DAYS.map((d) => chip(`${d} days`, d === days, href({ days: String(d) })))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {chip("Any pool", !pool, href({ pool: undefined }))}
            {POOLS.map((p) => chip(POOL_LABELS[p], pool === p, href({ pool: p })))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {chip("Show every change", every, href({ every: every ? undefined : "1" }))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {chip("Any tier", !tier, href({ tier: undefined }))}
            {SELECTIVITY_TIERS.map((t) => chip(SELECTIVITY_TIER_LABELS[t], tier === t, href({ tier: t })))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {chip("Any cause", !cause, href({ cause: undefined }))}
            {CAUSES.filter((c) => every || (c !== "method" && c !== "backfill")).map((c) => chip(CAUSE_LABELS[c], cause === c, href({ cause: c })))}
          </div>
          {!every && (
            <p className="mb-3 text-xs text-muted-foreground">
              Hiding method changes and moves under {DISPLAY_MOVE_MIN} points. Every change is recorded; &ldquo;Show every change&rdquo; lists them.
            </p>
          )}
          {moved.length === 0 ? (
            <Empty>No moves in the last {days} days{every ? "" : ` of ${DISPLAY_MOVE_MIN} points or more, or across a tier`}.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">College</th>
                    <th className="py-1.5 pr-3 font-medium">Pool</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Score</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Change</th>
                    <th className="py-1.5 pr-3 font-medium">Tier</th>
                    <th className="py-1.5 pr-3 font-medium">Cause</th>
                    <th className="py-1.5 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {moved.map((m) => (
                    <tr key={`${m.unitId}-${m.pool}`}>
                      <td className="py-1.5 pr-3">{collegeLink(m.unitId)}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{POOL_LABELS[m.pool]}</td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap tabular-nums">
                        {m.scoreFrom === null ? "—" : m.scoreFrom.toFixed(2)} → {m.scoreTo === null ? "—" : m.scoreTo.toFixed(2)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{m.delta === null ? "new" : `${m.delta > 0 ? "+" : "−"}${Math.abs(m.delta).toFixed(2)}`}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{m.tierFrom === m.tierTo ? tierWord(m.tierTo) : `${tierWord(m.tierFrom)} → ${tierWord(m.tierTo)}`}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{CAUSE_LABELS[m.cause]}</td>
                      <td className="py-1.5 whitespace-nowrap tabular-nums">{day(m.movedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Follower emails" id="followers">
          {emails.length === 0 ? (
            <Empty>No tier change has gone to followers yet. They go out with the update email after a publish that changes a college&apos;s public tier (never for a method change).</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {emails.map((e) => (
                <li key={`${e.publishId}-${e.unitId}-${e.field}`} className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="min-w-0">
                    {collegeLink(e.unitId)} <span className="text-muted-foreground">·</span> {e.sentence}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {day(e.publishedAt)} · {e.followers} {e.followers === 1 ? "follower" : "followers"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Tier counts after each publish" id="counts">
          <div className="mb-3 flex flex-wrap gap-2">{POOLS.map((p) => chip(POOL_LABELS[p], countsPool === p, href({ counts: p === "all" ? undefined : p })))}</div>
          {counts.length === 0 ? (
            <Empty>Nothing recorded yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Publish</th>
                    {SELECTIVITY_TIERS.map((t) => (
                      <th key={t} className="py-1.5 pr-3 text-right font-medium">
                        {SELECTIVITY_TIER_LABELS[t]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {counts.map((c, i) => {
                    const elite = c.counts.elite ?? 0;
                    const outside = countsPool === "all" && (elite < lo || elite > hi);
                    return (
                      <tr key={`${c.publishedAt}-${i}`}>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {day(c.publishedAt)} <span className="text-xs text-muted-foreground">· {c.method}{c.cause === "method" ? " (new method)" : ""}</span>
                        </td>
                        {SELECTIVITY_TIERS.map((t) => (
                          <td key={t} className={`py-1.5 pr-3 text-right tabular-nums ${t === "elite" && outside ? "font-semibold text-destructive" : ""}`}>
                            {c.counts[t] ?? 0}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                Ultra selective is held to {lo}–{hi} colleges for all applicants (ELITE_COUNT_RANGE); a count outside it is in red.
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Method log" id="methods">
          {methods.length === 0 ? (
            <Empty>Nothing recorded yet.</Empty>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {methods.map((m) => {
                const run = methodChanges.find((x) => x.run.method === m.method && x.moves);
                const n = run?.moves ? run.moves.up.length + run.moves.down.length : null;
                return (
                  <li key={m.method} className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span>
                      <span className="font-mono">{m.method}</span> <span className="text-muted-foreground">since {day(m.since)}</span>
                    </span>
                    <span className="text-muted-foreground">{n === null ? "first recorded method" : `${n} tier ${n === 1 ? "change" : "changes"} when it shipped`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
