"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/**
 * Reports `record_reading_shown { inputs, missing }` once per mount (specs/planner/record/reading.md "Rules"): the
 * "How Quad reads your record" section's only telemetry. The tiny client island a server-rendered `RecordReading`
 * needs for it, the same pattern as `RecordOverviewOpened.tsx`.
 */
export function RecordReadingShown({ inputs, missing }: { inputs: number; missing: boolean }) {
  useEffect(() => {
    track("record_reading_shown", { inputs, missing });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
