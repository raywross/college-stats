import Link from "next/link";
import { GROUP_LABELS, HEALTH_GROUPS } from "@/lib/admin/health-rules";
import { failureSummary, type HealthRowView } from "@/lib/admin/health-view";
import { dayLabel } from "@/lib/admin/ops-view";
import { pctSmart } from "@/lib/format";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";

const collegeHref = (unit: string) => `/admin/data/colleges/${unit}`;
const queueHref = (unit: string) => `/admin/data/colleges/${unit}/review`;

function Title({ row }: { row: HealthRowView }) {
  return (
    <>
      <Link href={collegeHref(row.health.unitId)} className="underline decoration-dotted underline-offset-2">
        {row.name}
      </Link>
      <div className="text-xs font-normal text-muted-foreground">
        {row.health.unitId}
        {row.state && ` · ${row.state}`}
      </div>
      <Changed row={row} />
    </>
  );
}

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

const columns: readonly Column<HealthRowView>[] = [
  { key: "college", header: "College", role: "title", cell: (row) => <Title row={row} /> },
  { key: "tier", header: "Tier and admit rate", cell: (row) => <Tier row={row} /> },
  { key: "overall", header: "Overall", cell: (row) => <HealthChip status={row.health.overall} /> },
  ...HEALTH_GROUPS.map((g): Column<HealthRowView> => ({ key: g, header: GROUP_LABELS[g], cell: (row) => <GroupCell row={row} group={g} /> })),
  { key: "failures", header: "Open failures", cell: (row) => <Failures row={row} /> },
  { key: "queue", header: "Queue", align: "right", cell: (row) => <Queue row={row} /> },
];

/**
 * Every college in the page's slice, through `ResponsiveTable`: a table from `md`, cards below it. The name links to
 * the college's page in the console. Each group cell shows its status, the date it is judged by, and the deciding
 * reason as its tooltip. The admit rate is cited once for the table by its source note, since every row shows the
 * same field.
 */
export function HealthTable({ rows }: { rows: HealthRowView[] }) {
  return (
    <ResponsiveTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.health.unitId}
      caption="Colleges by data health, worst first"
      empty="No college matches these filters."
    />
  );
}
