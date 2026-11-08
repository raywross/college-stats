import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader, Panel } from "@/components/admin/Panel";
import { DataBack } from "@/components/admin/steward/Bits";
import { TodoTable } from "@/components/admin/steward/TodoTable";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import { listsByUnit } from "@/lib/admin/essays";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readTodo } from "@/lib/admin/steward-reads";
import { TODO_KIND_LABEL, linkCls, pageParam, param } from "@/lib/admin/steward-view";
import { pageOf } from "@/lib/admin/health-view";
import type { TodoDoc } from "@/lib/steward/types";

export const metadata: Metadata = { title: "To do", robots: { index: false, follow: false } };

const KINDS = Object.keys(TODO_KIND_LABEL) as TodoDoc["kind"][];
const PER_PAGE = 100;

/**
 * `/admin/data/todo` (specs/product/data-steward.md "Documents a person has to fetch"): documents a machine couldn't
 * get, from the Steward's rows and the engines' own records (`reported.failures`, the queue's unreachable and
 * not-a-url items, `directories.blocked`), highest reach first, each with the page to open and why. Found (with the
 * address), No document published, Done. `?kind=` narrows; `?closed=1` shows the closed rows too; `?page=` pages.
 */
export default async function TodoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const params = await searchParams;
  const rawKind = param(params.kind);
  const kind = KINDS.includes(rawKind as TodoDoc["kind"]) ? (rawKind as TodoDoc["kind"]) : null;
  const closed = param(params.closed) === "1";
  const supabase = await adminSupabase();
  const lists = await listsByUnit();
  const all = await readTodo(supabase as unknown as StoreClient, { demand: lists });
  const rows = all.filter((r) => (!kind || r.kind === kind) && (closed || r.status === "open" || r.status === "found"));
  const page = pageOf(rows, pageParam(params.page), PER_PAGE);
  const href = (change: { kind?: TodoDoc["kind"] | null; closed?: boolean; page?: number }) => {
    const q = new URLSearchParams();
    const k = change.kind === undefined ? kind : change.kind;
    if (k) q.set("kind", k);
    if (change.closed ?? closed) q.set("closed", "1");
    if (change.page && change.page > 1) q.set("page", String(change.page));
    const s = q.toString();
    return s ? `/admin/data/todo?${s}` : "/admin/data/todo";
  };

  return (
    <>
      <PageHeader title="To do" back={<DataBack />} subtitle="Documents a machine couldn't fetch. Open the page in your own browser and say what you found." />
      <Panel title={kind ? TODO_KIND_LABEL[kind] : "Every kind"} aside={<span className="text-sm text-muted-foreground">{rows.length.toLocaleString("en-US")} rows</span>}>
        <nav aria-label="Kinds" className="mb-3 flex flex-wrap gap-2 text-sm">
          {[null, ...KINDS].map((k) => (
            <Link key={k ?? "all"} href={href({ kind: k, page: 1 })} aria-current={k === kind ? "page" : undefined} className={`inline-flex min-h-10 items-center rounded-full border px-4 ${k === kind ? "border-primary font-semibold" : "border-border"}`}>
              {k ? TODO_KIND_LABEL[k] : "All"}
            </Link>
          ))}
          <Link href={href({ closed: !closed, page: 1 })} className={`inline-flex min-h-10 items-center px-2 ${linkCls}`}>
            {closed ? "Hide closed rows" : "Show closed rows"}
          </Link>
        </nav>
        <p className="mb-3 text-sm text-muted-foreground" role="status">
          Highest reach first{lists ? ", then most-listed" : ""}
          {page.total > 0 ? ` · showing ${page.from} to ${page.to}` : ""}
        </p>
        <TodoTable rows={page.rows} />
        {page.pages > 1 && (
          <nav aria-label="To do pages" className="mt-3 flex items-center justify-between gap-3 text-sm">
            {page.page > 1 ? (
              <Link href={href({ page: page.page - 1 })} rel="prev" className={`inline-flex min-h-10 items-center ${linkCls}`}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">
              Page {page.page} of {page.pages}
            </span>
            {page.page < page.pages ? (
              <Link href={href({ page: page.page + 1 })} rel="next" className={`inline-flex min-h-10 items-center ${linkCls}`}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Panel>
    </>
  );
}
