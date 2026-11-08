/**
 * Supabase access for high schools (supabase/migrations/20261005180000_high_schools.sql; specs/product/high-school-data.md),
 * shared by the app (lib/high-schools.ts) and the publish step (scripts/lib/publish-high-schools.mts). Plain module, no
 * Next.js imports. The app reads by id and through the search function, never every row.
 */
import { retryOnStatementTimeout } from "./supabase-retry.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HighSchoolDetail, HighSchoolHit, HighSchoolMeta, PublishedHighSchool, StateMedians } from "./high-school-types";
import { clampLimit, hsSearchKey } from "./high-school-core.ts";
import { callBundle } from "./bundle-read.ts";

/** Rows per page: ~2–4 KB each with the AP Course Ledger's list on the row; a page retries on a statement timeout. */
const PAGE_SIZE = 500;

export type HighSchoolFileName = "meta" | "medians";

export interface HighSchoolFiles {
  meta: HighSchoolMeta;
  medians: StateMedians;
}

/** A row of `high_schools` as publish-high-schools writes it. */
export interface HighSchoolTableRow {
  id: string;
  state: string;
  kind: "public" | "private";
  name: string;
  city: string | null;
  /** hsSearchKey(name, city). */
  search: string;
  data: PublishedHighSchool;
}

export function toHighSchoolTableRow(p: PublishedHighSchool): HighSchoolTableRow {
  return { id: p.id, state: p.state, kind: p.kind, name: p.name, city: p.city, search: hsSearchKey(p.name, p.city), data: p };
}

/** One published high school (its state report merged in), or null. */
export async function fetchHighSchool(client: SupabaseClient, id: string): Promise<PublishedHighSchool | null> {
  const { data, error } = await client.from("high_schools").select("data").eq("id", id).maybeSingle();
  if (error) throw new Error(`Supabase: reading high school ${id} failed: ${error.message}`);
  return (data?.data as PublishedHighSchool | undefined) ?? null;
}

/** One high school's profile detail, or null. */
export async function fetchHighSchoolDetail(client: SupabaseClient, id: string): Promise<HighSchoolDetail | null> {
  const { data, error } = await client.from("high_school_details").select("data").eq("id", id).maybeSingle();
  if (error) throw new Error(`Supabase: reading high school detail ${id} failed: ${error.message}`);
  return (data?.data as HighSchoolDetail | undefined) ?? null;
}

/** meta.json or medians.json as published, or null. */
export async function fetchHighSchoolFile<N extends HighSchoolFileName>(client: SupabaseClient, name: N): Promise<HighSchoolFiles[N] | null> {
  const { data, error } = await client.from("high_school_files").select("data").eq("name", name).maybeSingle();
  if (error) throw new Error(`Supabase: reading high school file ${name} failed: ${error.message}`);
  return (data?.data as HighSchoolFiles[N] | undefined) ?? null;
}

/**
 * One school's rows as high_school_bundle() returns them (supabase/migrations/20261109120000_high_school_bundle.sql):
 * the published row, its profile detail, and the pooled course list (school_course_list(), the raw keys, possibly
 * empty) or null when the detail has an AP list of its own.
 */
export interface HighSchoolRows {
  school: PublishedHighSchool | null;
  detail: HighSchoolDetail | null;
  courses: string[] | null;
}

/** high_school_bundle(id) in one call; "missing" until the migration is applied (remembered a minute per instance). */
export async function fetchHighSchoolBundle(client: SupabaseClient, id: string): Promise<HighSchoolRows | "missing"> {
  const r = await callBundle<Partial<HighSchoolRows> | null>(client, "high_school_bundle", { p_id: id });
  if (r.kind === "missing") return "missing";
  if (r.kind === "error") throw new Error(`Supabase: reading high school ${id} failed: ${r.error.message}`);
  const b = r.data ?? {};
  return { school: b.school ?? null, detail: b.detail ?? null, courses: Array.isArray(b.courses) ? b.courses : null };
}

/** school_course_list(id): the pooled course keys (three or more students), raw; null when the call fails. */
export async function fetchSchoolCourseList(client: SupabaseClient, id: string): Promise<string[] | null> {
  const { data, error } = await client.rpc("school_course_list", { p_high_school_id: id });
  return error || !Array.isArray(data) ? null : (data as string[]);
}

/**
 * One school's rows: the bundle when the function is there (one call), else the three reads it replaces (the row and
 * the detail together, then the course list when there is a school and its detail has no AP list). A failed detail
 * read in the fallback reads as no detail (`onDetailError` hears it), as it always did.
 */
export async function fetchHighSchoolRows(client: SupabaseClient, id: string, onDetailError?: (err: unknown) => void): Promise<HighSchoolRows> {
  const bundle = await fetchHighSchoolBundle(client, id);
  if (bundle !== "missing") return bundle;
  const [school, detail] = await Promise.all([
    fetchHighSchool(client, id),
    fetchHighSchoolDetail(client, id).catch((err) => (onDetailError?.(err), null)),
  ]);
  const courses = school && !detail?.ap_courses?.length ? await fetchSchoolCourseList(client, id) : null;
  return { school, detail, courses };
}

/** Name/city search through `search_high_schools` (trigram + prefix match, state filter). */
export async function searchHighSchoolsRpc(
  client: SupabaseClient,
  { q, state, limit }: { q: string; state?: string | null; limit?: number },
): Promise<HighSchoolHit[]> {
  const { data, error } = await client.rpc("search_high_schools", { p_q: hsSearchKey(q), p_state: state?.toUpperCase() || null, p_limit: clampLimit(limit) });
  if (error) throw new Error(`Supabase: searching high schools failed: ${error.message}`);
  return ((data ?? []) as (HighSchoolHit & { score?: number })[]).map(({ id, name, city, state: st, kind, district, grades }) => ({ id, name, city, state: st, kind, district, grades }));
}

async function fetchAll<T>(client: SupabaseClient, table: string, key: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const data = (await retryOnStatementTimeout(() => client.from(table).select(columns).order(key).range(from, from + PAGE_SIZE - 1), `Supabase: reading ${table} failed`)) ?? [];
    out.push(...(data as T[]));
    if (data.length < PAGE_SIZE) return out;
  }
}

/** Every published row (the publish step's read-back check). */
export async function fetchAllHighSchoolRows(client: SupabaseClient): Promise<HighSchoolTableRow[]> {
  return fetchAll<HighSchoolTableRow>(client, "high_schools", "id", "id, state, kind, name, city, search, data");
}

export async function fetchAllHighSchoolDetails(client: SupabaseClient): Promise<HighSchoolDetail[]> {
  return (await fetchAll<{ data: HighSchoolDetail }>(client, "high_school_details", "id", "data")).map((r) => r.data);
}

export async function fetchAllHighSchoolFiles(client: SupabaseClient): Promise<Partial<HighSchoolFiles>> {
  const rows = await fetchAll<{ name: HighSchoolFileName; data: unknown }>(client, "high_school_files", "name", "name, data");
  return Object.fromEntries(rows.map((r) => [r.name, r.data])) as Partial<HighSchoolFiles>;
}
