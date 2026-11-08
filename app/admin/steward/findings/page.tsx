import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Empty, Fields, PageHeader, Panel } from "@/components/admin/Panel";
import { RunForm } from "@/components/admin/ops/RunForm";
import { ClustersTable } from "@/components/admin/steward/ClustersTable";
import { DataBack } from "@/components/admin/steward/Bits";
import { dispatchAction } from "@/app/admin/operations/actions";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import type { StoreClient } from "@/lib/admin/review-queue";
import { collegesToReview, readClusters, readIssues, readRuns } from "@/lib/admin/steward-reads";
import { linkCls, pageParam, param, reviewHref } from "@/lib/admin/steward-view";
import { runById } from "@/lib/admin/workflows";
import { dayLabel, timeLabel, usd } from "@/lib/admin/ops-view";
import { pageOf } from "@/lib/admin/health-view";
import { getData } from "@/lib/data";
import { ISSUE_KINDS, ISSUE_KIND_LABEL, type IssueKind } from "@/lib/steward/types";

export const metadata: Metadata = { title: "Issues", robots: { index: false, follow: false } };

const CLUSTERS_PER_PAGE = 50;
const COLLEGES_SHOWN = 25;

/**
 * `/admin/data/issues` (specs/product/data-steward.md "The console: where it all shows", Issues row): the review
 * queue's open items grouped by cause, live (lib/steward/cluster.ts through `readClusters`, cached with the queue),
 * joined with the Steward's issue documents; the last run's summary; Run the Data Steward (steward.yml through the
 * console's dispatch, logged first); and Colleges to review. `?kind=` narrows the causes; `?page=` pages them.
 */
export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const params = await searchParams;
  const kindParam = param(params.kind);
  const kind = ISSUE_KINDS.includes(kindParam as IssueKind) ? (kindParam as IssueKind) : null;
  const supabase = await adminSupabase();
  const client = supabase as unknown as StoreClient;
  const [clusters, issues, runs, colleges, data] = await Promise.all([readClusters(client), readIssues(client), readRuns(client, 1), collegesToReview(client), getData()]);
  const last = runs[0] ?? null;
  const run = runById("steward");

  const rows = clusters.ok ? clusters.clusters.map((c) => ({ ...c, issue: issues.get(c.cluster.key) ?? null })).filter((r) => !kind || (r.issue?.kind ?? r.kind) === kind) : [];
  const page = pageOf(rows, pageParam(params.page), CLUSTERS_PER_PAGE);
  const items = rows.reduce((n, r) => n + r.cluster.items, 0);
  const href = (change: { kind?: IssueKind | null; page?: number }) => {
    const q = new URLSearchParams();
    const k = change.kind === undefined ? kind : change.kind;
    if (k) q.set("kind", k);
    if (change.page && change.page > 1) q.set("page", String(change.page));
    const s = q.toString();
    return s ? `/admin/data/issues?${s}` : "/admin/data/issues";
  };
  const named = colleges.slice(0, COLLEGES_SHOWN).map((c) => ({ ...c, name: c.name === c.unit_id ? (data.getSchoolById(c.unit_id)?.name ?? c.unit_id) : c.name }));

  return (
    <>
      <PageHeader title="Issues" back={<DataBack />} subtitle="The review queue grouped by cause. The Steward checks each cause against the colleges' documents and writes proposals." />
      <div className="space-y-5">
        <Panel title="The last run">
          {!last ? (
            <Empty>The Steward hasn&apos;t run yet. The causes below come straight from the queue.</Empty>
          ) : (
            <Fields
              items={[
                { label: "Started", value: timeLabel(last.started) },
                { label: "Mode", value: last.mode },
                { label: "Spent", value: `${usd(last.spent_usd)} of ${usd(last.budget_usd)}` },
                { label: "Wrote", value: `${last.proposals} proposals · ${last.issues} issues · ${last.todo} To do · ${last.decisions} decisions · ${last.audits} audits` },
                { label: "Stopped early", value: last.stopped ?? "No" },
              ]}
            />
          )}
        </Panel>

        {run && (
          <Panel title="Run the Data Steward">
            <details className="rounded-2xl border border-border bg-card">
              <summary className="min-h-12 cursor-pointer px-4 py-3 text-sm">
                <span className="font-semibold">{run.label}</span>
                <span className="mt-0.5 block font-normal text-muted-foreground">{run.description} One cause takes its key from the table below.</span>
              </summary>
              <div className="border-t border-border px-4 py-4">
                <RunForm run={run} prefillUnit={null} cost={null} action={dispatchAction} />
              </div>
            </details>
          </Panel>
        )}

        <Panel title="Causes" id="causes" aside={clusters.ok ? <span className="text-sm text-muted-foreground">{items.toLocaleString("en-US")} items in {rows.length.toLocaleString("en-US")} causes</span> : undefined}>
          {!clusters.ok ? (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t read the review queue: {clusters.reason}.
            </p>
          ) : (
            <div className="space-y-3">
              <nav aria-label="Kinds" className="flex flex-wrap gap-2 text-sm">
                {[null, ...ISSUE_KINDS].map((k) => (
                  <Link key={k ?? "all"} href={href({ kind: k, page: 1 })} aria-current={k === kind ? "page" : undefined} className={`inline-flex min-h-10 items-center rounded-full border px-4 ${k === kind ? "border-primary font-semibold" : "border-border"}`}>
                    {k ? ISSUE_KIND_LABEL[k] : "All"}
                  </Link>
                ))}
              </nav>
              <p className="text-sm text-muted-foreground" role="status">
                Largest first{clusters.updated ? ` · the queue was last written ${dayLabel(clusters.updated)}` : ""}
                {page.total > 0 ? ` · showing ${page.from} to ${page.to}` : ""}
              </p>
              <ClustersTable rows={page.rows} />
              {page.pages > 1 && (
                <nav aria-label="Cause pages" className="flex items-center justify-between gap-3 text-sm">
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
            </div>
          )}
        </Panel>

        <Panel title="Colleges to review" id="colleges" aside={<span className="text-sm text-muted-foreground">Most visible changes first</span>}>
          {named.length === 0 ? (
            <Empty>Nothing is pending for any college.</Empty>
          ) : (
            <ul className="divide-y rounded-2xl border bg-background text-sm">
              {named.map((c) => (
                <li key={c.unit_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3">
                  <Link href={reviewHref(c.unit_id)} className={`font-semibold ${linkCls}`}>
                    {c.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {c.items.toLocaleString("en-US")} open item{c.items === 1 ? "" : "s"}
                    {c.rows ? ` · ${c.rows} proposed (${c.changes} would change the site, ${c.yourCall} your call)` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {colleges.length > COLLEGES_SHOWN && <p className="mt-2 text-xs text-muted-foreground">And {(colleges.length - COLLEGES_SHOWN).toLocaleString("en-US")} more colleges.</p>}
        </Panel>
      </div>
    </>
  );
}
