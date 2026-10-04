/**
 * Colors and marks (specs/school-identity/brand.md): the college's colors from Wikipedia's college color data (or its
 * article's infobox), the derived accent, monogram text color, and per-theme tints, and its stored site icon. Pure;
 * applied by lib/identity.ts. Decoration, never data.
 */
import type { School } from "./types";
import type { BrandColorEntry, BrandLogoEntry, BrandOverride } from "./identity-files";

/** One college's brand inputs. */
export interface BrandInputs {
  colors: BrandColorEntry | undefined;
  logo: BrandLogoEntry | undefined;
  override: BrandOverride | undefined;
}

/** Sets `brand` (colors, derived fields, logo) from the brand files, overrides last. Replaces any earlier `brand`. */
export function applyBrand(school: School, inputs: BrandInputs): void {
  // Built by the brand track (brand.md, implementation steps 1 and 2).
  void school;
  void inputs;
}
