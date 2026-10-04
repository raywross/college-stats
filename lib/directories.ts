/**
 * National directories of campus chapters and groups (specs/campus-directories.md): the shared data model behind
 * religious life, Greek life, and LGBTQ+ life's "Scaling" phases. Pure module (type-only imports), so the sync, the
 * runner, tests, and the app all read the same definitions.
 *
 * - Each organization's list is crawled by one adapter (scripts/lib/directories/adapters/<key>.mts) into
 *   data/directories/<key>.json, matched to IPEDS unit ids.
 * - `npm run merge-directories` (and `npm run sync-data`) turn the matches into one `directories` detail table per
 *   college (data/detail/schools/{id}.json) plus a small presence summary in data/schools.json (`school.directories`).
 * - Every listing names its organization; the table's `credits` say who published the list, where, the date we read
 *   it, and its tier (religious-life.md#source-tiers). `checkDirectoryRows` refuses a listing without one.
 */
import type { Cited } from "./lineage";

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

export type DirectoryDomain = "faith" | "greek" | "lgbtq";
export const DIRECTORY_DOMAINS: readonly DirectoryDomain[] = ["faith", "greek", "lgbtq"];

/**
 * Source tiers (religious-life.md#source-tiers) a directory can carry. Tier A (official statistics and policy pages)
 * never comes from a directory: a policy page is checked per college (`PolicyCheck` below).
 * B: an official directory (the college's own registered-org list); C: an organization's estimate for a campus
 * (Hillel's Jewish-student count); D: a national organization's list of its campus chapters.
 */
export type DirectoryTier = "B" | "C" | "D";
export const DIRECTORY_TIERS: readonly DirectoryTier[] = ["B", "C", "D"];

/** Faith traditions (religious-life.md, "Faith communities present"). Christian groups stay one tradition (open question 2). */
export const TRADITIONS = {
  jewish: "Jewish",
  catholic: "Catholic",
  christian: "Christian",
  orthodox: "Orthodox Christian",
  latter_day_saint: "Latter-day Saint",
  muslim: "Muslim",
  hindu: "Hindu",
  sikh: "Sikh",
  buddhist: "Buddhist",
  bahai: "Baháʼí",
  nonreligious: "Nonreligious and secular",
  interfaith: "Interfaith",
  other: "Other",
} as const;
export type Tradition = keyof typeof TRADITIONS;
export const isTradition = (v: string): v is Tradition => v in TRADITIONS;

/** Greek councils (greek-life.md, "Size and makeup"). */
export const COUNCILS = {
  npc: "Panhellenic sororities (NPC)",
  nic: "Interfraternity (NIC and IFC)",
  nphc: "Historically Black (NPHC)",
  nalfo: "Latino (NALFO)",
  napa: "Asian (NAPA)",
  nmgc: "Multicultural (NMGC)",
  lgbtq: "LGBTQ+ fraternities and sororities",
  professional: "Professional and other",
} as const;
export type Council = keyof typeof COUNCILS;
export const isCouncil = (v: string): v is Council => v in COUNCILS;

/** What an LGBTQ+ listing is (lgbtq-life.md, "Measures" 2 and 4). */
export const LGBTQ_KINDS = {
  center: "LGBTQ+ center or staffed office",
  group: "Student group or chapter",
  policy: "Listed for a policy",
} as const;
export type LgbtqKind = keyof typeof LGBTQ_KINDS;

/** The policy keys of lgbtq-life.md's data model (`school.lgbtq.policies[].key`). */
export const POLICY_KEYS = {
  nondiscrimination_orientation: "Nondiscrimination policy covers sexual orientation",
  nondiscrimination_identity: "Nondiscrimination policy covers gender identity or expression",
  inclusive_housing: "Gender-inclusive housing",
  name_on_records: "Chosen name and pronouns on campus records",
  inclusive_restrooms: "Gender-inclusive restrooms listed online",
  health_plan_transition: "Student health plan covers transition-related care",
  trans_admission: "Trans admission policy (historically women's or men's college)",
  /** lgbtq-life.md open question 3: athletic eligibility is set nationally (NCAA); a per-college policy covers intramurals and club sports only. */
  trans_athletics: "Trans-inclusive athletic policy (intramurals and club sports)",
} as const;
export type PolicyKey = keyof typeof POLICY_KEYS;

/**
 * What every listing from one directory is. One per adapter: a directory that mixes kinds is split into one adapter
 * per kind (e.g. one per Clearinghouse list), so each list's credit and tier stay exact.
 */
export type Classification =
  | { domain: "faith"; tradition: Tradition }
  | { domain: "greek"; council: Council }
  | { domain: "lgbtq"; kind: "center" | "group" }
  | { domain: "lgbtq"; kind: "policy"; policy: PolicyKey };

/** The group key a classification files under: its tradition, council, kind, or policy key. */
export function classKey(c: Classification): Tradition | Council | LgbtqKind | PolicyKey {
  if (c.domain === "faith") return c.tradition;
  if (c.domain === "greek") return c.council;
  return c.kind === "policy" ? c.policy : c.kind;
}

/** Display label for a classification's group. */
export function classLabel(c: Classification): string {
  if (c.domain === "faith") return TRADITIONS[c.tradition];
  if (c.domain === "greek") return COUNCILS[c.council];
  return c.kind === "policy" ? POLICY_KEYS[c.policy] : LGBTQ_KINDS[c.kind];
}

/** Problem with a classification read from a file, or null. */
export function classificationProblem(c: unknown): string | null {
  const o = c as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return "no classification";
  if (o.domain === "faith") return typeof o.tradition === "string" && o.tradition in TRADITIONS ? null : `unknown tradition "${String(o.tradition)}"`;
  if (o.domain === "greek") return typeof o.council === "string" && o.council in COUNCILS ? null : `unknown council "${String(o.council)}"`;
  if (o.domain === "lgbtq") {
    if (o.kind === "center" || o.kind === "group") return null;
    if (o.kind === "policy") return typeof o.policy === "string" && o.policy in POLICY_KEYS ? null : `unknown policy key "${String(o.policy)}"`;
    return `unknown LGBTQ+ kind "${String(o.kind)}"`;
  }
  return `unknown domain "${String(o.domain)}"`;
}

/* ------------------------------------------------------------------ */
/* Stored shapes                                                       */
/* ------------------------------------------------------------------ */

/** Who published a directory and when we read it: shown in each listing's ⓘ (owner decision 4, "publish with credit"). */
export type DirectoryCredit = {
  /** "Orthodox Christian Fellowship" */
  organization: string;
  /** Who publishes the list, when not the organization itself (else the same name). */
  publisher: string;
  /** The page we read (https). */
  list_url: string;
  /** ISO date we read it. */
  read: string;
  tier: DirectoryTier;
} & Classification;

/** One organization's entry for one college. */
export interface Listing {
  /** Adapter key; its credit is `credits[org]` in the same table. */
  org: string;
  /** Tier C for an entry carrying an organization's estimate; otherwise the credit's tier. */
  tier?: DirectoryTier;
  /** Chapter or group name as listed ("OCF at UT Austin"). */
  name?: string;
  /** The chapter's own page, when the list links one. */
  url?: string;
  /** Status as listed ("active", "colony"). */
  status?: string;
  /** A fact the list states for the campus ("2,750 Jewish undergraduates"); tier C needs one, with its quote. */
  fact?: string;
  /** Short supporting quote from the list (≤ 160 characters). */
  quote?: string;
  /** The chapter serves several colleges (a city-wide or consortium chapter). */
  multi?: true;
}

/** The `directories` detail table's rows. */
export interface DirectoryRows {
  credits: Record<string, DirectoryCredit>;
  /** Sorted by domain, group, organization, then name. */
  listings: Listing[];
}

/** `school.directories`: which groups each domain's listings cover, for filters and "has anything" checks. */
export type DirectorySummary = Partial<Record<DirectoryDomain, string[]>>;

/** Explore's "has a [tradition] community" filter (religious-life.md, "Later": now phase 3): the faith summary names it. */
export function hasFaithTradition(s: { directories?: DirectorySummary | null }, wanted: readonly Tradition[]): boolean {
  const present = s.directories?.faith;
  return !!present && wanted.some((t) => present.includes(t));
}

/** A listing joined to its credit, for display. */
export type CreditedListing = Listing & { credit: DirectoryCredit; tier: DirectoryTier };

export const MAX_QUOTE = 160;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ORG_KEY = /^[a-z0-9][a-z0-9-]*$/;

const isHttps = (u: unknown) => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u);

/** Problems with one credit (empty when sound). */
export function creditProblems(key: string, c: DirectoryCredit | undefined): string[] {
  if (!c) return [`no credit for organization "${key}"`];
  const out: string[] = [];
  if (!ORG_KEY.test(key)) out.push(`organization key "${key}" must be lowercase letters, digits, and hyphens`);
  if (!c.organization) out.push(`${key}: credit has no organization name`);
  if (!c.publisher) out.push(`${key}: credit has no publisher`);
  if (!isHttps(c.list_url)) out.push(`${key}: credit's list_url must be an https link`);
  if (typeof c.read !== "string" || !ISO_DATE.test(c.read)) out.push(`${key}: credit needs the ISO date the list was read`);
  if (!DIRECTORY_TIERS.includes(c.tier)) out.push(`${key}: unknown tier "${String(c.tier)}"`);
  const cls = classificationProblem(c);
  if (cls) out.push(`${key}: ${cls}`);
  return out;
}

/** Problems with one listing given its table's credits. */
export function listingProblems(l: Listing, credits: Record<string, DirectoryCredit>): string[] {
  const out: string[] = [];
  const credit = credits[l.org];
  if (!l.org || !credit) out.push(`listing "${l.name ?? l.org ?? "?"}" names no credited organization (every listing needs its source)`);
  if (l.tier !== undefined && !DIRECTORY_TIERS.includes(l.tier)) out.push(`listing "${l.name ?? l.org}" has unknown tier "${l.tier}"`);
  const tier = l.tier ?? credit?.tier;
  if (tier === "C" && (!l.fact || !l.quote)) out.push(`listing "${l.name ?? l.org}" is an organization estimate (tier C) without its fact and quote`);
  if (l.quote && l.quote.length > MAX_QUOTE) out.push(`listing "${l.name ?? l.org}" quote is over ${MAX_QUOTE} characters`);
  if (l.url !== undefined && !/^https?:\/\/\S+$/.test(l.url)) out.push(`listing "${l.name ?? l.org}" has a malformed url`);
  return out;
}

/** The detail table's row check (lib/detail.ts DETAIL_TABLES): a problem, or null. */
export function checkDirectoryRows(rows: unknown): string | null {
  const r = rows as DirectoryRows | null;
  if (!r || typeof r !== "object" || !r.credits || !Array.isArray(r.listings)) return "rows must be { credits, listings }";
  if (!r.listings.length) return "no listings (leave the table out instead)";
  for (const [k, c] of Object.entries(r.credits)) {
    const p = creditProblems(k, c);
    if (p.length) return p[0];
  }
  for (const l of r.listings) {
    const p = listingProblems(l, r.credits);
    if (p.length) return p[0];
  }
  const used = new Set(r.listings.map((l) => l.org));
  const unused = Object.keys(r.credits).filter((k) => !used.has(k));
  if (unused.length) return `credits nothing lists: ${unused.join(", ")}`;
  const sorted = sortListings(r.listings, r.credits);
  if (sorted.some((l, i) => l !== r.listings[i])) return "listings aren't in canonical order (sortListings)";
  return null;
}

/* ------------------------------------------------------------------ */
/* Ordering and summary                                                */
/* ------------------------------------------------------------------ */

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const DOMAIN_ORDER = (d: DirectoryDomain) => DIRECTORY_DOMAINS.indexOf(d);

/** Canonical order: domain, group key, organization, name, url (stable diffs). Returns a new array of the same objects. */
export function sortListings(listings: readonly Listing[], credits: Record<string, DirectoryCredit>): Listing[] {
  const key = (l: Listing) => {
    const c = credits[l.org];
    return c ? [String(DOMAIN_ORDER(c.domain)), classKey(c), c.organization, l.name ?? "", l.url ?? ""] : ["9", "", l.org, l.name ?? "", l.url ?? ""];
  };
  return [...listings].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const c = cmp(ka[i], kb[i]);
      if (c) return c;
    }
    return cmp(a.org, b.org);
  });
}

/** `school.directories` from a college's table: each domain's group keys, sorted; null when there's nothing. */
export function summarize(rows: DirectoryRows | null | undefined): DirectorySummary | null {
  if (!rows?.listings.length) return null;
  const by = new Map<DirectoryDomain, Set<string>>();
  for (const l of rows.listings) {
    const c = rows.credits[l.org];
    if (!c) continue;
    (by.get(c.domain) ?? by.set(c.domain, new Set()).get(c.domain)!).add(classKey(c));
  }
  const out: DirectorySummary = {};
  for (const d of DIRECTORY_DOMAINS) if (by.get(d)?.size) out[d] = [...by.get(d)!].sort();
  return Object.keys(out).length ? out : null;
}

/** The newest date any credit in the table was read (the table's `year`). */
export function newestRead(rows: DirectoryRows): string {
  return Object.values(rows.credits)
    .map((c) => c.read)
    .sort()
    .at(-1)!;
}

/* ------------------------------------------------------------------ */
/* Display helpers (shared by the three domains)                       */
/* ------------------------------------------------------------------ */

/** A college's listings for one domain, each with its credit; [] when it has none. */
export function listingsFor(rows: DirectoryRows | null | undefined, domain: DirectoryDomain): CreditedListing[] {
  if (!rows) return [];
  const out: CreditedListing[] = [];
  for (const l of rows.listings) {
    const credit = rows.credits[l.org];
    if (credit?.domain === domain) out.push({ ...l, credit, tier: l.tier ?? credit.tier });
  }
  return out;
}

export interface ListingGroup {
  /** Tradition, council, kind, or policy key. */
  key: string;
  label: string;
  listings: CreditedListing[];
}

/** Listings grouped by tradition / council / kind (policy items by policy), in the classification tables' order. */
export function groupListings(listings: readonly CreditedListing[]): ListingGroup[] {
  const groups = new Map<string, ListingGroup>();
  for (const l of listings) {
    const key = classKey(l.credit);
    const g = groups.get(key) ?? groups.set(key, { key, label: classLabel(l.credit), listings: [] }).get(key)!;
    g.listings.push(l);
  }
  const order = [...Object.keys(TRADITIONS), ...Object.keys(COUNCILS), "center", "group", ...Object.keys(POLICY_KEYS)];
  return [...groups.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** "Orthodox Christian Fellowship's chapter list" style credit line, for the ⓘ. */
export function creditLine(c: DirectoryCredit): string {
  return c.publisher && c.publisher !== c.organization ? `${c.organization}, published by ${c.publisher}` : c.organization;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-04" → "October 2026": the display year of a list read on that date. */
export function readLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * The newest date any college's `directories` lineage record was read, across the whole dataset, as a display
 * label ("October 2026"); null before any adapter has ever run. For a college with no listing of its own
 * (`listingsFor` returns []), this is how a "none found" sentence can still name a date without inventing one for
 * that college specifically — it's the date the sweep of every national directory last ran, not a claim about
 * this college. (specs/greek-life.md phase 4 "none found" vs. "none reported"; shared by faith, Greek, and LGBTQ+.)
 */
export function latestDirectoryRead(schools: readonly { lineage?: { directories?: { retrieved?: string } } | null }[]): string | null {
  const dates = schools.map((s) => s.lineage?.directories?.retrieved).filter((d): d is string => !!d);
  if (!dates.length) return null;
  return readLabel(dates.sort().at(-1)!);
}

/** The ⓘ citation for one listing: the organization's list, its tier, the date read, and any quote. Plain data. */
export function citeListing(l: CreditedListing): Cited {
  const c = l.credit;
  return {
    key: l.tier === "C" ? "org-estimate" : "directory",
    label: c.organization,
    publisher: c.publisher,
    year: readLabel(c.read),
    url: c.list_url,
    retrieved: c.read,
    path: "detail.directories",
    field: l.name ?? c.organization,
    method: "reported",
    isDefault: true,
    ...(l.quote ? { quote: l.quote } : {}),
    directory: { organization: c.organization, tier: l.tier, phrase: TIER_PHRASES[l.tier] },
  };
}

/** What each tier means, in one phrase (shown in the ⓘ next to the credit). */
export const TIER_PHRASES: Record<DirectoryTier, string> = {
  B: "the college's own directory of registered groups",
  C: "an estimate published by the organization, not by the college",
  D: "a national organization's list of its campus chapters, not confirmed by the college",
};

/* ------------------------------------------------------------------ */
/* Tier A policy checks (for the LGBTQ+ policy items)                  */
/* ------------------------------------------------------------------ */

/**
 * A policy fact read from the college's own page (lgbtq-life.md "Inclusive policies"; tier A). Every check names the
 * page, the date it was checked, and the quote; a "no" or a conduct restriction also names the second model that
 * confirmed it against the quote and page (owner decision 3, 2026-10-04): unconfirmed findings are never stored.
 */
export interface PolicyCheck {
  key: PolicyKey | "conduct_restriction";
  value: "yes" | "no" | "not_found";
  url: string;
  checked: string;
  quote: string | null;
  /** The model id that re-checked the finding ("claude-sonnet-5"); required for "no" and conduct restrictions. */
  verified_by?: string;
}

/** Problems with one policy check; the LGBTQ+ track's merge calls this before writing. */
export function policyCheckProblems(p: PolicyCheck): string[] {
  const out: string[] = [];
  const what = `policy ${p.key}`;
  if (!(p.key in POLICY_KEYS) && p.key !== "conduct_restriction") out.push(`${what}: unknown policy key`);
  if (!["yes", "no", "not_found"].includes(p.value)) out.push(`${what}: unknown value "${p.value}"`);
  if (!isHttps(p.url)) out.push(`${what}: needs the policy page's https URL`);
  if (!ISO_DATE.test(p.checked ?? "")) out.push(`${what}: needs the ISO date it was checked`);
  if (p.value !== "not_found" && !p.quote) out.push(`${what}: a "${p.value}" needs the page's own words (quote)`);
  if (p.quote && p.quote.length > MAX_QUOTE) out.push(`${what}: quote is over ${MAX_QUOTE} characters`);
  const sensitive = p.value === "no" || p.key === "conduct_restriction";
  if (sensitive && !p.verified_by) out.push(`${what}: a "no" or a conduct restriction needs verified_by (the second model's check)`);
  return out;
}
