"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ROUND_LABELS, type ListRound } from "@/lib/list-rules";
import { myPlanRound } from "@/lib/planner/store-rounds";
import { ROUND_SHORT } from "@/lib/planner/rounds";

/**
 * "On your plan: EA" under a college's "Applying early" section (specs/planner/early-rounds.md "Display"), for a
 * signed-in student with this college on their list, linking to the rounds stage. The profile page is static (built
 * once, kept for a day), so the read runs on the server through a Server Action after the page loads, with the
 * student's own session; nothing renders for anyone else.
 */
export function OnYourPlan({ unitId }: { unitId: string }) {
  const [plan, setPlan] = useState<{ round: ListRound | null; href: string } | null>(null);
  useEffect(() => {
    let live = true;
    myPlanRound(unitId)
      .then((r) => {
        if (live) setPlan(r);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [unitId]);
  if (!plan) return null;
  return (
    <p className="text-sm">
      <span className="font-semibold">On your plan: </span>
      {plan.round ? <abbr title={ROUND_LABELS[plan.round]} className="no-underline">{ROUND_SHORT[plan.round]}</abbr> : "no round chosen yet"}
      <Link href={plan.href} className="ml-2 font-semibold text-primary underline-offset-2 hover:underline">
        Rounds
      </Link>
    </p>
  );
}
