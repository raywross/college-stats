/**
 * Delta Phi Epsilon, Chapter Locator (dphie.org/chapter-locator/). NPC (Panhellenic) sorority. Static, server-rendered
 * text grouped by state (`<h3>State</h3>`), each state's "Chapters" subsection (a sibling "Associations" subsection,
 * for multi-campus or regional groups, is left out) listing `<strong>Name Chapter at College</strong><br />City,
 * ST<br />` pairs. robots.txt allows everything (checked 2026-10-04).
 */
import { decodeEntities } from "./_text.mts";
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://dphie.org/chapter-locator/";

const STATE_SECTION = /<h3>([^<]+)<\/h3>\s*<h4><span[^>]*>Chapters<\/span><\/h4>\s*<p>([\s\S]*?)<\/p>/g;
const CHAPTER_AT = /<strong>([^<]*?)\s+Chapter at\s+([^<]*?)<\/strong>\s*<br\s*\/?>\s*([^<]*?),\s*([A-Z]{2})\s*(?:<br\s*\/?>|$)/g;

export function entriesFrom(html: string): RawEntry[] {
  const out: RawEntry[] = [];
  for (const section of html.matchAll(STATE_SECTION)) {
    const body = section[2];
    for (const m of body.matchAll(CHAPTER_AT)) {
      const [, name, college, city, state] = m;
      out.push({ campus: decodeEntities(college.trim()), name: `${name.trim()} Chapter`, city: city.trim(), state });
    }
  }
  return out;
}

export default defineAdapter({
  key: "delta-phi-epsilon",
  organization: "Delta Phi Epsilon",
  publisher: "Delta Phi Epsilon",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${entries.length} chapters across state sections`);
    return entries;
  },
});
