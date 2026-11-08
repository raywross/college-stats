import Link from "next/link";
import type { HealthCounts } from "@/lib/admin/health";
import { GROUP_LABELS, HEALTH_GROUPS, HEALTH_STATUSES, STATUS_LABELS } from "@/lib/admin/health-rules";
import { healthHref, type HealthFilters } from "@/lib/admin/health-view";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { cn } from "@/lib/utils";

const BASE = "/admin/data/health?tab=sources";
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

      <GroupTable counts={counts} filters={filters} hasUnjudged={hasUnjudged} />
    </section>
  );
}

function GroupTable({ counts, filters, hasUnjudged }: { counts: HealthCounts; filters: HealthFilters; hasUnjudged: boolean }) {
  const statuses = [...HEALTH_STATUSES].reverse();
  const clear = healthHref(BASE, filters, { group: null, status: null });
  const columns: Column<(typeof HEALTH_GROUPS)[number]>[] = [
    { key: "group", header: "Group", role: "title", cell: (g) => GROUP_LABELS[g] },
    ...statuses.map((s): Column<(typeof HEALTH_GROUPS)[number]> => ({
      key: s,
      header: STATUS_LABELS[s],
      align: "right",
      cell: (g) => <GroupCell n={counts.groups[g][s]} on={filters.group === g && filters.status === s} href={healthHref(BASE, filters, { group: g, status: s })} clear={clear} />,
    })),
  ];
  if (hasUnjudged) {
    columns.push({
      key: "unjudged",
      header: "Not judged",
      align: "right",
      cell: (g) => <GroupCell n={counts.groups[g].unjudged} on={filters.group === g && filters.status === "unjudged"} href={healthHref(BASE, filters, { group: g, status: "unjudged" })} clear={clear} />,
    });
  }
  return <ResponsiveTable rows={HEALTH_GROUPS} columns={columns} rowKey={(g) => g} caption="By data group" empty="No data group." />;
}

function GroupCell({ n, on, href, clear }: { n: number; on: boolean; href: string; clear: string }) {
  return n === 0 ? (
    <span className="text-muted-foreground">0</span>
  ) : (
    <Link href={on ? clear : href} aria-current={on ? "true" : undefined} className={cn("inline-flex min-h-11 items-center rounded-md px-1.5 underline decoration-dotted underline-offset-2", on && "bg-foreground text-background no-underline")}>
      {num(n)}
    </Link>
  );
}
