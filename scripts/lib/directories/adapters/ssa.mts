/**
 * Secular Student Alliance, "Find a Chapter" (the example adapter; specs/campus-directories.md#example-ssa).
 * The page is a map whose markers carry each affiliate's name ("Secular Student Alliance at Fordham University",
 * "Wichita State University Secular Shockers"); no city, state, or link. robots.txt allows everything (checked
 * 2026-10-04). High-school clubs and law/medical-school groups are left out: the site covers undergraduate colleges.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://www.secularstudents.org/find-a-chapter";

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", "#39": "'", "#x27": "'", lt: "<", gt: ">", nbsp: " " };
export const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (/^#\d+$/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : m));

const NOT_COLLEGE = /\b(high school|middle school|elementary|school district|school of law|law school|school of medicine|medical school|seminary)\b/i;
const INSTITUTION = /\b(university|college|institute|polytechnic|state|tech|suny|cuny|school of (?:engineering|mines))\b/i;
/** "Denver Area Secular Student Alliance": kept, so the matcher files it for review as an area chapter. */
const AREA = /\barea\b/i;
/** Club words that trail a campus name: "Wichita State University Secular Shockers". */
const TRAILING =
  /\s*(?:[-–:,]\s*)?\b(?:an affiliate of the )?(?:secular student alliance(?: club)?|secular students?(?: alliance| association| society| union| united)?|(?:atheists?|agnostics?) and (?:agnostics?|atheists?)|secular (?:society|shockers|raiders|union|alliance|organization)|ssa|club|chapter|freethinkers?|freethought(?: society)?|atheists?|skeptics|humanists?(?: league)?)$/i;
/** Club words that lead it: "Humanists of Boston University", "Freethinkers Alliance Longwood University". */
const LEADING = /^(?:humanists?|atheists?|skeptics|freethinkers?(?: alliance)?|secular \w+)(?:\s+(?:of|at))?\s+/i;

/** The campus a marker names, or null for a group that isn't at a college. */
export function campusOf(title: string): string | null {
  if (NOT_COLLEGE.test(title)) return null;
  let t = title.trim();
  // "X at <campus>": the campus follows the last " at " whose tail names an institution.
  const parts = t.split(/\s+at\s+/i);
  for (let i = parts.length - 1; i > 0; i--) {
    const tail = parts.slice(i).join(" at ");
    if (INSTITUTION.test(tail)) {
      t = tail;
      break;
    }
  }
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(TRAILING, "").trim();
    // Only strip a leading club phrase when an institution name is left after it.
    const lead = t.replace(LEADING, "");
    if (lead !== t && INSTITUTION.test(lead)) t = lead.trim();
  }
  return INSTITUTION.test(t) || AREA.test(t) ? t : null;
}

/** Marker titles: `<div title="…" aria-label="…" role="button" …><img … src="…/transparent.png"`. */
export function parseMarkers(html: string): string[] {
  const out = new Set<string>();
  const re = /<div title="([^"]+)" aria-label="([^"]+)" role="button"[^>]*>\s*<img[^>]*mapfiles\/transparent\.png/g;
  for (const m of html.matchAll(re)) if (m[1] === m[2]) out.add(decode(m[1]).replace(/\s+/g, " ").trim());
  return [...out];
}

export function entriesFrom(html: string): RawEntry[] {
  return parseMarkers(html).flatMap((title) => {
    const campus = campusOf(title);
    return campus ? [{ campus, name: title }] : [];
  });
}

export default defineAdapter({
  key: "ssa",
  organization: "Secular Student Alliance",
  publisher: "Secular Student Alliance",
  listUrl: LIST_URL,
  tier: "D",
  domain: "faith",
  tradition: "nonreligious",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${parseMarkers(html).length} map markers, ${entries.length} at colleges`);
    return entries;
  },
});
