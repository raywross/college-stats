import Link from "next/link";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty } from "@/components/admin/Panel";
import type { HeldEssay, QueueRow } from "@/lib/admin/review-queue";
import { documentLabel, itemEdition, itemValue, safeHref } from "@/lib/admin/ops-view";
import { acceptHeldAction, rediscoverHeldAction, rejectHeldAction } from "@/app/admin/data/actions";

const FAILURES_SHOWN = 3;
const linkCls = "underline decoration-dotted underline-offset-2";

function listsLabel(n: number | undefined): string | null {
  return n ? `on ${n} ${n === 1 ? "list" : "lists"}` : null;
}

function Actions({ row }: { row: QueueRow }) {
  return (
    <div className="flex min-w-48 flex-col items-start gap-2">
      {row.accept.ok ? (
        <AdminForm
          action={acceptHeldAction}
          hidden={{ item: row.id }}
          trigger="Accept the value"
          tone="primary"
          pendingLabel="Saving…"
          description={
            <>
              Saves {row.accept.fields.map((f, i) => (
                <span key={f}>
                  {i > 0 ? ", " : ""}
                  <span className="font-mono">{f}</span>
                </span>
              ))}{" "}
              as edits by Quad, noting the document, and marks the item accepted. The next snapshot publishes them.
            </>
          }
        />
      ) : (
        <p className="max-w-64 text-xs text-muted-foreground">Can&apos;t accept: {row.accept.message}</p>
      )}
      <AdminForm
        action={rejectHeldAction}
        hidden={{ item: row.id }}
        trigger="Reject"
        pendingLabel="Saving…"
        fields={[{ name: "note", label: "Why (optional)", type: "textarea", maxLength: 500 }]}
        description="Keeps this value off the site; the next run won't hold the same document's value again."
      />
      <AdminForm
        action={rediscoverHeldAction}
        hidden={{ item: row.id }}
        trigger="Re-run discovery"
        pendingLabel="Starting…"
        description="Starts a run that finds this college's documents from scratch."
      />
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

function Document({ url }: { url: string | undefined }) {
  const href = safeHref(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`break-all ${linkCls}`}>
      {documentLabel(url)}
    </a>
  ) : (
    <span className="text-muted-foreground">{documentLabel(url)}</span>
  );
}

/** Above this many open items, Holds points at Issues, where the queue is grouped by cause (specs/product/data-steward.md). */
export const ISSUES_POINTER_AT = 500;

/** One line pointing at Issues when the queue is large; nothing otherwise. */
export function IssuesPointer({ open }: { open: number }) {
  if (open <= ISSUES_POINTER_AT) return null;
  return (
    <p role="note" className="rounded-2xl border border-border bg-card p-3 text-sm">
      {open.toLocaleString("en-US")} items are open: Issues groups them by cause, so one decision settles many.{" "}
      <Link href="/admin/data/issues" className={`font-semibold ${linkCls}`}>
        Open Issues
      </Link>
    </p>
  );
}

/**
 * The held review items (specs/data-platform/change-sets.md "Holds and review"): college (with how many families'
 * lists it is on), template code, edition, the value read, each failed check, the document, and the three actions.
 * Accept the value is offered only when `acceptPlan` allows it; otherwise its refusal is shown in its place. Wide: it
 * scrolls inside its own box on a phone.
 */
export function HeldItemsTable({ rows, lists }: { rows: QueueRow[]; lists: ReadonlyMap<string, number> | null }) {
  if (!rows.length) return <Empty>No held items match.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[60rem] text-sm">
        <caption className="sr-only">Held review items, most-listed college first</caption>
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
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const listed = listsLabel(lists?.get(row.item.unit_id));
            return (
              <tr key={row.id} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <Link href={`/admin/colleges/${row.item.unit_id}`} className={linkCls}>
                    {row.item.name}
                  </Link>
                  <div className="text-xs font-normal text-muted-foreground">
                    {row.item.unit_id}
                    {listed ? ` · ${listed}` : ""}
                  </div>
                </th>
                <td className="px-3 py-2 font-mono text-xs">{row.item.code ?? "C1"}</td>
                <td className="px-3 py-2">{itemEdition(row.item)}</td>
                <td className="px-3 py-2">{itemValue(row.item)}</td>
                <td className="max-w-80 px-3 py-2">
                  <Checks row={row} />
                </td>
                <td className="max-w-56 px-3 py-2 text-xs">
                  <Document url={row.item.urls[0]} />
                </td>
                <td className="px-3 py-2">
                  <Actions row={row} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The essay reader's held records: the run read the college's page but its checks held the questions. Each links to
 * the college's hand-read form (/admin/essays/[unit]), where a saved read is live at once.
 */
export function HeldEssaysList({ records, lists }: { records: HeldEssay[]; lists: ReadonlyMap<string, number> | null }) {
  if (!records.length) return <Empty>No essay questions are held.</Empty>;
  return (
    <ul className="divide-y rounded-2xl border bg-background" aria-label="Held essay questions">
      {records.map((r) => {
        const listed = listsLabel(lists?.get(r.unit_id));
        const page = typeof r.record?.url === "string" ? r.record.url : undefined;
        return (
          <li key={r.unit_id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-3" data-unit={r.unit_id}>
            <span className="min-w-0 space-y-0.5">
              <span className="block font-semibold break-words">{r.name}</span>
              <span className="block text-xs text-muted-foreground">
                {r.unit_id} · held {r.held}
                {listed ? ` · ${listed}` : ""}
              </span>
              {r.problems.length > 0 && <span className="block text-xs">{r.problems.slice(0, FAILURES_SHOWN).join("; ")}</span>}
              {page && (
                <span className="block text-xs">
                  <Document url={page} />
                </span>
              )}
            </span>
            <Link href={`/admin/essays/${r.unit_id}`} className="inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">
              Enter the questions
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
