/**
 * Sigma Nu "Chapter Listing" (specs/greek-life.md phase 4; NIC member). A plain server-rendered page with two
 * HTML tables: `<table class="chapters">` (active chapters) and `<table class="chapters dormant">` (dormant ones,
 * left out — "active chapters only"). Each row gives the chapter's Greek-letter designation and the school's own
 * name. robots.txt allows the page (checked 2026-10-04).
 */
import { defineAdapter, type RawEntry } from "../contract.mts";
import { textOf } from "./_html.mts";

const LIST_URL = "https://www.sigmanu.org/about-us/chapter-listing/";

export interface ChapterRow {
  chapter: string;
  school: string;
}

/** Rows of the first (non-dormant) `<table class="chapters">`; [] if the layout doesn't match. */
export function parseActiveTable(html: string): ChapterRow[] {
  const table = /<table class="chapters">[\s\S]*?<\/table>/.exec(html);
  if (!table) return [];
  const rows = table[0].match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const out: ChapterRow[] = [];
  for (const row of rows) {
    const chapter = /<td class="chapname">([\s\S]*?)<\/td>/.exec(row);
    const school = /<td class="school">([\s\S]*?)<\/td>/.exec(row);
    if (chapter && school) out.push({ chapter: textOf(chapter[1]), school: textOf(school[1]) });
  }
  return out;
}

export function entriesFrom(rows: readonly ChapterRow[]): RawEntry[] {
  return rows.filter((r) => r.school).map((r) => ({ campus: r.school, name: `${r.chapter} (Sigma Nu)` }));
}

export default defineAdapter({
  key: "sigma-nu",
  organization: "Sigma Nu",
  publisher: "Sigma Nu",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "nic",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const rows = parseActiveTable(html);
    if (!rows.length) throw new Error("sigma-nu: no active-chapters table found on the chapter-listing page (layout may have changed)");
    const entries = entriesFrom(rows);
    ctx.log(`${rows.length} active chapters`);
    return entries;
  },
});
