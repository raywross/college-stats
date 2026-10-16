/**
 * The Show interest guide's pure parts (specs/planner/v3/guides/show-interest.md "The page", "The overview"): which
 * four events it lists, the C7 word and the header's sentence, the "Logged for Elon" line, and the overview's order.
 * No server or browser APIs, so the guide's client components and tests import it.
 */
import { SOCIAL_LABELS } from "../social.ts";
import type { FactorImportance, SocialNetwork } from "../types.ts";
import { eventDistance, type MeasuringPoint } from "../visit-events/measure.ts";
import { isShownKind, type VisitEventRow } from "../visit-events/types.ts";
import { onCampusEvents } from "../visit-events/view.ts";
import { VISIT_KIND_LABELS } from "./actions.ts";
import { visitedState } from "./capture.ts";
import type { EdCandidate } from "./ed-opportunities.ts";
import type { InterestActRow } from "./interest-acts-types.ts";
import type { PlanItem, PlanSchool, PlanVisit } from "./types.ts";

/** Events the guide lists for one college (spec "1 Visit": the built two, widened to four). */
export const GUIDE_EVENTS_MAX = 4;
/** Of those, at most this many are the family's nearby ones; the rest are on campus. */
export const GUIDE_NEAR_MAX = 2;

export interface GuideEvent extends VisitEventRow {
  /** Miles from the family's measuring point; null online or without a point. */
  distanceMiles: number | null;
  /** Inside the family's radius (listed first). */
  near: boolean;
}

/**
 * The next events within the family's radius first (soonest first, at most two), then the next ones on campus, up to
 * four in all. Staff and unlisted kinds never show (visit-events.md "Display"); an event is never listed twice.
 */
export function guideEvents(events: readonly VisitEventRow[], point: MeasuringPoint | null, radiusMiles: number, now: Date = new Date()): GuideEvent[] {
  const nowIso = now.toISOString();
  const shown = events.filter((e) => isShownKind(e.kind) && !e.removed_at && e.starts_at >= nowIso);
  const withDistance = (e: VisitEventRow): GuideEvent => {
    const d = point && !e.online ? eventDistance(e, point) : null;
    return { ...e, distanceMiles: d, near: d !== null && d <= radiusMiles };
  };
  const all = shown.map(withDistance);
  const near = all
    .filter((e) => e.near && e.kind !== "online")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, GUIDE_NEAR_MAX);
  const used = new Set(near.map((e) => e.id));
  const campus = onCampusEvents(all.filter((e) => !used.has(e.id))).slice(0, GUIDE_EVENTS_MAX - near.length);
  return [...near, ...campus];
}

/** What the guide's server loader hands the page (lib/planner/interest-guide-server.ts). */
export interface InterestGuideData {
  events: GuideEvent[];
  /** "Read from Elon's calendar at 3:10 am", or null before any read. */
  readLine: string | null;
  /** "home in Marietta, GA" when the family has a measuring point. */
  pointLabel: string | null;
  radiusMiles: number;
  /** The viewer's own pending acts for this college (tokens left out). */
  pending: InterestActRow[];
  /** Each event's own zone by id (the listed events and the pending acts'). */
  zones: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* C7                                                                   */
/* ------------------------------------------------------------------ */

export type InterestVariant = "counts" | "considered" | "not_considered" | "unknown";

export function interestVariant(factor: FactorImportance | null | undefined): InterestVariant {
  if (factor === "very_important" || factor === "important") return "counts";
  if (factor === "considered") return "considered";
  if (factor === "not_considered") return "not_considered";
  return "unknown";
}

/** The C7 word: "very important", "important", "considered", "not considered", or null when unreported. */
export function c7Word(factor: FactorImportance | null | undefined): string | null {
  switch (factor) {
    case "very_important":
      return "very important";
    case "important":
      return "important";
    case "considered":
      return "considered";
    case "not_considered":
      return "not considered";
    default:
      return null;
  }
}

/**
 * The guide's opening sentence (spec "The why"), in two parts so the component can cite the claim (the edition and
 * field beside it, `MetricLabel`): what the college reports, never what a visit does to an application.
 */
export function interestSentence(name: string, factor: FactorImportance | null | undefined): { claim: string; then: string | null } {
  switch (interestVariant(factor)) {
    case "counts":
    case "considered":
      return { claim: `${name} says applicant interest is ${c7Word(factor)}`, then: "What counts most, in order." };
    case "not_considered":
      return { claim: `${name} says it doesn't consider applicant interest`, then: "These are for you, not for the application." };
    default:
      return { claim: `${name} hasn't said whether interest counts`, then: null };
  }
}

/* ------------------------------------------------------------------ */
/* What the plan already records                                        */
/* ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/**
 * "visited Mar 14 (campus tour) · tour planned Nov 3 · info requested Sep 2 · following on Instagram": what the plan
 * records for one college, in that order; empty when nothing is. Only confirmed records: a pending act is never here.
 */
export function loggedParts(
  item: Pick<PlanItem, "visited_on" | "info_requested_on"> & Partial<Pick<PlanItem, "followed_networks">>,
  visits: readonly PlanVisit[],
  today: string,
): string[] {
  const out: string[] = [];
  const state = visitedState(item.visited_on, visits, today);
  if (state.visited && state.date) out.push(`visited ${day(state.date)}${state.visit ? ` (${VISIT_KIND_LABELS[state.visit.kind].toLowerCase()})` : ""}`);
  if (state.upcoming) out.push(`${VISIT_KIND_LABELS[state.upcoming.kind].toLowerCase()} planned ${day(state.upcoming.on_date)}`);
  if (item.info_requested_on) out.push(`info requested ${day(item.info_requested_on)}`);
  const followed = ((item.followed_networks ?? []) as SocialNetwork[]).filter((n) => n in SOCIAL_LABELS);
  if (followed.length) out.push(`following on ${followed.map((n) => SOCIAL_LABELS[n]).join(", ")}`);
  return out;
}

/* ------------------------------------------------------------------ */
/* The overview                                                         */
/* ------------------------------------------------------------------ */

export interface OverviewRow {
  itemId: string;
  unitId: string;
  name: string;
  factor: FactorImportance | null;
  /** Why it sorts where it does: an ED candidate, important or very important, considered, or neither. */
  group: "ed" | "counts" | "considered" | "not_considered" | "unknown";
}

/**
 * Every college on the list in the move order (spec "The overview"): ED candidates first (their own rank), then where
 * interest is important or very important, then considered; `folded` holds where it isn't considered and where the
 * college hasn't said. Within a group, the order the colleges arrive in (the plan view's order).
 */
export function overviewRows(
  items: readonly Pick<PlanItem, "id" | "unit_id" | "withdrawn_on">[],
  schools: Record<string, Pick<PlanSchool, "name" | "profile">>,
  edCandidates: readonly Pick<EdCandidate, "itemId" | "rank">[],
): { shown: OverviewRow[]; notConsidered: OverviewRow[]; unknown: OverviewRow[] } {
  const edRank = new Map(edCandidates.map((c) => [c.itemId, c.rank]));
  const rows: OverviewRow[] = [];
  for (const item of items) {
    if (item.withdrawn_on) continue;
    const school = schools[item.unit_id];
    if (!school) continue;
    const factor = school.profile?.factors?.interest ?? null;
    const variant = interestVariant(factor);
    const group: OverviewRow["group"] = edRank.has(item.id) ? "ed" : variant;
    rows.push({ itemId: item.id, unitId: item.unit_id, name: school.name, factor, group });
  }
  const order: Record<OverviewRow["group"], number> = { ed: 0, counts: 1, considered: 2, not_considered: 3, unknown: 4 };
  const indexed = rows.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => order[a.r.group] - order[b.r.group] || (edRank.get(a.r.itemId) ?? 0) - (edRank.get(b.r.itemId) ?? 0) || a.i - b.i);
  const sorted = indexed.map((x) => x.r);
  return {
    shown: sorted.filter((r) => r.group === "ed" || r.group === "counts" || r.group === "considered"),
    notConsidered: sorted.filter((r) => r.group === "not_considered"),
    unknown: sorted.filter((r) => r.group === "unknown"),
  };
}
