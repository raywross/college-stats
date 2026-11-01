import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/admin/Panel";
import { FieldEditor } from "@/components/admin/FieldEditor";
import { requireAdmin } from "@/lib/admin/auth";
import { loadCollegeEditor } from "@/lib/admin/edits-reads";
import { releaseEditAction, revertEditAction, saveEditAction } from "./actions";

export const metadata: Metadata = { title: "Edit college", robots: { index: false, follow: false } };

/**
 * /admin/colleges/[unit]/edit (specs/data-platform/change-sets.md "Admin edits"): every registry value an admin can
 * set for one college, grouped by topic, each with its value, citation, typed input, note, and Save; an edited value
 * also has Release and its History with Revert to this. A save shows on the college's pages at once (the live
 * overlay) and the next snapshot bakes it in. Server-rendered behind requireAdmin().
 */
export default async function EditCollegePage({ params }: PageProps<"/admin/colleges/[unit]/edit">) {
  await connection();
  await requireAdmin();
  const { unit } = await params;
  if (!/^\d{6,8}$/.test(unit)) notFound();
  const editor = await loadCollegeEditor(unit);
  if (!editor) notFound();
  const { school, groups } = editor;

  return (
    <>
      <PageHeader
        back={
          <Link href={`/admin/colleges/${unit}`} className="text-muted-foreground underline-offset-4 hover:underline">
            {school.name}
          </Link>
        }
        title={`Edit ${school.name}`}
        subtitle={
          <>
            Any registered value, cited as edited by Quad on the day it was saved · unit {unit} ·{" "}
            <Link href={`/schools/${unit}`} className="underline-offset-4 hover:underline">
              Public profile
            </Link>
          </>
        }
      />
      <FieldEditor unit={unit} groups={groups} actions={{ save: saveEditAction, release: releaseEditAction, revert: revertEditAction }} />
    </>
  );
}
