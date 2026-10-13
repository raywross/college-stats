/**
 * The people line a guardian just tapped, held in the browser for the moment between the tap and the new plan
 * arriving (U20 "real speed"): PlanPeople writes it on a tap, app/plan/loading.tsx's PendingPeopleLine reads it so
 * the tapped student's chip and Edit show at once instead of a skeleton. Module state in the browser tab only (never
 * the server: a server render always starts with nothing pending); a snapshot older than a few seconds is ignored,
 * and the real line clears it when it mounts.
 */
import type { PlanPerson, PlanPersonDetail } from "@/components/planner/PlanPeople";

export interface PeopleSnapshot {
  people: PlanPerson[];
  /** The student being switched to. */
  selected: string;
  detail: PlanPersonDetail | null;
  details: Record<string, PlanPersonDetail>;
  at: number;
}

const FRESH_MS = 10_000;
let snapshot: PeopleSnapshot | null = null;

export function setPendingPeople(next: Omit<PeopleSnapshot, "at"> | null, now: number = Date.now()): void {
  snapshot = next ? { ...next, at: now } : null;
}

/** What was tapped within the last few seconds, or null. Always null on the server. */
export function pendingPeople(now: number = Date.now()): PeopleSnapshot | null {
  if (typeof window === "undefined") return null;
  return snapshot && now - snapshot.at < FRESH_MS ? snapshot : null;
}
