import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { PersonHeader } from "@/components/account/PersonHeader";
import { PlanPage } from "@/components/planner/PlanPage";
import { AccountsSetupError, authConfigured, requireUser } from "@/lib/auth";
import { personPage } from "@/lib/households";
import { parseStage } from "@/lib/planner/stage";

export const metadata: Metadata = { title: "Their plan", robots: { index: false } };

/**
 * /household/[person]/plan (specs/planner/model.md "Where it lives"): inside the hub's frame, the person area with
 * Plan selected, then the plan (components/planner/PlanPage.tsx). Students only: a guardian's page has no Plan tab
 * (their list rows carry the planner's controls instead), so it redirects to their list. `?stage=N` opens another
 * stage's panel.
 */
export default async function PersonPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ person: string }>;
  searchParams: Promise<{ stage?: string | string[] }>;
}) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { person: id } = await params;
  const { stage } = await searchParams;
  await requireUser(`/household/${id}/plan`);

  let person;
  try {
    person = await personPage(id);
    if (person?.kind !== "student") {
      if (person) redirect(`/household/${id}`);
      notFound();
    }
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PersonHeader id={id} person={person} active="plan" />
      </div>
      <PlanPage personId={id} person={person} stage={parseStage(Array.isArray(stage) ? stage[0] : stage)} />
    </div>
  );
}
