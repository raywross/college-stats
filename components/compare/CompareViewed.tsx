"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";
import { getCompareIds } from "@/lib/compare";
import { isPresetCompare } from "@/lib/discovery-events";

/**
 * Reports a compare view once per set of colleges (specs/product/telemetry.md): how many, and whether the URL's
 * colleges differ from the saved list (`preset`: a link from a profile or the home page, not the tray).
 * Renders nothing. Mount it before `CompareHeader`: that component syncs the saved list to the URL in its own
 * effect, and sibling effects run in order, so this one still reads the list as it was before the visit.
 */
export function CompareViewed({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  // A ref survives React's dev-only double effect run, which would otherwise read the list after it was synced.
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (reported.current === key) return;
    reported.current = key;
    const urlIds = key ? key.split(",") : [];
    track("compare_viewed", { count: urlIds.length, preset: isPresetCompare(getCompareIds(), urlIds) });
  }, [key]);
  return null;
}
