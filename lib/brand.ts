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

/** Compare-slot colors (validated all-pairs, both themes). Slot order = pick order. */
export const SLOT_COLORS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
