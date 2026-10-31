import { AdminForm } from "@/components/admin/AdminForm";
import { StatusChip } from "@/components/admin/StatusChip";
import { Empty } from "@/components/admin/Panel";
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
 * `/admin/data/snapshots` (specs/data-platform/change-sets.md "The console", "Snapshots" row): the list, newest
 * first, with **Point back here** (a typed confirmation, then `admin_data_point_snapshot` and the workflow's `point`
 * job) and **Download manifest** (a plain link to the public object; nothing to log, nothing to confirm).
 */
export function SnapshotsTable({ snapshots, currentId }: { snapshots: SnapshotRow[]; currentId: number | null }) {
  if (!snapshots.length) return <Empty>No snapshot has been published yet.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[48rem] text-sm">
        <caption className="sr-only">The newest {snapshots.length} snapshots, newest first</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Created
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Colleges
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Size
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Change sets
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => {
            const isCurrent = s.id === currentId;
            const manifestUrl = manifestDownloadUrl(s.id);
            return (
              <tr key={s.id} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  Snapshot {s.id}
                  <div className="text-xs font-normal text-muted-foreground">{fmtDateTime(s.created_at)}</div>
                </th>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip label={STATUS_LABEL[s.status]} tone={STATUS_TONE[s.status]} />
                    {isCurrent && <StatusChip label="Live" tone="good" />}
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums">{s.manifest.colleges?.toLocaleString("en-US") ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{formatBytes(manifestBytes(s.manifest))}</td>
                <td className="px-3 py-2 tabular-nums">{s.change_set_ids.length}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-2">
                    {!isCurrent && (
                      <AdminForm
                        action={pointBackAction}
                        hidden={{ snapshot: String(s.id) }}
                        trigger="Point back here"
                        typed={{ expected: CONFIRM_POINT_BACK, instruction: <>Type &ldquo;{CONFIRM_POINT_BACK}&rdquo; to confirm</> }}
                        description="Moves the live pointer to this snapshot at once, with no rebuild. The next publish from current layers supersedes it unless the offending change set is also reverted."
                      />
                    )}
                    {manifestUrl && (
                      <a href={manifestUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline decoration-dotted underline-offset-2">
                        Download manifest
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
