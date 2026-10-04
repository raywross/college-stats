import type { School } from "./types";

export const SITE_NAME = "Quad";
export const SITE_TAGLINE = "College data, decoded.";

/** Hand-picked monograms for well-known schools; everything else is generated. */
const MONOGRAMS: Record<string, string> = {
  "166027": "H",
  "243744": "S",
  "130794": "Y",
  "186131": "P",
  "190150": "C",
  "110635": "UCB",
  "110662": "UCLA",
  "170976": "UM",
  "228778": "UT",
  "139755": "GT",
  "199120": "UNC",
  "168342": "W",
  "215062": "Penn",
  "131520": "HU",
  "145637": "UIUC",
  "134130": "UF",
  "121345": "PC",
  "234076": "UVA",
  "204796": "OSU",
  "236948": "UW",
};

const STOP = new Set(["of", "at", "the", "and", "in", "for", "&"]);

export function monogram(school: Pick<School, "unit_id" | "name">): string {
  if (MONOGRAMS[school.unit_id]) return MONOGRAMS[school.unit_id];
  const base = school.name.split(/[-–]/)[0];
  const letters = base
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()))
    .map((w) => w[0].toUpperCase())
    .join("");
  return letters.slice(0, 3) || school.name.slice(0, 2);
}

/** Readable short names where the monogram is too cryptic for labels. */
const SHORT_NAMES: Record<string, string> = {
  "110635": "Berkeley",
  "170976": "Michigan",
  "228778": "UT Austin",
  "139755": "Georgia Tech",
  "131520": "Howard",
  "121345": "Pomona",
  "134130": "Florida",
  "236948": "UW",
  "190150": "Columbia",
  "204796": "Ohio State",
  "243744": "Stanford",
  "215062": "Penn",
  "234076": "UVA",
};

/** Short display name for tight spaces (charts, compare headers). */
export function shortName(school: Pick<School, "unit_id" | "name">): string {
  if (SHORT_NAMES[school.unit_id]) return SHORT_NAMES[school.unit_id];
  const m = MONOGRAMS[school.unit_id];
  if (m && m.length > 1) return m;
  return school.name
    .replace(/-(Main Campus|.*Campus)$/, "")
    .replace(/^The /, "")
    .replace(/ (University|College)$/, "")
    .replace(/^University of /, "U. ");
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A stable, pleasing hue per school for its crest (decoration, not data). */
export function crestHue(id: string): number {
  // Spread across the wheel in 24 steps so neighbors differ visibly.
  return (hash(id) % 24) * 15;
}

export function crestGradient(id: string): string {
  const h = crestHue(id);
  return `linear-gradient(135deg, oklch(0.68 0.19 ${h}) 0%, oklch(0.5 0.22 ${(h + 40) % 360}) 100%)`;
}

export function crestTint(id: string, alpha = 0.16): string {
  const h = crestHue(id);
  return `oklch(0.7 0.17 ${h} / ${alpha})`;
}

/**
 * What a crest needs to look like its college (specs/school-identity/brand.md): the gradient in its colors, the
 * monogram's text color, and its mark. Plain data, safe for client components and search results.
 */
export interface CrestBrand {
  /** Gradient from → to in the college's colors; null keeps the generated gradient. */
  gradient: [string, string] | null;
  /** The monogram's text color on that gradient. */
  text: "white" | "black";
  /** The mark's URL (/brand/{unit_id}.webp), or null for the monogram. Null for every college when BRAND_MARKS=off. */
  logo: string | null;
}

/**
 * Marks are shown unless `BRAND_MARKS=off` (brand.md: the one switch that degrades to colors only without touching the
 * data). A server-side environment variable, read when a page renders: at build time for prerendered pages, so set it in
 * the deployment's environment and redeploy.
 */
export function brandMarksOn(): boolean {
  return (process.env.BRAND_MARKS ?? "").trim().toLowerCase() !== "off";
}

/**
 * A school's crest look from `school.brand`, or undefined for the generated tile. The gradient runs from the accent to
 * the stored gradient end (a darkened or lightened accent where the next color is black, gray, or white); both are
 * computed at sync time (lib/brand-colors.ts), so this does no color math. Server-side (reads BRAND_MARKS): client
 * components get it from their data (`SchoolIndexEntry.brand`, scatter and map points).
 */
export function crestBrand(school: Pick<School, "unit_id" | "brand">): CrestBrand | undefined {
  const b = school.brand;
  if (!b) return undefined;
  const logo = b.logo && brandMarksOn() ? `/brand/${school.unit_id}.webp` : null;
  const gradient: [string, string] | null = b.accent ? [b.accent, b.crest_to ?? b.accent] : null;
  if (!gradient && !logo) return undefined;
  return { gradient, text: b.on_accent ?? "white", logo };
}

/** `oklch(L C H)` → `oklch(L C H / alpha)`: a stored tint at the alpha a surface uses (string work, no color math). */
const withAlpha = (oklch: string, alpha: number) => oklch.replace(/\)\s*$/, ` / ${alpha})`);

/**
 * The tint a surface (the profile hero, a card's glow) uses for a school, per theme: the college's own tints re-lit for
 * the paper and indigo backgrounds when it has colors, else the hashed hue in both. Set the two as CSS variables and
 * pick with `[--tint:var(--tint-light)] dark:[--tint:var(--tint-dark)]`.
 */
export function brandTint(school: Pick<School, "unit_id" | "brand">, alpha = 0.16): { light: string; dark: string } {
  const b = school.brand;
  if (b?.tint_light && b.tint_dark) return { light: withAlpha(b.tint_light, alpha), dark: withAlpha(b.tint_dark, alpha) };
  const t = crestTint(school.unit_id, alpha);
  return { light: t, dark: t };
}

/**
 * Where a college asks for its mark to come down (brand.md safeguards: honored within a day by `logo: false` in
 * data/brand-overrides.json). The owner hasn't chosen an address yet; until then, a prefilled issue on the public repo.
 */
export const BRAND_REMOVAL_CONTACT = `https://github.com/raywross/college-stats/issues/new?title=${encodeURIComponent(`Remove our mark from ${SITE_NAME}`)}&body=${encodeURIComponent(
  "College:\nYour role at the college:\nAnything else (for example, corrected colors and the brand guide that publishes them):\n",
)}`;

/** Compare-slot colors (validated all-pairs, both themes). Slot order = pick order. */
export const SLOT_COLORS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
