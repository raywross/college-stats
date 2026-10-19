import type { SourceFileRow } from "@/lib/admin/source-files";
import { dateLabel, monthLabel } from "@/lib/releases";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";

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

/**
 * Every published file the dataset is built from (specs/product/admin-health-views.md "Published files"): the year it
 * describes, its file date on the publisher's server, when the sync read it, which estimate inputs it feeds, the next
 * release, and its health with the reason as the chip's tooltip. Rows that feed the estimate come first.
 */
export function SourceFilesTable({ rows, feeds }: { rows: SourceFileRow[]; feeds: FeedsBySource }) {
  const sorted = [...rows].sort((a, b) => Number((feeds[b.source]?.length ?? 0) > 0) - Number((feeds[a.source]?.length ?? 0) > 0));
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-border md:block">
        <table className="w-full min-w-[64rem] text-sm">
          <caption className="sr-only">Published files the dataset is built from</caption>
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Source and files
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Describes
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Published (file dated)
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Collected
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Feeds the estimate
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Next release
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Health
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.source} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {row.label}
                  <Files row={row} />
                </th>
                <td className="px-3 py-2">{row.describes ?? <span className="text-muted-foreground">Not stated</span>}</td>
                <td className="px-3 py-2">{published(row)}</td>
                <td className="px-3 py-2">{dateLabel(row.collected)}</td>
                <td className="px-3 py-2">{feeds[row.source]?.length ? feeds[row.source].join(", ") : <span className="text-muted-foreground">No</span>}</td>
                <td className="px-3 py-2">{next(row)}</td>
                <td className="px-3 py-2">
                  <div title={row.reason}>
                    <HealthChip status={row.status} />
                  </div>
                  <p className="mt-0.5 max-w-64 text-xs text-muted-foreground">{row.reason}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {sorted.map((row) => (
          <li key={row.source} className="rounded-2xl border border-border bg-card p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">{row.label}</p>
              <HealthChip status={row.status} />
            </div>
            <Files row={row} />
            <p className="mt-2">
              <span className="text-muted-foreground">Describes </span>
              {row.describes ?? "Not stated"}
            </p>
            <p>
              <span className="text-muted-foreground">Published </span>
              {published(row)}
              <span className="text-muted-foreground"> · collected </span>
              {dateLabel(row.collected)}
            </p>
            <p>
              <span className="text-muted-foreground">Feeds the estimate: </span>
              {feeds[row.source]?.length ? feeds[row.source].join(", ") : "No"}
            </p>
            <p>
              <span className="text-muted-foreground">Next: </span>
              {next(row)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{row.reason}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
