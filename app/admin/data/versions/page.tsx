import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/admin/Panel";
import { SnapshotsTable } from "@/components/admin/Snapshots";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import { currentSnapshotId, loadSnapshots } from "@/lib/admin/data-reads";

export const metadata: Metadata = { title: "Snapshots", robots: { index: false, follow: false } };

/**
 * `/admin/data/snapshots` (specs/data-platform/change-sets.md "The console", Snapshots row): every snapshot,
 * newest first, with the current one marked, **Point back here**, and **Download manifest**.
 */
export default async function SnapshotsPage() {
  await connection();
  await requireAdmin();
  const supabase = await adminSupabase();
  const snapshots = await loadSnapshots(supabase);
  const currentId = currentSnapshotId(snapshots);

  return (
    <>
      <PageHeader title="Snapshots" subtitle="Every snapshot the publisher has written, newest first. Pointing back moves the live pointer at once, with no rebuild." />
      <SnapshotsTable snapshots={snapshots} currentId={currentId} />
    </>
  );
}
