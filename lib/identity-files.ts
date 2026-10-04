/**
 * Shapes of the committed files behind school identity (specs/school-identity/README.md): what each sync step writes
 * under data/ and `applyIdentity` (lib/identity.ts) reads. Types only, so the app, scripts, and tests share them.
 */
import type { LineageRecord, SocialNetwork } from "./types";

/** data/wikidata.json: one entry per college with a Wikidata item (`npm run sync-wikidata`; social-accounts.md). */
export interface WikidataEntry {
  unit_id: string;
  /** The Wikidata item, e.g. "Q761534". */
  qid: string;
  /** English Wikipedia article URL (the brand step joins colors through it). */
  wikipedia: string | null;
  /** Official website (P856). */
  website: string | null;
  /** Validated handles, one per network. */
  accounts: Partial<Record<SocialNetwork, string>>;
  /** Commons logo file name (P154); stored for later, not shown this round (brand.md). */
  logo_file: string | null;
  /** Other names (skos:altLabel, English), read by the alias table (aliases.md). */
  alt_labels: string[];
  /** ISO date of the query. */
  retrieved: string;
}

/** A page the site probe fetched: the URL asked for, where redirects ended, and the status (null = no response). */
export interface ProbedPage {
  url: string;
  final_url: string | null;
  status: number | null;
  /**
   * Why there is no status, or why the page wasn't read (`ProbeError` in scripts/lib/site-probe.mts): "robots",
   * "dns", "timeout", "challenge", … Absent when the page was fetched.
   */
  error?: string;
}

/** A link the probe picked from a page; `text` is the anchor text, kept as the lineage quote. */
export interface FoundLink {
  url: string;
  /** The page the link was found on. */
  found_on: string;
  text: string;
  /** The visit scorer's score (links.md: "visit" +3, "tour" +2, …; ≥ 3 makes a visit page). */
  score: number;
  /** "picker": the Haiku picker chose it from the page's links (`--picker`). Absent: the scorer did. */
  by?: "picker";
}

/** One stored link's liveness result from a probe run. */
export interface LinkCheck {
  url: string;
  status: number | null;
  /** Where redirects ended, when that differs from `url`; null when the link answered without a redirect, or not at all. */
  final_url: string | null;
  /** "dns", "timeout", "robots", …: why there is no status (or "challenge" for a bot-protection page). */
  error?: string;
}

/**
 * data/site-probe.json: one entry per college the site probe visited (`npm run probe-sites`, or `npm run sync-data --
 * --links`; links.md). One polite pass over each homepage and admissions page collects the visit link, the footer's
 * social links, and the site icon candidates, so the social and brand steps never fetch the homepage again.
 */
export interface SiteProbeEntry {
  unit_id: string;
  /** ISO date of the visit. */
  retrieved: string;
  homepage: ProbedPage | null;
  /** The page the visit link was looked for on (links.admissions, else the homepage). */
  admissions: ProbedPage | null;
  /** The best visit link (score ≥ 3), or null. */
  visit: FoundLink | null;
  /** A virtual tour, kept when it is the only visit page found. */
  virtual_tour: FoundLink | null;
  /** The homepage's link to each network, as found: the first in <footer> or <header>, else the first on the page. */
  social: Partial<Record<SocialNetwork, string>>;
  /**
   * Icon candidates from the homepage <head>, best first, then /apple-touch-icon.png and /favicon.ico. Absolute URLs,
   * resolved against the page's final URL (or its <base href>). `rel` is the kind: "apple-touch-icon" (incl.
   * -precomposed; largest `sizes` first), "icon" (incl. "shortcut icon"; largest first, scalable "any"/SVG first), or
   * "fallback" for the two conventional paths the head didn't declare (they may not exist). Not downloaded here.
   */
  icons: { url: string; rel: string; sizes: string | null; type: string | null }[];
  /** Liveness of each stored link this run, keyed by field ("website", "admissions", …). */
  checked?: Record<string, LinkCheck>;
}

/** data/link-issues.json: links that failed the liveness check, kept for a person to look at (links.md). */
export interface LinkIssue {
  unit_id: string;
  /** The links.* field, e.g. "admissions". */
  field: string;
  url: string;
  /** Failed runs in a row (404, 410, or no such host); two make the link null. */
  failures: number;
  last_status: number | null;
  last_error?: string;
  first_failed: string;
  last_failed: string;
}

/** data/brand-colors.json: one entry per college with colors (brand.md), from Wikipedia's module or its infobox. */
export interface BrandColorEntry {
  unit_id: string;
  /** Hex colors in brand order, "#BA0C2F". */
  colors: string[];
  names: string[] | null;
  /** The `Module:College color/data` key the colors came from; null when read from the article's infobox. */
  key: string | null;
  /** The college's Wikipedia article. */
  article: string;
  /** The brand or athletics guide the module entry cites, when it gives one. */
  cite_url: string | null;
  cite_title: string | null;
  retrieved: string;
}

/** data/brand-logos.json: each stored site icon (public/brand/{unit_id}.webp). */
export interface BrandLogoEntry {
  unit_id: string;
  /** Where the icon was fetched from. */
  source_url: string;
  retrieved: string;
  /** Stored width in px (192). */
  width: number;
}

/** data/brand-overrides.json, keyed by unit id: corrections and removals, applied after everything else (brand.md). */
export interface BrandOverride {
  /** false: never show this college's mark (a removal request). The file is deleted and the monogram returns. */
  logo?: false;
  colors?: string[];
  names?: string[];
  /** Where corrected colors came from (the college's brand guide). */
  _lineage?: LineageRecord;
  _note?: string;
}

/** data/aliases.json: one row per (college, alias key) (aliases.md; lib/aliases.ts). */
export interface AliasRow {
  unit_id: string;
  /** As people write it: "UGA". */
  alias: string;
  /** The search key: lower case, no accents, punctuation, or spaces ("uga"). */
  key: string;
  source: "curated" | "ipeds" | "wikidata" | "domain";
  weight: number;
}
