import Link from "next/link";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty } from "@/components/admin/Panel";
import { DocLink, TodoStatusChip } from "@/components/admin/steward/Bits";
import { todoDoneAction, todoFoundAction, todoNoDocumentAction } from "@/app/admin/data/steward-actions";
import { dayLabel } from "@/lib/admin/ops-view";
import { TODO_KIND_LABEL, TODO_WHY_LABEL, editionOf, linkCls, reviewHref } from "@/lib/admin/steward-view";
import type { TodoDoc } from "@/lib/steward/types";

const th = "px-3 py-2 font-medium";

/** Found, No document published, Done: the row's three actions (the closed ones offer only what still applies). */
export function TodoActions({ row }: { row: TodoDoc }) {
  return (
    <div className="flex min-w-44 flex-col items-start gap-2">
      {row.status !== "done" && (
        <AdminForm
          action={todoFoundAction}
          hidden={{ todo: row.key }}
          trigger="Found"
          tone="primary"
          pendingLabel="Saving…"
          fields={[
            { name: "url", label: "The document's address", type: "text", placeholder: "https://", required: true, maxLength: 2000, defaultValue: row.document_url ?? "" },
            { name: "note", label: "Note (optional)", type: "text", maxLength: 500 },
          ]}
          description="The next run of this college fetches it from this address."
        />
      )}
      {row.status !== "no-document" && row.status !== "done" && (
        <AdminForm
          action={todoNoDocumentAction}
          hidden={{ todo: row.key }}
          trigger="No document published"
          pendingLabel="Saving…"
          fields={[{ name: "note", label: "Where you looked (optional)", type: "text", maxLength: 500 }]}
          description="Closes the row: the college publishes no such document."
        />
      )}
      {row.status !== "done" && <AdminForm action={todoDoneAction} hidden={{ todo: row.key }} trigger="Done" pendingLabel="Saving…" />}
    </div>
  );
}

/**
 * The To do rows (specs/product/data-steward.md "Documents a person has to fetch"): the subject (a college links its
 * Review page), kind and edition, why a machine couldn't, the page to open, the host, reach and demand, the attempts,
 * the status, and the actions. Wide: scrolls in its own box on a phone.
 */
export function TodoTable({ rows }: { rows: TodoDoc[] }) {
  if (!rows.length) return <Empty>Nothing to fetch by hand.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[60rem] text-sm">
        <caption className="sr-only">Documents a person has to fetch, highest reach first</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th scope="col" className={th}>
              Subject
            </th>
            <th scope="col" className={th}>
              Why
            </th>
            <th scope="col" className={th}>
              Open
            </th>
            <th scope="col" className={`${th} text-right`}>
              Reach
            </th>
            <th scope="col" className={th}>
              Attempts
            </th>
            <th scope="col" className={th}>
              Status
            </th>
            <th scope="col" className={th}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const last = r.attempts.at(-1);
            return (
              <tr key={r.key} className="border-t border-border align-top" data-todo={r.key}>
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {r.unit_id ? (
                    <Link href={reviewHref(r.unit_id)} className={linkCls}>
                      {r.subject}
                    </Link>
                  ) : (
                    r.subject
                  )}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {TODO_KIND_LABEL[r.kind]}
                    {editionOf(r) ? ` · ${editionOf(r)}` : ""}
                    {r.unit_id ? ` · ${r.unit_id}` : ""}
                  </span>
                </th>
                <td className="px-3 py-2">{TODO_WHY_LABEL[r.why]}</td>
                <td className="max-w-56 px-3 py-2 text-xs">
                  {r.landing ? <DocLink url={r.landing}>{r.host ?? "The page"}</DocLink> : <span className="text-muted-foreground">{r.host ?? "No page known"}</span>}
                  {r.document_url && (
                    <span className="mt-0.5 block">
                      <DocLink url={r.document_url}>The document</DocLink>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.reach}
                  {r.demand ? <span className="block text-xs text-muted-foreground">on {r.demand} list{r.demand === 1 ? "" : "s"}</span> : null}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.attempts.length ? (
                    <>
                      {r.attempts.length} · last {dayLabel(last?.at)}
                      {last?.result ? <span className="block text-muted-foreground">{last.result}</span> : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <TodoStatusChip status={r.status} />
                  {r.note && <span className="mt-1 block max-w-48 text-xs text-muted-foreground">{r.note}</span>}
                </td>
                <td className="px-3 py-2">
                  <TodoActions row={r} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
