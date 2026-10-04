/**
 * The LGBTQ+ policy checklist (specs/lgbtq-life.md phase 3 "Where it appears"): national-directory leads (tier D,
 * specs/campus-directories.md) and, once the pilot track builds them, the college's own verified facts (tier A,
 * `school.lgbtq.policies`). Kept apart from lib/lgbtq.ts (the phase 1 "another gender" counts) on purpose:
 * tests/lgbtq.test.mts bans the gender-identity counts from Explore, Compare, and rankings, but this module's policy
 * facts are meant to reach all three (lgbtq-life.md "Where it appears": Explore filters, Compare rows), so the two
 * concerns can't share a file without the guard losing its own meaning.
 */
import { listingsFor, POLICY_KEYS, type CreditedListing, type PolicyKey } from "./directories.ts";
import type { SchoolDetail } from "./detail.ts";
import type { LgbtqLife, School } from "./types.ts";

export type ChecklistSource = "tier-a" | "tier-d";

export interface ChecklistItem {
  key: PolicyKey;
  label: string;
  source: ChecklistSource;
  /** Whether the checked fact (tier A) or the list (tier D) says the college does this; tier D is always "yes" (a lead, never a "no" — lgbtq-life.md "Sensitive facts: rules"). */
  value: "yes" | "no";
  /** The sentence to show: never a plain "Yes"/"No" (lgbtq-life.md phase 3 scope). */
  text: string;
  url: string;
  /** ISO date: the page was checked (tier A) or the list was read (tier D). */
  date: string;
  quote?: string;
  /** The raw tier D listing, for a proper citation (`citeListing`); absent for a tier A item. */
  listing?: CreditedListing;
}

const tierDText = (label: string, l: CreditedListing) => `${label}: listed by ${l.credit.organization} (${l.credit.read})`;

/** This college's tier D leads, one per policy key (the first list that names it, when more than one does). */
function tierDByKey(listings: readonly CreditedListing[]): Map<PolicyKey, CreditedListing> {
  const out = new Map<PolicyKey, CreditedListing>();
  for (const l of listings) {
    const c = l.credit;
    if (c.domain === "lgbtq" && c.kind === "policy" && !out.has(c.policy)) out.set(c.policy, l);
  }
  return out;
}

/**
 * One row per policy key that has something to show, in POLICY_KEYS order: a verified tier A fact from the
 * college's own page when the pilot has checked it (replacing a tier D lead for the same key, even when the answer
 * is "no" — lgbtq-life.md "Inclusive policies" rank the college's own page above any list); otherwise the tier D
 * lead when a national directory names the college; otherwise the key is left out entirely. Absence is never shown
 * as "No" (lgbtq-life.md "Sensitive facts: rules").
 */
export function policyChecklist(lgbtq: Pick<LgbtqLife, "policies"> | null | undefined, directoryListings: readonly CreditedListing[]): ChecklistItem[] {
  const tierA = new Map((lgbtq?.policies ?? []).filter((p) => p.key !== "conduct_restriction").map((p) => [p.key as PolicyKey, p]));
  const tierD = tierDByKey(directoryListings);
  const out: ChecklistItem[] = [];
  for (const key of Object.keys(POLICY_KEYS) as PolicyKey[]) {
    const label = POLICY_KEYS[key];
    const a = tierA.get(key);
    if (a && a.value !== "not_found") {
      out.push({
        key,
        label,
        source: "tier-a",
        value: a.value,
        text: a.value === "yes" ? `${label}, per the college's own page (checked ${a.checked})` : `No: ${label}, per the college's own page (checked ${a.checked})`,
        url: a.url,
        date: a.checked,
        ...(a.quote ? { quote: a.quote } : {}),
      });
      continue;
    }
    const d = tierD.get(key);
    if (d) out.push({ key, label, source: "tier-d", value: "yes", text: tierDText(label, d), url: d.credit.list_url, date: d.credit.read, listing: d });
  }
  return out;
}

/** Whether a checklist (or a single key within it) says "yes" — for Explore filters and Compare cells. */
export function checklistSays(items: readonly ChecklistItem[], key: PolicyKey): ChecklistItem | null {
  return items.find((i) => i.key === key && i.value === "yes") ?? null;
}

/**
 * Explore's three policy filters (lgbtq-life.md "Where it appears"): true when the checklist says yes for that key,
 * from either tier. `center` reads the directory summary directly (it isn't a PolicyKey). Pure on the stored
 * summaries, so Explore never needs the full checklist (or the detail file) just to filter.
 */
export function hasLgbtqCenter(school: Pick<School, "directories">): boolean {
  return !!school.directories?.lgbtq?.includes("center");
}

export function policyIsYes(school: Pick<School, "lgbtq" | "directories">, key: PolicyKey): boolean {
  const tierA = school.lgbtq?.policies?.find((p) => p.key === key);
  if (tierA) return tierA.value === "yes";
  return !!school.directories?.lgbtq?.includes(key);
}

export interface ComparedChecklistRow {
  key: PolicyKey;
  label: string;
  /** One cell per compared college, in the same order; null when that college has nothing for this key. */
  cells: (ChecklistItem | null)[];
}

/**
 * Compare's checklist rows (lgbtq-life.md "Where it appears": "the checklist rows side by side, each cell dated").
 * Takes each compared college's detail file (for its `directories` table's tier D leads) alongside the schools
 * themselves (for `lgbtq.policies`, tier A); a key with nothing for any compared college is left out of the table
 * entirely, same as a single college's checklist.
 */
export function comparedChecklist(schools: readonly School[], details: readonly (SchoolDetail | null)[]): ComparedChecklistRow[] {
  const perSchool = schools.map((s, i) => policyChecklist(s.lgbtq, listingsFor(details[i]?.tables.directories?.rows, "lgbtq")));
  const keys = (Object.keys(POLICY_KEYS) as PolicyKey[]).filter((k) => perSchool.some((items) => items.some((it) => it.key === k)));
  return keys.map((key) => ({ key, label: POLICY_KEYS[key], cells: perSchool.map((items) => items.find((it) => it.key === key) ?? null) }));
}
