/**
 * Kappa Sigma "Chapters by Arm/Tier" (specs/greek-life.md phase 4; NIC member). Same Ninja Tables widget pattern as
 * sigep.mts (see `_ninja-tables.mts`): the table is fetched client-side from `admin-ajax.php` with a table id and
 * nonce embedded in the page. robots.txt allows the page and the ajax endpoint (Crawl-delay: 10, checked
 * 2026-10-04). Rows give the chapter designation (`organizationname`) and the school's own name (`school`), no
 * city/state and no colony flag, so every row is treated as an active chapter.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";
import { ninjaTableRequestUrl, ninjaTableRows } from "./_ninja-tables.mts";
import { decodeEntities } from "./_html.mts";

const LIST_URL = "https://www.kappasigma.org/chapters-by-arm-tier/";

export function entriesFromRows(rows: readonly Record<string, string | null | undefined>[]): RawEntry[] {
  return rows.flatMap((row) => {
    const campus = row.school ? decodeEntities(row.school).replace(/\s+/g, " ").trim() : "";
    if (!campus) return [];
    const entry: RawEntry = { campus };
    if (row.organizationname) entry.name = `${decodeEntities(row.organizationname)} (Kappa Sigma)`;
    return [entry];
  });
}

export default defineAdapter({
  key: "kappa-sigma",
  organization: "Kappa Sigma",
  publisher: "Kappa Sigma",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "nic",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const ajaxUrl = ninjaTableRequestUrl(html);
    if (!ajaxUrl) throw new Error("kappa-sigma: no Ninja Tables data_request_url found on the chapters page (layout may have changed)");
    const json = await ctx.fetchJson(ajaxUrl);
    const rows = ninjaTableRows(json);
    const entries = entriesFromRows(rows);
    ctx.log(`${rows.length} table rows, ${entries.length} chapters`);
    return entries;
  },
});
