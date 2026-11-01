import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader, Panel } from "@/components/admin/Panel";
import { ReferenceEditor, ReferenceVersions } from "@/components/admin/ReferenceEditor";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { adminSupabase } from "@/lib/admin/people";
import { getData } from "@/lib/data";
import { loadReferenceDocument, loadReferenceVersions } from "@/lib/admin/reference-reads";
import { bodyToEditor, referenceDescription, validateReference } from "@/lib/admin/reference-view";

export const metadata: Metadata = { title: "Reference document", robots: { index: false, follow: false } };

/**
 * `/admin/data/reference/[name]` (specs/data-platform/change-sets.md "Admin edits" → "Reference documents"): the
 * document's current body (a JSON textarea, two-space, as stored, or the plain text of a `{text}` document), the
 * validator's current verdict, a note, Save document, and the Versions panel with Revert to version {n}. `name` is
 * percent-decoded: the essay guidance document's name has a "/" in it, encoded into this one route segment.
 */
export default async function ReferenceDocumentPage({ params }: { params: Promise<{ name: string }> }) {
  await connection();
  await requireAdmin();
  const name = decodeURIComponent((await params).name);
  const supabase = await adminSupabase();
  const doc = await loadReferenceDocument(supabase, name);
  if (!doc) notFound();

  const [{ getAllSchools }, versions] = await Promise.all([getData(), loadReferenceVersions(supabase, name)]);
  const knownUnitIds = new Set(getAllSchools().map((s) => s.unit_id));
  const problems = validateReference(name, doc.body, knownUnitIds);
  const editor = bodyToEditor(doc.body);

  return (
    <>
      <PageHeader
        title={name}
        subtitle={referenceDescription(name, doc.collection)}
        back={
          <Link href="/admin/data/reference" className="underline decoration-dotted underline-offset-2">
            Reference
          </Link>
        }
      />
      <div className="space-y-5">
        <Panel title="Document" aside={<span className="text-sm text-muted-foreground">Version {doc.version} · {fmtDateTime(doc.updated_at)}</span>}>
          <ReferenceEditor name={name} kind={editor.kind} value={editor.value} problems={problems} />
        </Panel>
        <Panel title="Versions">
          <ReferenceVersions name={name} rows={versions} />
        </Panel>
      </div>
    </>
  );
}
