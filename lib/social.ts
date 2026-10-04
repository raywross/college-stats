/**
 * Social accounts (specs/school-identity/social-accounts.md): handles from Wikidata, else the college's homepage
 * footer (data/site-probe.json). Pure; applied by lib/identity.ts. Profile URLs are built at render time from the
 * handle, so a network's URL change is one edit here.
 */
import type { School, SocialNetwork } from "./types";
import type { SiteProbeEntry, WikidataEntry } from "./identity-files";

/** The order the profile shows them: the order students use them, not alphabetical. */
export const SOCIAL_NETWORKS: readonly SocialNetwork[] = ["instagram", "youtube", "tiktok", "x", "facebook", "linkedin"];

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

/** The public profile URL for a stored handle. */
export function socialUrl(network: SocialNetwork, handle: string): string {
  const h = encodeURIComponent(handle);
  switch (network) {
    case "instagram":
      return `https://www.instagram.com/${h}`;
    case "youtube":
      return `https://www.youtube.com/channel/${h}`;
    case "tiktok":
      return `https://www.tiktok.com/@${h}`;
    case "x":
      return `https://x.com/${h}`;
    case "facebook":
      return `https://www.facebook.com/${h}`;
    case "linkedin":
      return `https://www.linkedin.com/school/${h}`;
  }
}

/**
 * Sets `social` from the college's Wikidata accounts, filling networks it lacks from the homepage footer links the
 * site probe found (lineage source college-site, the homepage as its URL). Replaces any earlier `social` and its
 * lineage.
 */
export function applySocial(school: School, wikidata: WikidataEntry | undefined, probe: SiteProbeEntry | undefined): void {
  // Built by the social-accounts track (social-accounts.md, implementation step 2).
  void school;
  void wikidata;
  void probe;
}
