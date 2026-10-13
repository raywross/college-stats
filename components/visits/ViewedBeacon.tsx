"use client";
/**
 * Fires `visit_events_viewed` once when a surface showing visit events renders (specs/product/visit-events.md
 * "Privacy and telemetry"). Renders nothing, like components/profile/ViewBeacon.tsx.
 */
import { useEffect } from "react";
import { track } from "@/lib/analytics";
import type { VisitEventKind } from "@/lib/visit-events/types";

export function ViewedBeacon({ surface, kind = "all" }: { surface: "profile" | "me" | "planner"; kind?: VisitEventKind | "all" }) {
  useEffect(() => {
    track("visit_events_viewed", { surface, kind });
    // Fire once per mount: a surface is "viewed" when it first renders, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
