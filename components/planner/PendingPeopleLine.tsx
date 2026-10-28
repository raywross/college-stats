"use client";
/**
 * The people line while another student's plan loads (U20 "real speed"; app/advisor/loading.tsx). Tapping a circle on
 * the people line (PlanPeople) navigates to that student's plan; the loading boundary replaces the page at once, and
 * this draws the line again from what the browser already has: every circle, and the tapped student's chip expanded
 * with their progress, next step, and Edit (the page sends each child's chip details with the line). With nothing
 * pending (a first load), it shows `children`, the plain skeleton. Reads no request data.
 */
import type { ReactNode } from "react";
import { PlanPeople } from "@/components/planner/PlanPeople";
import { pendingPeople } from "@/lib/planner/people-snapshot";

export function PendingPeopleLine({ children }: { children: ReactNode }) {
  const pending = pendingPeople();
  if (!pending) return <>{children}</>;
  return <PlanPeople people={pending.people} selected={pending.selected} detail={pending.detail} details={pending.details} />;
}
