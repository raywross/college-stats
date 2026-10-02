/**
 * Lineage: where each value came from. Pure functions over (school, meta) so the
 * sync script, the checker, tests, and the app all resolve citations the same way.
 * See specs/data-lineage.md.
 */
import type { DatasetMeta, LineageRecord, School, SourceInfo, SourceKey } from "./types";
import { FIELDS, METADATA_KEYS, isFieldPath, registeredPathFor, type FieldPath, type VintageKey } from "./fields.ts";

/** A source as cited for one value: plain data, safe to pass to client components. */
export interface CitedSource {
  key: SourceKey;
  label: string;
  publisher: string;
  /** Display year; null when the release has no single year (shown as "most recent release"). */
  year: string | null;
  url: string;
  retrieved: string;
}

export interface Cited extends CitedSource {
  path: FieldPath;
  /** Field label, e.g. "Acceptance rate". */
  field: string;
  method: NonNullable<LineageRecord["method"]>;
  /** False when this school's value came from somewhere other than the field's default source. */
  isDefault: boolean;
  formula?: string;
  /** Derived values: the distinct sources of their inputs. */
  inputs?: CitedSource[];
  quote?: string;
  page?: number;
}

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
  cds: null,
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
export function yearLabel(s: Pick<CitedSource, "year">): string {
  return s.year ?? "most recent release";
}

/** Compact name for a chip: "CDS 2024-25", "IPEDS Fall 2024", "Scorecard". */
export function shortSource(s: CitedSource): string {
  const name = s.key === "cds" ? "CDS" : s.key === "scorecard" ? "Scorecard" : "IPEDS";
  return s.year ? `${name} ${s.year}` : name;
}

const sourceId = (s: CitedSource) => `${s.key}|${s.url}|${s.year ?? ""}`;

/** Distinct sources behind a value: a derived value cites its inputs, recursively. */
function underlyingSources(path: FieldPath, school: School | undefined, meta: DatasetMeta, seen = new Set<string>()): CitedSource[] {
  const def = FIELDS[path] as (typeof FIELDS)[FieldPath];
  const overridden = !!school?.lineage?.[path];
  if (!("derived" in def) || !def.derived || overridden || seen.has(path)) return [sourceFor(path, school, meta)];
  seen.add(path);
  const out = new Map<string, CitedSource>();
  for (const input of def.derived.inputs) {
    if (!isFieldPath(input)) continue;
    for (const s of underlyingSources(input, school, meta, seen)) out.set(sourceId(s), s);
  }
  return [...out.values()];
}

/** True when a value and everything it's calculated from use their fields' default sources. */
function usesDefaults(path: FieldPath, school: School | undefined, seen = new Set<string>()): boolean {
  if (school?.lineage?.[path]) return false;
  const def = FIELDS[path] as (typeof FIELDS)[FieldPath];
  if (!("derived" in def) || !def.derived || seen.has(path)) return true;
  seen.add(path);
  return def.derived.inputs.every((i) => !isFieldPath(i) || usesDefaults(i, school, seen));
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
  };
}

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
  "scorecard-enrollment",
  "scorecard-age",
  "scorecard-cost",
  "scorecard-latest",
];
/** Releases that must resolve to a year (the rest may be null). */
const YEAR_REQUIRED: readonly VintageKey[] = ["ipeds-adm", "ipeds-sfa", "ipeds-ic", "ipeds-hd", "ipeds-ic-char", "ipeds-ef", "ipeds-gr", "ipeds-sal", "scorecard-enrollment", "scorecard-age", "scorecard-cost", "ipeds-om"];
const METHODS = new Set(["reported", "derived", "extracted"]);

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
    if (def.source !== "cds" && !def.vintage && !("derived" in def)) errors.push(`fields.ts: ${path} has no vintage`);
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
  }
  if (school.cds && !Object.values(school.lineage ?? {}).some((r) => r?.source === "cds")) {
    errors.push(`${where}: has a "cds" record but no field cites it`);
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
    out[p] = rec;
  }
  return { ...out, ...((patch.lineage as Partial<Record<FieldPath, LineageRecord>>) ?? {}) };
}
