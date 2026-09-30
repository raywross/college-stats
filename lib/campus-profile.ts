/**
 * Campus profile (specs/data-expansion/campus-profile.md): IPEDS directory (HD) codes and their labels, from the HD2025
 * data dictionary (checked 2026-09-30), and how a directory row becomes the stored fields. Pure: sync-data, the UI, and
 * tests share it.
 */
import type { HdDesignation, MsiDesignation, ResearchTier, School, SettingGroup } from "./types";

type Row = Record<string, string> | undefined;

export const LOCALE_LABELS: Record<number, string> = {
  11: "City: Large", 12: "City: Midsize", 13: "City: Small",
  21: "Suburb: Large", 22: "Suburb: Midsize", 23: "Suburb: Small",
  31: "Town: Fringe", 32: "Town: Distant", 33: "Town: Remote",
  41: "Rural: Fringe", 42: "Rural: Distant", 43: "Rural: Remote",
};

/** The same locales in plain words, for the profile's header. */
export const SETTING_SHORT: Record<number, string> = {
  11: "Large city", 12: "Midsize city", 13: "Small city",
  21: "Large suburb", 22: "Midsize suburb", 23: "Small suburb",
  31: "Town near a city", 32: "Distant town", 33: "Remote town",
  41: "Rural, near a city", 42: "Rural, distant", 43: "Rural, remote",
};

export const SETTING_GROUPS: readonly { key: SettingGroup; label: string }[] = [
  { key: "city", label: "City" },
  { key: "suburb", label: "Suburb" },
  { key: "town", label: "Town" },
  { key: "rural", label: "Rural" },
];

/** Carnegie Classification 2025, institutional classes (CARNEGIEIC). */
export const CARNEGIE_IC: Record<number, string> = {
  1: "Mixed Associate Large", 2: "Mixed Associate Medium", 3: "Mixed Associate Small",
  4: "Mixed Associate/Baccalaureate", 5: "Mixed Baccalaureate",
  6: "Mixed Undergraduate/Graduate-Doctorate Large", 7: "Mixed Undergraduate/Graduate-Doctorate Medium",
  8: "Mixed Undergraduate/Graduate-Doctorate Small", 9: "Mixed Undergraduate/Graduate-Master's Large/Medium",
  10: "Mixed Undergraduate/Graduate-Master's Small", 11: "Professions-focused Associate Large/Medium",
  12: "Professions-focused Associate Small", 13: "Professions-focused Associate/Baccalaureate",
  14: "Professions-focused Baccalaureate Medium", 15: "Professions-focused Baccalaureate Small",
  16: "Professions-focused Undergraduate/Graduate-Doctorate Large", 17: "Professions-focused Undergraduate/Graduate-Doctorate Medium",
  18: "Professions-focused Undergraduate/Graduate-Doctorate Small", 19: "Professions-focused Undergraduate/Graduate-Master's Large/Medium",
  20: "Professions-focused Undergraduate/Graduate-Master's Small", 21: "Special Focus: Applied and Career Studies",
  22: "Special Focus: Arts and Sciences", 23: "Special Focus: Arts, Music, and Design", 24: "Special Focus: Business",
  25: "Special Focus: Graduate Studies", 26: "Special Focus: Law", 27: "Special Focus: Medical Schools and Centers",
  28: "Special Focus: Nursing", 29: "Special Focus: Other Health Professions",
  30: "Special Focus: Technology, Engineering, and Sciences", 31: "Special Focus: Theological Studies",
};

/** Student Access and Earnings (CARNEGIESAEC); 0 is "not classified". */
export const CARNEGIE_SAEC: Record<number, string> = {
  1: "Lower Access, Lower Earnings", 2: "Higher Access, Lower Earnings", 3: "Lower Access, Medium Earnings",
  4: "Higher Access, Medium Earnings", 5: "Lower Access, Higher Earnings",
  6: "Opportunity Colleges and Universities: Higher Access, Higher Earnings",
};

export const CARNEGIE_SIZE: Record<number, string> = { 1: "Very Small", 2: "Small", 3: "Medium", 4: "Large", 5: "Very Large" };

/** CARNEGIERSCH: 1 R1, 2 R2, 3 Research Colleges and Universities; 0 none. */
const RESEARCH: Record<number, ResearchTier> = { 1: "R1", 2: "R2", 3: "RCU" };

export const RESEARCH_LABELS: Record<ResearchTier, string> = {
  R1: "R1: very high research",
  R2: "R2: high research",
  RCU: "Research college or university",
};

export const DESIGNATION_LABELS: Record<HdDesignation | MsiDesignation, string> = {
  hbcu: "HBCU",
  tribal: "Tribal college",
  land_grant: "Land-grant",
  hsi: "Hispanic-Serving",
  pbi: "Predominantly Black",
  aanapisi: "AANAPISI",
  annh: "Alaska Native & Native Hawaiian-Serving",
  nasnti: "Native American-Serving",
  women: "Women's college",
  men: "Men's college",
};

/* ---- Explore filters: `setting=city,town`, `research=R1,R2`, `designation=hbcu,hsi` ---- */

export const RESEARCH_TIERS: readonly ResearchTier[] = ["R1", "R2", "RCU"];
export const DESIGNATION_KEYS = Object.keys(DESIGNATION_LABELS) as (HdDesignation | MsiDesignation)[];

export const isSettingGroup = (v: string): v is SettingGroup => SETTING_GROUPS.some((g) => g.key === v);
export const isResearchTier = (v: string): v is ResearchTier => (RESEARCH_TIERS as readonly string[]).includes(v);
export const isDesignation = (v: string): v is HdDesignation | MsiDesignation => (DESIGNATION_KEYS as readonly string[]).includes(v);

/** Any of the chosen values matches; a college that doesn't report the field never does. */
export function matchesCampus(
  s: Pick<School, "campus">,
  f: { setting?: SettingGroup[]; research?: ResearchTier[]; designation?: (HdDesignation | MsiDesignation)[] }
): boolean {
  if (f.setting?.length && !(s.campus?.setting && f.setting.includes(s.campus.setting.group))) return false;
  if (f.research?.length && !(s.campus?.carnegie?.research && f.research.includes(s.campus.carnegie.research))) return false;
  if (f.designation?.length && !designationsOf(s).some((d) => f.designation!.includes(d))) return false;
  return true;
}

/** Which glossary entry explains each designation. */
export const DESIGNATION_TERMS: Record<HdDesignation | MsiDesignation, "hbcu" | "tribal-college" | "land-grant" | "hsi" | "single-sex"> = {
  hbcu: "hbcu",
  tribal: "tribal-college",
  land_grant: "land-grant",
  hsi: "hsi",
  pbi: "hsi",
  aanapisi: "hsi",
  annh: "hsi",
  nasnti: "hsi",
  women: "single-sex",
  men: "single-sex",
};

/** A college's designations, directory ones first. */
export function designationsOf(s: Pick<School, "campus">): (HdDesignation | MsiDesignation)[] {
  return [...(s.campus?.designations ?? []), ...(s.campus?.msi ?? [])];
}

const code = (row: Row, col: string): number | null => {
  const v = row?.[col];
  if (v === undefined || v === "" || v === ".") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Setting, Carnegie classes, HD designations, and coordinates from a directory row. */
export function campusProfileFrom(row: Row): {
  setting: NonNullable<NonNullable<School["campus"]>["setting"]> | null;
  carnegie: NonNullable<NonNullable<School["campus"]>["carnegie"]> | null;
  designations: HdDesignation[];
  lat: number | null;
  lng: number | null;
} {
  const locale = code(row, "LOCALE");
  const label = locale !== null ? LOCALE_LABELS[locale] : undefined;
  const ic = code(row, "CARNEGIEIC");
  const rsch = code(row, "CARNEGIERSCH");
  const saec = code(row, "CARNEGIESAEC");
  const size = code(row, "CARNEGIESIZE");
  const inUniverse = ic !== null && ic > 0;
  const lat = code(row, "LATITUDE");
  const lng = code(row, "LONGITUD");
  return {
    setting: label ? { locale: locale!, label, group: SETTING_GROUPS[Math.floor(locale! / 10) - 1].key } : null,
    carnegie: inUniverse
      ? {
          ic: CARNEGIE_IC[ic!] ?? null,
          research: rsch !== null ? (RESEARCH[rsch] ?? null) : null,
          access_earnings: saec !== null ? (CARNEGIE_SAEC[saec] ?? null) : null,
          size: size !== null ? (CARNEGIE_SIZE[size] ?? null) : null,
        }
      : null,
    designations: (["hbcu", "tribal", "land_grant"] as const).filter((d) => row?.[{ hbcu: "HBCU", tribal: "TRIBAL", land_grant: "LANDGRNT" }[d]] === "1"),
    // Degrees, within plausible U.S. bounds (territories included).
    lat: lat !== null && lat > -20 && lat < 75 ? lat : null,
    lng: lng !== null && lng > -180 && lng < -60 ? lng : lng !== null && lng > 140 ? lng : null,
  };
}

/** College Scorecard flags (school.minority_serving.*, school.women_only, school.men_only) → designations. */
export const MSI_FIELDS: Record<MsiDesignation, string> = {
  hsi: "school.minority_serving.hispanic",
  pbi: "school.minority_serving.predominantly_black",
  aanapisi: "school.minority_serving.aanipi",
  annh: "school.minority_serving.annh",
  nasnti: "school.minority_serving.nant",
  women: "school.women_only",
  men: "school.men_only",
};

export function msiFrom(sc: Record<string, unknown>): MsiDesignation[] {
  return (Object.entries(MSI_FIELDS) as [MsiDesignation, string][]).filter(([, f]) => sc[f] === 1).map(([k]) => k);
}
