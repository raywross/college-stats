/**
 * High school field registry and citations (specs/product/high-school-data.md; the college counterpart is lib/fields.ts
 * and lib/lineage.ts, specs/data-lineage.md).
 *
 * Every value a high school row, state report, or profile detail stores, and every value derived from them, is
 * registered here with its default source and release year. `citeHsField` turns one into a citation the ⓘ popover
 * (`MetricLabel cited=` / `InfoTip cited=`) renders, the same way it renders a college's.
 *
 * Paths:
 *   - stored row fields, as in `HighSchool` ("enrollment.total", "rigor.ap_enrolled"); a stored leaf below a registered
 *     path is covered by its nearest registered ancestor ("grad_rate.low" → "grad_rate");
 *   - `derived.*`: computed from row fields at render time (and for medians), citing their inputs;
 *   - `state.{HsStateField}`: a state report card value, cited to the state file section that lists it;
 *   - `detail.*`: a value from the school's own profile (data/high-schools/detail/{id}.json).
 *
 * Pure module (type-only imports, plus the pure lineage helpers' types), so scripts and tests load it directly.
 */
import type { Cited, CitedSource } from "./lineage";
import type {
  HighSchool,
  HighSchoolDetail,
  HighSchoolMeta,
  HighSchoolView,
  HsReplaced,
  HsSourceInfo,
  HsSourceKey,
  HsStateField,
  HsStateReport,
  HsTopic,
  HsVintageKey,
} from "./high-school-types";

/** `"state-report"`: the school's state file section that lists the field supplies the source and year. */
export type HsFieldSource = HsSourceKey | "state-report";

export interface HsFieldDef {
  label: string;
  topic: HsTopic;
  /** Default source. Public rows' directory and enrollment fields cite CCD; private rows' cite PSS (see citeHsField). */
  source: HsFieldSource;
  /** Which `meta.vintages` year the default source's value describes; null when the value carries its own. */
  vintage: HsVintageKey | null;
  derived?: { formula: string; inputs: readonly string[] };
}

export const HS_STATE_FIELDS: readonly HsStateField[] = [
  "college_going_rate",
  "ap_pass_rate",
  "ela_proficiency",
  "math_proficiency",
  "chronic_absence",
  "nsc_enrolled_fall",
  "nsc_persisted",
  "nsc_completed",
];

const ccdDir = (label: string): HsFieldDef => ({ label, topic: "basics", source: "nces-ccd", vintage: "ccd-directory" });
const ccdEnr = (label: string): HsFieldDef => ({ label, topic: "enrollment", source: "nces-ccd", vintage: "ccd-enrollment" });
const crdc = (label: string): HsFieldDef => ({ label, topic: "rigor", source: "crdc", vintage: "crdc" });
const stateField = (label: string, topic: HsTopic): HsFieldDef => ({ label, topic, source: "state-report", vintage: null });
const profile = (label: string, topic: HsTopic): HsFieldDef => ({ label, topic, source: "hs-profile", vintage: null });

export const HS_FIELDS = {
  // Directory (CCD for public schools; PSS for private ones)
  name: ccdDir("School name"),
  state: ccdDir("State"),
  city: ccdDir("City"),
  zip: ccdDir("ZIP code"),
  address: ccdDir("Address"),
  lat: ccdDir("Latitude"),
  lng: ccdDir("Longitude"),
  locale: ccdDir("Locale"),
  district: ccdDir("School district"),
  state_school_id: ccdDir("State school ID"),
  grades: ccdDir("Grades offered"),
  "status.charter": ccdDir("Charter school"),
  "status.magnet": ccdDir("Magnet school"),
  "status.title_i": ccdDir("Title I school"),
  "status.virtual": ccdDir("Virtual school"),
  school_type: ccdDir("School type"),
  affiliation: { label: "Religious affiliation", topic: "basics", source: "nces-pss", vintage: "pss" },

  // Enrollment and staffing (CCD membership, staff, and lunch files)
  "enrollment.total": ccdEnr("Enrollment"),
  "enrollment.by_grade": ccdEnr("Enrollment by grade"),
  "enrollment.by_race": ccdEnr("Enrollment by race/ethnicity"),
  "enrollment.female": ccdEnr("Female students"),
  student_teacher_ratio: ccdEnr("Student-to-teacher ratio"),
  frl_share: ccdEnr("Free or reduced-price lunch eligible"),

  // Outcomes (EDFacts)
  grad_rate: { label: "Four-year graduation rate", topic: "outcomes", source: "edfacts", vintage: "edfacts-acgr" },
  grad_history: { label: "Four-year graduation rate by class", topic: "outcomes", source: "edfacts", vintage: "edfacts-acgr-history" },

  // Rigor (CRDC)
  "rigor.ap_courses": crdc("AP courses offered"),
  "rigor.ap_enrolled": crdc("Students in an AP course"),
  "rigor.ap_exam_takers": crdc("Students who took an AP exam"),
  "rigor.ap_passed_some": crdc("Students who passed an AP exam"),
  "rigor.ib_enrolled": crdc("Students in the IB program"),
  "rigor.dual_enrolled": crdc("Students in dual enrollment"),
  "rigor.enrollment": crdc("Enrollment (CRDC)"),

  // Derived (computed at render time and for medians; never stored)
  "derived.ap_enrolled_share": {
    label: "Share of students in an AP course",
    topic: "rigor",
    source: "crdc",
    vintage: "crdc",
    derived: { formula: "Students in at least one AP course ÷ enrollment, both from the same CRDC year", inputs: ["rigor.ap_enrolled", "rigor.enrollment"] },
  },
  "derived.ap_pass_share": {
    label: "AP exam takers who passed at least one exam",
    topic: "rigor",
    source: "crdc",
    vintage: "crdc",
    derived: { formula: "Students who passed at least one AP exam ÷ students who took one", inputs: ["rigor.ap_passed_some", "rigor.ap_exam_takers"] },
  },
  "derived.ib_enrolled_share": {
    label: "Share of students in the IB program",
    topic: "rigor",
    source: "crdc",
    vintage: "crdc",
    derived: { formula: "Students in the IB Diploma Programme ÷ enrollment, both from the same CRDC year", inputs: ["rigor.ib_enrolled", "rigor.enrollment"] },
  },
  "derived.dual_enrolled_share": {
    label: "Share of students in dual enrollment",
    topic: "rigor",
    source: "crdc",
    vintage: "crdc",
    derived: { formula: "Students in dual enrollment ÷ enrollment, both from the same CRDC year", inputs: ["rigor.dual_enrolled", "rigor.enrollment"] },
  },

  // State report cards (data/high-schools/state/{xx}.json)
  "state.college_going_rate": stateField("College-going rate", "where-go"),
  "state.ap_pass_rate": stateField("AP pass rate", "rigor"),
  "state.ela_proficiency": stateField("Reading/ELA proficiency", "outcomes"),
  "state.math_proficiency": stateField("Math proficiency", "outcomes"),
  "state.chronic_absence": stateField("Chronic absence", "outcomes"),
  "state.nsc_enrolled_fall": stateField("Enrolled in college the fall after graduating", "where-go"),
  "state.nsc_persisted": stateField("Returned for a second year of college", "where-go"),
  "state.nsc_completed": stateField("Completed a college degree", "where-go"),

  // School profile (data/high-schools/detail/{id}.json)
  "detail.class_size": profile("Senior class size", "basics"),
  "detail.gpa_scale": profile("GPA scale", "grading"),
  "detail.gpa_distribution": profile("GPA distribution", "grading"),
  "detail.ap_courses": profile("AP courses listed", "rigor"),
  "detail.ib_courses": profile("IB courses listed", "rigor"),
  "detail.scores": profile("SAT/ACT scores", "outcomes"),
  "detail.matriculation": profile("Where graduates enrolled", "where-go"),
  "detail.admitted": profile("Colleges that admitted graduates", "where-go"),
  "detail.school_outcomes": profile("Graduating class outcomes (school-reported)", "outcomes"),
  "detail.ap_stats": profile("AP exam results (school-reported)", "rigor"),
  "detail.enrollment": profile("Enrollment (school-reported)", "enrollment"),
} as const satisfies Record<string, HsFieldDef>;

export type HsFieldPath = keyof typeof HS_FIELDS;

export function isHsFieldPath(path: string): path is HsFieldPath {
  return Object.prototype.hasOwnProperty.call(HS_FIELDS, path);
}

/** `state.college_going_rate` for `college_going_rate`. */
export function stateFieldPath(field: HsStateField): HsFieldPath {
  return `state.${field}` as HsFieldPath;
}

/** The registered path covering a stored leaf ("grad_rate.low" → "grad_rate"), or null when nothing covers it. */
export function registeredHsPathFor(path: string): HsFieldPath | null {
  for (let p = path; p; p = p.includes(".") ? p.slice(0, p.lastIndexOf(".")) : "") {
    if (isHsFieldPath(p)) return p;
  }
  return null;
}

/** Release year used when a row's lineage names a source without a year. */
export const HS_SOURCE_VINTAGE: Record<HsSourceKey, HsVintageKey | null> = {
  "nces-ccd": "ccd-directory",
  edfacts: "edfacts-acgr",
  crdc: "crdc",
  "nces-pss": "pss",
  "hs-profile": null,
  "state-ca": null,
  "state-tx": null,
  "state-ny": null,
  "state-fl": null,
  "state-il": null,
  "state-sc": null,
  "state-ct": null,
};

export const HS_SOURCE_KEYS = Object.keys(HS_SOURCE_VINTAGE) as HsSourceKey[];

export function isHsSourceKey(key: string): key is HsSourceKey {
  return Object.prototype.hasOwnProperty.call(HS_SOURCE_VINTAGE, key);
}

/** `state-ca` for "CA"; null for a state without a report card adapter. */
export function stateSourceKey(usps: string): HsSourceKey | null {
  const key = `state-${usps.toLowerCase()}`;
  return isHsSourceKey(key) ? key : null;
}

/* ------------------------------------------------------------------ */
/* Citations                                                           */
/* ------------------------------------------------------------------ */

export type HsCitedSource = CitedSource<HsSourceKey>;
export type HsCited = Cited<HsSourceKey, HsFieldPath>;

/** What a citation can draw on besides the row: the school's merged state report and its profile detail. */
export interface HsCiteExtras {
  stateReport?: HsStateReport | null;
  detail?: HighSchoolDetail | null;
  /** What the school's newer profile replaced (HighSchoolView.replaced). */
  replaced?: Partial<Record<string, HsReplaced>> | null;
}

/** A source's entry in meta, or a neutral placeholder (code can ship before the data that adds the source). */
export function hsSourceInfo(meta: HighSchoolMeta, key: HsSourceKey): HsSourceInfo {
  return meta.sources[key] ?? { name: "Source being published", publisher: "Updating now", url: "/data", retrieved: meta.generated };
}

/** The default source of a stored field for this row: private rows' CCD fields come from PSS. */
function defaultSource(def: HsFieldDef, row: Pick<HighSchool, "kind">): { key: HsSourceKey; vintage: HsVintageKey | null } | null {
  if (def.source === "state-report") return null;
  if (row.kind === "private" && def.source === "nces-ccd") return { key: "nces-pss", vintage: "pss" };
  return { key: def.source, vintage: def.vintage };
}

function stateSection(path: string, report: HsStateReport | null | undefined) {
  if (!path.startsWith("state.") || !report) return null;
  const field = path.slice("state.".length) as HsStateField;
  return report.sections.find((s) => s.fields.includes(field)) ?? null;
}

const QUOTED_DETAIL: Partial<Record<HsFieldPath, (d: HighSchoolDetail) => { quote?: string; page?: number } | null | undefined>> = {
  "detail.class_size": (d) => d.class_size,
  "detail.gpa_scale": (d) => d.gpa_scale,
  "detail.scores": (d) => d.scores,
  "detail.matriculation": (d) => d.matriculation,
  "detail.admitted": (d) => d.admitted,
  "detail.school_outcomes": (d) => d.school_outcomes,
  "detail.ap_stats": (d) => d.ap_stats,
  "detail.enrollment": (d) => d.enrollment,
};

/** Profile values that describe a year other than the profile's edition (last year's scores, the graduating class). */
const DETAIL_YEAR: Partial<Record<HsFieldPath, (d: HighSchoolDetail) => string | null | undefined>> = {
  "detail.scores": (d) => d.scores?.year,
  "detail.admitted": (d) => d.admitted?.classes,
  "detail.matriculation": (d) => d.matriculation?.classes,
  "detail.school_outcomes": (d) => d.school_outcomes?.class,
  "detail.ap_stats": (d) => d.ap_stats?.year,
  "detail.enrollment": (d) => d.enrollment?.year,
};

function placeholder(row: Pick<HighSchool, "state">, path: HsFieldPath, meta: HighSchoolMeta, what: string): HsCitedSource {
  const key = path.startsWith("state.") ? (stateSourceKey(row.state) ?? "nces-ccd") : "hs-profile";
  return { key, label: what, publisher: what, year: null, url: "/data", retrieved: meta.generated };
}

/** The source behind one non-derived path for one school. */
function hsSourceFor(path: HsFieldPath, row: HighSchool, meta: HighSchoolMeta, extras: HsCiteExtras): HsCitedSource {
  const def: HsFieldDef = HS_FIELDS[path];
  // A newer figure from the school's own profile (applyProfileNewest) cites the profile, with the figure's own year.
  const fromProfile = row.lineage?.[path];
  if (fromProfile?.source === "hs-profile" && extras.detail) {
    const d = extras.detail;
    return {
      key: "hs-profile",
      label: `${row.name} school profile ${d.profile.edition}`,
      publisher: row.name,
      year: fromProfile.year ?? d.profile.edition,
      url: fromProfile.url ?? d.profile.url,
      retrieved: fromProfile.retrieved ?? d.profile.retrieved,
    };
  }
  if (def.source === "state-report") {
    const section = stateSection(path, extras.stateReport);
    if (!section) return placeholder(row, path, meta, "Not reported by the state");
    const info = meta.sources[section.source];
    return { key: section.source, label: section.label, publisher: info?.publisher ?? section.label, year: section.year, url: section.url, retrieved: section.retrieved };
  }
  if (def.source === "hs-profile") {
    const d = extras.detail;
    if (!d) return placeholder(row, path, meta, "No school profile");
    return {
      key: "hs-profile",
      label: `${row.name} school profile ${d.profile.edition}`,
      publisher: row.name,
      year: DETAIL_YEAR[path]?.(d) || d.profile.edition,
      url: d.profile.url,
      retrieved: d.profile.retrieved,
    };
  }
  const rec = row.lineage?.[path];
  const dflt = defaultSource(def, row)!;
  const key = rec?.source ?? dflt.key;
  const info = hsSourceInfo(meta, key);
  const vintage = rec ? HS_SOURCE_VINTAGE[key] : dflt.vintage;
  return {
    key,
    label: info.name,
    publisher: info.publisher,
    year: rec?.year !== undefined ? rec.year : vintage ? (meta.vintages[vintage] ?? null) : null,
    url: rec?.url ?? info.url,
    retrieved: rec?.retrieved ?? info.retrieved,
  };
}

const sourceId = (s: HsCitedSource) => `${s.key}|${s.url}|${s.year ?? ""}`;

function inputSources(path: HsFieldPath, row: HighSchool, meta: HighSchoolMeta, extras: HsCiteExtras, seen = new Set<string>()): HsCitedSource[] {
  const def: HsFieldDef = HS_FIELDS[path];
  if (!def.derived || seen.has(path)) return [hsSourceFor(path, row, meta, extras)];
  seen.add(path);
  const out = new Map<string, HsCitedSource>();
  for (const input of def.derived.inputs) {
    if (!isHsFieldPath(input)) continue;
    for (const s of inputSources(input, row, meta, extras, seen)) out.set(sourceId(s), s);
  }
  return [...out.values()];
}

/**
 * Full citation for one value of one high school, ready for `MetricLabel cited=` / `InfoTip cited=`.
 * State report paths need `extras.stateReport` and profile paths `extras.detail` (both on a HighSchoolView: see
 * citeHsView); without them the citation is a "not reported" placeholder, so cite only values that are shown.
 */
export function citeHsField(path: HsFieldPath, row: HighSchool, meta: HighSchoolMeta, extras: HsCiteExtras = {}): HsCited {
  const def: HsFieldDef = HS_FIELDS[path];
  if (def.derived) {
    const inputs = inputSources(path, row, meta, extras);
    const top = inputs.length === 1 ? inputs[0] : hsSourceFor(path, row, meta, extras);
    return { ...top, path, field: def.label, method: "derived", isDefault: def.derived.inputs.every((i) => !row.lineage?.[i]), formula: def.derived.formula, inputs };
  }
  const own = row.lineage?.[path];
  // State and profile paths take their source from the state file / profile, unless a newer profile figure replaced
  // the value (then its lineage record, source "hs-profile", is the citation).
  const rec = def.source === "state-report" || def.source === "hs-profile" ? (own?.source === "hs-profile" ? own : undefined) : own;
  const quoted = def.source === "hs-profile" && extras.detail ? QUOTED_DETAIL[path]?.(extras.detail) : undefined;
  const replaces = extras.replaced?.[path];
  return {
    ...hsSourceFor(path, row, meta, extras),
    path,
    field: def.label,
    method: rec?.method ?? (def.source === "hs-profile" ? "extracted" : "reported"),
    isDefault: !rec,
    ...(rec?.quote ? { quote: rec.quote } : quoted?.quote ? { quote: quoted.quote } : {}),
    ...(rec?.page !== undefined ? { page: rec.page } : quoted?.page !== undefined ? { page: quoted.page } : {}),
    ...(replaces ? { replaces: { value: replaces.value, year: replaces.year, label: replaces.label, display: replaces.display } } : {}),
  };
}

/** citeHsField with everything a page has. */
export function citeHsView(path: HsFieldPath, view: Pick<HighSchoolView, "school" | "state_report" | "detail" | "meta" | "replaced">): HsCited {
  return citeHsField(path, view.school, view.meta, { stateReport: view.state_report, detail: view.detail, replaced: view.replaced });
}

/* ------------------------------------------------------------------ */
/* Values and footnotes                                                */
/* ------------------------------------------------------------------ */

function at(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const share = (num: unknown, den: unknown): number | null =>
  typeof num === "number" && typeof den === "number" && den > 0 ? Math.min(1, num / den) : null;

/** Derived values, from the row alone (no mixed sources: each pairs counts from one CRDC year). */
export const HS_DERIVED: Record<Extract<HsFieldPath, `derived.${string}`>, (row: HighSchool) => number | null> = {
  "derived.ap_enrolled_share": (r) => share(r.rigor?.ap_enrolled, r.rigor?.enrollment),
  "derived.ap_pass_share": (r) => share(r.rigor?.ap_passed_some, r.rigor?.ap_exam_takers),
  "derived.ib_enrolled_share": (r) => share(r.rigor?.ib_enrolled, r.rigor?.enrollment),
  "derived.dual_enrolled_share": (r) => share(r.rigor?.dual_enrolled, r.rigor?.enrollment),
};

/** The value at a path for one school (derived values computed), or undefined/null when it has none. */
export function hsValueAt(path: HsFieldPath, row: HighSchool, extras: HsCiteExtras = {}): unknown {
  // Missing is null, never undefined (specs/data-lineage.md rule 5), including a leaf under a null block (a private
  // school's `rigor`) or a state/detail field the school has no file for.
  if (path.startsWith("derived.")) return HS_DERIVED[path as keyof typeof HS_DERIVED](row) ?? null;
  if (path.startsWith("state.")) return extras.stateReport?.values[path.slice("state.".length) as HsStateField] ?? null;
  if (path.startsWith("detail.")) return (extras.detail ? at(extras.detail, path.slice("detail.".length)) : null) ?? null;
  return at(row, path) ?? null;
}

/** Whether the school's value at a path was suppressed (small cell or the source's own privacy rule). */
export function isHsSuppressed(path: HsFieldPath, row: HighSchool, extras: HsCiteExtras = {}): boolean {
  if (path.startsWith("state.")) return !!extras.stateReport?.suppressed.includes(path.slice("state.".length) as HsStateField);
  if (row.suppressed?.includes(path)) return true;
  const def: HsFieldDef = HS_FIELDS[path];
  return !!def.derived && def.derived.inputs.some((i) => row.suppressed?.includes(i));
}

/**
 * Distinct sources behind the values a section shows, for its footnote: only paths this school has a value for (or a
 * suppressed cell); derived values expand to their inputs' sources.
 */
export function hsSourcesForFields(paths: readonly HsFieldPath[], row: HighSchool, meta: HighSchoolMeta, extras: HsCiteExtras = {}): HsCitedSource[] {
  const out = new Map<string, HsCitedSource>();
  for (const p of paths) {
    const v = hsValueAt(p, row, extras);
    if ((v === null || v === undefined) && !isHsSuppressed(p, row, extras)) continue;
    for (const s of inputSources(p, row, meta, extras)) out.set(sourceId(s), s);
  }
  return [...out.values()];
}

/** Registry problems: derived inputs that aren't registered, or derivations that loop. Run by tests and check:lineage. */
export function validateHsRegistry(): string[] {
  const problems: string[] = [];
  for (const [path, def] of Object.entries(HS_FIELDS) as [HsFieldPath, HsFieldDef][]) {
    if (path.startsWith("derived.") !== !!def.derived) problems.push(`hs-fields ${path}: derived.* paths and only they have a formula`);
    for (const i of def.derived?.inputs ?? []) if (!isHsFieldPath(i)) problems.push(`hs-fields ${path}: input ${i} isn't registered`);
    if (path.startsWith("state.") !== (def.source === "state-report")) problems.push(`hs-fields ${path}: state.* paths and only they cite the state report`);
    if (path.startsWith("detail.") !== (def.source === "hs-profile")) problems.push(`hs-fields ${path}: detail.* paths and only they cite the school profile`);
    if (path.startsWith("derived.") && !(path in HS_DERIVED)) problems.push(`hs-fields ${path}: no calculation in HS_DERIVED`);
  }
  for (const f of HS_STATE_FIELDS) if (!isHsFieldPath(`state.${f}`)) problems.push(`hs-fields: state.${f} isn't registered`);
  return problems;
}
