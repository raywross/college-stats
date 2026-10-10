/**
 * Lineage: where each value came from. Pure functions over (school, meta) so the
 * sync script, the checker, tests, and the app all resolve citations the same way.
 * See specs/data-lineage.md.
 */
import type { AdmissionFactor, DatasetMeta, FactorUse, FederalAdmissions, LineageRecord, ReportedSourceKind, School, SourceInfo, SourceKey } from "./types";
import type { HsSourceKey } from "./high-school-types";
import { validateAdmissionProfile } from "./cds/admissions.ts";
import { FIELDS, METADATA_KEYS, PER_DOCUMENT_SOURCES, REPORTED_PATHS, UNDATED_SOURCES, isFieldPath, registeredPathFor, type FieldPath, type VintageKey } from "./fields.ts";
import { NEWEST_TARGETS, newestGroupCitation, validateNewestGroups } from "./newest-groups.ts";
import { replacedTest, satTotalInputs, validateTests } from "./cds/test-blocks.ts";
import { satTotal } from "./score-bands.ts";
import { financialAidProblems } from "./cds/financial-aid.ts";

/** Any source key a citation can carry: a college source (lib/fields.ts) or a high school source (lib/hs-fields.ts). */
export type AnySourceKey = SourceKey | HsSourceKey;

/**
 * A source as cited for one value: plain data, safe to pass to client components. `K` defaults to the college
 * sources; high school citations (lib/hs-fields.ts `citeHsField`) use `HsSourceKey`. Display code that serves both
 * (the ⓘ popover, source footnotes) takes `AnyCitedSource` / `AnyCited`.
 */
export interface CitedSource<K extends AnySourceKey = SourceKey> {
  key: K;
  label: string;
  publisher: string;
  /** Display year; null when the release has no single year (shown as "most recent release"). */
  year: string | null;
  url: string;
  retrieved: string;
}

export interface Cited<K extends AnySourceKey = SourceKey, P extends string = FieldPath> extends CitedSource<K> {
  path: P;
  /** Field label, e.g. "Acceptance rate". */
  field: string;
  method: NonNullable<LineageRecord["method"]>;
  /** False when this school's value came from somewhere other than the field's default source. */
  isDefault: boolean;
  formula?: string;
  /** Derived values: the distinct sources of their inputs. */
  inputs?: CitedSource<K>[];
  quote?: string;
  page?: number;
  /**
   * For a funnel value that a newer college-reported class replaced: the previous (federal or hand-imported CDS)
   * value and the year it describes, from `admissions.federal`, so the tooltip can say "Federal data, fall 2024: 5.8%".
   */
  replaces?: {
    value: number | Record<string, number> | null;
    year: string | null;
    /** Whose figure it was, when not the federal one: "Cornell University Common Data Set" (`aid.cds_previous`). */
    label?: string;
    /** The replaced value as text, when it isn't a number (a test policy). */
    text?: string;
    /** The replaced value already formatted (e.g. a share as "77%"), when the path alone can't say how. */
    display?: string;
  };
  /** For a value reported by the college itself (source "college-site"): which kind of document supplied it. */
  sourceKind?: ReportedSourceKind;
  /** For a value from a college's Common Data Set record: its edition, "2025–26" (the year is the value's own). */
  cdsEdition?: string;
  /** The same document named in full, "Common Data Set 2025–26", for lines that spell out the document. */
  document?: string;
  /**
   * A listing from someone else's list (specs/campus-directories.md; lib/directories.ts `citeListing`): who compiled
   * it, its tier, and what that tier means. The ⓘ credits the organization and the date read (owner decision 4).
   */
  directory?: { organization: string; tier: "B" | "C" | "D"; phrase: string };
  /** A freely licensed image shown beside the value (an organization's logo from Wikimedia Commons), credited as its license asks. */
  image?: { what: string; attribution: string; license: string; source: string };
}

/** A citation of either kind (college or high school), for display components that render both. */
export type AnyCitedSource = CitedSource<AnySourceKey>;
export type AnyCited = Cited<AnySourceKey, string>;

/**
 * Identity values found on the college's own site (a visit link, a footer account, its icon; specs/school-identity/):
 * they come from its homepage or admissions page, never from the admissions document `reported.admissions` names.
 */
const IDENTITY_PATH = /^(links|social|brand)\./;

/** The funnel paths `applyNewest` may replace, keyed to their `admissions.federal` counterparts. */
const FEDERAL_COUNTERPART: Partial<Record<FieldPath, keyof FederalAdmissions>> = {
  "admissions.applicants": "applicants",
  "admissions.admitted": "admitted",
  "admissions.enrolled": "enrolled",
  "admissions.acceptance_rate": "acceptance_rate",
};

/** Release year used when a school's lineage names a source without a year. */
const SOURCE_VINTAGE: Record<SourceKey, VintageKey | null> = {
  scorecard: "scorecard-latest",
  "ipeds-adm": "ipeds-adm",
  "ipeds-sfa": "ipeds-sfa",
  "ipeds-ic": "ipeds-ic",
  "ipeds-hd": "ipeds-hd",
  "ipeds-ic-char": "ipeds-ic-char",
  "ipeds-ef": "ipeds-ef",
  "ipeds-om": "ipeds-om",
  "ipeds-gr": "ipeds-gr",
  "ipeds-sal": "ipeds-sal",
  "ipeds-ef-c": "ipeds-ef-c",
  "ipeds-ef-a": "ipeds-ef-a",
  "ipeds-c": "ipeds-c",
  "ipeds-f": "ipeds-f",
  "scorecard-fos": "scorecard-fos",
  // A hand-kept table; each value's lineage record carries the statute and its effective date.
  "state-law": null,
  // Directories, organization estimates, and policy pages: each listing or check carries its own list or page and date.
  directory: null,
  "org-estimate": null,
  "policy-page": null,
  cds: null,
  "college-site": null,
  // Undated references (UNDATED_SOURCES): the retrieval date in meta.json's edition stands in for a year.
  wikidata: null,
  wikipedia: null,
};

/**
 * A source's entry in meta, or a neutral placeholder. Production can build new code before the publish that adds the
 * code's new source finishes (Vercel and "Publish data" run at once); pages then render with the placeholder, and the
 * workflow's revalidation after the publish and after the deploy replaces them. Never throws.
 */
export function sourceInfo(meta: DatasetMeta, key: SourceKey): SourceInfo {
  return (
    meta.sources[key] ?? {
      label: "Source being published",
      publisher: "Updating now",
      edition: "Publishing",
      url: "/data#sources",
      description: "This source's details are being published and will appear shortly.",
    }
  );
}

function sourceFor(path: FieldPath, school: School | undefined, meta: DatasetMeta): CitedSource {
  const def = FIELDS[path];
  const rec = school?.lineage?.[path];
  const key = rec?.source ?? def.source;
  const info = sourceInfo(meta, key);
  if (key === "cds" && school?.cds) {
    return {
      key,
      label: `${school.name} Common Data Set`,
      publisher: school.name,
      year: rec?.year ?? school.cds.edition,
      url: rec?.url ?? school.cds.url,
      retrieved: rec?.retrieved ?? meta.retrieved,
    };
  }
  if (key === "college-site" && school) {
    // The college's own page or file; the record names the document (validateSchool requires url, year, quote).
    return {
      key,
      // A CDS record value (round 3) names its document's edition; the year after it is the value's own.
      label: rec?.edition ? `${school.name} Common Data Set ${rec.edition}` : `${school.name} (${rec?.year ?? "college-reported"})`,
      publisher: school.name,
      year: rec?.year ?? null,
      url: rec?.url ?? info.url,
      retrieved: rec?.retrieved ?? meta.retrieved,
    };
  }
  const vintage = rec ? SOURCE_VINTAGE[key] : def.vintage;
  return {
    key,
    label: info.label,
    publisher: info.publisher,
    year: rec?.year !== undefined ? rec.year : vintage ? meta.vintages[vintage] ?? null : null,
    url: rec?.url ?? info.url,
    retrieved: rec?.retrieved ?? meta.retrieved,
  };
}

/** "Fall 2024", or "most recent release" when a source has no single year. */
export function yearLabel(s: Pick<AnyCitedSource, "year">): string {
  return s.year ?? "most recent release";
}

/**
 * Whether a citation names a year at all. Undated references (UNDATED_SOURCES: Wikidata, Wikipedia) have no release
 * to name; the retrieval date shown with them dates them, so "Wikidata, most recent release" would only mislead.
 */
export function citesYear(s: Pick<AnyCitedSource, "key" | "year">): boolean {
  return s.year !== null || !(UNDATED_SOURCES as ReadonlySet<string>).has(s.key);
}

/** Compact name for a chip: "CDS 2024-25", "IPEDS Fall 2024", "Scorecard". */
export function shortSource(s: CitedSource): string {
  const name =
    s.key === "cds"
      ? "CDS"
      : s.key === "college-site"
        ? "College"
        : s.key === "state-law"
          ? "State law"
          : s.key === "wikidata"
            ? "Wikidata"
            : s.key === "wikipedia"
              ? "Wikipedia"
              : s.key === "directory" || s.key === "org-estimate"
                ? "Directories"
                : s.key === "policy-page"
                  ? "Policy page"
                  : s.key === "scorecard" || s.key === "scorecard-fos"
                    ? "Scorecard"
                    : "IPEDS";
  return s.year ? `${name} ${s.year}` : name;
}

const sourceId = (s: CitedSource) => `${s.key}|${s.url}|${s.year ?? ""}`;

/** Sources a college either has a value from (with its own lineage record) or has nothing to cite from. */
const PER_COLLEGE_ONLY: ReadonlySet<SourceKey> = new Set<SourceKey>(["college-site", "state-law", "directory", "org-estimate", "policy-page"]);

/** Distinct sources behind a value: a derived value cites its inputs, recursively. */
function underlyingSources(path: FieldPath, school: School | undefined, meta: DatasetMeta, seen = new Set<string>()): CitedSource[] {
  const def = FIELDS[path] as (typeof FIELDS)[FieldPath];
  const overridden = !!school?.lineage?.[path];
  // A college-reported field or state law this college has no value for (no lineage record) has nothing to cite.
  if (school && !overridden && PER_COLLEGE_ONLY.has(def.source) && !("derived" in def && def.derived)) return [];
  if (!("derived" in def) || !def.derived || overridden || seen.has(path)) return [sourceFor(path, school, meta)];
  seen.add(path);
  const out = new Map<string, CitedSource>();
  for (const input of inputsUsed(path, def.derived.inputs, school)) {
    if (!isFieldPath(input)) continue;
    for (const s of underlyingSources(input, school, meta, seen)) out.set(sourceId(s), s);
  }
  return [...out.values()];
}

/**
 * The inputs a derived value actually used for this school. Yield (lib/metrics.ts#yieldRate) uses the shown enrolled
 * and admitted when they describe the same class (same lineage year), else the previous class's pair in
 * `admissions.federal`; every other derived value uses all its registered inputs.
 */
function inputsUsed(path: FieldPath, inputs: readonly string[], school: School | undefined): readonly string[] {
  if (path === "derived.sat_total") return satTotalInputs(school);
  if (path === "derived.gpa_estimate" && school) return gpaEstimateInputs(school);
  if (path !== "derived.yield") return inputs;
  const sameClass = school?.lineage?.["admissions.enrolled"]?.year === school?.lineage?.["admissions.admitted"]?.year;
  return sameClass || !school?.admissions?.federal ? inputs.filter((i) => i !== "admissions.federal") : ["admissions.federal"];
}

/**
 * The inputs `derived.gpa_estimate` used at this college (lib/planner/gpa-model.ts satMidpoint, collegeGpa): its SAT
 * total, else its ACT composite; its admit rate; and the weighted average that bounded it, when it publishes one.
 */
function gpaEstimateInputs(school: School): FieldPath[] {
  const out: FieldPath[] = [];
  if (satTotal(school)) out.push("derived.sat_total");
  else if (school.admissions?.act_composite_25_75) out.push("admissions.act_composite_25_75");
  out.push("admissions.acceptance_rate");
  if (school.reported?.admission_profile?.gpa?.average != null) out.push("reported.admission_profile.gpa.average");
  return out;
}

/** True when a value and everything it's calculated from use their fields' default sources. */
function usesDefaults(path: FieldPath, school: School | undefined, seen = new Set<string>()): boolean {
  if (school?.lineage?.[path]) return false;
  const def = FIELDS[path] as (typeof FIELDS)[FieldPath];
  if (!("derived" in def) || !def.derived || seen.has(path)) return true;
  seen.add(path);
  return inputsUsed(path, def.derived.inputs, school).every((i) => !isFieldPath(i) || usesDefaults(i, school, seen));
}

/** Full citation for one value of one school (or the dataset default without a school). */
export function lineageFor(path: FieldPath, school: School | undefined, meta: DatasetMeta): Cited {
  const def = FIELDS[path] as (typeof FIELDS)[FieldPath];
  const rec = school?.lineage?.[path];
  const derived = "derived" in def ? def.derived : undefined;
  const inputs = derived ? underlyingSources(path, school, meta) : undefined;
  return {
    ...(derived && !rec && inputs?.length === 1 ? inputs[0] : sourceFor(path, school, meta)),
    path,
    field: def.label,
    method: rec?.method ?? (derived ? "derived" : "reported"),
    // A derived value from non-default inputs (e.g. yield from a CDS's counts) is non-default too.
    isDefault: usesDefaults(path, school),
    ...(derived ? { formula: derived.formula, inputs } : {}),
    ...(rec?.quote ? { quote: rec.quote } : {}),
    ...(rec?.page !== undefined ? { page: rec.page } : {}),
    ...replacedBy(path, school, meta),
    // A round-3 record value names its CDS edition (its year is the item's own, e.g. next year's price); the
    // admissions block's document kind applies only to values without one.
    ...(rec?.source === "college-site" && rec.edition
      ? { sourceKind: "cds" as const, cdsEdition: rec.edition, document: `Common Data Set ${rec.edition}` }
      : rec?.source === "college-site" && school?.reported?.admissions && !IDENTITY_PATH.test(path)
        ? { sourceKind: school.reported.admissions.source_kind }
        : {}),
    ...newestGroupCitation(path, school),
    ...replacedFactor(path, school, meta),
    ...replacedTestBy(path, school, meta),
  };
}

/** The previous test value a newer CDS block replaced (`admissions.federal_tests`; lib/cds/test-blocks.ts). */
function replacedTestBy(path: FieldPath, school: School | undefined, meta: DatasetMeta): Pick<Cited, "replaces"> {
  const r = replacedTest(path, school);
  return r ? { replaces: { value: r.value, year: r.year ?? meta.vintages["ipeds-adm"] ?? null, text: r.text } } : {};
}

/** The federal value a college-reported funnel value replaced, when the school keeps one (`admissions.federal`). */
function replacedBy(path: FieldPath, school: School | undefined, meta: DatasetMeta): Pick<Cited, "replaces"> {
  const key = FEDERAL_COUNTERPART[path];
  const federal = school?.admissions?.federal;
  if (!key || !federal || school?.lineage?.[path]?.source !== "college-site") return {};
  // A hand-imported CDS override's values carry its edition (lineage on admissions.federal); federal ones, the fall.
  const year = school?.lineage?.["admissions.federal"]?.year ?? (federal.year !== null ? `Fall ${federal.year}` : (meta.vintages["ipeds-adm"] ?? null));
  return { replaces: { value: federal[key], year } };
}

/** A federal factor answer a newer CDS C7 replaced (`admissions.federal_factors`; lib/cds/admissions.ts). */
function replacedFactor(path: FieldPath, school: School | undefined, meta: DatasetMeta): Pick<Cited, "replaces"> | Record<string, never> {
  if (!path.startsWith("admissions.factors.") || school?.lineage?.[path]?.source !== "college-site") return {};
  const key = path.slice("admissions.factors.".length) as AdmissionFactor;
  const federal = school.admissions.federal_factors;
  if (!federal || !(key in federal)) return {};
  return { replaces: { value: null, label: FACTOR_USE_WORDS[federal[key] ?? "not_considered"], year: meta.vintages["ipeds-adm"] ?? null } };
}
const FACTOR_USE_WORDS: Record<FactorUse, string> = { required: "required", considered: "considered", not_considered: "not considered" };

/** Distinct sources behind a set of values (section footnotes), in first-seen order. */
export function sourcesForFields(paths: readonly FieldPath[], school: School | undefined, meta: DatasetMeta): CitedSource[] {
  const out = new Map<string, CitedSource>();
  for (const p of paths) for (const s of underlyingSources(p, school, meta)) out.set(sourceId(s), s);
  return [...out.values()];
}

/* ------------------------------------------------------------------ */
/* Validation (run by the sync before writing, and by check:lineage)   */
/* ------------------------------------------------------------------ */

export const VINTAGE_KEYS: readonly VintageKey[] = [
  "ipeds-adm",
  "ipeds-sfa",
  "ipeds-ic",
  "ipeds-hd",
  "ipeds-ic-char",
  "ipeds-ef",
  "ipeds-om",
  "ipeds-gr",
  "ipeds-sal",
  "ipeds-ef-c",
  "ipeds-ef-a",
  "ipeds-c",
  "ipeds-f",
  "scorecard-enrollment",
  "scorecard-age",
  "scorecard-cost",
  "scorecard-retention",
  "scorecard-latest",
  "scorecard-fos",
];
/** Releases that must resolve to a year (the rest may be null). */
const YEAR_REQUIRED: readonly VintageKey[] = ["ipeds-adm", "ipeds-sfa", "ipeds-ic", "ipeds-hd", "ipeds-ic-char", "ipeds-ef", "ipeds-ef-c", "ipeds-ef-a", "ipeds-c", "ipeds-gr", "ipeds-sal", "ipeds-f", "scorecard-enrollment", "scorecard-age", "scorecard-cost", "ipeds-om"];
const METHODS = new Set(["reported", "derived", "extracted"]);

/** Fields read from the hand-kept state-law table (data/state-laws.json). */
const STATE_LAW_PATHS = (Object.keys(FIELDS) as FieldPath[]).filter((p) => FIELDS[p].source === "state-law");
/** Stored fields summarizing national directories (school.directories); detail tables are checked in lib/detail.ts. */
const DIRECTORY_PATHS = (Object.keys(FIELDS) as FieldPath[]).filter((p) => (FIELDS[p].source === "directory" || FIELDS[p].source === "org-estimate") && !p.startsWith("detail."));
/** Tier A facts the campus-life pilot checked on a college's own page (lgbtq-life.md "Inclusive policies"); the
 * `campus_pages` detail table is checked in lib/detail.ts, so this is only the top-level `lgbtq.policies` copy. */
const POLICY_PAGE_PATHS = (Object.keys(FIELDS) as FieldPath[]).filter((p) => FIELDS[p].source === "policy-page" && !p.startsWith("detail."));

/** Every stored leaf path of a school, e.g. "demographics.racial_diversity.asian". Arrays and null are leaves; undefined isn't stored. */
export function leafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || (!prefix && METADATA_KEYS.has(k))) continue;
    out.push(...leafPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

function valueAt(school: School, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), school);
}

/** Problems with the registry itself or its fit with meta.json. */
export function validateRegistry(meta: DatasetMeta): string[] {
  const errors: string[] = [];
  // The app tolerates a missing source mid-publish (sourceInfo); a written dataset must have every one.
  for (const k of Object.keys(SOURCE_VINTAGE) as SourceKey[]) {
    const s = meta.sources?.[k];
    if (!s) errors.push(`meta.json: sources.${k} is missing`);
    else if (!s.label || !s.url) errors.push(`meta.json: sources.${k} has no label or url`);
  }
  for (const k of VINTAGE_KEYS) {
    if (!(k in (meta.vintages ?? {}))) errors.push(`meta.json: vintages.${k} is missing`);
    else if (YEAR_REQUIRED.includes(k) && !meta.vintages[k]) errors.push(`meta.json: vintages.${k} has no year`);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (p: string, trail: string[]) => {
    if (done.has(p)) return;
    if (visiting.has(p)) {
      errors.push(`fields.ts: circular derivation ${[...trail, p].join(" → ")}`);
      return;
    }
    visiting.add(p);
    const def = FIELDS[p as FieldPath] as (typeof FIELDS)[FieldPath];
    if ("derived" in def && def.derived) for (const i of def.derived.inputs) if (isFieldPath(i)) visit(i, [...trail, p]);
    visiting.delete(p);
    done.add(p);
  };
  for (const [path, def] of Object.entries(FIELDS) as [FieldPath, (typeof FIELDS)[FieldPath]][]) {
    if (!(def.source in meta.sources)) errors.push(`fields.ts: ${path} uses unknown source "${def.source}"`);
    if (def.vintage && !VINTAGE_KEYS.includes(def.vintage)) errors.push(`fields.ts: ${path} uses unknown vintage "${def.vintage}"`);
    if (!PER_DOCUMENT_SOURCES.has(def.source) && !UNDATED_SOURCES.has(def.source) && !def.vintage && !("derived" in def)) errors.push(`fields.ts: ${path} has no vintage`);
    if ("derived" in def && def.derived) {
      if (!def.derived.inputs.length) errors.push(`fields.ts: ${path} is derived but lists no inputs`);
      for (const i of def.derived.inputs) if (!isFieldPath(i)) errors.push(`fields.ts: ${path} input "${i}" isn't a registered field`);
    }
    if ("computed" in def && !path.startsWith("derived.")) errors.push(`fields.ts: computed field ${path} must live under "derived."`);
    visit(path, []);
  }
  return errors;
}

/** Problems with one school's stored values and lineage. */
export function validateSchool(school: School, meta: DatasetMeta): string[] {
  const errors: string[] = [];
  const where = `${school.name} (${school.unit_id})`;
  for (const leaf of leafPaths(school)) {
    const p = registeredPathFor(leaf);
    if (!p) errors.push(`${where}: "${leaf}" isn't registered in lib/fields.ts`);
    else if ("computed" in FIELDS[p]) errors.push(`${where}: "${leaf}" is stored, but ${p} is computed at render time`);
  }
  for (const [path, rec] of Object.entries(school.lineage ?? {}) as [string, LineageRecord | undefined][]) {
    if (!rec) continue;
    if (!isFieldPath(path)) {
      errors.push(`${where}: lineage for unregistered field "${path}"`);
      continue;
    }
    if ("computed" in FIELDS[path]) errors.push(`${where}: lineage for computed field "${path}"`);
    if (!(rec.source in meta.sources)) errors.push(`${where}: ${path} lineage has unknown source "${rec.source}"`);
    if (rec.method && !METHODS.has(rec.method)) errors.push(`${where}: ${path} lineage has unknown method "${rec.method}"`);
    if (valueAt(school, path) === undefined) errors.push(`${where}: lineage for ${path}, which has no value`);
    if (rec.source === "cds") {
      if (!school.cds) errors.push(`${where}: ${path} cites a Common Data Set but the school has no "cds" record`);
      if (!(rec.url ?? school.cds?.url) || !(rec.year ?? school.cds?.edition)) errors.push(`${where}: ${path} CDS lineage needs a URL and edition`);
    }
    if (rec.method === "extracted" && (!rec.quote || !rec.url || !rec.retrieved || !rec.year)) {
      errors.push(`${where}: ${path} is extracted but lacks quote, url, retrieved, or year`);
    }
    // A value computed from a college's printed figures (a share from two CDS counts) cites them the same way.
    if (rec.source === "college-site" && rec.method === "derived" && (!rec.quote || !rec.url || !rec.retrieved || !rec.year)) {
      errors.push(`${where}: ${path} is derived from the college's document but lacks quote, url, retrieved, or year`);
    }
  }
  if (school.cds && !Object.values(school.lineage ?? {}).some((r) => r?.source === "cds")) {
    errors.push(`${where}: has a "cds" record but no field cites it`);
  }
  // College-reported values (specs/college-reported-data.md): every stored one names its document, with a quote,
  // and describes a year newer than the federal admissions year. Null is "not published", and has no lineage. A value
  // computed from printed figures (round 3: a CDS share from its counts) may be "derived", with the same citation.
  for (const path of REPORTED_PATHS) {
    const value = valueAt(school, path);
    if (value === undefined || value === null) continue;
    const rec = school.lineage?.[path];
    if (!rec) errors.push(`${where}: ${path} is stored without a lineage record`);
    else if (rec.source !== "college-site") errors.push(`${where}: ${path} must cite source "college-site", not "${rec.source}"`);
    else if (rec.method !== "extracted" && rec.method !== "derived") errors.push(`${where}: ${path} must have method "extracted" or "derived"`);
  }
  // State laws (specs/lgbtq-life.md): each stored one cites its statute and effective date (scripts/lib/lgbtq-sync.mts).
  for (const path of STATE_LAW_PATHS) {
    if (valueAt(school, path) == null) continue;
    const rec = school.lineage?.[path];
    if (rec?.source !== "state-law" || !rec.url || !rec.year) errors.push(`${where}: ${path} must cite source "state-law" with the statute's URL and effective date`);
  }
  // Directory summaries (specs/campus-directories.md): each cites the directories and the date they were read; the
  // listings behind it, each credited, are checked against it in lib/detail.ts (detailMismatches).
  for (const path of DIRECTORY_PATHS) {
    if (valueAt(school, path) == null) continue;
    const rec = school.lineage?.[path];
    if ((rec?.source !== "directory" && rec?.source !== "org-estimate") || !rec.retrieved || !rec.year) errors.push(`${where}: ${path} must cite source "directory" with the date the lists were read`);
  }
  // Campus-life pilot policy facts (specs/lgbtq-life.md phase 4; scripts/lib/campus-pilot/merge.mts
  // applyLgbtqPolicies): each cites the date the college's own pages were checked.
  for (const path of POLICY_PAGE_PATHS) {
    if (valueAt(school, path) == null) continue;
    const rec = school.lineage?.[path];
    if (rec?.source !== "policy-page" || !rec.retrieved || !rec.year) errors.push(`${where}: ${path} must cite source "policy-page" with the date checked`);
  }
  errors.push(...validateNewest(school, where));
  errors.push(...validateNewestGroups(school, where, meta));
  errors.push(...validateAdmissionProfile(school, where));
  errors.push(...validateTests(school, where));
  errors.push(...financialAidProblems(school));
  return errors;
}

/**
 * Newest figures in the dataset (specs/college-reported-round-2.md, Decision 1; `lib/newest.ts#applyNewest`): a
 * college-reported class is newer than what it replaced (or would replace); every `admissions.*` value cited to the
 * college's site is extracted or derived and names its document; a replaced value means `admissions.federal` keeps
 * what it replaced; and when applicants or admitted were replaced, `admissions.year` is the reported class's.
 */
function validateNewest(school: School, where: string): string[] {
  const errors: string[] = [];
  const a = school.admissions;
  const federal = a.federal;
  const reported = school.reported?.admissions;
  const isCollegeSite = (k: keyof FederalAdmissions) => school.lineage?.[`admissions.${k}` as FieldPath]?.source === "college-site";

  if (reported) {
    // What the reported class replaced (admissions.federal) or, when nothing was replaced, what it would replace.
    const previousYear = federal ? federal.year : a.year;
    if (previousYear !== null && reported.year <= previousYear) {
      errors.push(`${where}: reported.admissions.year ${reported.year} isn't newer than the federal year ${previousYear}`);
    }
    if ((isCollegeSite("applicants") || isCollegeSite("admitted")) && a.year !== reported.year) {
      errors.push(`${where}: applicants or admitted come from the college's ${reported.year} class, but admissions.year is ${a.year}`);
    }
  }
  for (const k of ["year", "applicants", "admitted", "enrolled", "acceptance_rate"] as const) {
    const path = `admissions.${k}` as FieldPath;
    const rec = school.lineage?.[path];
    if (rec?.source !== "college-site") continue;
    if (rec.method !== "extracted" && rec.method !== "derived") errors.push(`${where}: ${path} cites the college's site, so it must be extracted or derived`);
    if (!rec.quote || !rec.url || !rec.retrieved || !rec.year) errors.push(`${where}: ${path} cites the college's site but lacks quote, url, retrieved, or year`);
    if (!federal) errors.push(`${where}: ${path} cites the college's site, but admissions.federal doesn't keep the value it replaced`);
    if (!reported) errors.push(`${where}: ${path} cites the college's site, but the school has no reported.admissions`);
  }
  // A replaced count differs from the one it replaced: that difference must be cited to the college's own document.
  if (federal) {
    for (const k of ["applicants", "admitted", "enrolled", "acceptance_rate"] as const) {
      if (a[k] !== federal[k] && !isCollegeSite(k)) errors.push(`${where}: admissions.${k} differs from admissions.federal.${k} but isn't cited to the college's site`);
    }
  }
  return errors;
}

/** Everything: registry + every school. Empty means the dataset's lineage is sound. */
export function validateLineage(schools: School[], meta: DatasetMeta): string[] {
  return [...validateRegistry(meta), ...schools.flatMap((s) => validateSchool(s, meta))];
}

/**
 * Lineage records for an override patch (data/overrides.json): every value the
 * patch sets is attributed to the patch's source. Throws when the patch doesn't
 * say where its values came from, or sets an unregistered field.
 */
export function lineageForPatch(id: string, patch: Record<string, unknown>): Partial<Record<FieldPath, LineageRecord>> {
  const cds = patch.cds as { edition?: string; url?: string } | undefined;
  const declared = patch._lineage as LineageRecord | undefined;
  if ("provenance" in patch) throw new Error(`overrides.json ${id}: "provenance" is replaced by field-level lineage; remove it`);
  let rec: LineageRecord;
  if (cds) {
    if (!cds.edition || !cds.url) throw new Error(`overrides.json ${id}: "cds" needs edition and url`);
    rec = { source: "cds", year: cds.edition, url: cds.url, ...(typeof patch._imported === "string" ? { retrieved: patch._imported } : {}) };
  } else if (declared?.source && declared.url) {
    rec = declared;
  } else {
    throw new Error(`overrides.json ${id}: say where the values came from with "cds" {edition, url} or "_lineage" {source, url, year}`);
  }
  const data = Object.fromEntries(Object.entries(patch).filter(([k]) => !k.startsWith("_") && k !== "lineage"));
  const out: Partial<Record<FieldPath, LineageRecord>> = {};
  for (const leaf of leafPaths(data)) {
    const p = registeredPathFor(leaf);
    if (!p) throw new Error(`overrides.json ${id}: "${leaf}" isn't registered in lib/fields.ts`);
    // Rule 9 (specs/data-expansion/cds-student-body-and-outcomes.md): a newest group's paths come from the CDS records.
    if (NEWEST_TARGETS.has(p)) throw new Error(`overrides.json ${id}: "${p}" comes from the college's CDS record (data/cds-records/, lib/newest-groups.ts), not an override`);
    out[p] = rec;
  }
  return { ...out, ...((patch.lineage as Partial<Record<FieldPath, LineageRecord>>) ?? {}) };
}

/** Every override in data/overrides.json that `lineageForPatch` refuses (`npm run check:lineage`). */
export function validateOverrides(overrides: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [id, patch] of Object.entries(overrides)) {
    if (id.startsWith("_")) continue;
    try {
      lineageForPatch(id, patch as Record<string, unknown>);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return errors;
}
