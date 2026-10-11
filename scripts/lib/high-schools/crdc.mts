/**
 * Civil Rights Data Collection (CRDC) public-use file, school level: AP courses, AP enrollment, IB enrollment, dual
 * enrollment, and CRDC's own school enrollment (`rigor.enrollment`, the denominator for the derived shares, so a share
 * never mixes two years). `COMBOKEY` is the ncessch.
 *
 * Source: the 2023–24 CRDC (released August 2026), https://civilrightsdata.ed.gov/data. Notes from reading the file:
 * - AP exam takers and passers are no longer collected (dropped after 2017–18; absent from 2021–22 and 2023–24), so
 *   `rigor.ap_exam_takers` / `rigor.ap_passed_some` are null (not suppressed) for every school.
 * - Reserve codes are negative numbers: -9 not applicable / not reported, -10 nonbinary counts not collected, -5 and
 *   others missing; -11 and -12 are OCR's suppression codes (2023–24 publishes unsuppressed counts, but the codes are
 *   honored if a release uses them). Counts of students 1–4 are suppressed here (lib/high-school-core.ts `suppress`).
 * - `SCH_APENR_IND` / `SCH_IBENR_IND` are "Yes", "No", or -9: -9 covers some large high schools that do offer AP, so
 *   it is "not reported", never zero; "No" means the school offers none, stored as an explicit 0 (courses and
 *   students; 2026-10-11, specs/chances/rigor-in-context.md). `SCH_DUAL_IND` is "Yes" or "No"; "No" means no students
 *   in dual enrollment (0). The stored shards pick up the "No" → 0 change at the next CRDC import.
 * - Totals are male + female (+ nonbinary when reported): if a part is missing, the total is missing.
 */
import { statSync } from "node:fs";
import type { HighSchool, HsSourceInfo } from "../../../lib/high-school-types.ts";
import { suppress, type Suppressed } from "../../../lib/high-school-core.ts";
import { readCsvRecords } from "./federal-csv.mts";
import type { AdapterContext, AdapterInfo, AdapterResult, HighSchoolPatch } from "./types.mts";

export const info: AdapterInfo = {
  key: "crdc",
  role: "enrichment",
  rowKind: "public",
  owns: ["rigor"],
  sources: ["crdc"],
  vintages: ["crdc"],
};

/** The CRDC release read. Update all four together when OCR publishes the next collection. */
export const CRDC_FILE = {
  url: "https://civilrightsdata.ed.gov/assets/ocr/docs/2023-24-crdc-data.zip",
  year: "2023–24",
  landing: "https://civilrightsdata.ed.gov/data",
  entries: {
    enrollment: "SCH/Enrollment.csv",
    ap: "SCH/Advanced Placement.csv",
    ib: "SCH/International Baccalaureate.csv",
    dual: "SCH/Dual Enrollment.csv",
    characteristics: "SCH/School Characteristics.csv",
  },
} as const;

export function crdcSourceInfo(retrieved: string): HsSourceInfo {
  return {
    name: `Civil Rights Data Collection ${CRDC_FILE.year}, public-use file`,
    publisher: "U.S. Department of Education, Office for Civil Rights",
    url: CRDC_FILE.landing,
    retrieved,
  };
}

/** CRDC reserve codes that mean "suppressed for privacy". Every other negative code is missing. */
export const CRDC_SUPPRESSED = ["-11", "-12"];

/** Suppression of one student count (1–4 → suppressed; reserve codes per CRDC_SUPPRESSED). */
export function crdcCount(raw: string | undefined, min?: number): Suppressed {
  return suppress(raw, { kind: "count", suppressedCodes: CRDC_SUPPRESSED, ...(min !== undefined ? { min } : {}) });
}

/**
 * A total from male / female / nonbinary columns, before small-cell suppression: the sum of the reported parts, or
 * null (with `suppressed` when a part was suppressed) when male or female is missing. Nonbinary (-10 when the state
 * didn't collect it) adds only when reported.
 */
export function crdcRawTotal(rec: Record<string, string>, stem: string): { value: number | null; suppressed: boolean } {
  let sum = 0;
  for (const sex of ["M", "F", "X"]) {
    const raw = rec[`${stem}_${sex}`];
    if (raw === undefined) {
      if (sex === "X") continue;
      return { value: null, suppressed: false };
    }
    const t = raw.trim();
    if (CRDC_SUPPRESSED.includes(t)) return { value: null, suppressed: true };
    const n = Number(t);
    if (t === "" || !Number.isFinite(n) || n < 0) {
      if (sex === "X") continue;
      return { value: null, suppressed: false };
    }
    sum += n;
  }
  return { value: sum, suppressed: false };
}

/** Small-cell rule on a summed total. */
function total(rec: Record<string, string>, stem: string): Suppressed {
  const raw = crdcRawTotal(rec, stem);
  if (raw.value === null) return raw;
  return crdcCount(String(raw.value));
}

type Rigor = NonNullable<HighSchool["rigor"]>;

export interface CrdcSchool {
  enrollment?: Record<string, string>;
  ap?: Record<string, string>;
  ib?: Record<string, string>;
  dual?: Record<string, string>;
}

/** One school's rigor patch from its CRDC records (any of them may be absent). Null when CRDC has nothing for it. */
export function buildCrdcPatch(id: string, s: CrdcSchool): HighSchoolPatch | null {
  if (!s.enrollment && !s.ap && !s.ib && !s.dual) return null;
  const suppressed: string[] = [];
  const put = (field: keyof Rigor, v: Suppressed): number | null => {
    if (v.suppressed) suppressed.push(`rigor.${field}`);
    return v.value;
  };
  const rigor: Rigor = {
    ap_courses: null,
    ap_enrolled: null,
    ap_exam_takers: null,
    ap_passed_some: null,
    ib_enrolled: null,
    dual_enrolled: null,
    enrollment: s.enrollment ? put("enrollment", total(s.enrollment, "TOT_ENR")) : null,
  };
  if (s.ap && s.ap.SCH_APENR_IND === "Yes") {
    // Courses aren't students: the small-cell rule doesn't apply (min 1).
    rigor.ap_courses = put("ap_courses", crdcCount(s.ap.SCH_APCOURSES, 1));
    rigor.ap_enrolled = put("ap_enrolled", total(s.ap, "TOT_APENR"));
  } else if (s.ap?.SCH_APENR_IND === "No") {
    // The school said it offers no AP courses (specs/chances/rigor-in-context.md "The school's offering"): an explicit
    // 0, so it reads "doesn't offer AP courses" rather than nothing. -9 ("not reported") stays missing.
    rigor.ap_courses = 0;
    rigor.ap_enrolled = 0;
  }
  if (s.ib && s.ib.SCH_IBENR_IND === "Yes") rigor.ib_enrolled = put("ib_enrolled", total(s.ib, "TOT_IBENR"));
  else if (s.ib?.SCH_IBENR_IND === "No") rigor.ib_enrolled = 0;
  if (s.dual?.SCH_DUAL_IND === "No") rigor.dual_enrolled = 0;
  else if (s.dual?.SCH_DUAL_IND === "Yes") rigor.dual_enrolled = put("dual_enrolled", total(s.dual, "TOT_DUALENR"));
  return { id, values: { rigor }, ...(suppressed.length ? { suppressed } : {}) };
}

/** Retrieved date of a cached download: the day the file landed in the cache. */
export function retrievedOf(path: string): string {
  return statSync(path).mtime.toISOString().slice(0, 10);
}

/** Schools to read: the public rows CCD wrote (the run's directory step), or every school when there are none yet. */
function wanted(ctx: AdapterContext): ((id: string) => boolean) {
  const ids = new Set([...ctx.existing.values()].filter((r) => r.kind === "public").map((r) => r.id));
  return ids.size ? (id) => ids.has(id) : () => true;
}

const sexes = (stem: string) => [`${stem}_M`, `${stem}_F`, `${stem}_X`];
/** The columns kept per file (the files have up to ~300 columns; ~97,000 schools). */
const CRDC_COLUMNS: Record<keyof CrdcSchool, readonly string[]> = {
  enrollment: sexes("TOT_ENR"),
  ap: ["SCH_APENR_IND", "SCH_APCOURSES", ...sexes("TOT_APENR")],
  ib: ["SCH_IBENR_IND", ...sexes("TOT_IBENR")],
  dual: ["SCH_DUAL_IND", ...sexes("TOT_DUALENR")],
};

export async function loadCrdcSchools(source: string, keep: (id: string) => boolean): Promise<Map<string, CrdcSchool>> {
  const schools = new Map<string, CrdcSchool>();
  for (const part of ["enrollment", "ap", "ib", "dual"] as const) {
    for await (const rec of readCsvRecords(source, CRDC_FILE.entries[part], { encoding: "latin1" })) {
      const id = rec.COMBOKEY;
      if (!id || !keep(id)) continue;
      let s = schools.get(id);
      if (!s) schools.set(id, (s = {}));
      const slim: Record<string, string> = {};
      for (const c of CRDC_COLUMNS[part]) if (c in rec) slim[c] = rec[c];
      s[part] = slim;
    }
  }
  return schools;
}

export async function load(ctx: AdapterContext): Promise<AdapterResult> {
  const zip = await ctx.fetchCached(CRDC_FILE.url);
  const retrieved = retrievedOf(zip);
  const schools = await loadCrdcSchools(zip, wanted(ctx));
  const patches: HighSchoolPatch[] = [];
  for (const [id, s] of schools) {
    const p = buildCrdcPatch(id, s);
    if (p) patches.push(p);
  }
  const has = (f: keyof Rigor) => patches.filter((p) => p.values.rigor?.[f] !== null && p.values.rigor?.[f] !== undefined).length;
  return {
    patches,
    sources: { crdc: crdcSourceInfo(retrieved) },
    vintages: { crdc: CRDC_FILE.year },
    notes: [
      `crdc ${CRDC_FILE.year}: ${patches.length} schools; values: enrollment ${has("enrollment")}, AP courses ${has("ap_courses")}, AP enrolled ${has("ap_enrolled")}, IB ${has("ib_enrolled")}, dual ${has("dual_enrolled")}; AP exam takers/passers not collected in this CRDC`,
    ],
  };
}
