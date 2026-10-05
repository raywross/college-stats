/**
 * Change detection between two publishes of the dataset (specs/product/follow-colleges.md#detecting-changes).
 *
 *   const changes = diffSchools({ schools: before, meta: beforeMeta }, { schools, meta }, NOTIFY_FIELDS, { calendar });
 *   describeChange(changes[0]) // "Fall 2025: 9.1% admitted (fall 2024: 9.8%)"
 *
 * Computed once per publish by `npm run publish-data` and stored in `dataset_changes`; the profile's "What changed"
 * panel and the follow digest read the stored rows. Pure module (type-only imports plus pure helpers) so the publish
 * script, tests, and the app share it.
 *
 * Years come from lineage, before and after (`lineageFor`, which `citeField` wraps), never from meta directly.
 */
import type { DatasetMeta, School } from "./types";
import type { ReleaseCalendar } from "./releases";
import { FIELDS, NOTIFY_FIELDS, NOTIFY_TOLERANCE, isFieldPath, type FieldDef, type FieldPath, type NotifyDef } from "./fields.ts";
import { lineageFor } from "./lineage.ts";
import { formatBy, money, num, pct, pctSmart } from "./format.ts";
import { POLICY_LABELS } from "./test-policy.ts";

/** The site's words for a text value, by field (the test policy's "Test-optional"). */
const TEXT_WORDS: Partial<Record<FieldPath, Readonly<Record<string, string>>>> = { "admissions.test_policy": POLICY_LABELS };

/**
 * - `new_year`: the value's year moved and the value differs ("Fall 2025: … (fall 2024: …)").
 * - `revised`: same year, the value differs beyond the field's tolerance.
 * - `updated`: the value differs and its source names no single year (College Scorecard's "most recent release"),
 *   so whether it's a new year or a revision can't be told. Not in the spec's original four; added so a Scorecard
 *   refresh isn't mislabeled.
 * - `appeared` / `disappeared`: null before / null after. `disappeared` is shown on the panel, never emailed.
 */
export type ChangeKind = "new_year" | "revised" | "updated" | "appeared" | "disappeared";
export const CHANGE_KINDS: readonly ChangeKind[] = ["new_year", "revised", "updated", "appeared", "disappeared"];
/** Kinds a digest email lists (follow-colleges.md: "No longer reported" is panel-only). */
export const EMAILED_KINDS: ReadonlySet<ChangeKind> = new Set<ChangeKind>(["new_year", "revised", "updated", "appeared"]);

/** One change, shaped like a `dataset_changes` row (supabase/migrations/20261005140000_follows.sql) minus the publish. */
export interface DatasetChange {
  unit_id: string;
  field: FieldPath;
  kind: ChangeKind;
  /** The stored values (numbers, [low, high] ranges, objects, or words); null when absent. */
  old_value: unknown;
  new_value: unknown;
  /** Display years from lineage ("Fall 2024", "2023–24"); null when the source names no single year. */
  old_year: string | null;
  new_year: string | null;
  /** The source cited for the value (after; before for `disappeared`): "IPEDS Admissions", "Cornell University Common Data Set 2025–26". */
  source: string | null;
  /** The release-calendar entry that brought it, when one was published between the two datasets. */
  release: string | null;
}

/** A change as stored: with the publish it came in (`dataset_publishes.id`) and that publish's time (the dataset version). */
export interface StoredChange extends DatasetChange {
  publish_id: number;
  published_at: string;
}

export interface DatasetSnapshot {
  schools: readonly School[];
  meta: DatasetMeta;
}

export interface DiffOptions {
  /** data/release-calendar.json of the new dataset, to name the release that brought a change. */
  calendar?: Pick<ReleaseCalendar, "releases">;
}

const EPSILON = 1e-9;

function valueAt(school: School, path: string): unknown {
  const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), school);
  return v === undefined ? null : v;
}

function notifyOf(path: FieldPath): NotifyDef | undefined {
  return (FIELDS[path] as FieldDef).notify;
}

/** Whether two non-null values differ by at least the tolerance (numbers), or at all (words). */
function differs(a: unknown, b: unknown, tolerance: number, keys?: readonly string[]): boolean {
  if (a === null || b === null) return a !== b;
  if (typeof a === "number" && typeof b === "number") return tolerance === 0 ? a !== b : Math.abs(a - b) >= tolerance - EPSILON;
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length || a.some((x, i) => differs(x ?? null, b[i] ?? null, tolerance));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ks = keys ?? [...new Set([...Object.keys(ao), ...Object.keys(bo)])];
    return ks.some((k) => differs(ao[k] ?? null, bo[k] ?? null, tolerance));
  }
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Whether a derived value's stored inputs changed at all (recursively through derived inputs). */
function inputsChanged(path: FieldPath, prev: School, next: School, seen = new Set<string>()): boolean {
  const def = FIELDS[path] as FieldDef;
  if (!def.derived || seen.has(path)) return JSON.stringify(valueAt(prev, path)) !== JSON.stringify(valueAt(next, path));
  seen.add(path);
  return def.derived.inputs.some((i) => isFieldPath(i) && inputsChanged(i, prev, next, seen));
}

/** A derived field whose value here is calculated (no lineage record, or one that says "derived"). */
function isCalculated(path: FieldPath, school: School): boolean {
  if (!(FIELDS[path] as FieldDef).derived) return false;
  const rec = school.lineage?.[path];
  return !rec || rec.method === "derived";
}

function releaseFor(path: FieldPath, school: School, prev: DatasetMeta, next: DatasetMeta, calendar: DiffOptions["calendar"]): string | null {
  // A value with its own lineage record names its document (a CDS, the college's page); the calendar covers releases.
  const vintage = school.lineage?.[path] ? null : (FIELDS[path] as FieldDef).vintage;
  if (!vintage || !calendar) return null;
  const match = calendar.releases
    .filter((r) => r.status === "published" && r.published && r.updates.includes(vintage) && r.published > prev.retrieved && r.published <= next.retrieved)
    .sort((a, b) => (b.published! < a.published! ? -1 : 1))[0];
  return match?.label ?? null;
}

/**
 * Every reportable change between two datasets, college by college in the new file's order, then field by field.
 * Colleges in only one of the two are skipped (a new college has no "before"; a removed one has no profile).
 */
export function diffSchools(prev: DatasetSnapshot, next: DatasetSnapshot, fields: readonly FieldPath[] = NOTIFY_FIELDS, options: DiffOptions = {}): DatasetChange[] {
  const before = new Map(prev.schools.map((s) => [s.unit_id, s]));
  const out: DatasetChange[] = [];
  for (const school of next.schools) {
    const old = before.get(school.unit_id);
    if (!old) continue;
    for (const field of fields) {
      const notify = notifyOf(field);
      if (!notify) continue;
      const a = valueAt(old, field);
      const b = valueAt(school, field);
      if (a === null && b === null) continue;
      const tolerance = notify.always ? 0 : (notify.tolerance ?? NOTIFY_TOLERANCE[notify.unit]);
      if (!differs(a, b, tolerance, notify.keys ? Object.keys(notify.keys) : undefined)) continue;
      // Re-deriving can move a stored derived value by float noise, or a formula fix can move it with no new data;
      // only a change in what it's calculated from is news.
      if (!notify.always && a !== null && b !== null && isCalculated(field, old) && isCalculated(field, school) && !inputsChanged(field, old, school)) continue;
      const citedBefore = lineageFor(field, old, prev.meta);
      const citedAfter = lineageFor(field, school, next.meta);
      const oldYear = a === null ? null : citedBefore.year;
      const newYear = b === null ? null : citedAfter.year;
      const kind: ChangeKind =
        a === null ? "appeared" : b === null ? "disappeared" : oldYear !== newYear ? "new_year" : newYear === null ? "updated" : "revised";
      out.push({
        unit_id: school.unit_id,
        field,
        kind,
        old_value: a,
        new_value: b,
        old_year: oldYear,
        new_year: newYear,
        source: (b === null ? citedBefore : citedAfter).label,
        release: kind === "disappeared" ? null : releaseFor(field, school, prev.meta, next.meta, options.calendar),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Sentences                                                           */
/* ------------------------------------------------------------------ */

export interface DescribeOptions {
  /** Words for a text value; by default the site's own (the test policy's labels), else the raw value. */
  formatText?: (field: FieldPath, value: string) => string;
}

/** "Fall 2024" → "fall 2024" mid-sentence; leaves "SAT …" and "2023–24" alone. */
function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}
function upperFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
const yearText = (year: string | null) => year ?? "most recent release";

function formatScalar(field: FieldPath, value: unknown, opts: DescribeOptions): string {
  if (value === null || value === undefined) return "not reported";
  if (typeof value === "string") return opts.formatText ? opts.formatText(field, value) : (TEXT_WORDS[field]?.[value] ?? value);
  if (typeof value !== "number") return String(value);
  switch (notifyOf(field)?.unit) {
    case "percent":
      return pctSmart(value);
    case "dollars":
      return money(value);
    case "ratio":
      return formatBy("ratio", value);
    default:
      return num(value);
  }
}

/** A stored value as the site writes it: "9.1%", "$59,402", "540–650", "$59,402 in-state, $41,000 out-of-state". */
export function formatChangeValue(field: FieldPath, value: unknown, opts: DescribeOptions = {}): string {
  if (Array.isArray(value)) return value.map((v) => formatScalar(field, v, opts)).join("–");
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const labels = notifyOf(field)?.keys ?? Object.fromEntries(Object.keys(o).map((k) => [k, k.replace(/_/g, " ")]));
    const shown = Object.keys(labels).filter((k) => o[k] !== null && o[k] !== undefined);
    if (shown.length && shown.every((k) => o[k] === o[shown[0]])) return formatScalar(field, o[shown[0]], opts);
    return shown.map((k) => `${formatScalar(field, o[k], opts)} ${labels[k]}`).join(", ");
  }
  return formatScalar(field, value, opts);
}

function phrase(field: FieldPath, v: string): string {
  const template = notifyOf(field)?.phrase;
  return template ? template.replace("{value}", v) : `${lowerFirst(FIELDS[field].label)} ${v}`;
}

/** Old and new as text; two shares that round to the same whole percent get one decimal ("97.6%" vs "98.0%"). */
function formatPair(field: FieldPath, a: unknown, b: unknown, opts: DescribeOptions): [string, string] {
  const was = formatChangeValue(field, a, opts);
  const now = formatChangeValue(field, b, opts);
  if (was === now && typeof a === "number" && typeof b === "number" && notifyOf(field)?.unit === "percent") return [pct(a, 1), pct(b, 1)];
  return [was, now];
}

/**
 * One plain sentence with both years (follow-colleges.md#detecting-changes):
 * - new_year: "Fall 2025: 9.1% admitted (fall 2024: 9.8%)"
 * - revised: "Revised fall 2024 figure: 9.6% admitted (was 9.8%)"
 * - updated: "Most recent release: graduation rate 61% (was 59%)"
 * - appeared: "Now reported: median earnings 10 years after entry $55,736 (most recent release)"
 * - disappeared: "No longer reported: median debt at graduation (was $24,250, most recent release)"
 * - a rename (`always`): "Name changed: New College (was Old College)"
 */
export function describeChange(c: Pick<DatasetChange, "field" | "kind" | "old_value" | "new_value" | "old_year" | "new_year">, opts: DescribeOptions = {}): string {
  const def = FIELDS[c.field] as FieldDef;
  const [was, now] = formatPair(c.field, c.old_value, c.new_value, opts);
  if (def.notify?.always && c.kind !== "appeared" && c.kind !== "disappeared") {
    return `${def.label} changed: ${now} (was ${was})`;
  }
  switch (c.kind) {
    case "new_year":
      return `${upperFirst(yearText(c.new_year))}: ${phrase(c.field, now)} (${lowerFirst(yearText(c.old_year))}: ${was})`;
    case "revised":
      return `Revised ${lowerFirst(yearText(c.new_year))} figure: ${phrase(c.field, now)} (was ${was})`;
    case "updated":
      return `${upperFirst(yearText(c.new_year))}: ${phrase(c.field, now)} (was ${was})`;
    case "appeared":
      return `Now reported: ${phrase(c.field, now)} (${lowerFirst(yearText(c.new_year))})`;
    case "disappeared":
      return `No longer reported: ${lowerFirst(def.label)} (was ${was}, ${lowerFirst(yearText(c.old_year))})`;
  }
}

/* ------------------------------------------------------------------ */
/* Reading stored changes                                              */
/* ------------------------------------------------------------------ */

export interface ChangePublish {
  publish_id: number;
  published_at: string;
  /** Distinct release names among the publish's changes. */
  releases: string[];
  changes: StoredChange[];
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * One college's changes for the profile panel: the last `publishes` publishes that touched it, newest first, each
 * with its changes in the registry's field order. Empty when its newest change is more than a year old.
 */
export function recentPublishes(changes: readonly StoredChange[], now: Date, { publishes = 2 }: { publishes?: number } = {}): ChangePublish[] {
  const byPublish = new Map<number, StoredChange[]>();
  for (const c of changes) byPublish.set(c.publish_id, [...(byPublish.get(c.publish_id) ?? []), c]);
  const order = new Map(NOTIFY_FIELDS.map((f, i) => [f, i]));
  const groups = [...byPublish.entries()]
    .map(([publish_id, cs]) => ({
      publish_id,
      published_at: cs[0].published_at,
      releases: [...new Set(cs.map((c) => c.release).filter((r): r is string => !!r))],
      changes: [...cs].sort((a, b) => (order.get(a.field) ?? 999) - (order.get(b.field) ?? 999)),
    }))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  if (!groups.length || now.getTime() - Date.parse(groups[0].published_at) > YEAR_MS) return [];
  return groups.slice(0, publishes);
}
