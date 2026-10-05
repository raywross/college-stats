/**
 * NCES Common Core of Data (CCD), the public high school directory, from the CCD school-level nonfiscal files
 * (https://nces.ed.gov/ccd/files.asp), all for the same school year:
 *
 *   029 directory      name, LEA, ST_SCHID, location address, status, school type, charter, grades offered
 *   052 membership     enrollment by grade, race/ethnicity, and sex (long format, 2.3 GB of CSV: streamed)
 *   059 staff          teachers (FTE) → student-teacher ratio (membership ÷ teachers, as NCES computes it)
 *   129 characteristics virtual status
 *   033 lunch          free + reduced-price lunch eligible → frl_share (÷ membership)
 *   EDGE geocodes      latitude, longitude, urban-centric locale (NCES EDGE program, same school year)
 *
 * Two status flags NCES no longer publishes in CCD come from the newest file that has them, with a lineage record:
 * Title I (CCD 129 file, 2021–22, the last year it was released) and magnet (CRDC school characteristics, the CRDC
 * year in crdc.mts).
 *
 * High school here: highest grade offered 12 or 13 (GSHI), a valid lowest grade, the 50 states + DC, and an updated
 * status that is open (Open, New, Added, Changed Boundary/Agency, Reopened; Closed, Inactive, and Future schools are
 * left out). Virtual schools stay in, labeled `status.virtual`.
 *
 * Suppression: CCD marks suppressed cells with DMS_FLAG "Suppressed" (blank count); counts 1–4 are suppressed here
 * too. "Missing", "Not reported", and "Not applicable" are null without a suppressed flag.
 */
import type { HighSchool, HsGrade, HsRaceKey, HsSourceInfo } from "../../../lib/high-school-types.ts";
import { HS_GRADES, HS_RACES, blankHighSchool, fipsToUsps, normalizeGrade, normalizeHighSchool, round, suppress, type Suppressed } from "../../../lib/high-school-core.ts";
import { CRDC_FILE, crdcSourceInfo, retrievedOf } from "./crdc.mts";
import { readCsvRecords, schoolYearLabel } from "./federal-csv.mts";
import type { AdapterContext, AdapterInfo, AdapterResult } from "./types.mts";

export const info: AdapterInfo = {
  key: "ccd",
  role: "directory",
  rowKind: "public",
  owns: [
    "name", "state", "city", "zip", "address", "lat", "lng", "locale", "district", "state_school_id", "grades", "status",
    "school_type", "affiliation", "enrollment", "student_teacher_ratio", "frl_share",
  ],
  sources: ["nces-ccd"],
  vintages: ["ccd-directory", "ccd-enrollment"],
};

const CCD_BASE = "https://nces.ed.gov/ccd/Data/zip";
const file = (name: string) => ({ url: `${CCD_BASE}/${name}.zip`, entry: `${name}.csv` });

/** The CCD release read (final 2024–25, v.2a). Update together when NCES publishes the next final release. */
export const CCD_FILES = {
  year: "2024–25",
  landing: "https://nces.ed.gov/ccd/files.asp",
  directory: file("ccd_sch_029_2425_w_1a_073025"),
  membership: file("ccd_sch_052_2425_l_1a_073025"),
  staff: file("ccd_sch_059_2425_l_1a_073025"),
  characteristics: file("ccd_sch_129_2425_w_1a_073025"),
  lunch: file("ccd_sch_033_2425_l_2a_073025"),
  edge: { url: "https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_2425.zip", entry: "EDGE_GEOCODE_PUBLICSCH_2425.TXT" },
  /** Title I status: last published in the 2021–22 school characteristics file. */
  titleI: { ...file("ccd_sch_129_2122_w_1a_071722"), year: "2021–22" },
} as const;

/** EDGE's TXT has no header row; these are its columns (from the xlsx in the same zip). */
export const EDGE_COLUMNS = [
  "NCESSCH", "LEAID", "NAME", "OPSTFIPS", "STREET", "CITY", "STATE", "ZIP", "STFIP", "CNTY", "NMCNTY", "LOCALE", "LAT", "LON",
  "CBSA", "NMCBSA", "CBSATYPE", "CSA", "NMCSA", "CD", "SLDL", "SLDU", "SCHOOLYEAR",
] as const;

/** NCES urban-centric locale codes. */
export const LOCALE_LABELS: Readonly<Record<string, string>> = {
  "11": "City: Large", "12": "City: Midsize", "13": "City: Small",
  "21": "Suburb: Large", "22": "Suburb: Midsize", "23": "Suburb: Small",
  "31": "Town: Fringe", "32": "Town: Distant", "33": "Town: Remote",
  "41": "Rural: Fringe", "42": "Rural: Distant", "43": "Rural: Remote",
};

export const RACE_LABELS: Readonly<Record<string, HsRaceKey>> = {
  "American Indian or Alaska Native": "american_indian",
  Asian: "asian",
  "Black or African American": "black",
  "Hispanic/Latino": "hispanic",
  "Native Hawaiian or Other Pacific Islander": "pacific_islander",
  "Two or more races": "two_or_more",
  White: "white",
};

/** CCD UPDATED_STATUS codes kept: 1 Open, 3 New, 4 Added, 5 Changed Boundary/Agency, 8 Reopened. */
export const OPEN_STATUSES = new Set(["1", "3", "4", "5", "8"]);

/* ------------------------------------------------------------------ */
/* Directory                                                           */
/* ------------------------------------------------------------------ */

export type DirectoryVerdict =
  | { keep: true; row: HighSchool }
  | { keep: false; reason: "out-of-scope state" | "not open" | "no grade 12" | "bad id" };

const yesNo = (t: string | undefined): boolean | null => (t === "Yes" ? true : t === "No" ? false : null);
const clean = (s: string | undefined): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
};
/** "Regular School" → "Regular school". */
export const sentenceCase = (s: string | null): string | null => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null);

/** One 029 directory record → a row with its directory fields, or why it isn't a high school here. */
export function classifyDirectory(rec: Record<string, string>): DirectoryVerdict {
  const id = rec.NCESSCH;
  if (!/^\d{12}$/.test(id ?? "")) return { keep: false, reason: "bad id" };
  const state = fipsToUsps(id.slice(0, 2));
  if (!state) return { keep: false, reason: "out-of-scope state" };
  if (!OPEN_STATUSES.has(rec.UPDATED_STATUS)) return { keep: false, reason: "not open" };
  const low = normalizeGrade(rec.GSLO);
  const high = normalizeGrade(rec.GSHI);
  if (!low || !(high === "12" || high === "13")) return { keep: false, reason: "no grade 12" };
  const name = clean(rec.SCH_NAME);
  if (!name) return { keep: false, reason: "bad id" };
  const row = blankHighSchool(id, "public", name, state);
  const street = [clean(rec.LSTREET1), clean(rec.LSTREET2)].filter(Boolean).join(", ");
  const zip = (rec.LZIP ?? "").trim();
  row.city = clean(rec.LCITY);
  row.zip = /^\d{5}$/.test(zip) ? zip : null;
  row.address = street || null;
  row.district = rec.LEAID && clean(rec.LEA_NAME) ? { id: rec.LEAID, name: clean(rec.LEA_NAME)! } : null;
  row.state_school_id = clean(rec.ST_SCHID);
  row.grades = { low, high };
  row.status = { charter: yesNo(rec.CHARTER_TEXT), magnet: null, title_i: null, virtual: null };
  row.school_type = sentenceCase(clean(rec.SCH_TYPE_TEXT));
  return { keep: true, row };
}

/* ------------------------------------------------------------------ */
/* Membership                                                          */
/* ------------------------------------------------------------------ */

/** A CCD count cell: the number, or null with suppressed when DMS_FLAG says "Suppressed". Before the small-cell rule. */
export function ccdCell(count: string | undefined, flag: string | undefined): { value: number | null; suppressed: boolean } {
  const t = (count ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(t)) return { value: Number(t), suppressed: false };
  return { value: null, suppressed: (flag ?? "").trim() === "Suppressed" };
}

interface Part {
  sum: number;
  parts: number;
  suppressed: boolean;
  missing: boolean;
}
const newPart = (): Part => ({ sum: 0, parts: 0, suppressed: false, missing: false });
function addPart(p: Part, c: { value: number | null; suppressed: boolean }) {
  p.parts++;
  if (c.value !== null) p.sum += c.value;
  else if (c.suppressed) p.suppressed = true;
  else p.missing = true;
}
/** A summed part as a raw (pre-small-cell) value: suppressed wins over missing. */
function partValue(p: Part | undefined): { value: number | null; suppressed: boolean } {
  if (!p || !p.parts) return { value: null, suppressed: false };
  if (p.suppressed) return { value: null, suppressed: true };
  if (p.missing) return { value: null, suppressed: false };
  return { value: p.sum, suppressed: false };
}

export interface MembershipEntry {
  total: { value: number | null; suppressed: boolean } | null;
  grades: Partial<Record<HsGrade, { value: number | null; suppressed: boolean }>>;
  race: Partial<Record<HsRaceKey, Part>>;
  female: Part;
}

const GRADE_LABEL: Readonly<Record<string, HsGrade>> = { "Grade 9": "9", "Grade 10": "10", "Grade 11": "11", "Grade 12": "12" };
const TOTAL_ROW = "Derived - Education Unit Total minus Adult Education Count";
const RACE_SEX_ROW = "Derived - Subtotal by Race/Ethnicity and Sex minus Adult Education Count";
const GRADE_ROW = "Subtotal 4 - By Grade";

/**
 * Folds 052 membership records into one entry per school: the total excluding adult education, grades 9–12 from the
 * by-grade subtotal, and race and female counts from the race × sex subtotal (each race summed over sexes, female
 * summed over races; a suppressed part suppresses the sum, a missing part makes it missing).
 */
export class MembershipAccumulator {
  readonly entries = new Map<string, MembershipEntry>();
  private readonly keep: (id: string) => boolean;
  constructor(keep: (id: string) => boolean = () => true) {
    this.keep = keep;
  }

  add(rec: Record<string, string>): void {
    const id = rec.NCESSCH;
    const ind = rec.TOTAL_INDICATOR;
    if (ind !== TOTAL_ROW && ind !== RACE_SEX_ROW && ind !== GRADE_ROW) return;
    if (!this.keep(id)) return;
    let e = this.entries.get(id);
    if (!e) this.entries.set(id, (e = { total: null, grades: {}, race: {}, female: newPart() }));
    const cell = ccdCell(rec.STUDENT_COUNT, rec.DMS_FLAG);
    if (ind === TOTAL_ROW) e.total = cell;
    else if (ind === GRADE_ROW) {
      const g = GRADE_LABEL[rec.GRADE];
      if (g) e.grades[g] = cell;
    } else {
      const race = RACE_LABELS[rec.RACE_ETHNICITY];
      if (!race) return; // "Not Specified"
      addPart((e.race[race] ??= newPart()), cell);
      if (rec.SEX === "Female") addPart(e.female, cell);
    }
  }
}

/** Small-cell rule for a raw count. */
const small = (c: { value: number | null; suppressed: boolean }): Suppressed =>
  c.suppressed ? { value: null, suppressed: true } : suppress(c.value, { kind: "count" });

/* ------------------------------------------------------------------ */
/* Assembling a row                                                    */
/* ------------------------------------------------------------------ */

export interface CcdExtras {
  membership?: MembershipEntry;
  teachers?: { value: number | null; suppressed: boolean };
  frl?: { value: number | null; suppressed: boolean };
  virtual?: string;
  /** 2021–22 TITLEI_STATUS code. */
  titleI?: string;
  /** CRDC SCH_STATUS_MAGNET ("Yes"/"No"). */
  magnet?: string;
  edge?: { lat: string; lon: string; locale: string };
}

/** CCD TITLEI_STATUS → runs a Title I program (schoolwide or targeted assistance). Eligible-no-program is false. */
export function titleIStatus(code: string | undefined): boolean | null {
  if (code === "SWELIGSWPROG" || code === "TGELGBTGPROG" || code === "SWELIGTGPROG") return true;
  if (code === "NOTTITLE1ELIG" || code === "SWELIGNOPROG" || code === "TGELGBNOPROG") return false;
  return null;
}

/** CCD VIRTUAL → a virtual school (exclusively or primarily virtual instruction, NCES's definition). */
export function virtualStatus(code: string | undefined): boolean | null {
  if (code === "FULLVIRTUAL" || code === "FACEVIRTUAL") return true;
  if (code === "SUPPVIRTUAL" || code === "NOTVIRTUAL") return false;
  return null;
}

/** Fill a directory row with membership, ratio, FRL, status flags, and geocodes. Returns a new row. */
export function completeRow(base: HighSchool, x: CcdExtras): HighSchool {
  const row: HighSchool = structuredClone(base);
  const suppressed: string[] = [];
  const lineage: NonNullable<HighSchool["lineage"]> = {};
  const put = (path: string, v: Suppressed): number | null => {
    if (v.suppressed) suppressed.push(path);
    return v.value;
  };

  const m = x.membership;
  const rawTotal = m?.total ?? { value: null, suppressed: false };
  row.enrollment.total = put("enrollment.total", small(rawTotal));
  row.enrollment.by_grade = {};
  for (const g of HS_GRADES) {
    const c = m?.grades[g];
    if (c) row.enrollment.by_grade[g] = put(`enrollment.by_grade.${g}`, small(c));
  }
  const races = m ? HS_RACES.filter((r) => m.race[r]) : [];
  row.enrollment.by_race = races.length ? {} : null;
  for (const r of races) row.enrollment.by_race![r] = put(`enrollment.by_race.${r}`, small(partValue(m!.race[r])));
  row.enrollment.female = m && m.female.parts ? put("enrollment.female", small(partValue(m.female))) : null;

  // Ratios and shares use the unsuppressed membership; both are null when the total is suppressed (they'd reveal it).
  const total = row.enrollment.total;
  const t = x.teachers;
  if (total !== null && total > 0 && t) {
    if (t.suppressed) suppressed.push("student_teacher_ratio");
    else if (t.value !== null && t.value > 0) {
      // Outside 1–100 students per teacher is a reporting error (FTE in the wrong unit, a district office's staff).
      const ratio = total / t.value;
      row.student_teacher_ratio = ratio >= 1 && ratio < 100 ? round(ratio, 2) : null;
    }
  }
  if (total !== null && total > 0 && x.frl) {
    const f = small(x.frl);
    if (f.suppressed) suppressed.push("frl_share");
    else if (f.value !== null && f.value <= total) row.frl_share = round(f.value / total, 4);
  }

  row.status.virtual = virtualStatus(x.virtual);
  row.status.title_i = titleIStatus(x.titleI);
  if (row.status.title_i !== null) lineage["status.title_i"] = { source: "nces-ccd", year: CCD_FILES.titleI.year };
  row.status.magnet = yesNo(x.magnet);
  if (row.status.magnet !== null) lineage["status.magnet"] = { source: "crdc" };

  if (x.edge) {
    const lat = Number(x.edge.lat);
    const lng = Number(x.edge.lon);
    if (x.edge.lat && x.edge.lon && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
      row.lat = lat;
      row.lng = lng;
    }
    row.locale = LOCALE_LABELS[x.edge.locale] ?? null;
  }
  delete row.suppressed;
  delete row.lineage;
  if (suppressed.length) row.suppressed = suppressed;
  if (Object.keys(lineage).length) row.lineage = lineage;
  return normalizeHighSchool(row);
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export function ccdSourceInfo(retrieved: string): HsSourceInfo {
  return {
    name: `Common Core of Data ${CCD_FILES.year}, public school files (directory, membership, staff, school characteristics, lunch) and EDGE school geocodes`,
    publisher: "National Center for Education Statistics",
    url: CCD_FILES.landing,
    retrieved,
  };
}

export interface CcdSources {
  directory: string;
  membership: string;
  staff: string;
  characteristics: string;
  lunch: string;
  edge: string;
  titleI: string;
  crdc: string;
}

/** Download (once) every file the adapter reads; returns local paths (zips, or test directories). */
async function fetchAll(ctx: AdapterContext): Promise<CcdSources> {
  return {
    directory: await ctx.fetchCached(CCD_FILES.directory.url),
    membership: await ctx.fetchCached(CCD_FILES.membership.url),
    staff: await ctx.fetchCached(CCD_FILES.staff.url),
    characteristics: await ctx.fetchCached(CCD_FILES.characteristics.url),
    lunch: await ctx.fetchCached(CCD_FILES.lunch.url),
    edge: await ctx.fetchCached(CCD_FILES.edge.url),
    titleI: await ctx.fetchCached(CCD_FILES.titleI.url),
    crdc: await ctx.fetchCached(CRDC_FILE.url),
  };
}

export interface CcdBuild {
  rows: HighSchool[];
  skipped: Record<string, number>;
  schoolYear: string | null;
}

/** Read every file and build the rows (separate from `load` so tests run it on fixture directories). */
export async function buildCcdRows(src: CcdSources): Promise<CcdBuild> {
  const base = new Map<string, HighSchool>();
  const skipped: Record<string, number> = {};
  let schoolYear: string | null = null;
  for await (const rec of readCsvRecords(src.directory, CCD_FILES.directory.entry)) {
    schoolYear ??= rec.SCHOOL_YEAR ? schoolYearLabel(rec.SCHOOL_YEAR) : null;
    const v = classifyDirectory(rec);
    if (v.keep) base.set(v.row.id, v.row);
    else skipped[v.reason] = (skipped[v.reason] ?? 0) + 1;
  }
  const keep = (id: string) => base.has(id);

  const memb = new MembershipAccumulator(keep);
  for await (const rec of readCsvRecords(src.membership, CCD_FILES.membership.entry)) memb.add(rec);

  const teachers = new Map<string, { value: number | null; suppressed: boolean }>();
  for await (const rec of readCsvRecords(src.staff, CCD_FILES.staff.entry)) {
    if (keep(rec.NCESSCH) && rec.TOTAL_INDICATOR === "Education Unit Total") teachers.set(rec.NCESSCH, ccdCell(rec.TEACHERS, rec.DMS_FLAG));
  }
  const frl = new Map<string, { value: number | null; suppressed: boolean }>();
  for await (const rec of readCsvRecords(src.lunch, CCD_FILES.lunch.entry)) {
    if (keep(rec.NCESSCH) && rec.DATA_GROUP === "Free and Reduced-price Lunch Table" && rec.TOTAL_INDICATOR === "Education Unit Total") {
      frl.set(rec.NCESSCH, ccdCell(rec.STUDENT_COUNT, rec.DMS_FLAG));
    }
  }
  const virtual = new Map<string, string>();
  for await (const rec of readCsvRecords(src.characteristics, CCD_FILES.characteristics.entry)) if (keep(rec.NCESSCH)) virtual.set(rec.NCESSCH, rec.VIRTUAL);
  const titleI = new Map<string, string>();
  for await (const rec of readCsvRecords(src.titleI, CCD_FILES.titleI.entry)) if (keep(rec.NCESSCH)) titleI.set(rec.NCESSCH, rec.TITLEI_STATUS);
  const magnet = new Map<string, string>();
  for await (const rec of readCsvRecords(src.crdc, CRDC_FILE.entries.characteristics, { encoding: "latin1" })) {
    if (keep(rec.COMBOKEY)) magnet.set(rec.COMBOKEY, rec.SCH_STATUS_MAGNET);
  }
  const edge = new Map<string, { lat: string; lon: string; locale: string }>();
  for await (const rec of readCsvRecords(src.edge, CCD_FILES.edge.entry, { sep: "|", columns: EDGE_COLUMNS })) {
    if (keep(rec.NCESSCH)) edge.set(rec.NCESSCH, { lat: rec.LAT, lon: rec.LON, locale: rec.LOCALE });
  }

  const rows = [...base.values()].map((row) =>
    completeRow(row, {
      membership: memb.entries.get(row.id),
      teachers: teachers.get(row.id),
      frl: frl.get(row.id),
      virtual: virtual.get(row.id),
      titleI: titleI.get(row.id),
      magnet: magnet.get(row.id),
      edge: edge.get(row.id),
    }),
  );
  return { rows, skipped, schoolYear };
}

export async function load(ctx: AdapterContext): Promise<AdapterResult> {
  const src = await fetchAll(ctx);
  const { rows, skipped, schoolYear } = await buildCcdRows(src);
  if (schoolYear && schoolYear !== CCD_FILES.year) ctx.warn(`ccd: the directory file says ${schoolYear}, CCD_FILES says ${CCD_FILES.year}`);
  const year = schoolYear ?? CCD_FILES.year;
  const n = (f: (r: HighSchool) => unknown) => rows.filter((r) => f(r) !== null && f(r) !== undefined).length;
  return {
    rows,
    sources: { "nces-ccd": ccdSourceInfo(retrievedOf(src.directory)), crdc: crdcSourceInfo(retrievedOf(src.crdc)) },
    vintages: { "ccd-directory": year, "ccd-enrollment": year },
    notes: [
      `ccd ${year}: ${rows.length} public high schools; skipped ${JSON.stringify(skipped)}`,
      `ccd values: enrollment ${n((r) => r.enrollment.total)}, ratio ${n((r) => r.student_teacher_ratio)}, FRL ${n((r) => r.frl_share)}, lat/lng ${n((r) => r.lat)}, locale ${n((r) => r.locale)}, title I ${n((r) => r.status.title_i)}, magnet ${n((r) => r.status.magnet)}, virtual ${n((r) => r.status.virtual)}`,
    ],
  };
}
