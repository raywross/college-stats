/**
 * What the site probe found (specs/school-identity/links.md; data/site-probe.json, data/link-issues.json): the visit
 * and virtual tour pages, and the liveness and redirect results for every stored link. Pure; applied by
 * lib/identity.ts after the HD links (lib/links.ts). The probe itself is scripts/lib/site-probe.mts.
 */
import type { School } from "./types";
import type { LinkIssue, SiteProbeEntry } from "./identity-files";

/**
 * Sets links.visit and links.virtual_tour (lineage source college-site: the page each was found on and its link
 * text), replaces links that redirect within the college's domain with their final URL, and nulls links that failed
 * the liveness check twice in a row.
 */
export function applyProbeLinks(school: School, entry: SiteProbeEntry | undefined, issues: readonly LinkIssue[]): void {
  // Built by the site-probe track (links.md, implementation step 2).
  void school;
  void entry;
  void issues;
}
