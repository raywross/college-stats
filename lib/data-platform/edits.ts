/**
 * Admin edits, the last layer (specs/data-platform/change-sets.md "Admin edits"; storage.md `data_field_edits`): an
 * admin sets any registered value in the console, with no source asked for, and the value cites Quad's editors and
 * the day. The publisher (scripts/lib/data-platform/compose.mts) applies every live edit after every pipeline layer;
 * the live overlay (later in this file's life: `cache()`d per request) applies the same function, so a page and the
 * next snapshot never disagree. Pure, no I/O.
 */
import { FIELDS, isFieldPath, type FieldPath } from "../fields.ts";
import type { LineageRecord, School, SourceInfo } from "../types.ts";

/** One row of `data_field_edits` (the columns the publisher and the overlay read). */
export interface FieldEdit {
  id: number;
  unit_id: string;
  path: string;
  /** The value to store; null clears it (the pipeline's value shows again only once the edit is released). */
  value: unknown;
  note?: string | null;
  /** ISO timestamp of the edit. */
  created_at: string;
  released_at?: string | null;
}

/** The lineage record an edit writes: Quad's editors, method `edited`, the day it was made, and the note. */
export function editLineage(edit: Pick<FieldEdit, "created_at" | "note">): LineageRecord {
  return { source: "quad-edit", method: "edited", retrieved: edit.created_at.slice(0, 10), ...(edit.note ? { note: edit.note } : {}) };
}

/** Why an edit can't be applied (an unregistered, computed or hidden path), or null. The console checks the same. */
export function editProblem(edit: Pick<FieldEdit, "unit_id" | "path">): string | null {
  if (!isFieldPath(edit.path)) return `edit ${edit.unit_id} ${edit.path}: not a registered field (lib/fields.ts)`;
  const def = FIELDS[edit.path as FieldPath] as (typeof FIELDS)[FieldPath] & { hidden?: true };
  if ("computed" in def) return `edit ${edit.unit_id} ${edit.path}: computed at render time, so it can't be edited`;
  if (def.hidden) return `edit ${edit.unit_id} ${edit.path}: a hidden field can't be edited`;
  return null;
}

/** The live edit per path for one college: the newest unreleased row (by `created_at`, then id). */
export function liveEdits(edits: readonly FieldEdit[]): FieldEdit[] {
  const byPath = new Map<string, FieldEdit>();
  for (const e of edits) {
    if (e.released_at) continue;
    const cur = byPath.get(e.path);
    if (!cur || e.created_at > cur.created_at || (e.created_at === cur.created_at && e.id > cur.id)) byPath.set(e.path, e);
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `obj` with `value` at the dotted `path` (missing objects created; existing keys keep their place), as a copy. */
function setAt(obj: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path;
  const out = { ...obj };
  out[head] = rest.length ? setAt(isPlainObject(obj[head]) ? obj[head] : {}, rest, value) : structuredClone(value);
  return out;
}

/** Top-level keys whose place later pipelines own (lib/identity.ts placeTopLevel): a new `lineage` goes before these. */
const LINEAGE_ANCHORS = ["trends", "reported"];

/**
 * The college with each live edit for it applied: the value set at its path and `lineage[path]` replaced by the
 * edit's record. Returns a new school (the input is untouched); edits for other colleges, released ones, and those
 * `editProblem` refuses are ignored (the publisher reports the refused ones).
 */
export function withEdits(school: School, edits: readonly FieldEdit[]): School {
  const mine = liveEdits(edits.filter((e) => e.unit_id === school.unit_id && !editProblem(e)));
  if (!mine.length) return school;
  let out = school as unknown as Record<string, unknown>;
  const lineage: Record<string, LineageRecord> = { ...(school.lineage ?? {}) } as Record<string, LineageRecord>;
  for (const e of mine) {
    out = setAt(out, e.path.split("."), e.value);
    lineage[e.path] = editLineage(e);
  }
  if ("lineage" in out) return { ...out, lineage } as unknown as School;
  const entries = Object.entries(out);
  let at = entries.findIndex(([k]) => LINEAGE_ANCHORS.includes(k));
  if (at < 0) at = entries.length;
  return Object.fromEntries([...entries.slice(0, at), ["lineage", lineage], ...entries.slice(at)]) as unknown as School;
}

/** meta.json's entry for Quad's editors, added by the publisher once any college carries an edit. */
export function quadEditSource(): SourceInfo {
  return {
    label: "Quad's editors",
    publisher: "Quad",
    edition: "Edited in Quad's console",
    url: "https://usequad.app/data",
    description:
      "Values Quad's editors set by hand, where a pipeline's value was missing or wrong. Each one is cited with the day it was edited; a pipeline's newer value takes over only when an editor releases the edit.",
  };
}
