"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/** Reports `plan_opened {stage}` once per stage shown (specs/planner/model.md "Telemetry"): the stage, nothing else. */
export function PlanOpened({ stage }: { stage: number }) {
  useEffect(() => {
    track("plan_opened", { stage });
  }, [stage]);
  return null;
}
