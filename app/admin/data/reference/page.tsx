import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { adminSupabase } from "@/lib/admin/people";
import { listReferenceDocuments } from "@/lib/admin/reference-reads";
import { referenceDescription, referenceHref } from "@/lib/admin/reference-view";

export const metadata: Metadata = { title: "Reference documents", robots: { index: false, follow: false } };

/**
 * `/admin/data/reference` (specs/data-platform/change-sets.md "Admin edits" → "Reference documents"; "The console",
 * Reference row): every whole-document reference (the release calendar, aid policies, guaranteed admission, state
 * laws, curated aliases, …), its collection, current version, when it last changed, and the change set that wrote it.
 */
export default async function ReferenceListPage() {
  await connection();
  await requireAdmin();
  const supabase = await adminSupabase();
  const docs = await listReferenceDocuments(supabase);

  return (
    <>
      <PageHeader
        title="Reference"
        subtitle="Whole documents the pipelines and admins keep by hand, not one college's field."
        back={
          <Link href="/admin/data" className="underline decoration-dotted underline-offset-2">
            Data
          </Link>
        }
      />
      <Panel title="Documents">
        {docs.length === 0 ? (
          <Empty>No reference documents yet.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.name} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <Link href={referenceHref(d.name)} className="font-semibold underline decoration-dotted underline-offset-2">
                    {d.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">{referenceDescription(d.name, d.collection)}</p>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <div>Version {d.version}</div>
                  <div>{fmtDateTime(d.updated_at)}</div>
                  <Link href={`/admin/data/change-sets/${d.change_set_id}`} className="underline decoration-dotted underline-offset-2">
                    Change set #{d.change_set_id}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
