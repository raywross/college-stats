/**
 * Social accounts (specs/school-identity/social-accounts.md): handles from Wikidata, else the college's homepage
 * footer (data/site-probe.json). Pure; applied by lib/identity.ts. Profile URLs are built at render time from the
 * handle, so a network's URL change is one edit here.
 */
import type { FieldPath } from "./fields";
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
 * Each network's real handle shape (social-accounts.md, Ingest): X and YouTube's own rules exactly; Instagram and
 * TikTok share one pattern; LinkedIn's organization slug and Facebook's numeric id or vanity name are looser, since
 * neither network publishes a precise grammar. Facebook allows hyphens: a real-run check (2026-10-04) found several
 * colleges stored under Facebook's older "Name-With-Hyphens-numericid" page slug (e.g. "Grand-View-University-315068091675",
 * 78 characters), which a plain alphanumeric-and-dot pattern dropped as if it were garbage.
 */
export const HANDLE_PATTERN: Record<SocialNetwork, RegExp> = {
  x: /^[A-Za-z0-9_]{1,15}$/,
  instagram: /^[A-Za-z0-9_.]{1,30}$/,
  tiktok: /^[A-Za-z0-9_.]{1,30}$/,
  youtube: /^UC[\w-]{22}$/,
  facebook: /^[A-Za-z0-9.-]{1,100}$/,
  linkedin: /^[A-Za-z0-9-]{1,100}$/,
};

export function isValidHandle(network: SocialNetwork, handle: string): boolean {
  return HANDLE_PATTERN[network].test(handle);
}

function stripAt(s: string): string {
  return s.startsWith("@") ? s.slice(1) : s;
}

function pathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

/** The path segment that holds the handle, for a network whose URLs nest it under a literal prefix. */
function firstHandleSegment(network: SocialNetwork, segs: readonly string[]): string | null {
  if (!segs.length) return null;
  if (network === "youtube") {
    // Only the channel-id form (/channel/UC…) is usable; /@handle and /c/name can't be turned into one without
    // another lookup, which the social-accounts.md ingest doesn't do (Cost: nothing, no model).
    const i = segs.findIndex((s) => s.toLowerCase() === "channel");
    return i >= 0 ? segs[i + 1] ?? null : null;
  }
  if (network === "linkedin") {
    const i = segs.findIndex((s) => s === "school" || s === "company");
    return (i >= 0 ? segs[i + 1] : segs[0]) ?? null;
  }
  return segs[0];
}

/**
 * Unwraps a stray URL, or a bare path fragment (a real-run value: "school/full-sail-university/", not a full URL,
 * but still carrying LinkedIn's "school/" prefix) into a handle; otherwise trims and un-@s it.
 */
export function normalizeHandle(network: SocialNetwork, raw: string): string {
  const v = raw.trim();
  if (v.includes("/")) {
    const segs = /^https?:\/\//i.test(v) ? pathSegments(v) : v.split("/").filter(Boolean);
    const seg = firstHandleSegment(network, segs);
    return stripAt(seg ?? v);
  }
  return stripAt(v);
}

const NETWORK_HOSTS: Record<SocialNetwork, readonly string[]> = {
  x: ["x.com", "twitter.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  facebook: ["facebook.com", "fb.com"],
  linkedin: ["linkedin.com"],
};

/**
 * A validated handle parsed from a social profile URL (the homepage footer probe), or null when the URL isn't that
 * network's domain, or doesn't resolve to a handle matching its shape. Used to fill a network Wikidata lacks from
 * `data/site-probe.json`, and to compare a Wikidata handle against what the homepage itself links to.
 */
export function handleFromUrl(network: SocialNetwork, url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
  if (!NETWORK_HOSTS[network].includes(host)) return null;
  const seg = firstHandleSegment(network, pathSegments(url));
  if (!seg) return null;
  const handle = stripAt(seg);
  return isValidHandle(network, handle) ? handle : null;
}

/**
 * Collapses handles that differ only by case (the spec's Georgia Tech example: "georgiatech" and "GeorgiaTech"):
 * keeps the lowercase spelling when it's one of the candidates, else the alphabetically first, so the result is
 * deterministic. Handles that aren't case variants of each other both survive (an ambiguous, not a duplicate, case).
 */
export function collapseCaseInsensitiveDuplicates(handles: readonly string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const h of handles) groups.set(h.toLowerCase(), [...(groups.get(h.toLowerCase()) ?? []), h]);
  return [...groups.entries()].map(([key, variants]) => (variants.includes(key) ? key : [...variants].sort()[0]));
}

/**
 * Sets `social` from the college's Wikidata accounts (the default source: no lineage record), filling networks it
 * lacks from the homepage footer link the site probe found (lineage source college-site, method extracted: the
 * homepage's final URL as `url`, the link itself as `quote`). Idempotent: clears `social` and every `social.*`
 * lineage record first, then rebuilds from the inputs, so applying twice gives the same school. Deletes the key
 * entirely when the college has no account anywhere, so documents don't grow empty objects.
 */
export function applySocial(school: School, wikidata: WikidataEntry | undefined, probe: SiteProbeEntry | undefined): void {
  const lineage = { ...(school.lineage ?? {}) };
  for (const network of SOCIAL_NETWORKS) delete lineage[`social.${network}` as FieldPath];

  const accounts: Partial<Record<SocialNetwork, string>> = { ...(wikidata?.accounts ?? {}) };
  if (probe) {
    const pageUrl = probe.homepage?.final_url ?? probe.homepage?.url ?? null;
    for (const network of SOCIAL_NETWORKS) {
      if (accounts[network]) continue; // Wikidata wins
      const href = probe.social[network];
      if (!href) continue;
      const handle = handleFromUrl(network, href);
      if (!handle) continue;
      accounts[network] = handle;
      lineage[`social.${network}` as FieldPath] = {
        source: "college-site",
        method: "extracted",
        url: pageUrl ?? href,
        retrieved: probe.retrieved,
        year: probe.retrieved.slice(0, 4),
        quote: href,
      };
    }
  }

  if (Object.keys(accounts).length) school.social = accounts;
  else delete school.social;
  school.lineage = lineage;
}
