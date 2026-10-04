/**
 * Omega Phi Beta "Chapters and Collectives" (specs/greek-life.md phase 4; NALFO member — found from NALFO's member
 * list, nalfo.org/member-organizations/). A plain HTML table: Entity, College/University, Location, Est. year.
 * robots.txt allows the page (checked 2026-10-04). Some rows name several colleges for one chapter/collective
 * ("The State University of New York at New Paltz; Marist College"), separated by `;`: `campuses` carries each.
 * An entity name ending "*" or "**" marks a footnoted (often since-closed) chapter in the source, but the table
 * itself gives no machine-readable active/inactive flag, so every row is kept.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";
import { textOf } from "./_html.mts";

const LIST_URL = "https://www.omegaphibeta.org/membership/chapters-and-collectives/";

export interface ChapterRow {
  entity: string;
  colleges: string;
}

/** Rows of the chapters table (Entity, College/University, Location, Est.); [] if the layout doesn't match. */
export function parseTable(html: string): ChapterRow[] {
  const table = /<table[^>]*>[\s\S]*?<\/table>/.exec(html);
  if (!table) return [];
  const rows = table[0].match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const out: ChapterRow[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textOf(m[1]));
    if (cells.length < 2 || /^entity$/i.test(cells[0])) continue;
    out.push({ entity: cells[0], colleges: cells[1] });
  }
  return out;
}

export function entriesFrom(rows: readonly ChapterRow[]): RawEntry[] {
  return rows.flatMap((r) => {
    const name = r.entity.replace(/\s*\*+$/, "").trim();
    const colleges = r.colleges
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean);
    if (!name || !colleges.length) return [];
    const entry: RawEntry = colleges.length > 1 ? { campus: colleges[0], campuses: colleges, name: `${name} (Omega Phi Beta)` } : { campus: colleges[0], name: `${name} (Omega Phi Beta)` };
    return [entry];
  });
}

export default defineAdapter({
  key: "omega-phi-beta",
  organization: "Omega Phi Beta",
  publisher: "Omega Phi Beta",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "nalfo",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const rows = parseTable(html);
    if (!rows.length) throw new Error("omega-phi-beta: no chapters table found on the chapters-and-collectives page (layout may have changed)");
    const entries = entriesFrom(rows);
    ctx.log(`${rows.length} rows, ${entries.length} chapters/collectives`);
    return entries;
  },
});
