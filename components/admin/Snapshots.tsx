import { AdminForm } from "@/components/admin/AdminForm";
import { StatusChip } from "@/components/admin/StatusChip";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { fmtDateTime, type ChipTone } from "@/lib/admin/console";
import { formatBytes, manifestBytes, manifestDownloadUrl, type SnapshotRow } from "@/lib/admin/data-reads";
import { CONFIRM_POINT_BACK } from "@/lib/admin/data-actions";
import { pointBackAction } from "@/app/admin/data/actions";

const STATUS_TONE: Record<SnapshotRow["status"], ChipTone> = {
  building: "info",
  published: "good",
  failed: "danger",
  withdrawn: "neutral",
};

const STATUS_LABEL: Record<SnapshotRow["status"], string> = {
  building: "Building",
  published: "Published",
  failed: "Failed",
  withdrawn: "Withdrawn",
};

/**
 * `/admin/data/versions` (specs/data-platform/change-sets.md "The console", "Snapshots" row): the list, newest
 * first, with **Point back here** (a typed confirmation, then `admin_data_point_snapshot` and the workflow's `point`
 * job) and **Download manifest** (a plain link to the public object; nothing to log, nothing to confirm).
 */
export function SnapshotsTable({ snapshots, currentId }: { snapshots: SnapshotRow[]; currentId: number | null }) {
  const columns: readonly Column<SnapshotRow>[] = [
    {
      key: "created",
      header: "Created",
      role: "title",
      cell: (s) => (
        <>
          Version {s.id}
          <div className="text-xs font-normal text-muted-foreground">{fmtDateTime(s.created_at)}</div>
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (s) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip label={STATUS_LABEL[s.status]} tone={STATUS_TONE[s.status]} />
          {s.id === currentId && <StatusChip label="Live" tone="good" help="live-version" />}
        </div>
      ),
    },
    { key: "colleges", header: "Colleges", cell: (s) => s.manifest.colleges?.toLocaleString("en-US") ?? "—" },
    { key: "size", header: "Size", role: "detail", cell: (s) => formatBytes(manifestBytes(s.manifest)) },
    { key: "changes", header: "Changes", cell: (s) => s.change_set_ids.length },
    {
      key: "actions",
      header: "Actions",
      role: "actions",
      cell: (s) => {
        const isCurrent = s.id === currentId;
        const manifestUrl = manifestDownloadUrl(s.id);
        return (
          <>
            {!isCurrent && (
              <AdminForm
                action={pointBackAction}
                hidden={{ snapshot: String(s.id) }}
                trigger="Make this the live version"
                sheet
                typed={{ expected: CONFIRM_POINT_BACK, instruction: <>Type &ldquo;{CONFIRM_POINT_BACK}&rdquo; to confirm</> }}
                description="Visitors see this version at once, with no rebuild. The next publish supersedes it unless the change at fault is also undone; to undo one change rather than a whole publish, use Undo this change on the change's page."
              />
            )}
            {manifestUrl && (
              <a href={manifestUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center text-sm underline decoration-dotted underline-offset-2">
                Download manifest
              </a>
            )}
          </>
        );
      },
    },
  ];
  return <ResponsiveTable rows={snapshots} columns={columns} rowKey={(s) => String(s.id)} caption={`The newest ${snapshots.length} published versions, newest first`} empty="No version has been published yet." />;
}
