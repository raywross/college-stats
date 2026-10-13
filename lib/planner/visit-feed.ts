"use server";
/**
 * U4 (planner tie-in, specs/product/visit-events.md "Planner"): a thin server action so
 * `components/visits/NextEvents.tsx` — a client component, since it owns the "I registered" sheet's open state —
 * can read the signed-in person's events and measuring point. Next.js doesn't allow a Client Component to import a
 * Server Component (`lib/visit-events/read.ts` is `server-only`, and no Server Component in this row's render tree
 * is ours to extend), so a Client Component calling a Server Action is the supported path; this file only forwards
 * to U1/U2's `eventsForUnit`/`myMeasuringPoint`, which still run with the signed-in person's own RLS session.
 */
import { eventsForUnit, myMeasuringPoint } from "@/lib/visit-events/read";
import type { VisitEventRow } from "@/lib/visit-events/types";
import type { MeasuringPoint } from "@/lib/visit-events/measure";

export interface NextEventsFeed {
  events: VisitEventRow[];
  point: MeasuringPoint | null;
}

/** A college's upcoming events plus the signed-in viewer's measuring point, for the planner row's next-events block. */
export async function loadNextEventsFeed(unitId: string): Promise<NextEventsFeed> {
  const [events, point] = await Promise.all([eventsForUnit(unitId, { limit: 50 }), myMeasuringPoint()]);
  return { events, point };
}
