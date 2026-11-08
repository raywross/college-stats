import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/admin/Panel";
import { SnapshotsTable } from "@/components/admin/Snapshots";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import { currentSnapshotId, loadSnapshots } from "@/lib/admin/data-reads";

export const metadata: Metadata = { title: "Published versions", robots: { index: false, follow: false } };

/**
 * `/admin/data/versions` (specs/data-platform/change-sets.md "The console", Snapshots row; specs/product/admin-redesign.md
 * "Data"): every published version, newest first, with the live one marked, **Make this the live version**, and
 * **Download manifest**; one sentence links the other undo, Undo this change on a change's page.
 */
export default async function SnapshotsPage() {
  await connection();
  await requireAdmin();
  const supabase = await adminSupabase();
  const snapshots = await loadSnapshots(supabase);
  const currentId = currentSnapshotId(snapshots);

  return (
    <>
      <PageHeader help="published-version" title="Published versions" subtitle="Every version the publisher has written, newest first. Making an earlier one live takes effect at once, with no rebuild." />
      <p className="-mt-2 mb-4 max-w-prose text-sm text-muted-foreground">
        To undo one change rather than a whole publish,{" "}
        <Link href="/admin/data/changes" className="font-semibold text-primary underline-offset-4 hover:underline">
          open it on Changes
        </Link>{" "}
        and use Undo this change.
      </p>
      <SnapshotsTable snapshots={snapshots} currentId={currentId} />
    </>
  );
}
