/**
 * Delta Zeta (deltazeta.org). NPC (Panhellenic) sorority. The homepage and the locator page both return a
 * Cloudflare "Just a moment..." challenge page (403) with the research user agent and with a plain browser UA,
 * checked 2026-10-04, even though robots.txt itself is permissive. Blocked per owner decision 1
 * (specs/campus-directories.md#blocked-lists-decision-1), recorded in data/directories/blocked.json, never
 * bypassed.
 */
import { Blocked, defineAdapter } from "../contract.mts";

const LIST_URL = "https://www.deltazeta.org/";

export default defineAdapter({
  key: "delta-zeta",
  organization: "Delta Zeta",
  publisher: "Delta Zeta",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl() {
    throw new Blocked(LIST_URL, "challenge", "Cloudflare 'Just a moment...' challenge on every request, checked 2026-10-04");
  },
});
