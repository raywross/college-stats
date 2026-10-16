import "server-only";
/**
 * The Show interest guide's server loader (lib/planner/guides-server.ts `interest.load`): for `?college=` on the
 * list, the college's next events (the same read `lib/planner/visit-feed.ts loadNextEventsFeed` uses: `eventsForUnit`
 * and `myMeasuringPoint`, with the person's visit-alert radius), picked by `guideEvents`, and the viewer's own pending
 * acts for that college with each event's zone. Without a college (the overview) it reads nothing.
 */
import { createServerSupabase } from "@/lib/supabase-server";
import { eventsForUnit, myMeasuringPoint, myVisitPrefs, readTimeLine } from "@/lib/visit-events/read";
import type { GuideQuery } from "@/components/planner/guides/types";
import { guideEvents, type InterestGuideData } from "./interest-guide";
export type { InterestGuideData };
import { zonesForEvents } from "./interest-acts-server";
import type { PlanView } from "./plan-view";
import { pendingActs } from "./store-interest";
import type { PlanContext } from "./types";

export async function loadInterestGuide(ctx: PlanContext, _view: PlanView, query: GuideQuery): Promise<InterestGuideData | null> {
  if (!query.college) return null;
  const item = ctx.items.find((i) => i.unit_id === query.college && !i.withdrawn_on);
  const school = ctx.schools[query.college];
  if (!item || !school) return null;

  const [events, point, prefs, pending] = await Promise.all([eventsForUnit(query.college, { limit: 50 }), myMeasuringPoint(), myVisitPrefs(), pendingActs(item.id)]);
  const picked = guideEvents(events, point, prefs.radius_miles);
  const zones: Record<string, string> = {};
  for (const e of events) if (e.timezone) zones[e.id] = e.timezone;
  const missing = pending.map((p) => p.event_id).filter((id): id is string => Boolean(id) && !zones[id!]);
  if (missing.length) Object.assign(zones, await zonesForEvents(await createServerSupabase(), missing));
  const lastSeen = events.reduce<string | null>((max, e) => (max == null || e.last_seen > max ? e.last_seen : max), null);

  return {
    events: picked,
    readLine: readTimeLine(school.name, lastSeen),
    pointLabel: point?.label ?? null,
    radiusMiles: prefs.radius_miles,
    pending: pending.map((p) => ({ ...p, confirm_token: "" })),
    zones,
  };
}
