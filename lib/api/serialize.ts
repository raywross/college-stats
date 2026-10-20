/**
 * The Data API's serializers (specs/product/data-api.md "PublicSchool", "Endpoints", "MCP server"): the one place a
 * college, its lineage, the field registry, the dataset's metadata, and the national figures become JSON. The REST
 * routes and the MCP tools call only these, so the two surfaces and the site can never disagree, and the numbers are
 * the site's own (`getData()`'s records and `lib/metrics.ts`), never recomputed here.
 *
 * Hidden fields (lib/fields.ts HIDDEN_FIELDS: the top band of Quad's selectivity and the scores behind the tiers) are
 * removed from every record, their lineage, and the registry. Nothing here imports the method (lib/selectivity.ts,
 * lib/chances/*, lib/admin/*); tests/api-v1.test.mts checks every college's output and the import graph.
 *
 * Pure module (type-only imports aside from the registry, lineage, and metrics), so tests load it directly.
 */
import type { DatasetMeta, School, SchoolSelectivity, SchoolType, SourceKey, Topic } from "../types";
import type { Dataset } from "../dataset";
import type { ReleaseCalendar } from "../releases";
import { HISTORY_FAMILIES, SERIES, type NationalHistory, type SchoolHistory, type SeriesBreak, type SeriesDef, type SeriesKey, type SeriesUnit, type YearKind } from "../history.ts";
import { FIELDS, HIDDEN_FIELDS, PER_DOCUMENT_SOURCES, registeredPathFor, type FieldDef, type FieldPath, type VintageKey } from "../fields.ts";
import { citesYear, leafPaths, lineageFor, yearLabel, type Cited } from "../lineage.ts";
import { METRICS, type MetricKey } from "../metrics.ts";

/** A college as the API serves it: the dataset's record less every hidden field. */
export type PublicSchool = Omit<School, "selectivity"> & { selectivity?: Omit<SchoolSelectivity, "band"> };

const HIDDEN = new Set<string>(HIDDEN_FIELDS);

/** Registry order, for stable output. */
const FIELD_ORDER = new Map((Object.keys(FIELDS) as FieldPath[]).map((p, i) => [p, i]));

const def = (path: FieldPath): FieldDef => FIELDS[path];

/** True when `path` is a hidden field or sits under one. */
export function isHiddenPath(path: string): boolean {
  const reg = registeredPathFor(path);
  return (reg !== null && HIDDEN.has(reg)) || HIDDEN.has(path);
}

/** Keys `publicSchool` always keeps under `fields=`. */
export const ALWAYS_KEPT_KEYS = ["unit_id", "name"] as const;

/**
 * A deep copy of `school` without the values at `paths` (dotted, e.g. a hidden field's path), and without their
 * lineage records. Objects left empty by a removal are kept as they are otherwise (`{}`), so a key's presence never
 * depends on hidden data. publicSchool passes HIDDEN_FIELDS; tests pass other lists to show a missing path leaks.
 */
export function stripPaths(school: School, paths: readonly string[]): School {
  const out = structuredClone(school);
  for (const path of paths) {
    const keys = path.split(".");
    let node: unknown = out;
    for (const k of keys.slice(0, -1)) node = node && typeof node === "object" ? (node as Record<string, unknown>)[k] : undefined;
    if (node && typeof node === "object") delete (node as Record<string, unknown>)[keys[keys.length - 1]];
    if (out.lineage) delete (out.lineage as Record<string, unknown>)[path];
  }
  return out;
}

/**
 * The school the API serves: every HIDDEN_FIELDS path removed (the selectivity band among them, dropped again by name
 * so the type holds even if the registry changed), `lineage` and `cds` kept (the raw records; /lineage is the resolved
 * form), nothing added. `fields` keeps only those top-level keys, plus unit_id and name always.
 */
export function publicSchool(school: School, fields?: readonly string[]): Partial<PublicSchool> {
  const stripped = stripPaths(school, HIDDEN_FIELDS);
  let record: PublicSchool;
  if (stripped.selectivity) {
    const { band: _band, ...selectivity } = stripped.selectivity;
    void _band;
    record = { ...stripped, selectivity };
  } else {
    record = stripped;
  }
  if (!fields || fields.length === 0) return record;
  const keep = new Set<string>([...ALWAYS_KEPT_KEYS, ...fields]);
  return Object.fromEntries(Object.entries(record).filter(([k]) => keep.has(k))) as Partial<PublicSchool>;
}

function valueAt(record: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), record);
}

/** Whether a registered path is picked by `fields=`: the path itself, anything under a named prefix, or the field holding a named leaf. */
export function fieldMatches(path: string, fields: readonly string[]): boolean {
  return fields.some((f) => path === f || path.startsWith(`${f}.`) || f.startsWith(`${path}.`));
}

/**
 * The resolved lineage of every value the college has (specs/data-lineage.md): `lineageFor` for each non-hidden,
 * non-computed registered field holding a non-null value (stored leaves map to their registered path), plus each
 * calculated metric (`derived.*` fields that lib/metrics.ts METRICS names) whose value is non-null for this college.
 * `fields` narrows to the paths `fieldMatches` picks. Keys in registry order.
 */
export function schoolLineage(school: School, meta: DatasetMeta, fields?: readonly string[]): Record<string, Cited> {
  const paths = new Set<FieldPath>();
  for (const leaf of leafPaths(school)) {
    if (valueAt(school, leaf) === null) continue;
    const reg = registeredPathFor(leaf);
    if (!reg || HIDDEN.has(reg) || def(reg).computed) continue;
    paths.add(reg);
  }
  for (const m of Object.values(METRICS)) {
    if (!m.field.startsWith("derived.") || HIDDEN.has(m.field) || paths.has(m.field)) continue;
    if (m.get(school) !== null) paths.add(m.field);
  }
  const picked = [...paths].filter((p) => !fields || fields.length === 0 || fieldMatches(p, fields));
  picked.sort((a, b) => (FIELD_ORDER.get(a) ?? 0) - (FIELD_ORDER.get(b) ?? 0));
  return Object.fromEntries(picked.map((p) => [p, lineageFor(p, school, meta)]));
}

/** One row of /fields and the MCP's list_fields. */
export interface FieldRow {
  path: string;
  label: string;
  topic: string;
  /** The default source's key ("ipeds-adm"); `source_label` is its name. */
  source: string;
  /** The release the default value describes (data/meta.json `vintages` key), null for per-document sources. */
  vintage: string | null;
  /** That release's year ("most recent release" when it has no single one); null when each value carries its own. */
  year: string | null;
  formula?: string;
  inputs?: string[];
  computed?: boolean;
  /** The default source's name ("IPEDS Admissions"). */
  source_label: string;
  /** Changes to it are reported to followers (lib/fields.ts `notify`). */
  notify?: boolean;
}

/** The public registry (no hidden field, and no hidden input named), in registry order. */
export function fieldRegistry(meta: DatasetMeta): FieldRow[] {
  const rows: FieldRow[] = [];
  for (const path of Object.keys(FIELDS) as FieldPath[]) {
    if (HIDDEN.has(path)) continue;
    const d = def(path);
    const cited = lineageFor(path, undefined, meta);
    const perDocument = PER_DOCUMENT_SOURCES.has(d.source) || PER_DOCUMENT_SOURCES.has(cited.key);
    rows.push({
      path,
      label: d.label,
      topic: d.topic,
      source: d.source,
      source_label: cited.label,
      vintage: d.vintage satisfies VintageKey | null,
      year: !perDocument && citesYear(cited) ? yearLabel(cited) : null,
      ...(d.derived ? { formula: d.derived.formula, inputs: d.derived.inputs.filter((i) => !HIDDEN.has(i)) } : {}),
      ...(d.computed ? { computed: true } : {}),
      ...(d.notify ? { notify: true } : {}),
    });
  }
  return rows;
}

/** Every topic the public registry uses, for validating `topic=`. */
export function fieldTopics(): Topic[] {
  return [...new Set((Object.keys(FIELDS) as FieldPath[]).filter((p) => !HIDDEN.has(p)).map((p) => def(p).topic))];
}

/** /meta and get_dataset_info: what the Data page shows. */
export interface DatasetInfo {
  retrieved: string;
  sources: DatasetMeta["sources"];
  vintages: DatasetMeta["vintages"];
  release_calendar: ReleaseCalendar;
  counts: ReturnType<Dataset["getDatasetSummary"]>;
}

export function datasetMeta(args: { meta: DatasetMeta; calendar: ReleaseCalendar; summary: ReturnType<Dataset["getDatasetSummary"]> }): DatasetInfo {
  const { meta, calendar, summary } = args;
  return { retrieved: meta.retrieved, sources: meta.sources, vintages: meta.vintages, release_calendar: calendar, counts: summary };
}

/** A search row (the fields of lib/dataset.ts toIndexEntry, named as the API names them). */
export interface SchoolSummary {
  unit_id: string;
  name: string;
  city: string;
  state: string;
  type: SchoolType;
  acceptance_rate: number | null;
}

export function schoolSummary(school: School): SchoolSummary {
  return {
    unit_id: school.unit_id,
    name: school.name,
    city: school.location.city,
    state: school.location.state,
    type: school.type,
    acceptance_rate: school.admissions.acceptance_rate,
  };
}

/** One metric across several colleges (compare_colleges): each value with its percentile rank, and the national median. */
export interface CompareRow {
  key: MetricKey;
  label: string;
  /** The registered field the metric reads, for its citation (lineageFor / citeField). */
  field: FieldPath;
  median: number | null;
  values: { unit_id: string; value: number | null; rank: number | null }[];
}

/** Metrics a compare table shows by default: every METRICS entry whose field is public. */
export const COMPARE_DEFAULT_METRICS: readonly MetricKey[] = (Object.keys(METRICS) as MetricKey[]).filter((k) => !HIDDEN.has(METRICS[k].field));

export function compareTable(schools: School[], data: Pick<Dataset, "rankOf" | "metricMedian" | "reportingCount">, metrics: readonly MetricKey[] = COMPARE_DEFAULT_METRICS): CompareRow[] {
  return metrics
    .filter((k) => k in METRICS && !HIDDEN.has(METRICS[k].field))
    .map((key) => ({
      key,
      label: METRICS[key].label,
      field: METRICS[key].field,
      median: data.metricMedian(key),
      values: schools.map((s) => ({ unit_id: s.unit_id, value: METRICS[key].get(s), rank: data.rankOf(s, key) })),
    }));
}

/** One metric nationally: the median, how many colleges report it, and the distribution the "where it sits" strips draw. */
export interface NationalMetric {
  key: MetricKey;
  label: string;
  field: FieldPath;
  median: number | null;
  reporting: number;
  distribution: { bins: number[]; min: number; max: number; n: number };
}

/** /national: per metric (lib/metrics.ts METRICS) median, reporting count, and distribution, plus data/history/national.json. */
export function nationalSummary(
  data: Pick<Dataset, "metricMedian" | "reportingCount" | "distribution">,
  national: NationalHistory | null,
): { metrics: NationalMetric[]; history: NationalHistory | null } {
  return {
    metrics: COMPARE_DEFAULT_METRICS.map((key) => ({
      key,
      label: METRICS[key].label,
      field: METRICS[key].field,
      median: data.metricMedian(key),
      reporting: data.reportingCount(key),
      distribution: data.distribution(key),
    })),
    history: national,
  };
}

/* ------------------------------------------------------------------ */
/* History series definitions (/schools/{id}/history and get_history)  */
/* ------------------------------------------------------------------ */

/**
 * A history series as both surfaces describe it (specs/product/data-api.md "Endpoints", "MCP server"): lib/history.ts
 * SERIES less its display-only fields, with the sources of the files it reads. One shape, so the REST route and the
 * MCP tool can't drift.
 */
export interface SeriesDefinition {
  label: string;
  short: string;
  /** The snapshot field the series extends back in time (a registered path). */
  field: string;
  unit: SeriesUnit;
  /** What a year means: a fall term, an academic year, or an entering cohort. */
  year_kind: YearKind;
  /** Present when the value can be negative (net price below zero when grants exceed the cost of attendance). */
  signed?: true;
  breaks: SeriesBreak[];
  /** The sources (data/meta.json `sources` keys) of the files behind the series. */
  sources: SourceKey[];
}

/** The series in a shard the API may show: known to SERIES and not extending a hidden field. */
export function publicSeriesKeys(history: Pick<SchoolHistory, "series">): SeriesKey[] {
  return Object.keys(history.series).filter((k): k is SeriesKey => k in SERIES && !isHiddenPath(SERIES[k as SeriesKey].field));
}

/** The definitions of `keys`, keyed by series key. */
export function seriesDefinitions(keys: readonly SeriesKey[]): Record<string, SeriesDefinition> {
  return Object.fromEntries(
    keys.map((k) => {
      const d: SeriesDef = SERIES[k];
      const def: SeriesDefinition = {
        label: d.label,
        short: d.short,
        field: d.field,
        unit: d.unit,
        year_kind: d.kind,
        ...(d.signed ? { signed: true as const } : {}),
        breaks: [...(d.breaks ?? [])],
        sources: [...new Set(d.families.map((f) => HISTORY_FAMILIES[f].source))],
      };
      return [k, def];
    }),
  );
}
