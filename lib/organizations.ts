/**
 * National organizations behind the campus directories (specs/campus-directories.md, "Organizations"): each adapter's
 * display name, home page, Greek letters, colors, and logo, from `data/directories/organizations.json` (shape below).
 * Logos are the organizations' own, from their sites, used only to identify them (owner decision 2026-10-04), or a
 * freely licensed Commons file; either way the credit sits in the listing's ⓘ, never on the page. The Religious,
 * Greek, and LGBTQ+ life blocks read the file through this one module.
 *
 * Pure apart from `loadOrganizations` (node:fs, server components only), so tests import the helpers directly.
 * Everything degrades gracefully: before the file exists, or for an organization it doesn't name, a Greek
 * organization gets a letter badge spelled from its name ("Sigma Phi Epsilon" → "ΣΦΕ") on the site's neutral
 * surface, a faith group gets its tradition's icon, and the website falls back to the home page of the domain its
 * own chapter list lives on (only when the organization publishes that list itself).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DirectoryCredit } from "./directories.ts";

/** A committed copy of an organization's logo; its credit shows in the listing's ⓘ. */
export interface OrgLogo {
  /** "public/org-logos/<key>.svg" (committed, ≤ 30 KB). */
  file: string;
  /** Where it came from: the organization's page or the Commons file page. */
  source: string;
  license: string;
  attribution: string;
}

export interface OrgInfo {
  name: string;
  /** The organization's own home page (https), or null. */
  website: string | null;
  /** Greek letters for Greek-letter organizations ("ΣΦΕ"), else null. */
  letters: string | null;
  /** Official colors ("#C8102E"), first is the badge background; [] when no reliable source states them. */
  colors: string[];
  wikidata: string | null;
  logo: OrgLogo | null;
}

export interface OrganizationsFile {
  updated: string;
  organizations: Record<string, OrgInfo>;
}

/**
 * Licenses a committed logo may carry: public domain or a free Commons license, or (owner decision 2026-10-04) the
 * organization's own logo from its site, used only to identify it and credited "© <Organization>".
 */
export const ALLOWED_LOGO_LICENSES = /^(Public domain|PD[- ].*|CC0( 1\.0)?|CC BY( \d\.\d)?|CC BY-SA( \d\.\d)?|Organization's own logo \(used to identify it\))$/i;

const HEX = /^#[0-9a-f]{6}$/i;
const LOGO_FILE = /^public\/org-logos\/[a-z0-9._-]+\.(svg|png|webp|jpe?g)$/;
const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S+$/.test(u);

/** Problems with the file's shape (empty when sound). Existence and size of logo files are the data track's test. */
export function organizationsProblems(file: unknown): string[] {
  const f = file as OrganizationsFile | null;
  if (!f || typeof f !== "object" || !f.organizations || typeof f.organizations !== "object") return ["file must be { updated, organizations }"];
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.updated ?? "")) out.push("updated must be an ISO date");
  for (const [key, o] of Object.entries(f.organizations)) {
    if (!o?.name) out.push(`${key}: no name`);
    if (o.website !== null && !isHttps(o.website)) out.push(`${key}: website must be https or null`);
    if (!Array.isArray(o.colors) || o.colors.some((c) => !HEX.test(c))) out.push(`${key}: colors must be #rrggbb strings`);
    if (o.logo) {
      if (!LOGO_FILE.test(o.logo.file)) out.push(`${key}: logo file must be public/org-logos/<name>.svg|png|webp|jpg`);
      if (!isHttps(o.logo.source)) out.push(`${key}: logo source must be an https link`);
      if (!ALLOWED_LOGO_LICENSES.test(o.logo.license ?? "")) out.push(`${key}: logo license "${o.logo.license}" isn't public domain or a free license`);
    }
  }
  return out;
}

const EMPTY: OrganizationsFile = { updated: "", organizations: {} };
let memo: OrganizationsFile | null = null;

/**
 * The organizations file, or an empty one before it exists. Tolerant on purpose (the strict check is
 * `organizationsProblems`, run by the tests): an entry whose logo path or website looks wrong loses just that part,
 * so one bad row never hides every badge on the page.
 */
export function loadOrganizations(root = process.cwd()): OrganizationsFile {
  if (memo && root === process.cwd()) return memo;
  const path = join(root, "data", "directories", "organizations.json");
  let file = EMPTY;
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as OrganizationsFile;
      const organizations: Record<string, OrgInfo> = {};
      for (const [key, o] of Object.entries(parsed.organizations ?? {})) {
        if (!o?.name) continue;
        organizations[key] = {
          name: o.name,
          website: isHttps(o.website) ? o.website : null,
          letters: typeof o.letters === "string" && o.letters ? o.letters : null,
          colors: Array.isArray(o.colors) ? o.colors.filter((c) => HEX.test(c)) : [],
          wikidata: o.wikidata ?? null,
          logo: o.logo && LOGO_FILE.test(o.logo.file) ? o.logo : null,
        };
      }
      file = { updated: parsed.updated ?? "", organizations };
    } catch (e) {
      console.warn(`organizations.json unreadable: ${(e as Error).message}`);
    }
  }
  if (root === process.cwd()) memo = file;
  return file;
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

const GREEK: Record<string, string> = {
  alpha: "Α", beta: "Β", gamma: "Γ", delta: "Δ", epsilon: "Ε", zeta: "Ζ", eta: "Η", theta: "Θ", iota: "Ι", kappa: "Κ",
  lambda: "Λ", mu: "Μ", nu: "Ν", xi: "Ξ", omicron: "Ο", pi: "Π", rho: "Ρ", sigma: "Σ", tau: "Τ", upsilon: "Υ",
  phi: "Φ", chi: "Χ", psi: "Ψ", omega: "Ω",
};

/**
 * Greek letters spelled from an organization's name, when every word is a letter's name ("Sigma Phi Epsilon" →
 * "ΣΦΕ"; "Tri Delta" → "ΔΔΔ"); null otherwise ("FOCUS", "Reformed University Fellowship").
 */
export function lettersFromName(name: string): string | null {
  const words = name.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
  if (words[0] === "tri" && words.length === 2 && GREEK[words[1]]) return GREEK[words[1]].repeat(3);
  if (!words.length || words.length > 4 || !words.every((w) => GREEK[w])) return null;
  return words.map((w) => GREEK[w]).join("");
}

/** What a listing's badge shows: the logo, Greek letters, or neither (the caller's tradition or kind icon). */
export type OrgBadgeData =
  | { kind: "logo"; src: string; logo: OrgLogo }
  | { kind: "letters"; letters: string; background: string | null; foreground: string | null }
  | { kind: "none" };

/** Text color with the better contrast on a #rrggbb background (WCAG relative luminance). */
export function inkOn(hex: string): "#ffffff" | "#1a1530" {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs. near-black ink (luminance ~0.012).
  return (1.05 / (lum + 0.05) >= (lum + 0.05) / 0.062 ? "#ffffff" : "#1a1530");
}

export function orgBadge(info: OrgInfo | null | undefined, organization: string): OrgBadgeData {
  if (info?.logo) return { kind: "logo", src: `/${info.logo.file.replace(/^public\//, "")}`, logo: info.logo };
  const letters = info?.letters ?? lettersFromName(info?.name ?? organization);
  if (!letters) return { kind: "none" };
  const bg = info?.colors[0] ?? null;
  return { kind: "letters", letters, background: bg, foreground: bg ? inkOn(bg) : null };
}

/**
 * The organization's own home page: the file's `website`, else (when the organization publishes its own chapter
 * list, under its name or a short form of it: "FOCUS" for "FOCUS (Fellowship of…)") the home page of that list's site;
 * null for a list someone else publishes (the list isn't the org's site).
 */
export function orgWebsite(info: OrgInfo | null | undefined, credit: Pick<DirectoryCredit, "organization" | "publisher" | "list_url">): string | null {
  if (info) return info.website;
  if (!credit.organization.startsWith(credit.publisher)) return null;
  try {
    return `${new URL(credit.list_url).origin}/`;
  } catch {
    return null;
  }
}

/** The organization's display name: the file's, else the credit's. */
export const orgName = (info: OrgInfo | null | undefined, credit: Pick<DirectoryCredit, "organization">) => info?.name ?? credit.organization;

/**
 * A chapter's own designation with the organization's name taken out: "Tau (Kappa Sigma)" → "Tau";
 * "Alpha-Mu (Texas Austin) (Lambda Chi Alpha)" → "Alpha-Mu (Texas Austin)"; null when the listing gives no name or
 * only repeats the organization's.
 */
export function chapterLabel(name: string | undefined, organization: string): string | null {
  if (!name) return null;
  const esc = organization.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = name.replace(new RegExp(`\\s*\\(${esc}\\)\\s*$`, "i"), "").trim();
  if (!stripped || stripped.toLowerCase() === organization.toLowerCase()) return null;
  return stripped;
}
