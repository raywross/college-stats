"use server";
/**
 * Server Actions and queries for saved lists (specs/product/saved-lists.md, specs/product/household-hub.md "One list
 * per person"). Every read and write runs with the signed-in user's own Supabase session, so the lists policies
 * (supabase/migrations/20261006150000_household_hub.sql) decide: a student's list is changed by the student or a
 * guardian with edit access; a user's own list (a guardian's) is read by their household and changed by them only.
 * Pure types and rules (owners, CSV, balance line, deadlines, transitions, the tracking row) live in
 * lib/list-rules.ts.
 *
 * Public pages (profile, Explore, compare tray) call addToMyDefaultList/removeFromMyLists/isOnAnyList from a client
 * component (AddToListButton); they never read cookies during render. "My" lists are the signed-in person's own:
 * their student record's, or, for someone without one (a guardian), the lists they own as a user.
 */
import { cache } from "react";
import { getUser, authConfigured, currentStudent, studentsICanSee } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { getData } from "@/lib/data";
import { isUnitId } from "@/lib/follow-state";
import {
  DEFAULT_LIST_NAME,
  applyOutcome,
  isoDateOrNull,
  ownerColumn,
  parseCsv,
  setStatus as setStatusPure,
  toCsv,
  type CsvRow,
  type ListCategory,
  type ListItem,
  type ListNote,
  type ListOutcome,
  type ListOwner,
  type ListRecord,
  type ListRound,
  type ListStatus,
  isListCategory,
  isListOutcome,
  isListRound,
  isListStatus,
} from "@/lib/list-rules";

const ITEM_COLUMNS =
  "id, list_id, unit_id, category, status, outcome, round, position, added_by, added_at, decision_date, deadline_text, deadline_date, enrolling, updates, visited_on, follows_social";
const LIST_COLUMNS = "id, student_id, user_id, name, is_default, share_enabled, created_by, created";

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

/**
 * The signed-in person's own owner: their student record when they have one (currentStudent() creates it for a
 * student), else themselves as a user (a guardian). Null when signed out or unconfigured.
 */
async function myOwner(): Promise<ListOwner | null> {
  if (!authConfigured()) return null;
  const student = await currentStudent();
  if (student) return { kind: "student", id: student.id };
  const user = await getUser();
  return user ? { kind: "user", id: user.id } : null;
}

/** The ids of every list `owner` has (the reader's RLS still applies). */
async function listIdsOf(supabase: Ready["supabase"], owner: ListOwner): Promise<{ ids: string[] } | { error: { code?: string; message?: string } }> {
  const { column, id } = ownerColumn(owner);
  const { data, error } = await supabase.from("lists").select("id").eq(column, id);
  if (error) return { error };
  return { ids: (data as { id: string }[]).map((l) => l.id) };
}

/** Accepts a bare student id, the call shape from before lists had two owner kinds. */
function asOwner(owner: ListOwner | string): ListOwner {
  return typeof owner === "string" ? { kind: "student", id: owner } : owner;
}

/* ------------------------------------------------------------------ */
/* Reads                                                                */
/* ------------------------------------------------------------------ */

/**
 * One owner's lists, memoized per request (React `cache`) so a page and the components under it share a single
 * query. `cache` compares arguments by identity and every caller builds a fresh `owner` object, so this takes the
 * owner's two strings (kind, id) and `myLists` unpacks it. A read only: the write path (getOrCreateDefaultList) is
 * not cached, so a page that has just created the default list must not expect it here (ListPage adds it).
 */
const listsOfOwner = cache(async (kind: ListOwner["kind"], ownerId: string): Promise<ListRecord[]> => {
  const r = await ready();
  if (!r) return [];
  const { column, id } = ownerColumn({ kind, id: ownerId });
  const { data, error } = await r.supabase.from("lists").select(LIST_COLUMNS).eq(column, id).order("is_default", { ascending: false }).order("created");
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`Reading lists failed: ${error.message}`);
  }
  return data as ListRecord[];
});

/** Every list the signed-in user can read for `owner` (a student they can see, or a user in their household), default first. */
export async function myLists(owner: ListOwner): Promise<ListRecord[]> {
  return listsOfOwner(owner.kind, owner.id);
}

/**
 * The owner's default list, created lazily (first "Add to list", first visit to the person's page). A user's own
 * default can only be created by that user (RLS). Null when signed out/unconfigured. A bare string is a student id
 * (the call shape from before user-owned lists).
 */
export async function getOrCreateDefaultList(ownerOrStudentId: ListOwner | string): Promise<ListRecord | null> {
  const r = await ready();
  if (!r) return null;
  const { column, id } = ownerColumn(asOwner(ownerOrStudentId));
  const existing = await r.supabase.from("lists").select(LIST_COLUMNS).eq(column, id).eq("is_default", true).maybeSingle();
  if (existing.error && !isMissingTable(existing.error)) throw new Error(`Reading your list failed: ${existing.error.message}`);
  if (existing.data) return existing.data as ListRecord;
  const inserted = await r.supabase.from("lists").insert({ [column]: id, name: DEFAULT_LIST_NAME, is_default: true }).select(LIST_COLUMNS).single();
  if (inserted.error) {
    // Two requests racing to create it: the partial unique index lost one insert; read the winner.
    const again = await r.supabase.from("lists").select(LIST_COLUMNS).eq(column, id).eq("is_default", true).maybeSingle();
    if (again.data) return again.data as ListRecord;
    throw new Error(`Creating your list failed: ${inserted.error.message}`);
  }
  return inserted.data as ListRecord;
}

export interface ListWithItems {
  list: ListRecord;
  items: ListItem[];
}

/** The list and its items for one id, memoized per request (React `cache`, keyed by the id string). A read only. */
const readListWithItems = cache(async (listId: string): Promise<ListWithItems | null> => {
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
});

/** A list and its items, in position order, for whoever can read the list. Null when not found/visible. */
export async function getListWithItems(listId: string): Promise<ListWithItems | null> {
  return readListWithItems(listId);
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

/** Whether the signed-in person's own college list(s) include `unitId` (for the Add-to-list button's initial state). */
export async function isOnAnyList(unitId: string): Promise<boolean> {
  if (!isUnitId(unitId)) return false;
  const owner = await myOwner();
  if (!owner) return false;
  const r = await ready();
  if (!r) return false;
  const lists = await listIdsOf(r.supabase, owner);
  if ("error" in lists) {
    if (isMissingTable(lists.error)) return false;
    console.error(`lists: isOnAnyList failed: ${lists.error.message}`);
    return false;
  }
  const listIds = lists.ids;
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

/** Another (non-default) list for `owner`: a student the user can edit, or the user themselves (RLS decides). */
export async function createList(owner: ListOwner, name: string): Promise<ListActionResult> {
  if (owner?.kind !== "student" && owner?.kind !== "user") return { ok: false, message: FAILED };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in to create a list." };
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { ok: false, message: "Give the list a name." };
  const { column, id } = ownerColumn(owner);
  const { error } = await r.supabase.from("lists").insert({ [column]: id, name: trimmed });
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

/**
 * Adds one or more colleges to the signed-in person's own default list, creating it if needed: a student's on their
 * record, a guardian's as a list they own (household-hub.md: a guardian's "Add to list" goes to their own list).
 * For AddToListButton.
 */
export async function addToMyDefaultList(unitIds: string[]): Promise<ListActionResult> {
  const owner = await myOwner();
  if (!owner) return { ok: false, message: "Sign in to save colleges to a list." };
  const list = await getOrCreateDefaultList(owner);
  if (!list) return { ok: false, message: FAILED };
  for (const unitId of unitIds) {
    const result = await addToList(list.id, unitId);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** Removes a college from every one of the signed-in person's own lists that has it (the Add-to-list button's "remove"). */
export async function removeFromMyLists(unitId: string): Promise<ListActionResult> {
  if (!isUnitId(unitId)) return { ok: false, message: "We couldn't find that college." };
  const owner = await myOwner();
  if (!owner) return { ok: false, message: "Sign in first." };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const lists = await listIdsOf(r.supabase, owner);
  if ("error" in lists) return fail(lists.error, "removeFromMyLists");
  const listIds = lists.ids;
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

/** The tracking row's Updates switch; the follows trigger adds or removes the owner's follow to match. */
export async function setUpdates(itemId: string, updates: boolean): Promise<ListActionResult> {
  if (typeof updates !== "boolean") return { ok: false, message: FAILED };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { error } = await r.supabase.from("list_items").update({ updates }).eq("id", itemId);
  if (error) return fail(error, "setUpdates");
  return { ok: true };
}

/** The tracking row's Visited: a yyyy-mm-dd, or null to clear it. */
export async function setVisited(itemId: string, date: string | null): Promise<ListActionResult> {
  const visited_on = date === null ? null : isoDateOrNull(date);
  if (date !== null && visited_on === null) return { ok: false, message: "That isn't a date." };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { error } = await r.supabase.from("list_items").update({ visited_on }).eq("id", itemId);
  if (error) return fail(error, "setVisited");
  return { ok: true };
}

/** The tracking row's "Following on social": the person's own say-so, nothing more. */
export async function setFollowsSocial(itemId: string, followsSocial: boolean): Promise<ListActionResult> {
  if (typeof followsSocial !== "boolean") return { ok: false, message: FAILED };
  const r = await ready();
  if (!r) return { ok: false, message: "Sign in first." };
  const { error } = await r.supabase.from("list_items").update({ follows_social: followsSocial }).eq("id", itemId);
  if (error) return fail(error, "setFollowsSocial");
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
    updates: item.updates,
    visited_on: item.visited_on,
    follows_social: item.follows_social,
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
      updates: row.updates,
      visited_on: row.visited_on,
      follows_social: row.follows_social,
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
