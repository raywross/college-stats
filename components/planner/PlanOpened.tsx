"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import type { PlanTab } from "@/lib/planner/plan-tabs";
import { recordPlanOpen } from "@/lib/planner/store-opens";
import { forgetPlanDot } from "@/components/layout/usePlanDot";
import type { ViewerRole } from "@/lib/viewer-relation";

/**
 * Reports `plan_opened {tab, viewer, everyone}` once per tab shown (specs/planner/redesign/page.md "Telemetry"):
 * which tab, whose view, and whether it's the Everyone calendar; nothing else. On the Next steps tab it also records
 * the open (plan_opens, lib/planner/store-opens.ts), which clears the header's new-move dot for this student.
 */
export function PlanOpened({ tab, viewer, everyone, studentId = null }: { tab: PlanTab; viewer: ViewerRole; everyone: boolean; studentId?: string | null }) {
  useEffect(() => {
    track("plan_opened", { tab, viewer, everyone });
  }, [tab, viewer, everyone]);
  useEffect(() => {
    // Recording the open is what turns the dot off, so the stored answer (usePlanDot's five-minute memory) goes too.
    // The header's dot is the family's (app/api/plan/next): a counselor's open records nothing.
    if (tab === "next" && studentId && viewer !== "counselor") void recordPlanOpen(studentId).then(forgetPlanDot, () => undefined);
  }, [tab, studentId, viewer]);
  return null;
}
