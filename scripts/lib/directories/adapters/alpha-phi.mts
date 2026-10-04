/**
 * Alpha Phi, Chapter Locator (alphaphi.org/discover-alpha-phi/chapter-locator/). NPC (Panhellenic) sorority. Every
 * request to the site (robots.txt included) returns a Cloudflare "Just a moment..." challenge page (403), checked
 * 2026-10-04 both with the research user agent and a plain browser UA — not UA-specific, so this isn't a case of
 * "ask nicer": blocked per owner decision 1 (specs/campus-directories.md#blocked-lists-decision-1), recorded in
 * data/directories/blocked.json, never bypassed.
 */
import { Blocked, defineAdapter } from "../contract.mts";

const LIST_URL = "https://www.alphaphi.org/discover-alpha-phi/chapter-locator/";

export default defineAdapter({
  key: "alpha-phi",
  organization: "Alpha Phi",
  publisher: "Alpha Phi",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl() {
    throw new Blocked(LIST_URL, "challenge", "Cloudflare 'Just a moment...' challenge on every request, checked 2026-10-04");
  },
});
