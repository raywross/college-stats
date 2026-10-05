"use server";
/**
 * Server Actions and queries for saved lists (specs/product/saved-lists.md). Every read and write runs with the
 * signed-in user's own Supabase session, so the lists policies (supabase/migrations/20261005150000_lists.sql)
 * decide: a student (or a guardian with edit access) sees and changes only the lists of students they can reach.
 * Pure types and rules (CSV, balance line, deadlines, transitions) live in lib/list-rules.ts.
 *
 * Public pages (profile, Explore, compare tray) call addToList/removeFromList/isOnAnyList from a client component
 * (AddToListButton); they never read cookies during render.
 */
import { getUser, authConfigured, currentStudent, studentsICanSee } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { getData } from "@/lib/data";
import { isUnitId } from "@/lib/follow-state";
import {
  DEFAULT_LIST_NAME,
  applyOutcome,
  parseCsv,
  setStatus as setStatusPure,
  toCsv,
  type CsvRow,
  type ListCategory,
  type ListItem,
  type ListNote,
  type ListOutcome,
  type ListRecord,
  type ListRound,
  type ListStatus,
  isListCategory,
  isListOutcome,
  isListRound,
  isListStatus,
} from "@/lib/list-rules";

const ITEM_COLUMNS = "id, list_id, unit_id, category, status, outcome, round, position, added_by, added_at, decision_date, deadline_text, deadline_date, enrolling";
const LIST_COLUMNS = "id, student_id, name, is_default, share_enabled, created_by, created";

export type ListActionResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

function fail(error: { message?: string } | null | undefined, what: string): ListActionResult {
  if (error) console.error(`lists: ${what} failed: ${error.message}`);
  return { ok: false, message: FAILED };
}

type Ready = { userId: string; supabase: Awaited<ReturnType<typeof createServerSupabase>> };

async function ready(): Promise<Ready | null> {
  if (!authConfigured()) return null;
  const user = await getUser();
  if (!user) return null;
  return { userId: user.id, supabase: await createServerSupabase() };
}

/* ------------------------------------------------------------------ */
/* Reads                                                                */
/* ------------------------------------------------------------------ */

/** Every list the signed-in user can read for `studentId` (own, or a student they can see as a guardian). */
export async function myLists(studentId: string): Promise<ListRecord[]> {
  const r = await ready();
  if (!r) return [];
  const { data, error } = await r.supabase.from("lists").select(LIST_COLUMNS).eq("student_id", studentId).order("is_default", { ascending: false }).order("created");
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`Reading lists failed: ${error.message}`);
  }
  return data as ListRecord[];
}

/** The student's default list, created lazily on first visit to /me/list. Null when signed out/unconfigured. */
export async function getOrCreateDefaultList(studentId: string): Promise<ListRecord | null> {
  const r = await ready();
  if (!r) return null;
  const existing = await r.supabase.from("lists").select(LIST_COLUMNS).eq("student_id", studentId).eq("is_default", true).maybeSingle();
  if (existing.error && !isMissingTable(existing.error)) throw new Error(`Reading your list failed: ${existing.error.message}`);
  if (existing.data) return existing.data as ListRecord;
  const inserted = await r.supabase.from("lists").insert({ student_id: studentId, name: DEFAULT_LIST_NAME, is_default: true }).select(LIST_COLUMNS).single();
  if (inserted.error) {
    // Two requests racing to create it: the partial unique index lost one insert; read the winner.
    const again = await r.supabase.from("lists").select(LIST_COLUMNS).eq("student_id", studentId).eq("is_default", true).maybeSingle();
    if (again.data) return again.data as ListRecord;
    throw new Error(`Creating your list failed: ${inserted.error.message}`);
  }
  return inserted.data as ListRecord;
}

export interface ListWithItems {
  list: ListRecord;
  items: ListItem[];
}

/** A list and its items, newest-position order, for whoever can read the student. Null when not found/visible. */
export async function getListWithItems(listId: string): Promise<ListWithItems | null> {
  const r = await ready();
  if (!r) return null;
  const list = await r.supabase.from("lists").select(LIST_COLUMNS).eq("id", listId).maybeSingle();
  if (list.error) {
    if (isMissingTable(list.error)) return null;
    throw new Error(`Reading that list failed: ${list.error.message}`);
  }
  if (!list.data) return null;
  const items = await r.supabase.from("list_items").select(ITEM_COLUMNS).eq("list_id", listId).order("position");
  if (items.error) throw new Error(`Reading that list's colleges failed: ${items.error.message}`);
  return { list: list.data as ListRecord, items: items.data as ListItem[] };
}

/** Notes for a set of items, grouped by item id (private notes the reader can't see are already filtered by RLS). */
export async function notesForItems(itemIds: string[]): Promise<Record<string, ListNote[]>> {
  const r = await ready();
  if (!r || itemIds.length === 0) return {};
  const { data, error } = await r.supabase.from("list_notes").select("id, item_id, author_id, body, private, created").in("item_id", itemIds).order("created");
  if (error) {
    if (isMissingTable(error)) return {};
    throw new Error(`Reading notes failed: ${error.message}`);
  }
  const byItem: Record<string, ListNote[]> = {};
  for (const note of data as ListNote[]) (byItem[note.item_id] ??= []).push(note);
  return byItem;
}

/** Display names for a set of user ids (added_by attribution), own profile first. Falls back to "a guardian". */
export async function namesFor(userIds: string[]): Promise<Record<string, string | null>> {
  const r = await ready();
  if (!r || userIds.length === 0) return {};
  const unique = [...new Set(userIds)];
  const { data, error } = await r.supabase.from("profiles").select("id, display_name").in("id", unique);
  if (error) return {};
  return Object.fromEntries((data as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name]));
}

/** Whether the signed-in user's own college list(s) include `unitId` (for the Add-to-list button's initial state). */
export async function isOnAnyList(unitId: string): Promise<boolean> {
  if (!isUnitId(unitId)) return false;
  const student = await currentStudent();
  if (!student) return false;
  const r = await ready();
  if (!r) return false;
  const lists = await r.supabase.from("lists").select("id").eq("student_id", student.id);
  if (lists.error) {
    if (isMissingTable(lists.error)) return false;
    console.error(`lists: isOnAnyList failed: ${lists.error.message}`);
    return false;
  }
  const listIds = (lists.data as { id: string }[]).map((l) => l.id);
  if (listIds.length === 0) return false;
  const { data, error } = await r.supabase.from("list_items").select("id").eq("unit_id", unitId).in("list_id", listIds).limit(1);
  if (error) {
    console.error(`lists: isOnAnyList failed: ${error.message}`);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Writes: lists                                                       */
/* ------------------------------------------------------------------ */

export async function createList(studentId: string, name: string): Promise<ListActionResult> {
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in to create a list." };
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { ok: false, message: "Give the list a name." };
  const { error } = await r.supabase.from("lists").insert({ student_id: studentId, name: trimmed });
  if (error) return fail(error, "createList");
  return { ok: true };
}

export async function deleteList(listId: string): Promise<ListActionResult> {
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { data, error } = await r.supabase.from("lists").delete().eq("id", listId).select("id");
  if (error) return fail(error, "deleteList");
  if (!data?.length) return { ok: false, message: "The default list can't be deleted." };
  return { ok: true };
}

export async function renameList(listId: string, name: string): Promise<ListActionResult> {
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { ok: false, message: "Give the list a name." };
  const { error } = await r.supabase.from("lists").update({ name: trimmed }).eq("id", listId);
  if (error) return fail(error, "renameList");
  return { ok: true };
}

/** Turns the share link on (returns the new token, shown once) or off. */
export async function setListShare(listId: string, enabled: boolean): Promise<{ ok: true; token: string | null } | { ok: false; message: string }> {
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { data, error } = await r.supabase.rpc("set_list_share", { p_list: listId, p_enabled: enabled });
  if (error) {
    console.error(`lists: setListShare failed: ${error.message}`);
    return { ok: false, message: FAILED };
  }
  return { ok: true, token: (data as string | null) ?? null };
}

/* ------------------------------------------------------------------ */
/* Writes: items                                                       */
/* ------------------------------------------------------------------ */

async function nextPosition(supabase: Ready["supabase"], listId: string): Promise<number> {
  const { data } = await supabase.from("list_items").select("position").eq("list_id", listId).order("position", { ascending: false }).limit(1);
  const rows = data as { position: number }[] | null;
  return (rows?.[0]?.position ?? -1) + 1;
}

/** Adds a college to a list (unsorted, considering). Adding it again is a no-op (the unique constraint catches it). */
export async function addToList(listId: string, unitId: string): Promise<ListActionResult> {
  if (!isUnitId(unitId)) return { ok: false, message: "We couldn't find that college." };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in to save colleges to a list." };
  const position = await nextPosition(r.supabase, listId);
  const { error } = await r.supabase.from("list_items").insert({ list_id: listId, unit_id: unitId, position });
  if (error && error.code !== "23505") return fail(error, "addToList");
  return { ok: true };
}

/** Adds one or more colleges to the signed-in user's own default list, creating it if needed. For AddToListButton. */
export async function addToMyDefaultList(unitIds: string[]): Promise<ListActionResult> {
  const student = await currentStudent();
  if (!student) return { ok: false, message: "Sign in to save colleges to a list." };
  const list = await getOrCreateDefaultList(student.id);
  if (!list) return { ok: false, message: FAILED };
  for (const unitId of unitIds) {
    const result = await addToList(list.id, unitId);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** Removes a college from every one of the signed-in user's own lists that has it (the Add-to-list button's "remove"). */
export async function removeFromMyLists(unitId: string): Promise<ListActionResult> {
  if (!isUnitId(unitId)) return { ok: false, message: "We couldn't find that college." };
  const student = await currentStudent();
  if (!student) return { ok: false, message: "Sign in first." };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const lists = await r.supabase.from("lists").select("id").eq("student_id", student.id);
  if (lists.error) return fail(lists.error, "removeFromMyLists");
  const listIds = (lists.data as { id: string }[]).map((l) => l.id);
  if (listIds.length === 0) return { ok: true };
  const { error } = await r.supabase.from("list_items").delete().eq("unit_id", unitId).in("list_id", listIds);
  if (error) return fail(error, "removeFromMyLists");
  return { ok: true };
}

export async function removeFromList(itemId: string): Promise<ListActionResult> {
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { error } = await r.supabase.from("list_items").delete().eq("id", itemId);
  if (error) return fail(error, "removeFromList");
  return { ok: true };
}

export async function setCategory(itemId: string, category: ListCategory): Promise<ListActionResult> {
  if (!isListCategory(category)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { error } = await r.supabase.from("list_items").update({ category }).eq("id", itemId);
  if (error) return fail(error, "setCategory");
  return { ok: true };
}

export async function setRound(itemId: string, round: ListRound | null): Promise<ListActionResult> {
  if (round !== null && !isListRound(round)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { error } = await r.supabase.from("list_items").update({ round }).eq("id", itemId);
  if (error) return fail(error, "setRound");
  return { ok: true };
}

export async function setItemStatus(itemId: string, status: ListStatus): Promise<ListActionResult> {
  if (!isListStatus(status)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const current = await r.supabase.from("list_items").select("status, outcome").eq("id", itemId).maybeSingle();
  if (current.error || !current.data) return fail(current.error, "setItemStatus");
  const next = setStatusPure(current.data as { status: ListStatus; outcome: ListOutcome | null }, status);
  const { error } = await r.supabase.from("list_items").update(next).eq("id", itemId);
  if (error) return fail(error, "setItemStatus");
  return { ok: true };
}

/** Records an outcome. `deferred` moves the item back to "applied" (lib/list-rules.ts applyOutcome). */
export async function setOutcome(itemId: string, outcome: ListOutcome, decisionDate: string | null): Promise<ListActionResult> {
  if (!isListOutcome(outcome)) return { ok: false, message: FAILED };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const next = applyOutcome(outcome);
  const { error } = await r.supabase.from("list_items").update({ ...next, decision_date: decisionDate }).eq("id", itemId);
  if (error) return fail(error, "setOutcome");
  return { ok: true };
}

export async function setDeadlineOverride(itemId: string, text: string | null, date: string | null): Promise<ListActionResult> {
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { error } = await r.supabase.from("list_items").update({ deadline_text: text?.slice(0, 200) || null, deadline_date: date || null }).eq("id", itemId);
  if (error) return fail(error, "setDeadlineOverride");
  return { ok: true };
}

export async function setEnrolling(itemId: string, enrolling: boolean): Promise<ListActionResult> {
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { error } = await r.supabase.from("list_items").update({ enrolling }).eq("id", itemId);
  if (error) return fail(error, "setEnrolling");
  return { ok: true };
}

/**
 * Moves an item up or down within its list (buttons, not drag-and-drop: specs/product/saved-lists.md "Display"
 * notes the deviation). Swaps `position` with the neighbor in the same list.
 */
export async function reorderItem(itemId: string, direction: "up" | "down"): Promise<ListActionResult> {
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const current = await r.supabase.from("list_items").select("id, list_id, position").eq("id", itemId).maybeSingle();
  if (current.error || !current.data) return fail(current.error, "reorderItem");
  const row = current.data as { id: string; list_id: string; position: number };
  let query = r.supabase.from("list_items").select("id, position").eq("list_id", row.list_id);
  query = direction === "up" ? query.lt("position", row.position).order("position", { ascending: false }) : query.gt("position", row.position).order("position", { ascending: true });
  const neighbor = await query.limit(1).maybeSingle();
  if (!neighbor.data) return { ok: true }; // already at an end
  const other = neighbor.data as { id: string; position: number };
  const [a, b] = await Promise.all([
    r.supabase.from("list_items").update({ position: other.position }).eq("id", row.id),
    r.supabase.from("list_items").update({ position: row.position }).eq("id", other.id),
  ]);
  if (a.error || b.error) return fail(a.error ?? b.error, "reorderItem");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Notes                                                                */
/* ------------------------------------------------------------------ */

export async function addNote(itemId: string, body: string, isPrivate: boolean): Promise<ListActionResult> {
  const trimmed = body.trim().slice(0, 2000);
  if (!trimmed) return { ok: false, message: "Write something first." };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { error } = await r.supabase.from("list_notes").insert({ item_id: itemId, body: trimmed, private: isPrivate });
  if (error) return fail(error, "addNote");
  return { ok: true };
}

export async function deleteNote(noteId: string): Promise<ListActionResult> {
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { error } = await r.supabase.from("list_notes").delete().eq("id", noteId);
  if (error) return fail(error, "deleteNote");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* CSV export / import                                                 */
/* ------------------------------------------------------------------ */

/** The list's CSV text (Scoir-compatible columns; lib/list-rules.ts toCsv), college names resolved from the dataset. */
export async function exportListCsv(listId: string): Promise<string | null> {
  const withItems = await getListWithItems(listId);
  if (!withItems) return null;
  const { getSchoolById } = await getData();
  const notes = await notesForItems(withItems.items.map((i) => i.id));
  const rows: CsvRow[] = withItems.items.map((item) => ({
    name: getSchoolById(item.unit_id)?.name ?? item.unit_id,
    category: item.category,
    round: item.round,
    status: item.status,
    outcome: item.outcome,
    deadline: item.deadline_date ?? item.deadline_text,
    enrolling: item.enrolling,
    notes: (notes[item.id] ?? []).filter((n) => !n.private).map((n) => n.body).join(" / "),
  }));
  return toCsv(rows);
}

export interface CsvImportResult {
  added: number;
  unmatched: string[];
}

/** Adds every matched row from a pasted CSV to the list (specs/product/saved-lists.md "Import"). Matching is by
 * exact (case-insensitive) college name only; unmatched names are reported back for the student to fix by hand. */
export async function importListCsv(listId: string, csvText: string): Promise<CsvImportResult> {
  const parsed = parseCsv(csvText);
  const { getAllSchools } = await getData();
  const byName = new Map(getAllSchools().map((s) => [s.name.toLowerCase(), s.unit_id]));
  let added = 0;
  const unmatched: string[] = [];
  for (const row of parsed) {
    const unitId = byName.get(row.name.toLowerCase());
    if (!unitId) {
      unmatched.push(row.name);
      continue;
    }
    const r = await ready();
    if (!r) break;
    const position = await nextPosition(r.supabase, listId);
    const { error } = await r.supabase.from("list_items").insert({
      list_id: listId,
      unit_id: unitId,
      position,
      category: row.category,
      round: row.round,
      status: row.status,
      outcome: row.outcome,
      enrolling: row.enrolling,
    });
    if (!error) added++;
    else if (error.code !== "23505") unmatched.push(row.name);
  }
  return { added, unmatched };
}

/* ------------------------------------------------------------------ */
/* Guardian helper                                                     */
/* ------------------------------------------------------------------ */

/** Every student (self first) the signed-in user can open a list for. Thin wrapper so pages don't import lib/auth directly. */
export async function studentsForLists() {
  return studentsICanSee();
}
