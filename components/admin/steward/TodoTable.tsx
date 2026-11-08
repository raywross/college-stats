import Link from "next/link";
import { AdminForm } from "@/components/admin/AdminForm";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { DocLink, StewardWords, TodoStatusChip } from "@/components/admin/steward/Bits";
import { todoDoneAction, todoFoundAction, todoLoginAction, todoNoDocumentAction } from "@/app/admin/steward/actions";
import { dayLabel } from "@/lib/admin/ops-view";
import { attemptResultWords } from "@/lib/admin/words";
import { TODO_KIND_LABEL, TODO_WHY_LABEL, editionOf, linkCls, reviewHref, todoHref } from "@/lib/admin/steward-view";
import { BY_ASSISTANT, loginFor } from "@/lib/steward/todo-assistant";
import type { LoginDoc, TodoDoc } from "@/lib/steward/types";

/** What the table and the row page know besides the rows: who presses the buttons, and the owner's logins. */
export interface TodoContext {
  /** The assistant view: every form says the assistant pressed it. */
  assistant?: boolean;
  logins?: ReadonlyMap<string, LoginDoc>;
}

const NO_LOGINS: ReadonlyMap<string, LoginDoc> = new Map();

/**
 * Found, No document published, Done: the row's three actions (the closed ones offer only what still applies). A row
 * behind a login whose host isn't listed also offers "I have a login here" to a person (never in the assistant view).
 */
export function TodoActions({ row, ctx = {} }: { row: TodoDoc; ctx?: TodoContext }) {
  const hidden: Record<string, string> = ctx.assistant ? { todo: row.key, by: BY_ASSISTANT } : { todo: row.key };
  const login = loginFor(row, ctx.logins ?? NO_LOGINS);
  return (
    <div className="flex flex-wrap items-start gap-2">
      {row.status !== "done" && (
        <AdminForm
          action={todoFoundAction}
          hidden={hidden}
          trigger="Found"
          tone="primary"
          pendingLabel="Checking…"
          sheet
          fields={[
            { name: "url", label: "The document's address", type: "text", placeholder: "https://", required: true, maxLength: 2000, defaultValue: row.document_url ?? "" },
            { name: "note", label: "Note (optional)", type: "text", maxLength: 500, hint: "The edition you read on its cover, and anything the next person should know." },
          ]}
          description="The address is checked once from here, and the next run of this college fetches it."
        />
      )}
      {row.status !== "no-document" && row.status !== "done" && (
        <AdminForm
          action={todoNoDocumentAction}
          hidden={hidden}
          trigger="No document published"
          pendingLabel="Saving…"
          sheet
          fields={[{ name: "note", label: "Where you looked (optional)", type: "text", maxLength: 500 }]}
          description="Closes the row: the college publishes no such document."
        />
      )}
      {row.status !== "done" && <AdminForm action={todoDoneAction} hidden={hidden} trigger="Done" pendingLabel="Saving…" />}
      {row.why === "login" && row.host && !login && !ctx.assistant && row.status === "open" && (
        <AdminForm
          action={todoLoginAction}
          hidden={{ host: row.host }}
          trigger="I have a login here"
          pendingLabel="Saving…"
          sheet
          fields={[
            { name: "account", label: "What the account is", type: "text", required: true, maxLength: 200, placeholder: "a counselor account" },
            { name: "may_use", label: "Documents from behind this login may be used on the site", type: "checkbox" },
            { name: "note", label: "Note (optional)", type: "text", maxLength: 500 },
          ]}
          description={`Lists ${row.host} as a host you have an account on. Your sign-in stays in your browser; nothing is stored here but the host and these words.`}
        />
      )}
    </div>
  );
}

function Subject({ r, ctx }: { r: TodoDoc; ctx: TodoContext }) {
  return (
    <>
      <Link href={todoHref(r.key, !!ctx.assistant)} className={`inline-flex min-h-11 items-center ${linkCls}`}>
        {r.subject}
      </Link>
      <span className="block text-xs font-normal text-muted-foreground">
        {TODO_KIND_LABEL[r.kind]}
        {editionOf(r) ? ` · ${editionOf(r)}` : ""}
        {r.unit_id ? (
          <>
            {" · "}
            <Link href={reviewHref(r.unit_id)} className={`inline-flex min-h-11 items-center ${linkCls}`}>
              Review {r.unit_id}
            </Link>
          </>
        ) : null}
      </span>
    </>
  );
}

function Why({ r, ctx }: { r: TodoDoc; ctx: TodoContext }) {
  const login = r.why === "login" ? loginFor(r, ctx.logins ?? NO_LOGINS) : null;
  return (
    <>
      {TODO_WHY_LABEL[r.why]}
      {login && <span className="block text-xs text-muted-foreground">You have a login: {login.account}</span>}
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
      {r.note && <StewardWords text={r.note} className="mt-1 block text-xs text-muted-foreground" />}
    </>
  );
}

const columns = (ctx: TodoContext): readonly Column<TodoDoc>[] => [
  { key: "subject", header: "Subject", role: "title", cell: (r) => <Subject r={r} ctx={ctx} /> },
  { key: "why", header: "Why", cell: (r) => <Why r={r} ctx={ctx} /> },
  { key: "open", header: "Open", cell: (r) => <Open r={r} /> },
  { key: "reach", header: "Reach", align: "right", cell: (r) => (r.demand ? `${r.reach} (on ${r.demand} list${r.demand === 1 ? "" : "s"})` : r.reach) },
  { key: "attempts", header: "Attempts", role: "detail", cell: (r) => <Attempts r={r} /> },
  { key: "status", header: "Status", cell: (r) => <Status r={r} /> },
  { key: "actions", header: "Actions", role: "actions", cell: (r) => <TodoActions row={r} ctx={ctx} /> },
];

/**
 * The To do rows (specs/product/data-steward.md "Documents a person has to fetch"), through `ResponsiveTable`: the
 * subject (linking the row's own page; a college's Review page beside it), kind and edition, why a machine couldn't
 * (and the owner's login where one is listed), the page to open, reach and demand, the attempts (folded on a phone),
 * the status, and the actions. `ctx.assistant` makes every form say the assistant pressed it.
 */
export function TodoTable({ rows, ctx = {} }: { rows: TodoDoc[]; ctx?: TodoContext }) {
  return <ResponsiveTable rows={rows} columns={columns(ctx)} rowKey={(r) => r.key} caption="Documents to fetch by hand, highest reach first" empty="Nothing to fetch by hand." />;
}
