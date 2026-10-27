import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { planPrintHref } from "@/lib/planner/plan-tabs";

export const metadata: Metadata = { title: "Family dossier", robots: { index: false } };

/**
 * /household/[person]/plan/print: moved to the top level (specs/planner/redesign/page.md "Routes"). Redirects to
 * `/advisor/print?for=<person>` (lib/planner/plan-tabs.ts planPrintHref); `/advisor/print` itself checks the viewer
 * can see this student.
 */
export default async function PersonPlanPrintRedirect({ params }: { params: Promise<{ person: string }> }) {
  const { person: id } = await params;
  redirect(planPrintHref({ person: id }));
}
