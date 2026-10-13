import Link from "next/link";
import type { HealthCounts } from "@/lib/admin/health";
import { GROUP_LABELS, HEALTH_GROUPS, HEALTH_STATUSES, STATUS_LABELS } from "@/lib/admin/health-rules";
import { healthHref, type HealthFilters } from "@/lib/admin/health-view";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";
import { cn } from "@/lib/utils";

const BASE = "/admin/health";
const num = (n: number) => n.toLocaleString("en-US");

/**
 * The stat row (charts.md rules: a number is the headline, the word beside it says what it counts, status is a word
 * before it is a mark): colleges by overall status, then a small grid of colleges by status in each data group. Every
 * number is a link to the table filtered to it, and the filter on now is outlined. The counts cover every college,
 * not the filtered rows.
 */
export function HealthStats({ counts, filters }: { counts: HealthCounts; filters: HealthFilters }) {
  const overallOn = (s: string) => filters.status === s && !filters.group;
  const hasUnjudged = HEALTH_GROUPS.some((g) => counts.groups[g].unjudged > 0);
  return (
    <section aria-labelledby="health-stats" className="space-y-4">
      <h2 id="health-stats" className="sr-only">
        Colleges by data health
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <li className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Colleges</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums">{num(counts.total)}</p>
        </li>
        {HEALTH_STATUSES.slice()
          .reverse()
          .map((s) => (
            <li key={s}>
              <Link
                href={healthHref(BASE, filters, { status: overallOn(s) ? null : s, group: null })}
                aria-current={overallOn(s) ? "true" : undefined}
                className={cn("block h-full rounded-2xl border bg-card p-4 transition-colors hover:bg-muted", overallOn(s) ? "border-foreground ring-1 ring-foreground" : "border-border")}
              >
                <HealthChip status={s} className="text-muted-foreground" />
                <p className="mt-1 font-display text-3xl font-bold tabular-nums">
                  {num(counts.overall[s])}
                  <span className="sr-only"> {STATUS_LABELS[s]} colleges</span>
                </p>
              </Link>
            </li>
          ))}
      </ul>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[30rem] text-sm">
          <caption className="px-4 pt-3 text-left text-sm font-semibold">By data group</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">
                Group
              </th>
              {HEALTH_STATUSES.slice()
                .reverse()
                .map((s) => (
                  <th key={s} scope="col" className="px-3 py-2 text-right font-medium">
                    {STATUS_LABELS[s]}
                  </th>
                ))}
              {hasUnjudged && (
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Not judged
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {HEALTH_GROUPS.map((g) => (
              <tr key={g} className="border-t border-border">
                <th scope="row" className="px-4 py-2 text-left font-medium">
                  {GROUP_LABELS[g]}
                </th>
                {HEALTH_STATUSES.slice()
                  .reverse()
                  .map((s) => (
                    <GroupCell key={s} n={counts.groups[g][s]} on={filters.group === g && filters.status === s} href={healthHref(BASE, filters, { group: g, status: s })} clear={healthHref(BASE, filters, { group: null, status: null })} />
                  ))}
                {hasUnjudged && <GroupCell n={counts.groups[g].unjudged} on={filters.group === g && filters.status === "unjudged"} href={healthHref(BASE, filters, { group: g, status: "unjudged" })} clear={healthHref(BASE, filters, { group: null, status: null })} />}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GroupCell({ n, on, href, clear }: { n: number; on: boolean; href: string; clear: string }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {n === 0 ? (
        <span className="text-muted-foreground">0</span>
      ) : (
        <Link href={on ? clear : href} aria-current={on ? "true" : undefined} className={cn("inline-block min-w-8 rounded-md px-1.5 py-0.5 underline decoration-dotted underline-offset-2", on && "bg-foreground text-background no-underline")}>
          {num(n)}
        </Link>
      )}
    </td>
  );
}
