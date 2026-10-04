/**
 * Religious life, phase 1 (specs/religious-life.md): a college's IPEDS religious affiliation (IC{Y} `RELAFFIL`, with
 * NCES's own label from the IC{Y} data dictionary), the faith families the Explore filter groups them into, and the
 * display rules for the CDS facts read so far (C7 religious commitment in admissions, H14 scholarships, F2 campus
 * ministries). Pure: sync-data, the UI, and tests share it.
 *
 * Neutral by design: affiliation is a fact, never a grade. "Faith-centered" comes only from the college's own CDS
 * saying religious affiliation or commitment is very important in admission, never from affiliation alone.
 */
import type { FactorImportance, FaithFamily, FaithFilter, School, SchoolReligion } from "./types";

type Row = Record<string, string> | undefined;

/** IPEDS "not applicable": the college has no religious affiliation (every public college, many private ones). */
export const RELAFFIL_NOT_APPLICABLE = -2;

export const FAITH_FAMILIES: readonly { key: FaithFamily; label: string }[] = [
  { key: "catholic", label: "Catholic" },
  { key: "baptist", label: "Baptist" },
  { key: "methodist", label: "Methodist and Wesleyan" },
  { key: "lutheran", label: "Lutheran" },
  { key: "presbyterian_reformed", label: "Presbyterian and Reformed" },
  { key: "nondenominational", label: "Nondenominational Christian" },
  { key: "other_christian", label: "Other Christian" },
  { key: "jewish", label: "Jewish" },
  { key: "latter_day_saint", label: "Latter-day Saint" },
  { key: "other", label: "Other" },
];
export const FAITH_FILTERS: readonly { key: FaithFilter; label: string }[] = [...FAITH_FAMILIES, { key: "none", label: "No affiliation" }];

/**
 * Every RELAFFIL code in IC2025 (the dictionary's frequencies, checked 2026-10-03) → its family. Labels are NOT
 * here: they come from the dictionary at sync time. A code missing from this table makes the sync fail
 * (`religionFrom`), so a new NCES code gets a family on purpose, never by default.
 */
export const RELAFFIL_FAMILY: Readonly<Record<number, FaithFamily>> = {
  30: "catholic", // Roman Catholic
  // Baptist: American, Baptist, Free Will, General, North American, Original Free Will, Southern.
  52: "baptist", 54: "baptist", 41: "baptist", 105: "baptist", 45: "baptist", 100: "baptist", 75: "baptist",
  // Methodist and the Wesleyan-Holiness churches that came out of it: AME, AME Zion, CME, Free Methodist, Nazarene,
  // United Methodist, Wesleyan.
  51: "methodist", 24: "methodist", 55: "methodist", 64: "methodist", 59: "methodist", 71: "methodist", 89: "methodist",
  // Lutheran: American Evangelical, Evangelical Lutheran, in America, Missouri Synod, Wisconsin Synod.
  22: "lutheran", 39: "lutheran", 67: "lutheran", 68: "lutheran", 33: "lutheran",
  // Presbyterian and Reformed: Christian Reformed, Cumberland Presbyterian, Presbyterian, PC(USA), PCA, Reformed
  // Church in America, Reformed Presbyterian.
  35: "presbyterian_reformed", 60: "presbyterian_reformed", 103: "presbyterian_reformed", 66: "presbyterian_reformed",
  97: "presbyterian_reformed", 49: "presbyterian_reformed", 81: "presbyterian_reformed",
  // Christian without one denomination: Evangelical Christian, Interdenominational, Multiple Protestant Denomination,
  // Non-Denominational, Undenominational.
  102: "nondenominational", 42: "nondenominational", 78: "nondenominational", 108: "nondenominational", 88: "nondenominational",
  // Every other Christian church IPEDS lists.
  27: "other_christian", // Assemblies of God Church
  28: "other_christian", // Brethren Church
  34: "other_christian", // Christ and Missionary Alliance Church
  61: "other_christian", // Christian Church (Disciples of Christ)
  48: "other_christian", // Christian Churches and Churches of Christ
  58: "other_christian", // Church of Brethren
  57: "other_christian", // Church of God
  74: "other_christian", // Churches of Christ
  50: "other_christian", // Episcopal Church, Reformed
  37: "other_christian", // Evangelical Covenant Church of America
  38: "other_christian", // Evangelical Free Church of America
  65: "other_christian", // Friends
  91: "other_christian", // Greek Orthodox
  43: "other_christian", // Mennonite Brethren Church
  69: "other_christian", // Mennonite Church
  87: "other_christian", // Missionary Church Inc
  44: "other_christian", // Moravian Church
  79: "other_christian", // Other Protestant
  47: "other_christian", // Pentecostal Holiness Church
  107: "other_christian", // Plymouth Brethren
  73: "other_christian", // Protestant Episcopal
  92: "other_christian", // Russian Orthodox
  95: "other_christian", // Seventh Day Adventist
  84: "other_christian", // United Brethren Church
  76: "other_christian", // United Church of Christ
  80: "jewish",
  94: "latter_day_saint", // The Church of Jesus Christ of Latter-day Saints
  93: "other", // Unitarian Universalist
  99: "other", // Other (none of the above)
};

/**
 * `school.religion` from an IC{Y} row: null when the college has no row or IPEDS has no answer (a negative code
 * other than "not applicable"); `{ affiliation: null }` for "not applicable". Throws on a code the dictionary
 * doesn't label or this module doesn't group, so nothing is written with a hand-typed or missing label.
 */
export function religionFrom(row: Row, labels: ReadonlyMap<number, string>): SchoolReligion | null {
  const raw = row?.RELAFFIL?.trim();
  if (!raw) return null;
  const code = Number(raw);
  if (!Number.isInteger(code)) throw new Error(`RELAFFIL "${raw}" is not a code`);
  if (code === RELAFFIL_NOT_APPLICABLE) return { affiliation: null };
  if (code < 0) return null;
  const label = labels.get(code);
  if (!label) throw new Error(`RELAFFIL ${code} has no label in the IPEDS data dictionary`);
  if (!(code in RELAFFIL_FAMILY)) throw new Error(`RELAFFIL ${code} ("${label}") has no faith family: add it to RELAFFIL_FAMILY in lib/religion.ts`);
  return { affiliation: { code, label } };
}

export function faithFamilyLabel(f: FaithFilter): string {
  return FAITH_FILTERS.find((x) => x.key === f)!.label;
}

/** The college's faith family, "none" without an affiliation, or null when IPEDS has no answer. */
export function faithFilterOf(s: Pick<School, "religion">): FaithFilter | null {
  if (!s.religion) return null;
  const code = s.religion.affiliation?.code;
  return code === undefined ? "none" : (RELAFFIL_FAMILY[code] ?? null);
}

export function isFaithFilter(v: string): v is FaithFilter {
  return FAITH_FILTERS.some((f) => f.key === v);
}

/** Explore's affiliation filter: colleges IPEDS has no answer for never match. */
export function matchesFaith(s: Pick<School, "religion">, wanted: readonly FaithFilter[]): boolean {
  const f = faithFilterOf(s);
  return f !== null && wanted.includes(f);
}

/** CDS C7 (C.715): how much religious affiliation or commitment counts in admission, from the college's own CDS. */
export function religiousCommitment(s: Pick<School, "reported">): FactorImportance | null {
  return s.reported?.admission_profile?.factors?.religious ?? null;
}

/** "Known for: Faith-centered": only C7 = very important (never affiliation alone; CCCU membership is a later phase). */
export function isFaithCentered(s: Pick<School, "reported">): boolean {
  return religiousCommitment(s) === "very_important";
}

/** What the profile's "Religious life" block shows; null hides it. */
export interface ReligionView {
  /** Present when IPEDS answered; `affiliation` null = "No religious affiliation". */
  religion: SchoolReligion | null;
  /** C7 level, shown when the college is affiliated or the level is above "not considered". */
  commitment: FactorImportance | null;
  aid: { non_need: boolean; need: boolean } | null;
  ministries: boolean;
}

/**
 * The block shows for an affiliated college, or for any college whose CDS says something about religion (C7 above
 * "not considered", H14 religious scholarships, F2 campus ministries). An unaffiliated college with none of those
 * gets no block: "No religious affiliation" alone on 1,200 public colleges would be noise.
 */
export function religionView(s: Pick<School, "religion" | "reported">): ReligionView | null {
  const religion = s.religion ?? null;
  const affiliated = !!religion?.affiliation;
  const c7 = religiousCommitment(s);
  const commitment = c7 && (affiliated || c7 !== "not_considered") ? c7 : null;
  const aid = s.reported?.religion?.aid_by_affiliation ?? null;
  const ministries = s.reported?.religion?.campus_ministries === true;
  if (!affiliated && !commitment && !aid && !ministries) return null;
  return { religion, commitment, aid, ministries };
}
