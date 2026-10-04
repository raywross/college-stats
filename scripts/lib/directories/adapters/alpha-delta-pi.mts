/**
 * Alpha Delta Pi, Chapter Locator (alphadeltapi.org/collegians/chapterlocator/, separate from the alumnae
 * association locator at /alumnae/associationlocator/). NPC (Panhellenic) sorority. The page is a WordPress Geo
 * Mashup map: a `latLongs` JS array embedded in the page, each marker's `content` a URL-encoded HTML snippet whose
 * `<h2>` reads "<Chapter> Chapter &#8211; <College>". robots.txt allows everything (checked 2026-10-04).
 */
import { decodeEntities, splitChapterCollege } from "./_text.mts";
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://www.alphadeltapi.org/collegians/chapterlocator/";

/** The URL-decoded `content` strings of every marker in the page's `latLongs` array. */
export function parseMarkerContents(html: string): string[] {
  const m = html.match(/latLongs\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  const out: string[] = [];
  for (const cm of m[1].matchAll(/"content":"(.*?)"\}/g)) {
    try {
      out.push(decodeURIComponent(cm[1]));
    } catch {
      // malformed percent-encoding: skip this marker
    }
  }
  return out;
}

export function entriesFrom(html: string): RawEntry[] {
  const out: RawEntry[] = [];
  for (const content of parseMarkerContents(html)) {
    const h2 = content.match(/<h2>([^<]*)<\/h2>/);
    if (!h2) continue;
    const split = splitChapterCollege(h2[1]);
    if (!split) continue;
    const [chapter, college] = split;
    out.push({ campus: college, name: decodeEntities(chapter) });
  }
  return out;
}

export default defineAdapter({
  key: "alpha-delta-pi",
  organization: "Alpha Delta Pi",
  publisher: "Alpha Delta Pi",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${parseMarkerContents(html).length} map markers, ${entries.length} parsed`);
    return entries;
  },
});
