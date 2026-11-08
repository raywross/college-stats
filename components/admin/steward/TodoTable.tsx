import Link from "next/link";
import { AdminForm } from "@/components/admin/AdminForm";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { DocLink, TodoStatusChip } from "@/components/admin/steward/Bits";
import { todoDoneAction, todoFoundAction, todoNoDocumentAction } from "@/app/admin/steward/actions";
import { dayLabel } from "@/lib/admin/ops-view";
import { attemptResultWords } from "@/lib/admin/words";
import { TODO_KIND_LABEL, TODO_WHY_LABEL, editionOf, linkCls, reviewHref } from "@/lib/admin/steward-view";
import type { TodoDoc } from "@/lib/steward/types";

/** Found, No document published, Done: the row's three actions (the closed ones offer only what still applies). */
export function TodoActions({ row }: { row: TodoDoc }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {row.status !== "done" && (
        <AdminForm
          action={todoFoundAction}
          hidden={{ todo: row.key }}
          trigger="Found"
          tone="primary"
          pendingLabel="Saving…"
          sheet
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
          sheet
          fields={[{ name: "note", label: "Where you looked (optional)", type: "text", maxLength: 500 }]}
          description="Closes the row: the college publishes no such document."
        />
      )}
      {row.status !== "done" && <AdminForm action={todoDoneAction} hidden={{ todo: row.key }} trigger="Done" pendingLabel="Saving…" />}
    </div>
  );
}

function Subject({ r }: { r: TodoDoc }) {
  return (
    <>
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
    </>
  );
}

function Open({ r }: { r: TodoDoc }) {
  return (
    <>
      {r.landing ? <DocLink url={r.landing}>{r.host ?? "The page"}</DocLink> : <span className="text-muted-foreground">{r.host ?? "No page known"}</span>}
      {r.document_url && (
        <span className="mt-0.5 block">
          <DocLink url={r.document_url}>The document</DocLink>
        </span>
      )}
    </>
  );
}

/** The last attempt's result in words: the explanation as the text, the reason in words and its code in the title. */
function AttemptResult({ result }: { result: string }) {
  const w = attemptResultWords(result);
  const title = w.code ? [`${w.label} (${w.code})`, w.key].filter(Boolean).join(" · ") : undefined;
  return (
    <span className="block text-muted-foreground" title={title}>
      {w.text}
    </span>
  );
}

function Attempts({ r }: { r: TodoDoc }) {
  const last = r.attempts.at(-1);
  return r.attempts.length ? (
    <>
      {r.attempts.length} · last {dayLabel(last?.at)}
      {last?.result ? <AttemptResult result={last.result} /> : null}
    </>
  ) : (
    <span className="text-muted-foreground">None</span>
  );
}

function Status({ r }: { r: TodoDoc }) {
  return (
    <>
      <TodoStatusChip status={r.status} />
      {r.note && <span className="mt-1 block text-xs text-muted-foreground">{r.note}</span>}
    </>
  );
}

const columns: readonly Column<TodoDoc>[] = [
  { key: "subject", header: "Subject", role: "title", cell: (r) => <Subject r={r} /> },
  { key: "why", header: "Why", cell: (r) => TODO_WHY_LABEL[r.why] },
  { key: "open", header: "Open", cell: (r) => <Open r={r} /> },
  { key: "reach", header: "Reach", align: "right", cell: (r) => (r.demand ? `${r.reach} (on ${r.demand} list${r.demand === 1 ? "" : "s"})` : r.reach) },
  { key: "attempts", header: "Attempts", role: "detail", cell: (r) => <Attempts r={r} /> },
  { key: "status", header: "Status", cell: (r) => <Status r={r} /> },
  { key: "actions", header: "Actions", role: "actions", cell: (r) => <TodoActions row={r} /> },
];

/**
 * The To do rows (specs/product/data-steward.md "Documents a person has to fetch"), through `ResponsiveTable`: the
 * subject (a college links its Review page), kind and edition, why a machine couldn't, the page to open, reach and
 * demand, the attempts (folded on a phone), the status, and the actions.
 */
export function TodoTable({ rows }: { rows: TodoDoc[] }) {
  return <ResponsiveTable rows={rows} columns={columns} rowKey={(r) => r.key} caption="Documents a person has to fetch, highest reach first" empty="Nothing to fetch by hand." />;
}
