import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Fields, PageHeader, Panel } from "@/components/admin/Panel";
import { DocLink, StewardWords, TodoStatusChip } from "@/components/admin/steward/Bits";
import { TodoActions } from "@/components/admin/steward/TodoTable";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readLogins, readTodo } from "@/lib/admin/steward-reads";
import { TODO_KIND_LABEL, TODO_WHY_LABEL, editionOf, keyFromSegment, linkCls, param, reviewHref } from "@/lib/admin/steward-view";
import { dayLabel } from "@/lib/admin/ops-view";
import { attemptResultWords } from "@/lib/admin/words";
import { loginFor } from "@/lib/steward/todo-assistant";

export const metadata: Metadata = { title: "To do row", robots: { index: false, follow: false } };

/**
 * `/admin/steward/todo/[key]` (specs/product/todo-browser-agent.md "Step 2", item 3): one To do row on one screen,
 * for a phone and for the assistant in the owner's browser: what the document is, the page to open, why a machine
 * couldn't, the owner's login where one is listed, every attempt in words, and the three actions. `?assistant=1`
 * makes the forms say the assistant pressed them.
 */
export default async function TodoRowPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const raw = (await params).key;
  const key = keyFromSegment(raw);
  if (!key || key.length > 200) notFound();
  const assistant = param((await searchParams).assistant) === "1";
  const supabase = await adminSupabase();
  const client = supabase as unknown as StoreClient;
  const [rows, logins] = await Promise.all([readTodo(client), readLogins(client)]);
  const row = rows.find((r) => r.key === key) ?? (key !== raw ? rows.find((r) => r.key === raw) : undefined);
  if (!row) notFound();
  const login = row.why === "login" ? loginFor(row, logins) : null;
  const attempts = [...row.attempts].reverse();

  return (
    <>
      <PageHeader
        help="to-do-row"
        title={row.subject}
        back={
          <Link href={assistant ? "/admin/steward/todo?assistant=1" : "/admin/steward/todo"} className={linkCls}>
            To do
          </Link>
        }
        chips={<TodoStatusChip status={row.status} />}
        subtitle={`${TODO_KIND_LABEL[row.kind]}${editionOf(row) ? ` · ${editionOf(row)}` : ""}${row.unit_id ? ` · ${row.unit_id}` : ""}`}
      />
      <div className="space-y-5">
        <Panel help="to-do-row" title="What to find">
          <Fields
            items={[
              { label: "Document", value: `${TODO_KIND_LABEL[row.kind]}${editionOf(row) ? `, ${editionOf(row)} edition` : ""}` },
              { label: "Why a machine couldn't", value: TODO_WHY_LABEL[row.why] },
              { label: "Open", value: row.landing ? <DocLink url={row.landing}>{row.landing}</DocLink> : <span className="text-muted-foreground">{row.host ?? "No page known"}</span> },
              { label: "The document", value: row.document_url ? <DocLink url={row.document_url}>{row.document_url}</DocLink> : <span className="text-muted-foreground">Not located yet</span> },
              { label: "Host", value: row.host ?? "—" },
              { label: "Reach", value: row.demand ? `${row.reach} (on ${row.demand} list${row.demand === 1 ? "" : "s"})` : String(row.reach) },
              ...(login ? [{ label: "Your login", value: `${login.account}${login.may_use ? " · documents may be used" : " · documents not for the site"}` }] : []),
              ...(row.unit_id
                ? [
                    {
                      label: "College",
                      value: (
                        <Link href={reviewHref(row.unit_id)} className={linkCls}>
                          Review page
                        </Link>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {row.note && <StewardWords text={row.note} className="mt-3 block text-sm text-muted-foreground" />}
        </Panel>
        <Panel help="to-do-row" title="Actions">
          <p className="mb-3 max-w-prose text-sm text-muted-foreground">
            Open the page, find the document for the kind and edition named above, open it and read its cover, then say what you found. Found checks the address once and tells you what answered there.
          </p>
          <TodoActions row={row} ctx={{ assistant, logins }} />
        </Panel>
        <Panel help="to-do-row" title="Attempts" aside={<span className="text-sm text-muted-foreground">{attempts.length}</span>}>
          {attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">None recorded.</p>
          ) : (
            <ol className="divide-y divide-border text-sm">
              {attempts.map((a, i) => {
                const w = attemptResultWords(a.result);
                return (
                  <li key={`${a.at}-${i}`} className="py-2">
                    <span className="text-muted-foreground">
                      {dayLabel(a.at)} · {a.route}
                    </span>
                    <span className="block" title={w.code ? `${w.label} (${w.code})` : undefined}>
                      {w.text}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>
    </>
  );
}
