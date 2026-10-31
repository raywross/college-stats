import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty, Fields, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { adminSupabase } from "@/lib/admin/people";
import { formatBytes, loadDataOverview, manifestBytes } from "@/lib/admin/data-reads";
import { publishNowAction } from "@/app/admin/data/actions";

export const metadata: Metadata = { title: "Data", robots: { index: false, follow: false } };

/**
 * `/admin/data` (specs/data-platform/change-sets.md "The console", Overview row; specs/data-platform/publish.md
 * "Environments", "The admin's publish controls"): the snapshot each environment serves, the last publish, the
 * change sets since it, and any holds, with **Publish now**. "Data" never "deploy": a publish moves which snapshot
 * the site reads, not a Vercel deploy.
 */
export default async function DataOverviewPage() {
  await connection();
  await requireAdmin();
  const supabase = await adminSupabase();
  const overview = await loadDataOverview(supabase);
  const { lastPublished } = overview;

  return (
    <>
      <PageHeader
        title="Data"
        subtitle="The college dataset's source of truth, published as snapshots."
      />
      <nav aria-label="Data screens" className="mb-5 flex flex-wrap gap-2 text-sm">
        {[
          { href: "/admin/data/change-sets", label: "Change sets" },
          { href: "/admin/data/holds", label: "Holds" },
          { href: "/admin/data/snapshots", label: "Snapshots" },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="inline-flex min-h-10 items-center rounded-full border border-border px-4 font-semibold hover:bg-muted">
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-5">
        <Panel title="Live on">
          {overview.environments.length === 0 ? (
            <Empty>No environment is configured (DATA_ENVIRONMENTS).</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {overview.environments.map((e) => (
                <li key={e.url} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                  <div>
                    <span className="font-semibold">{e.label}</span>{" "}
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline decoration-dotted underline-offset-2">
                      {e.url}
                    </a>
                  </div>
                  <StatusChip label={e.snapshot === "unknown" ? "Unknown" : `Live on ${e.label} · snapshot ${e.snapshot}`} tone={e.snapshot === "unknown" ? "warn" : "info"} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="The last publish" aside={<AdminForm action={publishNowAction} trigger="Publish now" tone="primary" pendingLabel="Publishing…" />}>
          {!lastPublished ? (
            <Empty>Nothing has published yet.</Empty>
          ) : (
            <Fields
              items={[
                { label: "Snapshot", value: `#${lastPublished.id}` },
                { label: "Published", value: fmtDateTime(lastPublished.created_at) },
                { label: "Colleges", value: lastPublished.manifest.colleges?.toLocaleString("en-US") ?? "—" },
                { label: "Size", value: formatBytes(manifestBytes(lastPublished.manifest)) },
                { label: "Change sets carried", value: String(lastPublished.change_set_ids.length) },
              ]}
            />
          )}
        </Panel>

        <Panel title="Change sets since the last publish">
          {overview.changeSets.length === 0 ? (
            <Empty>Nothing new.</Empty>
          ) : (
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {overview.changeSets.map((c) => (
                <li key={`${c.source}-${c.status}`} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5">
                  <span>
                    {c.source} <span className="text-muted-foreground">· {c.status}</span>
                  </span>
                  <span className="tabular-nums font-semibold">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Holds" aside={overview.holds.length > 0 ? <StatusChip label={`${overview.holds.length} held`} tone="warn" /> : undefined}>
          {overview.holds.length === 0 ? (
            <Empty>Nothing is held. Publish now will carry everything applied so far.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {overview.holds.map((h) => (
                <li key={h.id} className="rounded-xl border border-warning bg-warning/10 p-3">
                  <div className="font-semibold">
                    <Link href={`/admin/data/change-sets/${h.id}`} className="underline decoration-dotted underline-offset-2">
                      Change set #{h.id}
                    </Link>{" "}
                    · {h.kind} · {h.source}
                  </div>
                  <div className="mt-0.5 text-muted-foreground">{h.held_reason ?? "No reason recorded."}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(h.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
