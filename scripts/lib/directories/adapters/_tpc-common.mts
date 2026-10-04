/**
 * Shared parsing for five of the Trans Policy Clearinghouse's seven lists (gennyb.com; specs/lgbtq-life.md "Source
 * tiers"): nondiscrimination, gender-inclusive housing, gender-inclusive restrooms, name and pronoun changes, and
 * student health plan coverage all render the same WordPress accordion (`wpsm_accordion`): one collapsible panel per
 * state ("Alaska (3 colleges)"), each holding a `<ul><li>` of college names, sometimes with the year a policy began
 * in parentheses or a footnote "**" marker. The athletic-policies list uses the identical markup but (checked
 * 2026-10-04) every state panel says "no colleges" — see lgbtq-life.md's phase 3 notes — so no adapter reads it.
 * The historically-women's/men's-colleges list (trans admission) is prose, not this accordion; its own adapter
 * (tpc-trans-admission.mts) parses it directly. Leading underscore: a helper, not an adapter itself (registry.mts
 * only loads files it doesn't start with "_").
 */
import type { RawEntry } from "../contract.mts";

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", "#39": "'", "#x27": "'", lt: "<", gt: ">", nbsp: " " };

/** Decodes named and numeric HTML entities (the curly quotes and apostrophes gennyb.com's WordPress exports as `&#82xx;`). */
export function decode(s: string): string {
  return s.replace(/&(#?\w+);/g, (m, e: string) => {
    const key = e.toLowerCase();
    if (ENTITIES[key]) return ENTITIES[key];
    if (/^#\d+$/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
    return m;
  });
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ");
/** Strips tags, decodes entities, and collapses whitespace: shared by every gennyb.com adapter. */
export const clean = (s: string) => decode(stripTags(s)).replace(/\s+/g, " ").trim();

/** One accordion panel's heading text, less its "(N colleges)"/"(no colleges)" count. */
export function panelState(chunk: string): string | null {
  const m = /<span class="ac_title_class">\s*<span[^>]*>\s*<\/span>\s*([^<]+?)\s*<\/span>/.exec(chunk);
  if (!m) return null;
  return clean(m[1]).replace(/\s*\([^)]*\)\s*$/, "").trim() || null;
}

/** A list entry read from one accordion list: a college, the policy's start year when the list gives one. */
export interface TpcEntry {
  campus: string;
  state: string;
  year: number | null;
}

/** A list item that says the policy was taken away: a lead to drop, not a lead that it's present. */
const REMOVED = /:\s*(removed|rescinded|discontinued|repealed)\b/i;

/** One `<li>` item, cleaned to a campus name and its start year (null when the list gives none), or null to drop. */
export function tpcItem(li: string): { campus: string; year: number | null } | null {
  const text = clean(li);
  if (!text || REMOVED.test(text)) return null;
  const year = /\((\d{4})\)\s*:?\s*$/.exec(text);
  const name = (year ? text.slice(0, year.index) : text)
    .replace(/\*+$/, "")
    .replace(/[:,.\s]+$/, "")
    .trim();
  return name ? { campus: name, year: year ? Number(year[1]) : null } : null;
}

/** Every college in one of the five shared-accordion lists, panel by panel (one state's entries at a time). */
export function parseAccordionList(html: string): TpcEntry[] {
  const out: TpcEntry[] = [];
  for (const chunk of html.split("<!-- Inner panel Start -->").slice(1)) {
    const state = panelState(chunk);
    if (!state) continue;
    for (const li of chunk.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const item = tpcItem(li[1]);
      if (item) out.push({ campus: item.campus, state, year: item.year });
    }
  }
  return out;
}

/** `parseAccordionList` entries as the adapter contract's `RawEntry`s, with the start year as a short fact. */
export function entriesFromAccordion(html: string): RawEntry[] {
  return parseAccordionList(html).map((e) => ({ campus: e.campus, state: e.state, ...(e.year ? { fact: `since ${e.year}` } : {}) }));
}
