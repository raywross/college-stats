/**
 * Chabad on Campus, "Campus Chabad House" centers (specs/religious-life.md; specs/campus-directories.md). The HTML
 * directory page (chabad.org/centers/campus_cdo/...) returns 403, but its JSON API is explicitly `Allow`'d in
 * robots.txt (`Allow: /api/v2/chabadorg/centers/` inside a blanket `Disallow: /api/`); checked 2026-10-04. The API
 * ignores `searchQuery` and always returns its whole worldwide directory (4,220 centers 2026-10-04) with a
 * `center-type`; we keep only "Campus Chabad House" (246). Entries rarely give an address, only a `name` ("Chabad at
 * Yale University", "Chabad House @ University of Pennsylvania") and a `city`: the campus is read out of the name
 * after one of its "at"/"@"/"of"/"serving"/"for" connectors; a name with none of those (e.g. "Tannenbaum Chabad
 * House") names no campus and is dropped rather than guessed from the city alone.
 *
 * A name with exactly one connector just uses its tail ("Chabad at Dartmouth" → "Dartmouth", a town-named house with
 * no "University"/"College" in it). A name with several connectors is often a nested institution name ("... at the
 * University of Texas at Austin" has three: naively taking the last gives "Austin", dropping "University of Texas";
 * "... Center for Jewish Student Life at Binghamton University" has two, where the first just continues the Chabad
 * house's own name). For these, every split is tried from the last back to the first, and the first tail that
 * itself names an institution (contains "university"/"college"/"institute") wins — so "Texas at Austin" and "Jewish
 * Student Life at Binghamton University" are passed over for "the University of Texas at Austin" and "Binghamton
 * University" respectively (2026-10-04 fix: UT Austin's name used to resolve to "Austin" and drop the chapter). If
 * no tail qualifies (an abbreviation like "Chabad U of M - ..." with no full "University"), the last split is kept
 * as before, so the entry still goes to review rather than silently dropping.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://www.chabad.org/api/v2/chabadorg/centers/?searchQuery=campus";
const CAMPUS_TYPE = "Campus Chabad House";

interface ChabadCenter {
  name?: string;
  city?: string;
  "static-url"?: string;
  "center-type"?: { name?: string };
}

const CONNECTOR = /\s(?:at|@|of|serving|for)\s+/gi;
const INSTITUTION = /\b(university|college|institute)\b/i;
/** "Drexel University - Rohr Jewish Student Center": the center's own name trails the college's, after a dash. */
const TRAILING_DASH = /\s[-–]\s.+$/;

/** Text after one connector match, with a trailing " - Rohr ..." dropped when what's left still names an institution. */
function tailAt(name: string, m: RegExpMatchArray): string {
  const cand = name.slice((m.index ?? 0) + m[0].length).trim();
  const beforeDash = cand.replace(TRAILING_DASH, "");
  return beforeDash !== cand && INSTITUTION.test(beforeDash) ? beforeDash : cand;
}

/** The campus named in a center's name, or null when nothing after a connector names one. */
export function campusOf(name: string): string | null {
  const matches = [...name.matchAll(CONNECTOR)];
  if (!matches.length) return null;
  if (matches.length === 1) return tailAt(name, matches[0]) || null;
  // Several connectors: the rightmost split whose tail itself names an institution, so a connector that only
  // continues the college's own name ("of Texas" inside "University of Texas at Austin") or the Chabad house's own
  // name ("for Jewish Student Life" before "at Binghamton University") doesn't win.
  for (let i = matches.length - 1; i >= 0; i--) {
    const cand = tailAt(name, matches[i]);
    if (INSTITUTION.test(cand)) return cand || null;
  }
  return tailAt(name, matches[matches.length - 1]) || null;
}

export function entriesFrom(centers: readonly ChabadCenter[]): RawEntry[] {
  return centers
    .filter((c) => c["center-type"]?.name === CAMPUS_TYPE && c.name)
    .flatMap((c) => {
      const campus = campusOf(c.name!);
      if (!campus) return [];
      const entry: RawEntry = { campus, name: c.name };
      if (c.city) entry.city = c.city;
      if (c["static-url"]) entry.url = `https://www.chabad.org/${c["static-url"]}`;
      return [entry];
    });
}

export default defineAdapter({
  key: "chabad",
  organization: "Chabad on Campus",
  publisher: "Chabad.org",
  listUrl: LIST_URL,
  tier: "D",
  domain: "faith",
  tradition: "jewish",
  async crawl(ctx) {
    const data = await ctx.fetchJson<{ data: ChabadCenter[] }>(LIST_URL);
    const campusCenters = data.data.filter((c) => c["center-type"]?.name === CAMPUS_TYPE);
    const entries = entriesFrom(data.data);
    ctx.log(`${data.data.length} centers worldwide, ${campusCenters.length} campus Chabad houses, ${entries.length} name a campus`);
    return entries;
  },
});
