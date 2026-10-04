/**
 * Facts read from a college's own pages by the campus-life pilot (specs/religious-life.md phase 2, greek-life.md phase 2,
 * lgbtq-life.md phase 4; scripts/campus-pilot.mts). Pure module (type-only imports), shared by the pipeline, the merge,
 * the detail-file check, tests, and the profile.
 *
 * Two homes, by tier (religious-life.md#source-tiers):
 * - Tier A facts (the college's policy pages, its fraternity & sorority life reports, its institutional-research
 *   enrollment by religion) go in the `campus_pages` detail table (data/detail/schools/{id}.json, source `policy-page`).
 *   Every fact names its page, the date it was checked, and a short quote from that page.
 * - Tier B lists (faith communities named by the college's own office, college-recognized LGBTQ+ groups) and tier C
 *   estimates (a campus group's own size claim) go in the `directories` table as listings credited to that page
 *   (pilotDirectoryFiles in scripts/lib/campus-pilot/merge.mts), so they show and cite like every other listing.
 *
 * Sensitive-facts rules (lgbtq-life.md "Sensitive facts: rules"), enforced by `checkCampusPages` and the display:
 * quote, don't characterize; a "no", a conduct restriction, and an official religious composition carry `verified_by`
 * (owner decision 3, 2026-10-04: a second model re-checks them against the quote and page instead of a person); a fact
 * checked more than two years ago is hidden (`isFresh`); member counts under 10 show as "fewer than 10".
 */
import type { Cited } from "./lineage";
import { COUNCILS, MAX_QUOTE, POLICY_KEYS, policyCheckProblems, type Council, type PolicyCheck, type PolicyKey } from "./directories.ts";

/** A fact older than this (days since `checked`) is hidden until re-checked (lgbtq-life.md "Expiry"). */
export const FACT_MAX_AGE_DAYS = 730;
/** Counts below this show as "fewer than 10" (lgbtq-life.md open question 1; the same threshold for every count here). */
export const SMALL_COUNT = 10;

/** What every fact carries: the college's page, the date we checked it, and the page's own words. */
export interface PageRef {
  /** The college's page or file (https). */
  url: string;
  /** ISO date the page was read. */
  checked: string;
  /** Short quote from the page (≤ 160 characters). */
  quote: string;
  /** The model that re-checked the finding against the quote and page; required for sensitive findings. */
  verified_by?: string;
}

export interface GreekCouncilFact extends PageRef {
  council: Council;
  /** As the college names it ("University Panhellenic Council"). */
  name: string;
  chapters: number | null;
  members: number | null;
  /** The term the count describes ("Spring 2026"); counts are by semester (greek-life.md Rules). */
  term: string | null;
}

export interface CampusGreek {
  /** The college states it has no recognized fraternities or sororities (Williams, Reed). */
  none_stated?: PageRef;
  members_total?: PageRef & { value: number; term: string | null };
  councils?: GreekCouncilFact[];
  /** Chapter houses: "yes" when the college says chapters are housed (on or off campus). */
  housing?: PageRef & { value: "yes" | "no" };
  /** Deferred recruitment: "yes" = first-years can't join in their first term. */
  deferred?: PageRef & { value: "yes" | "no" };
  /** When formal recruitment happens, in the college's words ("Fall, before classes"). */
  formal_term?: PageRef & { value: string };
}

export interface CompositionItem {
  label: string;
  count: number | null;
  /** 0–1. */
  share: number | null;
}

export interface CampusFaith {
  /** The college's own faith or spiritual-life office (chaplaincy, campus ministry). */
  office?: PageRef & { name: string };
  /** Official religious composition (tier A), as the college publishes it; `verified_by` required. */
  composition?: PageRef & { items: CompositionItem[]; population: string | null; as_of: string | null };
}

export interface CampusLgbtq {
  center?: PageRef & { name: string; status: "open" | "closed"; closed?: string };
  /** Policy items (lgbtq-life.md Measures 2) and the conduct-code finding (Measures 3), as PolicyCheck rows. */
  policies?: PolicyCheck[];
}

/** The `campus_pages` detail table's rows. Each domain is left out when nothing was published for it. */
export interface CampusPagesRows {
  greek?: CampusGreek;
  faith?: CampusFaith;
  lgbtq?: CampusLgbtq;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isHttps = (u: unknown) => typeof u === "string" && /^https:\/\/\S+$/.test(u);
const isCount = (n: unknown) => n === null || (typeof n === "number" && Number.isInteger(n) && n >= 0);

function refProblems(what: string, r: PageRef | undefined, o: { sensitive?: boolean } = {}): string[] {
  if (!r) return [];
  const out: string[] = [];
  if (!isHttps(r.url)) out.push(`${what}: needs the college page's https URL`);
  if (typeof r.checked !== "string" || !ISO_DATE.test(r.checked)) out.push(`${what}: needs the ISO date it was checked`);
  if (!r.quote) out.push(`${what}: needs the page's own words (quote)`);
  else if (r.quote.length > MAX_QUOTE) out.push(`${what}: quote is over ${MAX_QUOTE} characters`);
  if (o.sensitive && !r.verified_by) out.push(`${what}: needs verified_by (the second model's check)`);
  return out;
}

/** Problems with a `campus_pages` table's rows (empty when sound). */
export function campusPagesProblems(rows: CampusPagesRows): string[] {
  const out: string[] = [];
  const g = rows.greek;
  if (g) {
    out.push(...refProblems("greek.none_stated", g.none_stated));
    out.push(...refProblems("greek.members_total", g.members_total));
    if (g.members_total && !(Number.isInteger(g.members_total.value) && g.members_total.value > 0)) out.push("greek.members_total: impossible count");
    for (const c of g.councils ?? []) {
      out.push(...refProblems(`greek council ${c.name}`, c));
      if (!(c.council in COUNCILS)) out.push(`greek council ${c.name}: unknown council "${c.council}"`);
      if (!isCount(c.chapters) || !isCount(c.members)) out.push(`greek council ${c.name}: impossible count`);
      if (c.chapters === null && c.members === null) out.push(`greek council ${c.name}: neither chapters nor members`);
    }
    out.push(...refProblems("greek.housing", g.housing), ...refProblems("greek.deferred", g.deferred), ...refProblems("greek.formal_term", g.formal_term));
    if (g.none_stated && (g.councils?.length || g.members_total)) out.push("greek: says none and lists councils");
  }
  const f = rows.faith;
  if (f) {
    out.push(...refProblems("faith.office", f.office));
    if (f.composition) {
      out.push(...refProblems("faith.composition", f.composition, { sensitive: true }));
      if (!f.composition.items.length) out.push("faith.composition: no items");
      for (const i of f.composition.items) {
        if (!i.label) out.push("faith.composition: an item has no label");
        if (!isCount(i.count) || (i.share !== null && !(i.share >= 0 && i.share <= 1))) out.push(`faith.composition ${i.label}: impossible value`);
        if (i.count === null && i.share === null) out.push(`faith.composition ${i.label}: neither count nor share`);
      }
    }
  }
  const l = rows.lgbtq;
  if (l) {
    if (l.center) {
      out.push(...refProblems("lgbtq.center", l.center));
      if (l.center.status !== "open" && l.center.status !== "closed") out.push(`lgbtq.center: unknown status "${String(l.center.status)}"`);
    }
    const keys = new Set<string>();
    for (const p of l.policies ?? []) {
      out.push(...policyCheckProblems(p));
      if (p.value === "not_found") out.push(`policy ${p.key}: "not found" is not stored (leave it out)`);
      if (keys.has(p.key)) out.push(`policy ${p.key}: listed twice`);
      keys.add(p.key);
    }
  }
  return out;
}

/** The detail table's row check (lib/detail.ts DETAIL_TABLES): a problem, or null. */
export function checkCampusPages(rows: unknown): string | null {
  const r = rows as CampusPagesRows | null;
  if (!r || typeof r !== "object" || Array.isArray(r)) return "rows must be an object";
  if (!r.greek && !r.faith && !r.lgbtq) return "no facts (leave the table out instead)";
  return campusPagesProblems(r)[0] ?? null;
}

/** Every date a fact in the table was checked (for the table's `year`). */
export function checkedDates(rows: CampusPagesRows): string[] {
  const out: string[] = [];
  const add = (r?: { checked: string }) => r && out.push(r.checked);
  const g = rows.greek;
  if (g) [g.none_stated, g.members_total, g.housing, g.deferred, g.formal_term, ...(g.councils ?? [])].forEach(add);
  if (rows.faith) [rows.faith.office, rows.faith.composition].forEach(add);
  if (rows.lgbtq) [rows.lgbtq.center, ...(rows.lgbtq.policies ?? [])].forEach(add);
  return out.sort();
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

/** Whether a fact checked on `checked` may still be shown on `today` (both ISO dates). */
export function isFresh(checked: string, today: string): boolean {
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${checked}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(age) && age <= FACT_MAX_AGE_DAYS;
}

/** A count under the small-number rule: "fewer than 10" below 10, else the number with separators. */
export function countLabel(n: number): string {
  return n < SMALL_COUNT ? "fewer than 10" : n.toLocaleString("en-US");
}

export interface CouncilRow {
  council: Council;
  label: string;
  name: string;
  chapters: number | null;
  /** Display string under the small-number rule, or null when the college gave no count. */
  members: string | null;
  term: string | null;
  ref: GreekCouncilFact;
}

export interface CouncilBreakdown {
  rows: CouncilRow[];
  /** The total the college states, or null. */
  total: string | null;
  totalRef: (PageRef & { value: number; term: string | null }) | null;
  /** The term every row shares, or null when terms differ (each row then shows its own). */
  term: string | null;
}

/**
 * The Greek council breakdown for a college (greek-life.md Measures 2), fresh facts only, in COUNCILS order; null when
 * there's nothing to show. Members under 10 show as "fewer than 10".
 */
export function greekCouncils(rows: CampusPagesRows | null | undefined, today: string): CouncilBreakdown | null {
  const g = rows?.greek;
  if (!g) return null;
  const order = Object.keys(COUNCILS);
  const councils = (g.councils ?? [])
    .filter((c) => isFresh(c.checked, today))
    .sort((a, b) => order.indexOf(a.council) - order.indexOf(b.council) || a.name.localeCompare(b.name));
  const total = g.members_total && isFresh(g.members_total.checked, today) ? g.members_total : null;
  if (!councils.length && !total) return null;
  const terms = new Set(councils.map((c) => c.term ?? ""));
  return {
    rows: councils.map((c) => ({
      council: c.council,
      label: COUNCILS[c.council],
      name: c.name,
      chapters: c.chapters,
      members: c.members === null ? null : countLabel(c.members),
      term: c.term,
      ref: c,
    })),
    total: total ? countLabel(total.value) : null,
    totalRef: total,
    term: terms.size === 1 ? (councils[0]?.term ?? total?.term ?? null) : councils.length ? null : (total?.term ?? null),
  };
}

/** Whether `GreekCouncils` (components/school/CampusPages.tsx) has anything fresh to show: a council breakdown, a
 * recruitment or housing fact, or "none stated". Shared with `GreekLife` so it only shows its own "none found in
 * national directories" line when the college's own pages have nothing either. */
export function hasGreekPageFacts(rows: CampusPagesRows | null | undefined, today: string): boolean {
  const g = rows?.greek;
  if (!g) return false;
  const fresh = (r?: { checked: string }) => !!r && isFresh(r.checked, today);
  return !!greekCouncils(rows, today) || fresh(g.deferred) || fresh(g.formal_term) || fresh(g.housing) || fresh(g.none_stated);
}

/** Whether `FaithFacts` has anything fresh to show: the office or an official composition. Shared with `ReligiousLife`
 * so a college with only these tier A facts (no IPEDS affiliation, no CDS answer, no directory listing) still gets a
 * "Religious life" block instead of none at all. */
export function hasFaithPageFacts(rows: CampusPagesRows | null | undefined, today: string): boolean {
  const f = rows?.faith;
  if (!f) return false;
  return (!!f.office && isFresh(f.office.checked, today)) || (!!f.composition && isFresh(f.composition.checked, today));
}

/** The policy rows to show, fresh only, in POLICY_KEYS order with the conduct finding last. */
export function policyRows(rows: CampusPagesRows | null | undefined, today: string): PolicyCheck[] {
  const order: string[] = [...Object.keys(POLICY_KEYS), "conduct_restriction"];
  return (rows?.lgbtq?.policies ?? [])
    .filter((p) => p.value !== "not_found" && isFresh(p.checked, today))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** Plain label of a policy row's key. */
export function policyLabel(key: PolicyKey | "conduct_restriction"): string {
  return key === "conduct_restriction" ? "What the student conduct policy says" : POLICY_KEYS[key];
}

/** The ⓘ citation for one fact: the college's page, the date checked, its quote. Plain data. */
export function citePage(ref: PageRef, college: string, field: string): Cited {
  return {
    key: "policy-page",
    label: `${college} website`,
    publisher: college,
    year: checkedLabel(ref.checked),
    url: ref.url,
    retrieved: ref.checked,
    path: "detail.campus_pages",
    field: ref.verified_by ? `${field} (confirmed by a second model check)` : field,
    method: "reported",
    isDefault: true,
    quote: ref.quote,
  };
}

/** "October 2026" from an ISO date. */
export function checkedLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[m - 1]} ${y}`;
}
