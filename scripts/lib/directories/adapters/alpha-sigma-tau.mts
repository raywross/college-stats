/**
 * Alpha Sigma Tau, Find a Chapter (alphasigmatau.org/members/find-a-chapter/). NPC (Panhellenic) sorority. The
 * homepage is reachable, but the chapter locator itself lives under `/members/` and returns a flat 403 ("Access to
 * this page is forbidden") from the site's Sucuri WAF for both the research user agent and a plain browser UA,
 * checked 2026-10-04 — a real access restriction on that path, not a bot challenge. Blocked per owner decision 1
 * (specs/campus-directories.md#blocked-lists-decision-1), recorded in data/directories/blocked.json, never
 * bypassed.
 */
import { Blocked, defineAdapter } from "../contract.mts";

const LIST_URL = "https://alphasigmatau.org/members/find-a-chapter/";

export default defineAdapter({
  key: "alpha-sigma-tau",
  organization: "Alpha Sigma Tau",
  publisher: "Alpha Sigma Tau",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl() {
    throw new Blocked(LIST_URL, "forbidden", "403 from the site's WAF on /members/find-a-chapter/ regardless of user agent, checked 2026-10-04");
  },
});
