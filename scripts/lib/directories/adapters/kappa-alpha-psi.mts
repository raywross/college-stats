/**
 * Kappa Alpha Psi "Find a Chapter" (specs/greek-life.md phase 4; NPHC member). robots.txt itself doesn't disallow
 * this path for a generic user agent, but the page returns HTTP 403 to our descriptive UA (checked 2026-10-04) —
 * a bot-protection layer, not a robots.txt rule. `ctx.fetchText` turns that 403 into `Blocked("forbidden")`
 * automatically; this adapter does nothing special, so a future run picks it up again if the block ever lifts.
 * Recorded in data/directories/blocked.json, never bypassed (owner decision 1). The other eight NPHC ("Divine
 * Nine") organizations' chapter locators are all JavaScript-rendered with no server-side data this pass could find
 * (see specs/greek-life.md phase 4 coverage table) — not technically blocked, just not built yet.
 */
import { defineAdapter } from "../contract.mts";

const LIST_URL = "https://www.kappaalphapsi1911.com/find-a-chapter/";

export default defineAdapter({
  key: "kappa-alpha-psi",
  organization: "Kappa Alpha Psi",
  publisher: "Kappa Alpha Psi",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "nphc",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    throw new Error(`kappa-alpha-psi: fetched the chapter locator without a block; the parser hasn't been written yet (got ${html.length} bytes)`);
  },
});
