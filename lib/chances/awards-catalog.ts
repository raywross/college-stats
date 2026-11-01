/**
 * The reviewed catalog of common high-school awards (specs/chances/inputs-beyond-academics.md "Awards"):
 * data/reference/awards.json, picked instead of typed so the tier is consistent. Read by `components/me/AwardsForm.tsx`
 * and `AwardEntry.key`'s lookup; checked by `scripts/check-awards-catalog.mts` in `npm run verify`. Pure and
 * client-safe (no server or browser APIs), like `lib/chances/major-course-expectations.ts`.
 */
import file from "../../.data/snapshot/reference/awards.json" with { type: "json" };
import type { RecognitionTier } from "./types.ts";

export interface AwardCatalogEntry {
  /** Stable id (`AwardEntry.key`). */
  key: string;
  /** As shown in the picker. */
  name: string;
  tier: RecognitionTier;
  /** The organization that gives the award, or "The student's own high school" for a school-given honor. */
  body: string;
  source_url: string;
}

export interface AwardsCatalogFile {
  retrieved: string;
  editorial: string;
  awards: AwardCatalogEntry[];
}

export const AWARDS_CATALOG = file as AwardsCatalogFile;

/** Every catalog entry, in file order (the picker's list). */
export function allAwards(source: AwardsCatalogFile = AWARDS_CATALOG): AwardCatalogEntry[] {
  return source.awards;
}

/** One catalog entry by key, or null when it isn't in the catalog (an old `key` the catalog since dropped). */
export function awardByKey(key: string | null | undefined, source: AwardsCatalogFile = AWARDS_CATALOG): AwardCatalogEntry | null {
  if (!key) return null;
  return source.awards.find((a) => a.key === key) ?? null;
}

/** Whether a string is a key in the catalog. */
export function isAwardKey(key: string, source: AwardsCatalogFile = AWARDS_CATALOG): boolean {
  return source.awards.some((a) => a.key === key);
}

const RECOGNITION_TIERS: readonly RecognitionTier[] = [1, 2, 3, 4];

function isHttps(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Problems with the catalog file, one line each (empty means sound): a reviewed file should have unique https-sourced
 * keys, a real tier, and a non-empty giving body — this is what `scripts/check-awards-catalog.mts` runs in
 * `npm run verify`, and what proves the check fails when the file is broken (tests/chances-awards-catalog.test.mts).
 */
export function validateAwardsCatalog(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || !Array.isArray((input as AwardsCatalogFile).awards)) {
    return ['"awards" must be an array'];
  }
  const f = input as AwardsCatalogFile;
  if (typeof f.retrieved !== "string" || !ISO.test(f.retrieved)) errors.push("retrieved must be yyyy-mm-dd");
  if (typeof f.editorial !== "string" || !f.editorial.trim()) errors.push('"editorial" must say the entries are reviewed');
  const seen = new Set<string>();
  const KEY_RE = /^[a-z][a-z0-9_]{1,60}$/;
  f.awards.forEach((a, i) => {
    const where = `awards[${i}] ${a && typeof a.key === "string" ? a.key : "(no key)"}`;
    if (!a || typeof a !== "object") {
      errors.push(`awards[${i}]: not an object`);
      return;
    }
    if (typeof a.key !== "string" || !KEY_RE.test(a.key)) errors.push(`${where}: key must be lowercase letters, digits, underscores`);
    else if (seen.has(a.key)) errors.push(`${where}: key listed twice`);
    else seen.add(a.key);
    if (typeof a.name !== "string" || !a.name.trim()) errors.push(`${where}: name is required`);
    if (!RECOGNITION_TIERS.includes(a.tier)) errors.push(`${where}: tier must be 1, 2, 3, or 4`);
    if (typeof a.body !== "string" || !a.body.trim()) errors.push(`${where}: body (the giving organization) is required`);
    if (!isHttps(a.source_url)) errors.push(`${where}: source_url must be an https url`);
  });
  if (f.awards.length < 20) errors.push(`only ${f.awards.length} awards; expected a reviewed catalog of about 40`);
  return errors;
}
