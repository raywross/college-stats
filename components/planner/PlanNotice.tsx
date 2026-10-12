"use client";

/**
 * The plan's one notice (specs/planner/redesign/list.md "Around the list"): `view.notices[0]` as one sentence and
 * one button, or nothing — at most one shows, where there used to be up to three. In the desktop plan's right
 * column (U5's aside composition), and at the top of the list on a phone (PlanList, `lg:hidden`). Reuses
 * ListNotices' content and actions (the ED II offer's "Switch to ED II" button included), so there's one place that
 * knows how to word each notice kind.
 */
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ListNotices } from "@/components/planner/ListNotices";
import { setPlanRound } from "@/lib/planner/store-plan";
import { track } from "@/lib/analytics";
import type { PlanContext } from "@/lib/planner/types";
import type { PlanView } from "@/lib/planner/plan-view";

export function PlanNotice({ ctx, view, className }: { ctx: PlanContext; view: PlanView; className?: string }) {
  void ctx;
  const router = useRouter();
  const [edTwoPending, startEdTwo] = useTransition();
  const kind = view.notices[0];
  if (!kind) return null;

  function handleUseEdTwo(itemId: string) {
    const dreamRound = view.rows.find((r) => r.dream)?.round === "rea" ? "rea" : "ed";
    startEdTwo(async () => {
      track("plan_ed2_offer_used", { dream_round: dreamRound });
      const result = await setPlanRound(itemId, "ed2");
      if (result.ok) router.refresh();
    });
  }

  return <ListNotices view={view} kind={kind} onUseEdTwo={handleUseEdTwo} edTwoPending={edTwoPending} className={className} />;
}
