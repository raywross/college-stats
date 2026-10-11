import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { personPlanRedirectHref } from "@/lib/planner/plan-frame";

export const metadata: Metadata = { title: "Their plan", robots: { index: false } };

/**
 * /household/[person]/plan: the plan moved to the top level (specs/planner/redesign/page.md "Account menu"). Redirects
 * to `/plan?for=<person>`, mapping an old `?stage=N` to the matching tab (lib/planner/plan-frame.ts
 * personPlanRedirectHref). `/plan` itself checks the viewer can see this student.
 */
export default async function PersonPlanRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ person: string }>;
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  const { person: id } = await params;
  const { stage } = await searchParams;
  redirect(personPlanRedirectHref(id, stage));
}
