import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Family dossier", robots: { index: false } };

/**
 * /household/[person]/plan/print: moved to the top level (specs/planner/redesign/page.md "Routes"). Redirects to
 * `/plan/print?for=<person>` (U8 builds that page); `/plan/print` itself checks the viewer can see this student.
 */
export default async function PersonPlanPrintRedirect({ params }: { params: Promise<{ person: string }> }) {
  const { person: id } = await params;
  redirect(`/plan/print?for=${encodeURIComponent(id)}`);
}
