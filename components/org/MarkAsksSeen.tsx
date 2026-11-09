"use client";

import { useEffect, useRef } from "react";
import { markAsksSeen } from "@/app/org/actions";

/**
 * Marks the family's unseen asks seen (round 5; specs/product/counselor-portal.md "Asking a student for something"),
 * once, when it mounts. It sits in the asks notice at the top of Next steps, and the advisor's panels mount the first
 * time they are shown (components/planner/PlanTabSwitch.tsx `Panels`), so this runs the first time the family actually
 * sees the notice: on a page opened on Next steps, or on the switch to it, never for a hidden panel. Renders nothing;
 * a failure is the office reading "Sent" a little longer, so it is ignored.
 */
export function MarkAsksSeen({ ids }: { ids: string[] }) {
  const sent = useRef(false);
  const key = ids.join(",");
  useEffect(() => {
    if (sent.current || key === "") return;
    sent.current = true;
    markAsksSeen(key.split(",")).catch(() => {});
  }, [key]);
  return null;
}
