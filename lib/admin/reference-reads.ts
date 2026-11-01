import "server-only";
/**
 * The reference editor's reads (specs/data-platform/change-sets.md "Admin edits" → "Reference documents";
 * specs/data-platform/storage.md `reference.*`, `base.release_calendar`): the list of known documents, one
 * document's current body, and its versions. `data_documents`/`data_document_versions` select for everyone
 * (storage.md "Row-level security"), so these read with the admin's own session (`adminSupabase()`), like
 * lib/admin/data-reads.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { referenceDocumentKey, type ReferenceDocumentRow } from "./reference-view.ts";

async function rows<T>(what: string, query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`admin: reading ${what} failed: ${error.message}`);
  return data ?? [];
}

const DOC_COLUMNS = "collection, key, version, updated_at, change_set_id";

interface DocRow {
  collection: string;
  key: string;
  version: number;
  updated_at: string;
  change_set_id: number;
}

/** Every reference document the console lists: `reference.files` (every curated name) plus the release calendar, by name. */
export async function listReferenceDocuments(supabase: SupabaseClient): Promise<ReferenceDocumentRow[]> {
  const [files, calendar] = await Promise.all([
    rows<DocRow>("data_documents", supabase.from("data_documents").select(DOC_COLUMNS).eq("collection", "reference.files")),
    rows<DocRow>("data_documents", supabase.from("data_documents").select(DOC_COLUMNS).eq("collection", "base.release_calendar").eq("key", "calendar")),
  ]);
  return [...files, ...calendar]
    .map((r) => ({ name: r.key, collection: r.collection, key: r.key, version: r.version, updated_at: r.updated_at, change_set_id: r.change_set_id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface ReferenceDocumentBody {
  collection: string;
  key: string;
  version: number;
  body: unknown;
  updated_at: string;
  change_set_id: number;
}

/** One document's current body, or null when the name doesn't match a document. */
export async function loadReferenceDocument(supabase: SupabaseClient, name: string): Promise<ReferenceDocumentBody | null> {
  const { collection, key } = referenceDocumentKey(name);
  const { data, error } = await supabase.from("data_documents").select("collection, key, version, body, updated_at, change_set_id").eq("collection", collection).eq("key", key).maybeSingle();
  if (error) throw new Error(`admin: reading data_documents failed: ${error.message}`);
  return (data as ReferenceDocumentBody | null) ?? null;
}

export interface ReferenceVersionRow {
  version: number;
  body: unknown;
  deleted: boolean;
  change_set_id: number;
  created_at: string;
}

/** Every version of a document, newest first. */
export async function loadReferenceVersions(supabase: SupabaseClient, name: string): Promise<ReferenceVersionRow[]> {
  const { collection, key } = referenceDocumentKey(name);
  return rows<ReferenceVersionRow>(
    "data_document_versions",
    supabase.from("data_document_versions").select("version, body, deleted, change_set_id, created_at").eq("collection", collection).eq("key", key).order("version", { ascending: false }),
  );
}

/** One version's body, for Revert to version {n}; null when it doesn't exist. */
export async function referenceVersionBody(supabase: SupabaseClient, collection: string, key: string, version: number): Promise<unknown | null> {
  const { data, error } = await supabase.from("data_document_versions").select("body").eq("collection", collection).eq("key", key).eq("version", version).maybeSingle();
  if (error) throw new Error(`admin: reading data_document_versions failed: ${error.message}`);
  return data ? (data as { body: unknown }).body : null;
}
