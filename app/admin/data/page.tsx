import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AdminForm } from "@/components/admin/AdminForm";
import { DoorScreens } from "@/components/admin/DoorScreens";
import { Empty, Fields, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { changeKindLabel } from "@/lib/admin/words";
import { statusLabel } from "@/lib/admin/change-set-view";
import { adminSupabase } from "@/lib/admin/people";
import { formatBytes, loadDataOverview, manifestBytes } from "@/lib/admin/data-reads";
import { publishNowAction } from "@/app/admin/data/actions";

export const metadata: Metadata = { title: "Data", robots: { index: false, follow: false } };

/**
 * `/admin/data`, the Data door's landing (specs/product/admin-redesign.md "Data"; specs/data-platform/change-sets.md
 * "The console", Overview row; specs/data-platform/publish.md "Environments", "The admin's publish controls"): the
 * door's screens as cards, then the published version each copy of the site serves, the last publish with **Publish
 * now**, the changes since it, and any held change. "Data" never "deploy": a publish moves which published version
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
      <PageHeader title="Data" help="data" subtitle="What the site holds, including what it hides, and the published versions visitors see." />
      <DoorScreens door="data" className="mb-6" />
      <div className="space-y-5">
        <Panel title="Live on" help="live-version">
          {overview.environments.length === 0 ? (
            <Empty>No copy of the site is configured to check (DATA_ENVIRONMENTS).</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {overview.environments.map((e) => (
                <li key={e.url} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                  <div className="min-w-0">
                    <span className="font-semibold">{e.label}</span>{" "}
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="break-all text-muted-foreground underline decoration-dotted underline-offset-2">
                      {e.url}
                    </a>
                  </div>
                  <StatusChip label={e.snapshot === "unknown" ? "Unknown" : `Live on ${e.label} · version ${e.snapshot}`} tone={e.snapshot === "unknown" ? "warn" : "info"} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="The last publish" help="publish-now" aside={<AdminForm action={publishNowAction} trigger="Publish now" tone="primary" pendingLabel="Publishing…" />}>
          {!lastPublished ? (
            <Empty>Nothing has published yet.</Empty>
          ) : (
            <Fields
              items={[
                { label: "Published version", value: `#${lastPublished.id}` },
                { label: "Published", value: fmtDateTime(lastPublished.created_at) },
                { label: "Colleges", value: lastPublished.manifest.colleges?.toLocaleString("en-US") ?? "—" },
                { label: "Size", value: formatBytes(manifestBytes(lastPublished.manifest)) },
                { label: "Changes carried", value: String(lastPublished.change_set_ids.length) },
              ]}
            />
          )}
        </Panel>

        <Panel title="Changes since the last publish" help="change">
          {overview.changeSets.length === 0 ? (
            <Empty>Nothing new.</Empty>
          ) : (
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {overview.changeSets.map((c) => (
                <li key={`${c.source}-${c.status}`} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5">
                  <span className="min-w-0 break-words">
                    {c.source} <span className="text-muted-foreground">· {statusLabel(c.status).toLowerCase()}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Held changes" help="held" aside={overview.holds.length > 0 ? <StatusChip label={`${overview.holds.length} held`} tone="warn" /> : undefined}>
          {overview.holds.length === 0 ? (
            <Empty>Nothing is held. Publish now will carry everything applied so far.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {overview.holds.map((h) => (
                <li key={h.id} className="rounded-xl border border-warning bg-warning/10 p-3">
                  <div className="font-semibold">
                    <Link href={`/admin/data/changes/${h.id}`} className="underline decoration-dotted underline-offset-2">
                      Change #{h.id}
                    </Link>{" "}
                    · {changeKindLabel(h.kind)} · {h.source}
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
