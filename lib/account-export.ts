/**
 * "Download my data" (specs/product/accounts.md "Data handling"): one JSON file with everything we keep about the
 * signed-in user. Each table's owner registers an exporter in ACCOUNT_EXPORTERS; app/account/export/route.ts runs
 * them all with the user's own Supabase session, so row-level security still decides what comes back.
 *
 * Adding a table (student profile, lists, follows, …): append one entry to ACCOUNT_EXPORTERS with a unique `key`
 * (it becomes the JSON property) and a `run` that reads only through `ctx.supabase`. Export what the user owns:
 * `ctx.userId` for per-user rows, `ctx.studentIds` (their own record plus managed students they created) for
 * per-student rows. Never another person's private data (a student's private notes, another guardian's finances).
 *
 * No server-only imports, so tests can run buildAccountExport() with fake exporters.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ExportContext {
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
  /** The user's own student record, if they have one. */
  ownStudentId: string | null;
  /** The user's own student record and the managed students they created (not students they only see as a guardian). */
  studentIds: string[];
}

export interface AccountExporter {
  /** Property name in the file; unique. */
  key: string;
  /** One line for the file's `contents` index. */
  description: string;
  run(ctx: ExportContext): Promise<unknown>;
}

/** Throws with the table name so a failed export says which part failed. */
async function rows<T>(table: string, query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`export: reading ${table} failed: ${error.message}`);
  return data ?? [];
}

const inList = (ids: string[]) => (ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

/** The registry. Later units append their tables here (keep keys unique; tests check). */
export const ACCOUNT_EXPORTERS: AccountExporter[] = [
  {
    key: "profile",
    description: "Your profile: name, birth year, and what you told us you are.",
    run: async ({ supabase, userId, email }) => {
      const [profile] = await rows("profiles", supabase.from("profiles").select("display_name, birth_year, role_hint, created, updated").eq("id", userId));
      return { email, ...(profile ?? {}) };
    },
  },
  {
    key: "students",
    description: "Your own student record and the managed students you created.",
    run: ({ supabase, studentIds }) =>
      rows("students", supabase.from("students").select("id, user_id, display_name, grad_year, managed_by, created").in("id", inList(studentIds)).is("deleted_at", null)),
  },
  {
    key: "households",
    description: "Households you belong to, with each member's name and role.",
    run: async ({ supabase }) => {
      const households = await rows<{ id: string; name: string; created: string }>(
        "households",
        supabase.from("households").select("id, name, created").is("deleted_at", null),
      );
      return Promise.all(
        households.map(async (h) => ({
          ...h,
          members: await rows("household_roster", supabase.rpc("household_roster", { p_household: h.id }).select("role, display_name, can_edit, managed, is_me, joined")),
        })),
      );
    },
  },
  {
    key: "memberships",
    description: "Your household memberships (as a guardian, and your student record's).",
    run: async ({ supabase, userId, ownStudentId }) => {
      const cols = "household_id, role, status, can_edit, created, accepted_at";
      const [asGuardian, asStudent] = await Promise.all([
        rows("household_members", supabase.from("household_members").select(cols).eq("user_id", userId)),
        ownStudentId ? rows("household_members", supabase.from("household_members").select(cols).eq("student_id", ownStudentId)) : Promise.resolve([]),
      ]);
      return [...asGuardian, ...asStudent];
    },
  },
  {
    key: "invitations_sent",
    description: "Invitations you sent (the links themselves aren't stored).",
    run: ({ supabase, userId }) =>
      rows("invitations", supabase.from("invitations").select("household_id, email, side, can_edit, created, expires_at, accepted_at, revoked_at").eq("invited_by", userId)),
  },
  {
    key: "student_profiles",
    description: "Student profile data: GPA, test scores, intended majors, and preferences (specs/product/student-profile.md), for your own and managed students.",
    run: ({ supabase, studentIds }) =>
      rows("student_profiles", supabase.from("student_profiles").select("student_id, data, updated_at").in("student_id", inList(studentIds))),
  },
  {
    key: "lists",
    description: "Your saved college lists: categories, rounds, statuses, outcomes, deadlines, and notes.",
    run: async ({ supabase, studentIds }) => {
      const lists = await rows<{ id: string; student_id: string; name: string; is_default: boolean; created: string }>(
        "lists",
        supabase.from("lists").select("id, student_id, name, is_default, created").in("student_id", inList(studentIds)),
      );
      return Promise.all(
        lists.map(async (list) => {
          const items = await rows<{ id: string; unit_id: string; category: string; status: string; outcome: string | null; round: string | null; position: number; added_at: string; decision_date: string | null; deadline_text: string | null; deadline_date: string | null; enrolling: boolean }>(
            "list_items",
            supabase
              .from("list_items")
              .select("id, unit_id, category, status, outcome, round, position, added_at, decision_date, deadline_text, deadline_date, enrolling")
              .eq("list_id", list.id),
          );
          const notes = await rows("list_notes", supabase.from("list_notes").select("item_id, body, private, created").in("item_id", inList(items.map((i) => i.id))));
          const itemsOut = items.map((i) => ({
            unit_id: i.unit_id,
            category: i.category,
            status: i.status,
            outcome: i.outcome,
            round: i.round,
            position: i.position,
            added_at: i.added_at,
            decision_date: i.decision_date,
            deadline_text: i.deadline_text,
            deadline_date: i.deadline_date,
            enrolling: i.enrolling,
          }));
          return { ...list, items: itemsOut, notes };
        }),
      );
    },
  },
  {
    key: "follows",
    description: "Colleges you follow, and your update-email preference (specs/product/follow-colleges.md).",
    run: async ({ supabase, userId }) => {
      const [follows, prefs] = await Promise.all([
        rows("follows", supabase.from("follows").select("unit_id, source, created").eq("user_id", userId)),
        rows("notification_prefs", supabase.from("notification_prefs").select("email_updates, updated").eq("user_id", userId)),
      ]);
      return { colleges: follows, email_updates: (prefs[0] as { email_updates?: boolean } | undefined)?.email_updates ?? true };
    },
  },
  {
    key: "access_log",
    description: "When guardians viewed your information, and when you viewed a student's as a guardian.",
    run: async ({ supabase, userId }) => ({
      about_me: await rows("my_access_log", supabase.rpc("my_access_log", { p_limit: 1000 }).select("at, table_name, viewer_name")),
      my_views: await rows("access_log", supabase.from("access_log").select("student_id, table_name, at").eq("viewer_id", userId).order("at", { ascending: false }).limit(1000)),
    }),
  },
];

export interface AccountExport {
  exported_at: string;
  site: string;
  contents: Record<string, string>;
  [key: string]: unknown;
}

/** Runs every exporter (in parallel) into one document. A failing exporter fails the export: no partial files. */
export async function buildAccountExport(
  ctx: ExportContext,
  { exporters = ACCOUNT_EXPORTERS, now = new Date(), site }: { exporters?: AccountExporter[]; now?: Date; site: string },
): Promise<AccountExport> {
  const keys = exporters.map((e) => e.key);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) throw new Error(`export: two exporters use the key "${dup}"`);
  const reserved = keys.find((k) => k === "exported_at" || k === "site" || k === "contents");
  if (reserved) throw new Error(`export: "${reserved}" is reserved`);

  const results = await Promise.all(exporters.map((e) => e.run(ctx)));
  const doc: AccountExport = {
    exported_at: now.toISOString(),
    site,
    contents: Object.fromEntries(exporters.map((e) => [e.key, e.description])),
  };
  exporters.forEach((e, i) => {
    doc[e.key] = results[i];
  });
  return doc;
}

/** quad-data-2026-10-05.json */
export function exportFilename(site: string, now = new Date()): string {
  const slug = site.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account";
  return `${slug}-data-${now.toISOString().slice(0, 10)}.json`;
}
