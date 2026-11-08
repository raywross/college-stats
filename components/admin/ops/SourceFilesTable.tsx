import type { SourceFileRow } from "@/lib/admin/source-files";
import { dateLabel, monthLabel } from "@/lib/releases";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";

/** The estimate inputs a source feeds, by source key; empty for sources the estimate doesn't read. */
export type FeedsBySource = Record<string, string[]>;

function Files({ row }: { row: SourceFileRow }) {
  return (
    <ul className="space-y-0.5">
      {row.files.map((f) => (
        <li key={f.file} className="font-mono text-xs">
          <a href={f.url} className="underline decoration-dotted underline-offset-2" rel="noreferrer" target="_blank">
            {f.file}
          </a>
        </li>
      ))}
    </ul>
  );
}

const published = (row: SourceFileRow) => (row.published ? dateLabel(row.published) : "No date on record");
const next = (row: SourceFileRow) => (row.next ? `${row.next.label}${row.next.expected ? `, expected ${monthLabel(row.next.expected)}` : ""}` : "None listed");

function Health({ row }: { row: SourceFileRow }) {
  return (
    <>
      <div title={row.reason}>
        <HealthChip status={row.status} />
      </div>
      <p className="mt-0.5 max-w-64 text-xs text-muted-foreground">{row.reason}</p>
    </>
  );
}

const columns: readonly Column<SourceFileRow>[] = [
  {
    key: "source",
    header: "Source and files",
    role: "title",
    cell: (row) => (
      <>
        {row.label}
        <Files row={row} />
      </>
    ),
  },
  { key: "describes", header: "Describes", cell: (row) => row.describes ?? <span className="text-muted-foreground">Not stated</span> },
  { key: "published", header: "Published (file dated)", cell: (row) => published(row) },
  { key: "collected", header: "Collected", cell: (row) => dateLabel(row.collected) },
  { key: "feeds", header: "Feeds the estimate" },
  { key: "next", header: "Next release", cell: (row) => next(row) },
  { key: "health", header: "Health", cell: (row) => <Health row={row} /> },
];

/**
 * Every published file the dataset is built from (specs/product/admin-health-views.md "Published files"), through
 * `ResponsiveTable`: the year it describes, its file date on the publisher's server, when the sync read it, which
 * estimate inputs it feeds, the next release, and its health with the reason beside the chip. Rows that feed the
 * estimate come first.
 */
export function SourceFilesTable({ rows, feeds }: { rows: SourceFileRow[]; feeds: FeedsBySource }) {
  const sorted = [...rows].sort((a, b) => Number((feeds[b.source]?.length ?? 0) > 0) - Number((feeds[a.source]?.length ?? 0) > 0));
  const cols = columns.map((c) => (c.key === "feeds" ? { ...c, cell: (row: SourceFileRow) => (feeds[row.source]?.length ? feeds[row.source].join(", ") : <span className="text-muted-foreground">No</span>) } : c));
  return <ResponsiveTable rows={sorted} columns={cols} rowKey={(row) => row.source} caption="Published files the dataset is built from" empty="No published file on record." />;
}
