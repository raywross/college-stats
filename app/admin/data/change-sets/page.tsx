import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/admin/Panel";
import { ChangeSetsTable } from "@/components/admin/ChangeSets";
import { requireAdmin } from "@/lib/admin/auth";
import { adminSupabase } from "@/lib/admin/people";
import { CHANGE_SET_STATUSES, loadChangeSets, parseStatusFilter, runRepo } from "@/lib/admin/data-reads";
import { statusLabel } from "@/lib/admin/change-set-view";

export const metadata: Metadata = { title: "Change sets", robots: { index: false, follow: false } };

/**
 * `/admin/data/change-sets` (specs/data-platform/change-sets.md "The console", Change sets row): every pipeline run,
 * import, edit and revert as a change set, newest first, with a status filter. Each links to its own page, where it
 * can be held, published anyway, or reverted.
 */
export default async function ChangeSetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const status = parseStatusFilter((await searchParams).status);
  const supabase = await adminSupabase();
  const rows = await loadChangeSets(supabase, { status });
  const chip = (s: string | null, label: string) => (
    <Link
      key={label}
      href={s ? `/admin/data/change-sets?status=${s}` : "/admin/data/change-sets"}
      aria-current={status === s ? "page" : undefined}
      className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm ${status === s ? "border-primary bg-primary/10 font-semibold" : "border-border hover:bg-muted"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Change sets"
        back={
          <Link href="/admin/data" className="underline decoration-dotted underline-offset-2">
            Data
          </Link>
        }
        subtitle="Every write to the data: pipeline runs, imports, edits, and reverts, newest first."
      />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {chip(null, "All")}
        {CHANGE_SET_STATUSES.map((s) => chip(s, statusLabel(s)))}
      </nav>
      <ChangeSetsTable rows={rows} repo={runRepo()} />
    </>
  );
}
