/**
 * Sigma Delta Tau, Find a Chapter (sigmadeltatau.org/member-experience/prospective-members/find-a-chapter/). NPC
 * (Panhellenic) sorority. A single static HTML table: School / Chapter / Location / Primary Recruitment / Charter
 * Date, one row per active collegiate chapter (no separate alumnae or closed-chapter rows on this page). robots.txt
 * allows everything (checked 2026-10-04).
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://sigmadeltatau.org/member-experience/prospective-members/find-a-chapter/";

const ROW =
  /<td class="tbl-school"><h2 class="h5 nomargB">([^<]*)<\/h2><\/td>\s*<td class="tbl-chapter">([^<]*)<\/td>\s*<td class="tbl-loc">([^<]*)<\/td>/g;

export function entriesFrom(html: string): RawEntry[] {
  const out: RawEntry[] = [];
  for (const m of html.matchAll(ROW)) {
    const [, school, chapter, loc] = m;
    const locMatch = loc.trim().match(/^(.*),\s*([A-Za-z.]+)$/);
    out.push({
      campus: school.trim(),
      name: chapter.trim(),
      ...(locMatch ? { city: locMatch[1].trim(), state: locMatch[2].trim() } : {}),
    });
  }
  return out;
}

export default defineAdapter({
  key: "sigma-delta-tau",
  organization: "Sigma Delta Tau",
  publisher: "Sigma Delta Tau",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${entries.length} chapter table rows`);
    return entries;
  },
});
