import "server-only";
/**
 * What /admin/colleges/[unit]/edit reads (specs/data-platform/change-sets.md "Admin edits"): the college from the
 * served dataset, its rows of `data_field_edits` (every one, newest first, with who made it), the names of those
 * admins, and the served snapshot's `edits.json` for the marker "a newer pipeline value exists". The rows are built by
 * lib/admin/edits-view.ts (pure). Callers check requireAdmin() first (the page and the actions do).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getData, getSnapshotId } from "@/lib/data";
import { withEdits } from "@/lib/data-platform/edits";
import { SNAPSHOT_OBJECTS, snapshotPath, type SnapshotEditsObject } from "@/lib/data-platform/snapshot";
import { sourceInfo } from "@/lib/lineage";
import { adminSupabase } from "@/lib/admin/people";
import type { School } from "@/lib/types";
import { editableRows, type EditGroup, type EditRecord } from "./edits-view";

/** The minimal client these reads need (the admin's session in production, a fake in tests). */
type Client = Pick<SupabaseClient, "from">;

const EDIT_COLUMNS = "id, unit_id, path, value, note, created_at, created_by, released_at";

/** Every edit row for one college, newest first (by time, then id). Throws naming the read when it fails. */
export async function collegeEdits(supabase: Client, unit: string): Promise<EditRecord[]> {
  const { data, error } = await supabase.from("data_field_edits").select(EDIT_COLUMNS).eq("unit_id", unit).order("id", { ascending: false });
  if (error) throw new Error(`admin: reading the edits of ${unit} failed: ${error.message}`);
  return ((data ?? []) as EditRecord[]).map((r) => ({ ...r, id: Number(r.id) })).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
}

/** One edit row by id, or null (the actions read the row they release or revert to). */
export async function readEdit(supabase: Client, id: number): Promise<EditRecord | null> {
  const { data, error } = await supabase.from("data_field_edits").select(EDIT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`admin: reading edit ${id} failed: ${error.message}`);
  return data ? ({ ...(data as EditRecord), id: Number((data as EditRecord).id) } as EditRecord) : null;
}

/**
 * Display names for the admins who made edits, by user id, from `profiles` (the same read the people module makes
 * for the log). A failed read is an empty map: every row then says "an admin".
 */
export async function editorNames(supabase: Client, ids: readonly (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (!wanted.length) return new Map();
  const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", wanted);
  if (error) {
    console.error(`[admin edits] reading editors' names failed; showing "an admin". ${error.message}`);
    return new Map();
  }
  return new Map(((data ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name]));
}

/** Log a failed read at most once a minute, like the loader. */
const LOG_EVERY_MS = 60_000;
let snapshotEditsFailureLogged = Number.NEGATIVE_INFINITY;

const isEditsObject = (v: unknown): v is SnapshotEditsObject => !!v && typeof v === "object" && Array.isArray((v as SnapshotEditsObject).edits);

/**
 * The served snapshot's `edits.json`, or null when it can't be known: no DATA_SNAPSHOT_URL, a dataset from data/ or
 * the bundled fixture, a snapshot published before the object existed (404), or a failed or malformed read (logged at
 * most once a minute). Read through Next's fetch cache (`force-cache`: the id is in the URL, so a new snapshot is a
 * new key).
 */
export async function snapshotEdits(opts: { id?: string; base?: string; fetchImpl?: typeof fetch } = {}): Promise<SnapshotEditsObject | null> {
  const base = (opts.base ?? process.env.DATA_SNAPSHOT_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  let id: string;
  try {
    id = opts.id ?? (await getSnapshotId());
  } catch {
    return null;
  }
  if (!/^[1-9]\d*$/.test(id)) return null;
  const url = `${base}/${snapshotPath(Number(id), SNAPSHOT_OBJECTS.edits)}`;
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { cache: "force-cache" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
    const body: unknown = await res.json();
    if (!isEditsObject(body)) throw new Error(`GET ${url}: not an edits object`);
    return body;
  } catch (err) {
    const at = Date.now();
    if (at - snapshotEditsFailureLogged >= LOG_EVERY_MS) {
      snapshotEditsFailureLogged = at;
      console.error("[admin edits] the snapshot's edits.json could not be read; no marker is shown.", err);
    }
    return null;
  }
}

export interface CollegeEditor {
  /** The served college with its live edits applied (what the public pages show). */
  school: School;
  groups: EditGroup[];
}

/** The editor's rows for one college, or null for a unit id the dataset doesn't have. */
export async function loadCollegeEditor(unit: string): Promise<CollegeEditor | null> {
  const data = await getData();
  const base = data.getSchoolById(unit);
  if (!base) return null;
  const supabase = await adminSupabase();
  const [edits, snapshot] = await Promise.all([collegeEdits(supabase, unit), snapshotEdits()]);
  const names = await editorNames(supabase, edits.map((e) => e.created_by));
  const meta = data.getMeta();
  const groups = editableRows(base, data.getAllSchools(), edits, snapshot, {
    cite: data.citeField,
    names,
    sourceLabel: (key) => sourceInfo(meta, key).label,
  });
  return { school: withEdits(base, edits), groups };
}
