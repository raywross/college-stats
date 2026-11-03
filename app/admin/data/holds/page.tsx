import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { HeldEssaysList, HeldItemsTable, IssuesPointer } from "@/components/admin/Holds";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import { listsByUnit } from "@/lib/admin/essays";
import { heldChangeSets } from "@/lib/admin/data-reads";
import { byLists, readHeldEssays, readQueue, type StoreClient } from "@/lib/admin/review-queue";
import { QUEUE_PAGE_SIZE, dayLabel, filterQueueRows, operationsQuery, parseOperationsParams, queueCodes } from "@/lib/admin/ops-view";
import { pageOf } from "@/lib/admin/health-view";

export const metadata: Metadata = { title: "Holds", robots: { index: false, follow: false } };

const inputCls = "mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const linkCls = "underline decoration-dotted underline-offset-2";

/**
 * `/admin/data/holds` (specs/data-platform/change-sets.md "Holds and review"): the values a person must look at
 * before they publish. The review queue's open items (`reported.review_queue`), with Accept the value (field edits),
 * Reject, and Re-run discovery; and the essay reader's held records (`essays.held`), each linking to its hand-read
 * form. Both most-listed college first. Held change sets (a whole run) are on Change sets. `?unit=`, `?code=` and
 * `?college=` narrow the items; `?qpage=` pages them.
 */
export default async function HoldsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const params = parseOperationsParams(await searchParams);
  const supabase = await adminSupabase();
  const client = supabase as unknown as StoreClient;
  const [queue, essays, lists, heldSets] = await Promise.all([readQueue(client), readHeldEssays(client), listsByUnit(), heldChangeSets(supabase)]);

  const open = queue.ok ? byLists(filterQueueRows(queue.rows, { ...params, queueStatus: "open" }), (r) => r.item.unit_id, (r) => r.item.name, lists) : [];
  const page = pageOf(open, params.page, QUEUE_PAGE_SIZE);
  const heldEssays = essays.ok ? byLists(essays.records, (r) => r.unit_id, (r) => r.name, lists) : [];
  const queryWith = (change: Partial<typeof params>) => {
    const q = operationsQuery({ ...params, queueStatus: "open", page: 1, ...change });
    return q ? `/admin/data/holds?${q}` : "/admin/data/holds";
  };

  return (
    <>
      <PageHeader
        title="Holds"
        back={
          <Link href="/admin/data" className={linkCls}>
            Data
          </Link>
        }
        subtitle="Values the automatic checks held back for a person. Nothing here reaches a college's page until it is accepted."
      />
      <div className="space-y-5">
        {queue.ok && <IssuesPointer open={queue.rows.filter((r) => r.status === "open").length} />}
        {heldSets.length > 0 && (
          <div role="note" className="rounded-2xl border border-warning bg-warning/10 p-4 text-sm">
            {heldSets.length} change set{heldSets.length === 1 ? " is" : "s are"} held as a whole, which stops every publish.{" "}
            <Link href="/admin/data/change-sets?status=held" className={`font-semibold ${linkCls}`}>
              See held change sets
            </Link>
          </div>
        )}

        <Panel title="Review items" id="review-items" aside={queue.ok ? <span className="text-sm text-muted-foreground">{page.total.toLocaleString("en-US")} open</span> : undefined}>
          {!queue.ok ? (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t read the held items: {queue.reason}.
            </p>
          ) : (
            <div className="space-y-3">
              <form method="get" action="/admin/data/holds" className="grid gap-3 sm:grid-cols-4">
                <label className="block text-sm font-semibold">
                  College
                  <input name="college" defaultValue={params.college ?? ""} placeholder="Name" className={inputCls} />
                </label>
                <label className="block text-sm font-semibold">
                  Code
                  <select name="code" defaultValue={params.code ?? ""} className={inputCls}>
                    <option value="">Any</option>
                    {queueCodes(queue.rows.filter((r) => r.status === "open")).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end gap-3 sm:col-span-2">
                  {params.unit && <input type="hidden" name="unit" value={params.unit} />}
                  <button type="submit" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
                    Filter
                  </button>
                  <Link href="/admin/data/holds" className={`inline-flex min-h-10 items-center text-sm ${linkCls}`}>
                    Clear
                  </Link>
                </div>
              </form>
              <p className="text-sm text-muted-foreground" role="status">
                {params.unit && (
                  <>
                    College {params.unit} ·{" "}
                    <Link href={queryWith({ unit: null })} className={linkCls}>
                      show all colleges
                    </Link>
                    {" · "}
                  </>
                )}
                {lists ? "Most-listed college first" : "By college (families' lists can't be read here)"}
                {queue.updated && ` · last written ${dayLabel(queue.updated)}`}
                {page.total > 0 && ` · showing ${page.from.toLocaleString("en-US")} to ${page.to.toLocaleString("en-US")}`}
              </p>
              <HeldItemsTable rows={page.rows} lists={lists} />
              {page.pages > 1 && (
                <nav aria-label="Held item pages" className="flex items-center justify-between gap-3 text-sm">
                  {page.page > 1 ? (
                    <Link href={queryWith({ page: page.page - 1 })} rel="prev" className={`inline-flex min-h-10 items-center ${linkCls}`}>
                      Previous {QUEUE_PAGE_SIZE}
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-muted-foreground">
                    Page {page.page} of {page.pages}
                  </span>
                  {page.page < page.pages ? (
                    <Link href={queryWith({ page: page.page + 1 })} rel="next" className={`inline-flex min-h-10 items-center ${linkCls}`}>
                      Next {QUEUE_PAGE_SIZE}
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Essay questions" id="essays" aside={essays.ok ? <span className="text-sm text-muted-foreground">{heldEssays.length} held</span> : undefined}>
          {!essays.ok ? <Empty>Couldn&apos;t read the held essay questions: {essays.reason}.</Empty> : <HeldEssaysList records={heldEssays} lists={lists} />}
        </Panel>
      </div>
    </>
  );
}
