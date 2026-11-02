"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import type { ViewerRole } from "@/lib/viewer-relation";

/**
 * Reports `record_overview_opened { viewer }` once per mount (specs/planner/record/build-plan.md "Telemetry"): the
 * overview's only telemetry. The tiny client island a server-rendered RecordOverview needs for it (the same pattern
 * as components/planner/PlanOpened.tsx).
 */
export function RecordOverviewOpened({ viewer }: { viewer: ViewerRole }) {
  useEffect(() => {
    track("record_overview_opened", { viewer });
  }, [viewer]);
  return null;
}
