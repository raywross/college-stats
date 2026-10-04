/**
 * Orthodox Christian Fellowship, chapter list (specs/religious-life.md; specs/campus-directories.md). Its
 * robots.txt itself returns a bare 403 ("Forbidden") to a plain descriptive request, and the chapters page answers
 * the same way (checked 2026-10-04, and again by this adapter every run). `ctx.fetchText` throws
 * `Blocked("forbidden")`, which the runner records in data/directories/blocked.json — never bypassed.
 */
import { defineAdapter } from "../contract.mts";

const LIST_URL = "https://ocf.net/chapters/";

export default defineAdapter({
  key: "ocf",
  organization: "Orthodox Christian Fellowship",
  publisher: "Orthodox Christian Fellowship",
  listUrl: LIST_URL,
  tier: "D",
  domain: "faith",
  tradition: "orthodox",
  async crawl(ctx) {
    await ctx.fetchText(LIST_URL);
    throw new Error("ocf: the chapters page answered without its usual 403 — re-check whether it's readable now");
  },
});
