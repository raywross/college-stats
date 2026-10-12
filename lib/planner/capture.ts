/**
 * The row capture panel's pure parts (specs/planner/redesign/list.md "The capture panel"; owner, 2026-10-12): which
 * page "Plan a visit" opens, what "We visited" shows for a college from its tracking date and logged visits, and the
 * college's social accounts with the link that opens each one to follow it. No server or browser APIs, so the panel
 * (components/planner/RowDrawer.tsx) and tests can import it.
 */
import { SOCIAL_LABELS, SOCIAL_NETWORKS } from "../social.ts";
import type { SchoolLinks, SocialNetwork } from "../types.ts";
import { followUrl } from "./actions.ts";
import type { PlanVisit } from "./types.ts";

export interface QuickLink {
  href: string;
  label: string;
}

/** The college's campus visit page, else its virtual tour, else its admissions page; null when it has none of them. */
export function visitPageLink(links: Pick<SchoolLinks, "visit" | "virtual_tour" | "admissions"> | null | undefined): QuickLink | null {
  if (!links) return null;
  if (links.visit) return { href: links.visit, label: "Campus visit page" };
  if (links.virtual_tour) return { href: links.virtual_tour, label: "Virtual tour" };
  if (links.admissions) return { href: links.admissions, label: "Admissions page" };
  return null;
}

export interface VisitedState {
  /** Whether the family has been: a tracking date, or any visit on or before today. */
  visited: boolean;
  /** The date shown beside "We visited": the first past visit's, else the tracking date; null when not visited. */
  date: string | null;
  /** The visit "We visited" edits (its date, its notes): the first past one, or null when only the tracking date is set. */
  visit: PlanVisit | null;
  /** How many visits on or before today are logged (more than one can't be undone with one tap). */
  pastCount: number;
  /** The soonest visit after today, if one is planned. */
  upcoming: PlanVisit | null;
}

/** "We visited" for one college, from `list_items.visited_on` and the college's `plan_visits` (any order). */
export function visitedState(visitedOn: string | null, visits: readonly PlanVisit[], today: string): VisitedState {
  const sorted = [...visits].sort((a, b) => a.on_date.localeCompare(b.on_date));
  const past = sorted.filter((v) => v.on_date <= today);
  const upcoming = sorted.find((v) => v.on_date > today) ?? null;
  const visit = past[0] ?? null;
  const date = visit?.on_date ?? visitedOn ?? null;
  return { visited: date !== null, date, visit, pastCount: past.length, upcoming };
}

export interface FollowTarget {
  network: SocialNetwork;
  label: string;
  /** Opens the college's account to follow it (X's follow intent, YouTube's subscribe prompt, else the profile). */
  href: string;
  followed: boolean;
}

/** The college's accounts in the site's order (lib/social.ts), each with its follow link and whether it's followed. */
export function followTargets(social: Partial<Record<SocialNetwork, string>> | null | undefined, followed: readonly SocialNetwork[]): FollowTarget[] {
  if (!social) return [];
  return SOCIAL_NETWORKS.flatMap((network) => {
    const handle = social[network];
    return handle ? [{ network, label: SOCIAL_LABELS[network], href: followUrl(network, handle), followed: followed.includes(network) }] : [];
  });
}
