/**
 * Official links (specs/school-identity/links.md): the website, admissions, application, financial aid, net price,
 * veterans', and disability-services pages each college reports in the IPEDS directory (HD{Y}), with Scorecard's
 * homepage as the fallback. Pure; applied by lib/identity.ts.
 */
import type { School } from "./types";

/** A URL with a scheme, or null for an empty value. */
export function normalizeUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const url = v.trim();
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * Sets the HD links from a fresh IPEDS HD row (WEBADDR, ADMINURL, APPLURL, FAIDURL, NPRICURL, VETURL, DISAURL).
 * Without a row (`npm run merge-identity` on the committed data), the links already on the school stay.
 */
export function applyLinks(school: School, hdRow?: Record<string, string>): void {
  // Built by the links track (links.md, implementation step 1).
  void school;
  void hdRow;
}
