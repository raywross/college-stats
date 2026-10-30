/**
 * The admin Essays section (specs/product/essays/sources.md "The hand read", "The admin side"): each college's essay
 * status, the counts, and the hand-read checklist (colleges on a family's list whose questions only the application
 * shows). A hand read is saved as a row of `essay_prompt_overrides` (owner, 2026-10-30: the database is the source of
 * truth, so a save is live on the advisor at once; supabase/migrations/20261030150000_essay_prompt_overrides.sql), so
 * a college with a row counts as confirmed here before the nightly export reaches the dataset.
 *
 * Pure but for the two reads, which go through the signed-in admin's own session (the admin read policy for
 * `list_items`, as the Health page reads it in lib/admin/health.ts `familyListUnits`; anyone may read the overrides).
 */
import type { EssayFormKind, School } from "../types.ts";
import type { ConfirmedRecord } from "../essay-prompts/confirmed.ts";
import { ADMIN_FAILED } from "./console.ts";

/* ------------------------------------------------------------------ */
/* Status, counts, the checklist                                       */
/* ------------------------------------------------------------------ */

/** Where a college's questions stand: in the dataset, or confirmed by a saved row. */
export type EssayStatus = "published" | "confirmed" | "refers_to_form" | "none" | "not_read";

export const ESSAY_STATUSES: readonly EssayStatus[] = ["published", "confirmed", "refers_to_form", "none", "not_read"];

export const ESSAY_STATUS_LABELS: Record<EssayStatus, string> = {
  published: "Published on the college's page",
  confirmed: "Confirmed from the form",
  refers_to_form: "Refers to the form",
  none: "None, says the college's page",
  not_read: "Not read",
};

/** One saved row, as the list page needs it. */
export interface OverrideRow {
  unit_id: string;
  cycle: string;
  status: "published" | "none";
  read_on: string;
  reader: string;
  record: ConfirmedRecord;
}

type EssaySchool = Pick<School, "unit_id" | "name" | "essays">;
type Overrides = ReadonlyMap<string, Pick<OverrideRow, "read_on" | "record">>;

/** A college's status: a saved row (for the open cycle) makes it confirmed; otherwise the dataset's block says. */
export function essayStatus(school: Pick<School, "unit_id" | "essays">, overrides?: Overrides | null): EssayStatus {
  if (overrides?.has(school.unit_id)) return "confirmed";
  const e = school.essays;
  if (!e) return "not_read";
  if (e.confidence === "confirmed") return "confirmed";
  return e.status;
}

export function statusCounts(schools: readonly Pick<School, "unit_id" | "essays">[], overrides?: Overrides | null): Record<EssayStatus, number> {
  const out = Object.fromEntries(ESSAY_STATUSES.map((s) => [s, 0])) as Record<EssayStatus, number>;
  for (const s of schools) out[essayStatus(s, overrides)]++;
  return out;
}

/** Statuses a person should read the form for: nothing read, the page points to the form, or the page says none. */
export const NEEDS_HAND_READ: ReadonlySet<EssayStatus> = new Set(["not_read", "refers_to_form", "none"]);

export interface ChecklistRow {
  unitId: string;
  name: string;
  status: EssayStatus;
  /** How many families' lists the college is on. */
  lists: number;
}

/**
 * The hand-read checklist: colleges on at least one family's list whose questions the reader couldn't take from the
 * college's own page (absent, `refers_to_form`, or `none`) and that have no saved row, most-listed first, then by name.
 */
export function handReadChecklist(schools: readonly EssaySchool[], listsByUnit: ReadonlyMap<string, number>, overrides?: Overrides | null): ChecklistRow[] {
  return schools
    .filter((s) => (listsByUnit.get(s.unit_id) ?? 0) > 0 && NEEDS_HAND_READ.has(essayStatus(s, overrides)))
    .map((s) => ({ unitId: s.unit_id, name: s.name, status: essayStatus(s, overrides), lists: listsByUnit.get(s.unit_id) ?? 0 }))
    .sort((a, b) => b.lists - a.lists || a.name.localeCompare(b.name, "en"));
}

export interface ReadRow {
  unitId: string;
  name: string;
  readOn: string | null;
  form: EssayFormKind | null;
  lists: number;
}

/** Colleges read by hand (a saved row, or a confirmed block already in the dataset), newest read first. */
export function handReadDone(schools: readonly EssaySchool[], listsByUnit: ReadonlyMap<string, number> | null, overrides?: Overrides | null): ReadRow[] {
  return schools
    .filter((s) => essayStatus(s, overrides) === "confirmed")
    .map((s) => {
      const row = overrides?.get(s.unit_id);
      return {
        unitId: s.unit_id,
        name: s.name,
        readOn: row?.read_on ?? s.essays?.read_on ?? null,
        form: row?.record.form ?? s.essays?.form ?? null,
        lists: listsByUnit?.get(s.unit_id) ?? 0,
      };
    })
    .sort((a, b) => (b.readOn ?? "").localeCompare(a.readOn ?? "") || a.name.localeCompare(b.name, "en"));
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

type Result<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
interface Query<T> extends Result<T[]> {
  eq(column: string, value: unknown): Query<T>;
  order(column: string, opts?: { ascending?: boolean }): Query<T>;
  range(from: number, to: number): Query<T>;
  maybeSingle(): Result<T>;
}
/** The slice of a Supabase client these reads use. */
export interface EssaysClient {
  from(table: string): { select(columns: string): Query<Record<string, unknown>> };
}

const PAGE = 1000;
const MAX_PAGES = 100;

async function adminClient(): Promise<EssaysClient | null> {
  const { supabaseAuthEnv, createServerSupabase } = await import("../supabase-server");
  if (!supabaseAuthEnv()) return null;
  // The admin read policies answer only requests carrying the console header (lib/admin/people.ts adminSupabase).
  const { ADMIN_CONSOLE_HEADER } = await import("./constants");
  return (await createServerSupabase({ headers: { [ADMIN_CONSOLE_HEADER]: "1" } })) as unknown as EssaysClient;
}

export interface ReadDeps {
  client?: () => Promise<EssaysClient | null>;
}

/**
 * How many lists each college is on (distinct `list_items.list_id` per `unit_id`); null when that read is unavailable
 * (sign-in not configured, the policy missing, an error, or too many rows to read whole), so the page says the
 * checklist can't be built rather than showing it empty.
 */
export async function listsByUnit(deps: ReadDeps = {}): Promise<Map<string, number> | null> {
  try {
    const client = await (deps.client ?? adminClient)();
    if (!client) return null;
    const lists = new Map<string, Set<string>>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await client
        .from("list_items")
        .select("unit_id, list_id")
        .order("unit_id")
        .order("id")
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error(`reading list_items failed: ${error.message}`);
      for (const r of data ?? []) {
        const unit = String(r.unit_id);
        const set = lists.get(unit) ?? new Set<string>();
        set.add(String(r.list_id));
        lists.set(unit, set);
      }
      if ((data?.length ?? 0) < PAGE) return new Map([...lists].map(([unit, set]) => [unit, set.size]));
    }
    throw new Error(`list_items has more than ${PAGE * MAX_PAGES} rows`);
  } catch (err) {
    console.error("[admin essays] reading the colleges on families' lists failed; the checklist is unavailable.", err);
    return null;
  }
}

const OVERRIDE_COLUMNS = "unit_id, cycle, status, read_on, reader, record";

function toOverride(r: Record<string, unknown>): OverrideRow | null {
  const record = r.record as ConfirmedRecord | null;
  if (!record || typeof record !== "object" || !Array.isArray(record.prompts)) return null;
  if (r.status !== "published" && r.status !== "none") return null;
  return { unit_id: String(r.unit_id), cycle: String(r.cycle), status: r.status, read_on: String(r.read_on), reader: String(r.reader), record };
}

/** Every saved row for `cycle`, by unit id; null when the table can't be read (not migrated, or no Supabase). */
export async function overridesForCycle(cycle: string, deps: ReadDeps = {}): Promise<Map<string, OverrideRow> | null> {
  try {
    const client = await (deps.client ?? adminClient)();
    if (!client) return null;
    const out = new Map<string, OverrideRow>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await client
        .from("essay_prompt_overrides")
        .select(OVERRIDE_COLUMNS)
        .eq("cycle", cycle)
        .order("unit_id")
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error(`reading essay_prompt_overrides failed: ${error.message}`);
      for (const r of data ?? []) {
        const row = toOverride(r);
        if (row) out.set(row.unit_id, row);
      }
      if ((data?.length ?? 0) < PAGE) return out;
    }
    throw new Error(`essay_prompt_overrides has more than ${PAGE * MAX_PAGES} rows for ${cycle}`);
  } catch (err) {
    console.error("[admin essays] reading the saved hand reads failed.", err);
    return null;
  }
}

/** One college's saved row for `cycle`: the row, none saved, or unavailable (the page then shows no form). */
export async function overrideFor(unitId: string, cycle: string, deps: ReadDeps = {}): Promise<{ ok: true; row: OverrideRow | null } | { ok: false }> {
  try {
    const client = await (deps.client ?? adminClient)();
    if (!client) return { ok: false };
    const { data, error } = await client.from("essay_prompt_overrides").select(OVERRIDE_COLUMNS).eq("unit_id", unitId).eq("cycle", cycle).maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, row: data ? toOverride(data) : null };
  } catch (err) {
    console.error(`[admin essays] reading the saved hand read for ${unitId} failed.`, err);
    return { ok: false };
  }
}

/* ------------------------------------------------------------------ */
/* Refusals in plain words                                             */
/* ------------------------------------------------------------------ */

export const SAVED_MESSAGE = "Saved. Live on the advisor now; the public college page updates at the next data build.";
export const DELETED_MESSAGE = "Deleted. The advisor goes back to what the college's own page says; the public college page updates at the next data build.";

/** admin_set_essay_prompts() / admin_delete_essay_prompts() refusals (the migration's exception keys). */
export const ESSAY_SAVE_ERRORS: Record<string, string> = {
  "admin only": "Only an admin can save essay questions. Reload the page and sign in again.",
  record_mismatch: "The saved record didn't match the college or cycle. Reload the page and try again.",
  invalid_status: "Choose whether the form asks questions or none.",
  invalid_record: "That record wasn't a hand read the database accepts. Reload the page and try again.",
  invalid_read_on: "The read-on date must be a real date, today or earlier.",
  no_prompts: "The form asks questions, but none are entered.",
};

/** A refusal from the save or delete function in plain words; anything else is the console's generic failure. */
export function essaySaveErrorMessage(error: { message?: string } | null | undefined): string {
  const text = error?.message ?? "";
  const key = Object.keys(ESSAY_SAVE_ERRORS).find((k) => new RegExp(`\\b${k}\\b`).test(text));
  return key ? ESSAY_SAVE_ERRORS[key] : ADMIN_FAILED;
}
