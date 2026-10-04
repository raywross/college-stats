/**
 * Chabad on Campus, "Campus Chabad House" centers (specs/religious-life.md; specs/campus-directories.md). The HTML
 * directory page (chabad.org/centers/campus_cdo/...) returns 403, but its JSON API is explicitly `Allow`'d in
 * robots.txt (`Allow: /api/v2/chabadorg/centers/` inside a blanket `Disallow: /api/`); checked 2026-10-04. The API
 * ignores `searchQuery` and always returns its whole worldwide directory (4,220 centers 2026-10-04) with a
 * `center-type`; we keep only "Campus Chabad House" (246). Entries rarely give an address, only a `name` ("Chabad at
 * Yale University", "Chabad House @ University of Pennsylvania") and a `city`: the campus is read out of the name
 * after its last "at"/"@"/"of"/"serving"/"for" that isn't itself part of "University of X"; a name with none of
 * those (e.g. "Tannenbaum Chabad House") names no campus and is dropped rather than guessed from the city alone.
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
/** A connector right after one of these is part of the institution's own name ("University of Pennsylvania"), not a split point. */
const SKIP_BEFORE = new Set(["university", "college", "institute"]);
const INSTITUTION = /\b(university|college|institute)\b/i;
/** "Drexel University - Rohr Jewish Student Center": the center's own name trails the college's, after a dash. */
const TRAILING_DASH = /\s[-–]\s.+$/;

/** The campus named in a center's name, or null when nothing after a connector names one. */
export function campusOf(name: string): string | null {
  let last: RegExpMatchArray | null = null;
  for (const m of name.matchAll(CONNECTOR)) {
    const before = name.slice(0, m.index).trim().split(/\s+/).pop()?.toLowerCase();
    if (before && SKIP_BEFORE.has(before)) continue;
    last = m;
  }
  if (!last || last.index === undefined) return null;
  const cand = name.slice(last.index + last[0].length).trim();
  const beforeDash = cand.replace(TRAILING_DASH, "");
  return (beforeDash !== cand && INSTITUTION.test(beforeDash) ? beforeDash : cand) || null;
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
