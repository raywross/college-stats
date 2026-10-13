import Link from "next/link";
import type { QueueRow } from "@/lib/admin/review-queue";
import { documentLabel, itemEdition, itemValue, safeHref } from "@/lib/admin/ops-view";
import { acceptAction, rediscoverAction, rejectAction } from "@/app/admin/operations/actions";
import { OpsActionForm } from "@/components/admin/ops/OpsActionForm";

const FAILURES_SHOWN = 3;

function Actions({ row }: { row: QueueRow }) {
  if (row.status !== "open") {
    return (
      <span className="text-sm text-muted-foreground">
        {row.status === "accepted" ? "Accepted into the overrides" : "Rejected"}
        {row.item.resolved_on ? ` on ${row.item.resolved_on}` : ""}
      </span>
    );
  }
  return (
    <div className="flex min-w-48 flex-col gap-2">
      {row.accept.ok ? (
        <OpsActionForm action={acceptAction} fields={{ item: row.id }} label="Accept" pendingLabel="Opening…" confirm="Write this value as an override?" />
      ) : (
        <p className="max-w-64 text-xs text-muted-foreground">Can&apos;t accept: {row.accept.message}</p>
      )}
      <OpsActionForm action={rejectAction} fields={{ item: row.id }} label="Reject" pendingLabel="Opening…" tone="neutral" confirm="Keep this value out of the site?" />
      <OpsActionForm action={rediscoverAction} fields={{ item: row.id }} label="Re-run discovery" pendingLabel="Starting…" tone="neutral" confirm="Find this college's documents again?" />
    </div>
  );
}

function Checks({ row }: { row: QueueRow }) {
  const failures = row.item.failures;
  if (!failures.length) return <span className="text-muted-foreground">None recorded</span>;
  return (
    <ul className="space-y-1">
      {failures.slice(0, FAILURES_SHOWN).map((f, i) => (
        <li key={i} className="text-xs">
          <span className="font-semibold">{f.check}</span>
          {f.detail && <span className="text-muted-foreground">: {f.detail}</span>}
        </li>
      ))}
      {failures.length > FAILURES_SHOWN && <li className="text-xs text-muted-foreground">and {failures.length - FAILURES_SHOWN} more</li>}
    </ul>
  );
}

function Document({ row }: { row: QueueRow }) {
  const url = row.item.urls[0];
  const href = safeHref(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all underline decoration-dotted underline-offset-2">
      {documentLabel(url)}
    </a>
  ) : (
    <span className="text-muted-foreground">{documentLabel(url)}</span>
  );
}

/**
 * The review queue as a table: college, template code, edition, the value read, each failed check with its detail, the
 * document, and the three fixes. Accept is offered only when `acceptPlan` allows it (lib/admin/review-queue.ts);
 * otherwise the plan's refusal is shown in its place. Wide: it scrolls inside its own box on a phone.
 */
export function ReviewQueueTable({ rows }: { rows: QueueRow[] }) {
  if (!rows.length) {
    return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No review-queue items match.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[60rem] text-sm">
        <caption className="sr-only">Review-queue items</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              College
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Code
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Edition
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Value read
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Failed checks
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Document
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Fix
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border align-top">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                <Link href={`/admin/colleges/${row.item.unit_id}`} className="underline decoration-dotted underline-offset-2">
                  {row.item.name}
                </Link>
                <div className="text-xs font-normal text-muted-foreground">{row.item.unit_id}</div>
              </th>
              <td className="px-3 py-2 font-mono text-xs">{row.item.code ?? "C1"}</td>
              <td className="px-3 py-2">{itemEdition(row.item)}</td>
              <td className="px-3 py-2">{itemValue(row.item)}</td>
              <td className="max-w-80 px-3 py-2">
                <Checks row={row} />
              </td>
              <td className="max-w-56 px-3 py-2 text-xs">
                <Document row={row} />
              </td>
              <td className="px-3 py-2">
                <Actions row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
