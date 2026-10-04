/**
 * Kappa Kappa Gamma (kappakappagamma.org). NPC (Panhellenic) sorority. No public chapter locator exists on the
 * site: the only page naming all chapters, "Chapters and Advisory Boards," sits under "myKappa" and is served by
 * the "password-protected-categories" WordPress plugin (confirmed 2026-10-04 from the page's own enqueued CSS).
 * Matches greek-life.md's note that NPC members' own campus-level data is behind member logins. Blocked per owner
 * decision 1 (specs/campus-directories.md#blocked-lists-decision-1), recorded in data/directories/blocked.json,
 * never bypassed.
 */
import { Blocked, defineAdapter } from "../contract.mts";

const LIST_URL = "https://www.kappakappagamma.org/stay-connected/mykappa/chapters-and-advisory-boards/";

export default defineAdapter({
  key: "kappa-kappa-gamma",
  organization: "Kappa Kappa Gamma",
  publisher: "Kappa Kappa Gamma",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl() {
    throw new Blocked(LIST_URL, "login", "page is served by the password-protected-categories plugin (myKappa member area), checked 2026-10-04");
  },
});
