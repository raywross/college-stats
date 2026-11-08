import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { StewardBack } from "@/components/admin/steward/Bits";
import { TodoTable } from "@/components/admin/steward/TodoTable";
import { todoLoginAction, todoLoginRemoveAction } from "@/app/admin/steward/actions";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import { listsByUnit } from "@/lib/admin/essays";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readLogins, readTodo } from "@/lib/admin/steward-reads";
import { TODO_KIND_LABEL, linkCls, pageParam, param } from "@/lib/admin/steward-view";
import { dayLabel } from "@/lib/admin/ops-view";
import { pageOf } from "@/lib/admin/health-view";
import { ASSISTANT_BATCH, assistantRows } from "@/lib/steward/todo-assistant";
import type { LoginDoc, TodoDoc } from "@/lib/steward/types";

export const metadata: Metadata = { title: "To do", robots: { index: false, follow: false } };

const KINDS = Object.keys(TODO_KIND_LABEL) as TodoDoc["kind"][];
const PER_PAGE = 100;

/**
 * `/admin/steward/todo` (specs/product/data-steward.md "Documents a person has to fetch"; specs/product/
 * todo-browser-agent.md): documents a machine couldn't get, from the Steward's rows and the engines' own records
 * (`reported.failures`, the queue's unreachable and not-a-url items, `directories.blocked`), highest reach first, each
 * with the page to open and why. Found (with the address, checked once), No document published, Done. `?kind=`
 * narrows; `?closed=1` shows the closed rows too; `?page=` pages. `?assistant=1` is the assistant view: one batch of
 * the rows the assistant in the owner's browser may work, with every form saying so. The Logins panel lists the hosts
 * the owner has an account on (`steward.logins`).
 */
export default async function TodoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const params = await searchParams;
  const rawKind = param(params.kind);
  const kind = KINDS.includes(rawKind as TodoDoc["kind"]) ? (rawKind as TodoDoc["kind"]) : null;
  const closed = param(params.closed) === "1";
  const assistant = param(params.assistant) === "1";
  const supabase = await adminSupabase();
  const client = supabase as unknown as StoreClient;
  const lists = await listsByUnit();
  const [all, logins] = await Promise.all([readTodo(client, { demand: lists }), readLogins(client)]);
  const byKind = all.filter((r) => !kind || r.kind === kind);
  const rows = assistant ? assistantRows(byKind, logins) : byKind.filter((r) => closed || r.status === "open" || r.status === "found");
  const page = assistant ? { rows, page: 1, pages: 1, total: rows.length, from: rows.length ? 1 : 0, to: rows.length } : pageOf(rows, pageParam(params.page), PER_PAGE);
  const href = (change: { kind?: TodoDoc["kind"] | null; closed?: boolean; page?: number; assistant?: boolean }) => {
    const q = new URLSearchParams();
    const k = change.kind === undefined ? kind : change.kind;
    if (k) q.set("kind", k);
    if (change.assistant ?? assistant) q.set("assistant", "1");
    else if (change.closed ?? closed) q.set("closed", "1");
    if (change.page && change.page > 1) q.set("page", String(change.page));
    const s = q.toString();
    return s ? `/admin/steward/todo?${s}` : "/admin/steward/todo";
  };
  const subtitle = assistant
    ? `The assistant's batch: up to ${ASSISTANT_BATCH} open rows it may work, highest reach first. Every button here records that the assistant pressed it.`
    : "Documents a machine couldn't fetch. Open the page in your own browser and say what you found.";

  return (
    <>
      <PageHeader help={assistant ? "to-do-assistant" : "to-do"} title={assistant ? "To do · assistant view" : "To do"} back={<StewardBack />} subtitle={subtitle} />
      <Panel help={assistant ? "to-do-assistant" : "to-do"} title={kind ? TODO_KIND_LABEL[kind] : "Every kind"} aside={<span className="text-sm text-muted-foreground">{rows.length.toLocaleString("en-US")} rows</span>}>
        <nav aria-label="Kinds" className="mb-3 flex flex-wrap gap-2 text-sm">
          {[null, ...KINDS].map((k) => (
            <Link key={k ?? "all"} href={href({ kind: k, page: 1 })} aria-current={k === kind ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-4 ${k === kind ? "border-primary font-semibold" : "border-border"}`}>
              {k ? TODO_KIND_LABEL[k] : "All"}
            </Link>
          ))}
          {!assistant && (
            <Link href={href({ closed: !closed, page: 1 })} className={`inline-flex min-h-11 items-center px-2 ${linkCls}`}>
              {closed ? "Hide closed rows" : "Show closed rows"}
            </Link>
          )}
          <Link href={href({ assistant: !assistant, page: 1 })} className={`inline-flex min-h-11 items-center px-2 ${linkCls}`}>
            {assistant ? "The whole list" : "Assistant view"}
          </Link>
        </nav>
        <p className="mb-3 text-sm text-muted-foreground" role="status">
          Highest reach first{lists ? ", then most-listed" : ""}
          {page.total > 0 ? ` · showing ${page.from} to ${page.to}` : ""}
          {assistant ? " · terms rows and logins on unlisted hosts left out" : ""}
        </p>
        <TodoTable rows={page.rows} ctx={{ assistant, logins }} />
        {page.pages > 1 && (
          <nav aria-label="To do pages" className="mt-3 flex items-center justify-between gap-3 text-sm">
            {page.page > 1 ? (
              <Link href={href({ page: page.page - 1 })} rel="prev" className={`inline-flex min-h-11 items-center ${linkCls}`}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">
              Page {page.page} of {page.pages}
            </span>
            {page.page < page.pages ? (
              <Link href={href({ page: page.page + 1 })} rel="next" className={`inline-flex min-h-11 items-center ${linkCls}`}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Panel>
      {!assistant && <LoginsPanel logins={logins} />}
    </>
  );
}

/** The hosts the owner has an account on: each with what the account is and the terms answer, Remove, and a form to add one. */
function LoginsPanel({ logins }: { logins: ReadonlyMap<string, LoginDoc> }) {
  const hosts = [...logins.values()].sort((a, b) => a.host.localeCompare(b.host));
  return (
    <Panel help="steward-logins" title="Logins" className="mt-5" aside={<span className="text-sm text-muted-foreground">{hosts.length} host{hosts.length === 1 ? "" : "s"}</span>}>
      <p className="mb-3 max-w-prose text-sm text-muted-foreground">
        Hosts you have an account on. A row behind their login can be worked from your browser, where you are already signed in; nothing about the login itself is kept here.
      </p>
      {hosts.length === 0 ? (
        <Empty>No hosts listed. Press I have a login here on a row behind a login, or add one below.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {hosts.map((l) => (
            <li key={l.host} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <div className="min-w-0">
                <span className="font-semibold">{l.host}</span>
                <span className="block text-muted-foreground">
                  {l.account} · {l.may_use ? "documents may be used" : "documents not for the site"} · added {dayLabel(l.added)}
                  {l.added_by ? ` by ${l.added_by}` : ""}
                  {l.note ? ` · ${l.note}` : ""}
                </span>
              </div>
              <AdminForm action={todoLoginRemoveAction} hidden={{ host: l.host }} trigger="Remove" pendingLabel="Removing…" description={`${l.host} leaves the list; rows behind its login go back to a person.`} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <AdminForm
          action={todoLoginAction}
          trigger="Add a host"
          pendingLabel="Saving…"
          fields={[
            { name: "host", label: "Host", type: "text", required: true, maxLength: 253, placeholder: "irp.example.edu" },
            { name: "account", label: "What the account is", type: "text", required: true, maxLength: 200, placeholder: "a counselor account" },
            { name: "may_use", label: "Documents from behind this login may be used on the site", type: "checkbox" },
            { name: "note", label: "Note (optional)", type: "text", maxLength: 500 },
          ]}
          description="Only the host and these words are kept. Sign in to the site in your own browser as usual."
        />
      </div>
    </Panel>
  );
}
