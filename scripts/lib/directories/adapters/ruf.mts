/**
 * Reformed University Fellowship, "Find a Campus" (specs/religious-life.md; specs/campus-directories.md). The "All
 * Campuses" block on https://ruf.org/campus/ is server-rendered (hidden with `display:none`, shown by the page's own
 * JS tab switcher) but paginated 24 to a page, with a "Next Page »" link; checked 2026-10-04 through page 9 (206
 * campuses, the last page has 14 and no Next Page link). robots.txt disallows only /wp-admin/.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://ruf.org/campus/";
/** Hard stop well above the ~9 pages seen 2026-10-04, so a layout change can't loop forever. */
const MAX_PAGES = 40;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
/** Named and numeric entities ("&#038;" → "&", "&#8211;" → "–"); unknown ones are left as written. */
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] !== "#") return NAMED_ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });

/** RUF's own branding on a second, separate ministry at the same campus ("Auburn University RUF International"). */
const RUF_SUFFIX = /\s+RUF (?:International|Global)$/;

/** One page's campus links and the next page's URL, or null when this is the last page. */
export function parsePage(html: string): { entries: RawEntry[]; next: string | null } {
  const entries: RawEntry[] = [];
  const re = /ruf-campuses__list--item"><a href="([^"]+)">([^<]+)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const listed = decodeEntities(m[2]).trim();
    const campus = listed.replace(RUF_SUFFIX, "");
    // Only International/Global ministries get a distinct name; a plain campus entry has none (RUF names no chapter).
    entries.push({ campus, url: m[1], ...(campus !== listed ? { name: listed } : {}) });
  }
  const next = /archive-pagination pagination"[^>]*>\s*<a href="([^"]+)"\s*>\s*Next Page/.exec(html);
  return { entries, next: next ? next[1] : null };
}

export default defineAdapter({
  key: "ruf",
  organization: "Reformed University Fellowship",
  publisher: "Reformed University Fellowship",
  listUrl: LIST_URL,
  tier: "D",
  domain: "faith",
  tradition: "christian",
  async crawl(ctx) {
    const entries: RawEntry[] = [];
    let url: string | null = LIST_URL;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const html = await ctx.fetchText(url);
      const parsed = parsePage(html);
      entries.push(...parsed.entries);
      url = parsed.next;
    }
    ctx.log(`${entries.length} campuses across ${Math.ceil(entries.length / 24)} pages`);
    return entries;
  },
});
