/**
 * Hillel International's College Guide (specs/religious-life.md; specs/campus-directories.md). Its robots.txt is
 * permissive (`Crawl-delay: 10`, no broad `Disallow`), but the page itself answers a plain descriptive request with a
 * 403 Cloudflare-style challenge (checked 2026-10-04, and again by this adapter every run); the spec already
 * recommends asking Hillel International for a data partnership rather than scraping around it (owner decision 1).
 * `ctx.fetchText` throws `Blocked("forbidden")` on the 403, which the runner records in data/directories/blocked.json
 * — never bypassed.
 */
import { defineAdapter } from "../contract.mts";

const LIST_URL = "https://www.hillel.org/college-tools/";

export default defineAdapter({
  key: "hillel",
  organization: "Hillel International",
  publisher: "Hillel International",
  listUrl: LIST_URL,
  tier: "D",
  domain: "faith",
  tradition: "jewish",
  async crawl(ctx) {
    await ctx.fetchText(LIST_URL);
    throw new Error("hillel: the College Guide answered without its usual 403 — re-check whether it's readable now");
  },
});
