/**
 * Maps a student's saved profile onto Explore's own URL params (specs/product/student-profile.md "Display"), so
 * "Fits my scores"/"Fits my preferences" are plain navigations that Explore's existing, server-side filter
 * pipeline (lib/params.ts → lib/dataset.ts) applies — never a client-side post-filter of an already-rendered page.
 * Pure and client-safe: `components/me/ExploreFitChips.tsx` is the only caller, kept thin so this mapping (and the
 * "preference has no matching Explore filter" case) can be tested without React.
 */
import { stateByPostal } from "./states.ts";
import type { StudentProfilePreferences } from "./student-profile.ts";

/** `mySAT`/`myACT`: only the ones the student actually has a saved score for. */
export function scoreParams(scores: { sat: number | null; act: number | null }): Record<string, string | null> {
  return {
    mySAT: scores.sat !== null ? String(scores.sat) : null,
    myACT: scores.act !== null ? String(scores.act) : null,
  };
}

export interface PreferencesMapping {
  /** Explore URL params to set (a null clears that param); empty when nothing in the profile maps to anything. */
  params: Record<string, string | null>;
  /** `statesOrRegions` entries that aren't a USPS state code — Explore has no "region" or "outside the U.S." filter
   * (its `regions` param matches live `school.location.region` values, which aren't a fixed list this pure module
   * can validate against), so these are reported instead of silently dropped. */
  unmapped: string[];
}

/**
 * Preferences → Explore's existing filters: `sizes`→`sizes`, `settings`→`setting`, `types`→`types`,
 * `maxAverageCost`→`maxCost` (all direct; same value unions), and `statesOrRegions` → `states` for whichever
 * entries are USPS codes. A preference the student never set maps to `null` (clears that param rather than
 * leaving a stale value from an earlier apply).
 */
export function preferencesToExploreParams(p: StudentProfilePreferences): PreferencesMapping {
  const states: string[] = [];
  const unmapped: string[] = [];
  for (const s of p.statesOrRegions) (stateByPostal(s) ? states : unmapped).push(s);

  return {
    params: {
      sizes: p.sizes.length ? p.sizes.join(",") : null,
      setting: p.settings.length ? p.settings.join(",") : null,
      states: states.length ? states.map((s) => s.toUpperCase()).join(",") : null,
      types: p.types.length ? p.types.join(",") : null,
      maxCost: p.maxAverageCost !== null ? String(p.maxAverageCost) : null,
    },
    unmapped,
  };
}

/** Whether a PreferencesMapping's params would change anything (all null = nothing in the profile to apply). */
export function hasAnyMappedPreference(mapping: PreferencesMapping): boolean {
  return Object.values(mapping.params).some((v) => v !== null);
}

/** The note for unmapped `statesOrRegions` entries, or null when there's nothing to say. */
export function unmappedPreferencesNote(unmapped: string[]): string | null {
  if (unmapped.length === 0) return null;
  const list = unmapped.map((s) => `"${s}"`).join(", ");
  return unmapped.length === 1
    ? `${list} isn't a state Explore filters by, so it wasn't applied.`
    : `${list} aren't states Explore filters by, so they weren't applied.`;
}
