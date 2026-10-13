import Link from "next/link";
import { GROUP_LABELS, HEALTH_GROUPS } from "@/lib/admin/health-rules";
import { failureSummary, type HealthRowView } from "@/lib/admin/health-view";
import { dayLabel } from "@/lib/admin/ops-view";
import { pctSmart } from "@/lib/format";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";

const collegeHref = (unit: string) => `/admin/colleges/${unit}`;
const queueHref = (unit: string) => `/admin/operations?unit=${unit}#review-queue`;

function GroupCell({ row, group }: { row: HealthRowView; group: (typeof HEALTH_GROUPS)[number] }) {
  const r = row.health.rows.find((x) => x.group === group);
  if (!r) return <span className="text-muted-foreground">—</span>;
  return (
    <div title={r.reason}>
      <HealthChip status={r.status} />
      <div className="text-xs text-muted-foreground">{dayLabel(r.judgedBy)}</div>
    </div>
  );
}

function Failures({ row }: { row: HealthRowView }) {
  const f = row.health.failures;
  return f.length ? <span>{failureSummary(f)}</span> : <span className="text-muted-foreground">None</span>;
}

function Queue({ row }: { row: HealthRowView }) {
  const n = row.health.queueItems;
  return n ? (
    <Link href={queueHref(row.health.unitId)} className="underline decoration-dotted underline-offset-2">
      {n.toLocaleString("en-US")}
    </Link>
  ) : (
    <span className="text-muted-foreground">0</span>
  );
}

function Tier({ row }: { row: HealthRowView }) {
  return (
    <>
      <span>{row.tier.label}</span>
      <span className="text-muted-foreground"> · {row.admitRate === null ? "no admit rate" : `${pctSmart(row.admitRate)} admitted`}</span>
    </>
  );
}

function Changed({ row }: { row: HealthRowView }) {
  const c = row.health.changed;
  return c ? (
    <span className="text-xs text-muted-foreground">
      Changed {dayLabel(c.at)} ({c.fields} field{c.fields === 1 ? "" : "s"})
    </span>
  ) : null;
}

/**
 * Every college in the page's slice: a table from `md`, cards below it (the console supports phones but doesn't favor
 * them). The name links to the college's page in the console (`/admin/colleges/[unit]`, built with the hidden-values
 * unit). Each group cell shows its status, the date it is judged by, and the deciding reason as its tooltip. The admit
 * rate is cited once for the table by its source note, since every row shows the same field.
 */
export function HealthTable({ rows }: { rows: HealthRowView[] }) {
  if (!rows.length) {
    return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No college matches these filters.</p>;
  }
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-border md:block">
        <table className="w-full min-w-[64rem] text-sm">
          <caption className="sr-only">Colleges by data health, worst first</caption>
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                College
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Tier and admit rate
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Overall
              </th>
              {HEALTH_GROUPS.map((g) => (
                <th key={g} scope="col" className="px-3 py-2 font-medium">
                  {GROUP_LABELS[g]}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-medium">
                Open failures
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Queue
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.health.unitId} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <Link href={collegeHref(row.health.unitId)} className="underline decoration-dotted underline-offset-2">
                    {row.name}
                  </Link>
                  <div className="text-xs font-normal text-muted-foreground">
                    {row.health.unitId}
                    {row.state && ` · ${row.state}`}
                  </div>
                  <Changed row={row} />
                </th>
                <td className="px-3 py-2">
                  <Tier row={row} />
                </td>
                <td className="px-3 py-2">
                  <HealthChip status={row.health.overall} />
                </td>
                {HEALTH_GROUPS.map((g) => (
                  <td key={g} className="px-3 py-2">
                    <GroupCell row={row} group={g} />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <Failures row={row} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <Queue row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.health.unitId} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={collegeHref(row.health.unitId)} className="font-semibold underline decoration-dotted underline-offset-2">
                  {row.name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {row.health.unitId}
                  {row.state && ` · ${row.state}`}
                </div>
              </div>
              <HealthChip status={row.health.overall} />
            </div>
            <p className="mt-1 text-sm">
              <Tier row={row} />
            </p>
            <Changed row={row} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              {HEALTH_GROUPS.map((g) => (
                <div key={g}>
                  <div className="text-xs font-medium text-muted-foreground">{GROUP_LABELS[g]}</div>
                  <GroupCell row={row} group={g} />
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm">
              <span className="text-muted-foreground">Open failures: </span>
              <Failures row={row} />
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Review queue: </span>
              <Queue row={row} />
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
