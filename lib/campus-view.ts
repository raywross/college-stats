/**
 * View models for the campus-life blocks (components/school/GreekLife.tsx, ReligiousLife.tsx, LgbtqLife.tsx): pure
 * joins of the college's own pages (lib/campus-pages.ts), the national directories (lib/directories.ts), and the
 * organizations file (lib/organizations.ts), so the display stays thin and the joins are tested.
 */
import { COUNCILS, TRADITIONS, type Council, type CreditedListing, type Tradition } from "./directories.ts";
import type { CouncilBreakdown, GreekCouncilFact } from "./campus-pages.ts";
import { chapterLabel, orgBadge, orgName, orgWebsite, type OrgBadgeData, type OrgInfo } from "./organizations.ts";

/** One listing ready to show: who, where their site is, the chapter's own name and page, and the badge. */
export interface ListingView {
  listing: CreditedListing;
  /** The organization's display name. */
  org: string;
  /** The organization's home page, or null. */
  website: string | null;
  /** The chapter's or group's own name, without the organization's ("Tau"), or null. */
  chapter: string | null;
  /** The chapter's own page from the list, or null. */
  chapterUrl: string | null;
  badge: OrgBadgeData;
}

/** The listing's name without the organization's, under either the list's name for it or the display name. */
function chapterOf(name: string | undefined, listed: string, display: string): string | null {
  const a = chapterLabel(name, listed);
  return a && display !== listed ? chapterLabel(a, display) : a;
}

export function listingView(l: CreditedListing, orgs: Record<string, OrgInfo>): ListingView {
  const info = orgs[l.org] ?? null;
  const org = orgName(info, l.credit);
  return {
    listing: l,
    org,
    website: orgWebsite(info, l.credit),
    chapter: chapterOf(l.name, l.credit.organization, org),
    chapterUrl: l.url ?? null,
    badge: orgBadge(info, org),
  };
}

/** One council row: the college's own count when its pages give one, and the chapters national lists name. */
export interface CouncilView {
  key: string;
  council: Council;
  /** "Panhellenic sororities (NPC)". */
  label: string;
  /** The college's own name for the council ("University Panhellenic Council (UPC)"), or null. */
  name: string | null;
  /** Chapters as the college counts them, or null when its pages don't say. */
  chapters: number | null;
  members: string | null;
  term: string | null;
  ref: GreekCouncilFact | null;
  listings: ListingView[];
}

export interface GreekView {
  councils: CouncilView[];
  /** All chapters, only when the college gives a count for every council shown (never mixed with list counts). */
  total: number | null;
}

/**
 * Councils from both sources, in COUNCILS order: a college-page council takes the national lists' chapters for the
 * same council (the first one by name when a college has two, e.g. two multicultural councils); a council only the
 * lists know gets its own row without a college count.
 */
export function greekView(breakdown: CouncilBreakdown | null, listings: readonly CreditedListing[], orgs: Record<string, OrgInfo>): GreekView {
  const rows: CouncilView[] = (breakdown?.rows ?? []).map((r) => ({
    key: `${r.council}|${r.name}`,
    council: r.council,
    label: r.label,
    name: r.name,
    chapters: r.chapters,
    members: r.members,
    term: r.term,
    ref: r.ref,
    listings: [],
  }));
  for (const l of listings) {
    const c = l.credit;
    if (c.domain !== "greek") continue;
    let row = rows.find((r) => r.council === c.council);
    if (!row) {
      row = { key: c.council, council: c.council, label: COUNCILS[c.council], name: null, chapters: null, members: null, term: null, ref: null, listings: [] };
      rows.push(row);
    }
    row.listings.push(listingView(l, orgs));
  }
  const order = Object.keys(COUNCILS);
  rows.sort((a, b) => order.indexOf(a.council) - order.indexOf(b.council));
  for (const r of rows) r.listings.sort((a, b) => a.org.localeCompare(b.org));
  const total = rows.length && rows.every((r) => r.chapters !== null) ? rows.reduce((s, r) => s + (r.chapters ?? 0), 0) : null;
  return { councils: rows, total };
}

/** Faith listings by tradition, in TRADITIONS order, with the views ready to show. */
export function faithView(listings: readonly CreditedListing[], orgs: Record<string, OrgInfo>): { tradition: Tradition; label: string; items: ListingView[] }[] {
  const by = new Map<Tradition, ListingView[]>();
  for (const l of listings) {
    if (l.credit.domain !== "faith") continue;
    const t = l.credit.tradition;
    (by.get(t) ?? by.set(t, []).get(t)!).push(listingView(l, orgs));
  }
  return (Object.keys(TRADITIONS) as Tradition[]).filter((t) => by.has(t)).map((t) => ({ tradition: t, label: TRADITIONS[t], items: by.get(t)! }));
}
