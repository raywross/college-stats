/**
 * The field editor at /admin/colleges/[unit]/edit (specs/data-platform/change-sets.md "Admin edits"), pure: which
 * registry paths an admin can edit, the input each one gets (inferred from the college's value, or from the value most
 * colleges have, since the registry carries no value type), how a submitted value is parsed and refused in plain words,
 * how a value and its citation read, the stored derived fields an input feeds, and the marker "a newer pipeline value
 * exists" from the served snapshot's `edits.json`. No I/O; tests/admin-edits.test.mts runs every rule.
 */
import { FIELDS, type FieldDef, type FieldPath } from "../fields.ts";
import { editProblem, liveEdits, withEdits, type FieldEdit } from "../data-platform/edits.ts";
import type { SnapshotEditsObject } from "../data-platform/snapshot.ts";
import { citesYear, yearLabel, type Cited } from "../lineage.ts";
import { TOPIC_LABELS } from "../topic-labels.ts";
import type { LineageRecord, School, SourceKey, Topic } from "../types.ts";

/** The input a path gets. `enum` is a select of the values colleges already have; `json` a textarea. */
export type EditKind = "number" | "boolean" | "date" | "text" | "enum" | "json";
export const EDIT_KINDS: readonly EditKind[] = ["number", "boolean", "date", "text", "enum", "json"];

/** Shown under a share's input. */
export const SHARE_HINT = "a share, 0 to 1: 0.42 is 42%";

/** A select is offered only when colleges share this few distinct strings at the path. */
export const ENUM_MAX = 12;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One row of `data_field_edits` as the console reads it (who made it, too). */
export interface EditRecord extends FieldEdit {
  created_by?: string | null;
}

/* ------------------------------------------------------------------ */
/* Values at a path                                                    */
/* ------------------------------------------------------------------ */

/** The value at a dotted path, or undefined. */
export function valueAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

type ValueType = "number" | "boolean" | "date" | "string" | "json";

function valueType(v: unknown): ValueType | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") return DATE_RE.test(v) ? "date" : "string";
  if (typeof v === "object") return "json";
  return null;
}

/** Deep equality over JSON values (object key order ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => sameValue(v, bb[i]));
  }
  const ak = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const bk = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ak.length === bk.length && ak.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/* ------------------------------------------------------------------ */
/* Inferring the input                                                 */
/* ------------------------------------------------------------------ */

/** What every college holds at one path: how many of each type, the distinct strings (capped), two JSON samples. */
interface PathStats {
  counts: Record<ValueType, number>;
  strings: Set<string>;
  stringCount: number;
  samples: { unit: string; value: unknown }[];
}

/** One pass over the colleges per path, kept while the list (the served dataset) lives: a request computes it once. */
const STATS = new WeakMap<readonly School[], Map<string, PathStats>>();

function pathStats(path: string, all: readonly School[]): PathStats {
  let byPath = STATS.get(all);
  if (!byPath) STATS.set(all, (byPath = new Map()));
  const hit = byPath.get(path);
  if (hit) return hit;
  const stats: PathStats = { counts: { number: 0, boolean: 0, date: 0, string: 0, json: 0 }, strings: new Set(), stringCount: 0, samples: [] };
  for (const s of all) {
    const v = valueAt(s, path);
    const t = valueType(v);
    if (!t) continue;
    stats.counts[t]++;
    if (t === "string") {
      stats.stringCount++;
      if (stats.strings.size <= ENUM_MAX) stats.strings.add(v as string);
    }
    if (t === "json" && stats.samples.length < 2) stats.samples.push({ unit: s.unit_id, value: v });
  }
  byPath.set(path, stats);
  return stats;
}

/** The type most colleges have at the path, or null when none has a value. */
function commonType(stats: PathStats): ValueType | null {
  let best: ValueType | null = null;
  for (const t of Object.keys(stats.counts) as ValueType[]) if (stats.counts[t] > 0 && (best === null || stats.counts[t] > stats.counts[best])) best = t;
  return best;
}

export interface KindInfo {
  kind: EditKind;
  /** A share (`notify.unit === "percent"`): shown as a percent and the raw share, entered 0 to 1. */
  share: boolean;
  /** For `enum`: the values to pick from, sorted. */
  options: string[] | null;
  /** A line under the input. */
  hint: string | null;
  /** For `json`: another college's value at the path, as a hint to the shape. */
  shape: string | null;
}

/**
 * The input for one path at one college: from its current value (number, boolean, a `YYYY-MM-DD` date, text, or JSON
 * for an array or object); a string becomes a select when every college together has at most ENUM_MAX distinct values
 * and some repeat (a category, not free text). With no value here, from the type most colleges have; with none
 * anywhere, a number for a numeric `notify` unit, else text.
 */
export function inferKind(path: string, school: School, all: readonly School[]): KindInfo {
  const def = (FIELDS as Record<string, FieldDef>)[path];
  const stats = pathStats(path, all);
  const t = valueType(valueAt(school, path)) ?? commonType(stats);
  let kind: EditKind;
  if (t === "number" || t === "boolean" || t === "date" || t === "json") kind = t;
  else if (t === "string") kind = stats.strings.size >= 2 && stats.strings.size <= ENUM_MAX && stats.stringCount > stats.strings.size ? "enum" : "text";
  else kind = def?.notify && def.notify.unit !== "text" ? "number" : "text";

  const share = kind === "number" && def?.notify?.unit === "percent";
  let options: string[] | null = null;
  if (kind === "enum") {
    const set = new Set(stats.strings);
    const own = valueAt(school, path);
    if (typeof own === "string") set.add(own);
    options = [...set].sort((a, b) => a.localeCompare(b));
  }
  let shape: string | null = null;
  if (kind === "json") {
    const other = stats.samples.find((s) => s.unit !== school.unit_id);
    if (other) shape = preview(other.value, 160);
  }
  const hint = share ? SHARE_HINT : kind === "date" ? "YYYY-MM-DD" : null;
  return { kind, share, options, hint, shape };
}

/* ------------------------------------------------------------------ */
/* Parsing what was submitted                                          */
/* ------------------------------------------------------------------ */

/** The slice of a form the parser reads (FormData in production). */
export interface FormLike {
  get(name: string): unknown;
}

export type Parsed = { ok: true; value: unknown } | { ok: false; problem: string };

export const PROBLEMS = {
  number: "Enter a number",
  share: "Enter a share from 0 to 1: 0.42 is 42%",
  boolean: "Pick true, false or none",
  date: "Enter a date as YYYY-MM-DD",
  json: "Not valid JSON",
  empty: "Enter a value, or tick “Clear this value” to clear it",
  option: "Pick one of the listed values",
} as const;

const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * The submitted `value` parsed by its kind. "Clear this value" (`clear`) saves null whatever the box holds; an empty
 * box without it is refused. A share (`share` set) may be typed with a percent sign ("42%" is 0.42) and must lie in 0–1.
 * Boolean's "none" is null (the select is the choice, so it needs no box).
 */
export function parseInput(kind: EditKind, form: FormLike): Parsed {
  const raw = text(form.get("value"));
  const trimmed = raw.trim();
  if (kind === "boolean") {
    if (trimmed === "true") return { ok: true, value: true };
    if (trimmed === "false") return { ok: true, value: false };
    if (trimmed === "none") return { ok: true, value: null };
    return { ok: false, problem: PROBLEMS.boolean };
  }
  if (form.get("clear")) return { ok: true, value: null };
  if (trimmed === "") return { ok: false, problem: PROBLEMS.empty };

  switch (kind) {
    case "number": {
      const share = !!form.get("share");
      let t = trimmed.replace(/[,\s$]/g, "");
      const percent = share && t.endsWith("%");
      if (percent) t = t.slice(0, -1);
      if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return { ok: false, problem: PROBLEMS.number };
      let n = Number(t);
      if (!Number.isFinite(n)) return { ok: false, problem: PROBLEMS.number };
      if (percent) n = Number((n / 100).toPrecision(12));
      if (share && (n < 0 || n > 1)) return { ok: false, problem: PROBLEMS.share };
      return { ok: true, value: n };
    }
    case "date": {
      if (!DATE_RE.test(trimmed)) return { ok: false, problem: PROBLEMS.date };
      const d = new Date(`${trimmed}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== trimmed) return { ok: false, problem: PROBLEMS.date };
      return { ok: true, value: trimmed };
    }
    case "json": {
      let value: unknown;
      try {
        value = JSON.parse(trimmed);
      } catch {
        return { ok: false, problem: PROBLEMS.json };
      }
      if (value === null) return { ok: false, problem: PROBLEMS.empty };
      return { ok: true, value };
    }
    case "enum":
    case "text":
      return { ok: true, value: trimmed };
  }
}

/* ------------------------------------------------------------------ */
/* Reading a value and its citation                                    */
/* ------------------------------------------------------------------ */

/** Compact JSON, cut at `max` characters. */
function preview(value: unknown, max = 80): string {
  const s = JSON.stringify(value) ?? "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const percentOf = (share: number) => `${Number((share * 100).toFixed(1)).toLocaleString("en-US")}%`;

/** A value as the editor shows it: numbers with separators, a share as a percent and the raw share, Yes/No, short JSON. */
export function formatValue(value: unknown, share = false): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "number") return share ? `${percentOf(value)} (${value})` : value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  return preview(value);
}

/** What the input starts with: the value as the kind's input takes it. */
export function inputValue(value: unknown, kind: EditKind): string {
  if (kind === "boolean") return value === true ? "true" : value === false ? "false" : "none";
  if (value === null || value === undefined) return "";
  if (kind === "json") return JSON.stringify(value, null, 2);
  return String(value);
}

/** "October 31, 2026" for a day or an ISO timestamp (the UTC day, as an edit's lineage records it). */
export function longDate(iso: string): string {
  const day = iso.slice(0, 10);
  if (!DATE_RE.test(day)) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** The citation in one line, the way the ⓘ popover words it. */
export function citationText(c: Cited, record?: LineageRecord | null): string {
  if (c.key === "quad-edit" || c.method === "edited" || record?.source === "quad-edit") {
    const day = record?.retrieved ?? c.retrieved;
    return `Edited by Quad on ${longDate(day)}.${record?.note ? ` ${record.note}` : ""}`;
  }
  const named = (s: Pick<Cited, "label" | "key" | "year">) => `${s.label}${citesYear(s) ? `, ${yearLabel(s)}` : ""}`;
  let line: string;
  if (c.directory) line = `Listed by ${c.directory.organization}.`;
  else if (c.method === "derived" && c.inputs?.length) line = `Calculated: ${c.formula}. From ${c.inputs.map(named).join("; ")}.`;
  else if (c.key === "college-site") line = `Reported by ${c.publisher}${c.cdsEdition ? ` in its Common Data Set ${c.cdsEdition}` : " on its own site"}.`;
  else line = `${c.method === "extracted" ? "Read from" : "Reported in"} ${named(c)}${c.page !== undefined ? `, p. ${c.page}` : ""}.`;
  return c.retrieved ? `${line} Retrieved ${c.retrieved}.` : line;
}

/* ------------------------------------------------------------------ */
/* Which paths, and what reads them                                    */
/* ------------------------------------------------------------------ */

/** Whether the console offers an input for a path: registered, not computed or hidden (editProblem), and not the key. */
export function isEditablePath(path: string): boolean {
  return path !== "unit_id" && editProblem({ unit_id: "0", path }) === null;
}

/** The stored derived fields (registry `derived`, not `computed`) whose inputs include `path`: editing it doesn't move them. */
export function derivedReaders(path: string): FieldPath[] {
  return (Object.keys(FIELDS) as FieldPath[]).filter((p) => {
    const def = FIELDS[p] as FieldDef;
    return !!def.derived && !def.computed && def.derived.inputs.includes(path);
  });
}

/** The sentence under a stored derived field's row. */
export const derivedNote = (formula: string) => `Derived: ${formula}. Editing an input does not recompute it; set this value too if it should change`;

/** The sentence under an input's row naming the stored derived fields that read it, or null. */
export function readersNote(readers: readonly { label: string }[]): string | null {
  if (!readers.length) return null;
  return `Stored derived ${readers.length === 1 ? "field" : "fields"} reading this: ${readers.map((r) => r.label).join(", ")}. Editing this does not recompute ${readers.length === 1 ? "it" : "them"}`;
}

/* ------------------------------------------------------------------ */
/* The marker                                                         */
/* ------------------------------------------------------------------ */

export interface MarkerOptions {
  /** A source key's name for readers ("IPEDS Admissions"). Default: the key. */
  sourceLabel?: (key: SourceKey) => string;
}

/**
 * "A newer pipeline value exists: {value} from {source}, {date}" for a live edit, or null: shown when the served
 * snapshot's `edits.json` has the pipelines' value at this college and path (a stored null counts), it differs from
 * the edit's, and its lineage record says it was retrieved after the edit's day. No object (not published yet, or
 * unreadable), no pipeline value (`pipeline: null`, the key was absent), the same value, no lineage record (the date is
 * unknown), or an older one: no marker.
 */
export function newerPipeline(edit: Pick<FieldEdit, "unit_id" | "path" | "value" | "created_at">, snapshot: SnapshotEditsObject | null, opts: MarkerOptions = {}): string | null {
  const entry = snapshot?.edits?.find((e) => e.unit_id === edit.unit_id && e.path === edit.path);
  const pipeline = entry?.pipeline;
  if (!pipeline || sameValue(pipeline.value, edit.value)) return null;
  // No lineage record at the path (a field cited by its default source): the date is unknown, so no evidence it's newer.
  const retrieved = pipeline.lineage?.retrieved ?? null;
  if (!retrieved || retrieved.slice(0, 10) <= edit.created_at.slice(0, 10)) return null;
  const def = (FIELDS as Record<string, FieldDef>)[edit.path];
  const source = (pipeline.lineage?.source ?? def?.source) as SourceKey | undefined;
  const label = source ? (opts.sourceLabel?.(source) ?? source) : "the pipelines";
  return `A newer pipeline value exists: ${formatValue(pipeline.value, def?.notify?.unit === "percent")} from ${label}, ${longDate(retrieved)}`;
}

/* ------------------------------------------------------------------ */
/* The rows                                                            */
/* ------------------------------------------------------------------ */

export interface HistoryRow {
  id: number;
  at: string;
  who: string;
  display: string;
  note: string | null;
  status: "live" | "released" | "replaced";
}

export interface EditRow extends KindInfo {
  path: string;
  label: string;
  current: unknown;
  /** What the input starts with. */
  input: string;
  display: string;
  cited: string;
  /** The value shown is a live edit. */
  edited: boolean;
  /** The live edit's id (for Release), or null. */
  liveEditId: number | null;
  /** The served snapshot still carries an edit that has since been released: the next publish brings the pipelines' value back. */
  releasedPending: boolean;
  newerPipeline: string | null;
  /** A stored derived field's note ("Derived: {formula}. Editing an input does not recompute it; …"), or null. */
  derivedNote: string | null;
  /** The stored derived fields that read this one. */
  readers: { path: string; label: string }[];
  /** The sentence naming them, or null when none does. */
  readersNote: string | null;
  /** Every edit of this path, newest first. */
  history: HistoryRow[];
}

export interface EditGroup {
  topic: Topic;
  label: string;
  rows: EditRow[];
}

export interface EditableRowsOptions extends MarkerOptions {
  /** The dataset's citeField (lineageFor over its meta). */
  cite: (path: FieldPath, school: School) => Cited;
  /** Who made each edit, by user id; anyone missing reads "an admin". */
  names?: ReadonlyMap<string, string | null>;
}

const newestFirst = (a: FieldEdit, b: FieldEdit) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id);

/**
 * Every editable path for one college, grouped by topic in the registry's order: the value shown (the served college
 * with its live edits applied), its citation, its input, whether it's an edit, the marker, the derived notes, and the
 * path's edit history. `edits` are this college's rows of `data_field_edits` (any order, released ones too).
 */
export function editableRows(school: School, all: readonly School[], edits: readonly EditRecord[], snapshot: SnapshotEditsObject | null, opts: EditableRowsOptions): EditGroup[] {
  const mine = edits.filter((e) => e.unit_id === school.unit_id);
  const live = new Map(liveEdits(mine).map((e) => [e.path, e]));
  const shown = withEdits(school, mine);
  const groups = new Map<Topic, EditGroup>();
  for (const path of Object.keys(FIELDS) as FieldPath[]) {
    if (!isEditablePath(path)) continue;
    const def = FIELDS[path] as FieldDef;
    const kind = inferKind(path, shown, all);
    const current = valueAt(shown, path) ?? null;
    const edit = live.get(path) ?? null;
    const record = (shown.lineage as Record<string, LineageRecord> | undefined)?.[path] ?? null;
    const baked = (school.lineage as Record<string, LineageRecord> | undefined)?.[path]?.source === "quad-edit";
    const history = mine
      .filter((e) => e.path === path)
      .sort(newestFirst)
      .map<HistoryRow>((e) => ({
        id: e.id,
        at: e.created_at,
        who: (e.created_by && opts.names?.get(e.created_by)) || "an admin",
        display: formatValue(e.value, kind.share),
        note: e.note ?? null,
        status: e.released_at ? "released" : edit?.id === e.id ? "live" : "replaced",
      }));
    const readers = derivedReaders(path).map((p) => ({ path: p, label: FIELDS[p].label }));
    const row: EditRow = {
      ...kind,
      path,
      label: def.label,
      current,
      input: inputValue(current, kind.kind),
      display: formatValue(current, kind.share),
      cited: citationText(opts.cite(path, shown), record),
      edited: !!edit,
      liveEditId: edit?.id ?? null,
      releasedPending: !edit && baked,
      newerPipeline: edit ? newerPipeline(edit, snapshot, opts) : null,
      derivedNote: def.derived && !def.computed ? derivedNote(def.derived.formula) : null,
      readers,
      readersNote: readersNote(readers),
      history,
    };
    let g = groups.get(def.topic);
    if (!g) groups.set(def.topic, (g = { topic: def.topic, label: TOPIC_LABELS[def.topic], rows: [] }));
    g.rows.push(row);
  }
  return [...groups.values()];
}
