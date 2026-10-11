"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import type { PlanTab } from "@/lib/planner/plan-tabs";

/**
 * Reports `plan_opened {tab, viewer, everyone}` once per tab shown (specs/planner/redesign/page.md "Telemetry"):
 * which tab, whose view, and whether it's the Everyone calendar; nothing else.
 */
export function PlanOpened({ tab, viewer, everyone }: { tab: PlanTab; viewer: "student" | "guardian"; everyone: boolean }) {
  useEffect(() => {
    track("plan_opened", { tab, viewer, everyone });
  }, [tab, viewer, everyone]);
  return null;
}
