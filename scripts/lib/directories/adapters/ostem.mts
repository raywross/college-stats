/**
 * oSTEM (Out in Science, Technology, Engineering, and Mathematics) chapter list (specs/lgbtq-life.md "Source tiers":
 * "over 100" chapters, *unverified*). Blocked: ostem.org returns 403 to a plain descriptive user agent on both
 * robots.txt itself and the chapters page (checked 2026-10-04, matching the recon's finding); never bypassed (owner
 * decision 1). This adapter exists so a run records the refusal in data/directories/blocked.json rather than the
 * org simply being absent; it throws nothing itself — `ctx.fetchText` turns the 403 into `Blocked` for the runner to
 * catch and record.
 */
import { defineAdapter } from "../contract.mts";

const LIST_URL = "https://www.ostem.org/page/chapters";

export default defineAdapter({
  key: "ostem",
  organization: "oSTEM",
  publisher: "oSTEM Inc.",
  listUrl: LIST_URL,
  tier: "D",
  domain: "lgbtq",
  kind: "group",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    throw new Error(`ostem: expected this to be blocked (403, checked 2026-10-04); got a readable page (${html.length} bytes) — write a real parser`);
  },
});
