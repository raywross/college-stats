/**
 * Sigma Phi Epsilon "Our Chapters" (specs/greek-life.md phase 4; NIC member). The visible page is a WordPress
 * "Ninja Tables" widget: the table itself is fetched client-side from `admin-ajax.php` using a table id and a
 * short-lived public nonce embedded in the page's own scripts (see `_ninja-tables.mts`). robots.txt allows the
 * page and the ajax endpoint (checked 2026-10-04). Each row gives the chapter designation, the school's own name
 * (`dyadinstitutionalid`, e.g. "Auburn University - Auburn"), and city/state — no colony flag was found in the
 * fields, so every row is treated as an active chapter.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";
import { ninjaTableRequestUrl, ninjaTableRows, type NinjaRow } from "./_ninja-tables.mts";
import { decodeEntities } from "./_html.mts";

const LIST_URL = "https://sigep.org/chapters/";

/** "Auburn University - Auburn<br>Auburn, Alabama" → "Auburn University - Auburn" (drop the trailing school/location). */
function campusOf(row: NinjaRow): string | null {
  const name = row.dyadinstitutionalid ?? row.school?.split(/<br\s*\/?>/i)[0];
  if (!name) return null;
  return decodeEntities(name).replace(/\s+/g, " ").trim() || null;
}

export function entriesFromRows(rows: readonly NinjaRow[]): RawEntry[] {
  return rows.flatMap((row) => {
    const campus = campusOf(row);
    if (!campus) return [];
    const entry: RawEntry = { campus };
    if (row.chapterdesignation) entry.name = `${decodeEntities(row.chapterdesignation)} (Sigma Phi Epsilon)`;
    if (row.city) entry.city = decodeEntities(row.city);
    if (row.state) entry.state = decodeEntities(row.state);
    if (row.website) entry.url = row.website;
    return [entry];
  });
}

export default defineAdapter({
  key: "sigep",
  organization: "Sigma Phi Epsilon",
  publisher: "Sigma Phi Epsilon",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "nic",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const ajaxUrl = ninjaTableRequestUrl(html);
    if (!ajaxUrl) throw new Error("sigep: no Ninja Tables data_request_url found on the chapters page (layout may have changed)");
    const json = await ctx.fetchJson(ajaxUrl);
    const rows = ninjaTableRows(json);
    const entries = entriesFromRows(rows);
    ctx.log(`${rows.length} table rows, ${entries.length} chapters`);
    return entries;
  },
});
