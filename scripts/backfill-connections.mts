/**
 * The Connections step's one-off backfill (specs/planner/v3/connections.md "Migration"): `list_items.legacy`,
 * `legacy_sibling`, and `recruited` used to carry a college connection; plan v3 moved that to the student's profile
 * (`academics.connections`, read by `hooksFromPlan` now). This copies every row that still has one of those three
 * set into the student's profile as a `ConnectionEntry`, skipping a college the profile already has an entry for.
 * `legacy` becomes `family: ["parent"]` (the toggle read "A parent or grandparent graduated from here"); the row
 * columns are left in place, unused (the owner drops them in a later migration once nothing reads them).
 *
 *   npm run backfill-connections              # writes
 *   npm run backfill-connections -- --dry-run # prints what it would do, writes nothing
 *
 * Through the secret-key client (as scripts/purge-accounts.mts): needs SUPABASE_URL and SUPABASE_SECRET_KEY. Run
 * once on dev after this unit merges, on prod at the formal release — the lead runs it, not this build.
 */
import { parseArgs } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseClient } from "../lib/supabase.ts";
import { RECRUITED_PICKS } from "../lib/chances/levels.ts";
import type { RecruitedPick } from "../lib/chances/types.ts";
import { sanitizeProfile, type ConnectionEntry } from "../lib/student-profile.ts";

const PAGE = 1000;

interface ListRow {
  id: string;
  student_id: string | null;
}

interface ItemRow {
  list_id: string;
  unit_id: string;
  legacy: boolean | null;
  legacy_sibling: boolean | null;
  recruited: string | null;
}

async function allLists(client: SupabaseClient): Promise<ListRow[]> {
  const out: ListRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from("lists").select("id, student_id").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`lists: ${error.message}`);
    out.push(...(data as ListRow[]));
    if (data.length < PAGE) return out;
  }
}

/** Every list_items row with a legacy flag, a sibling flag, or a recruited pick other than "none". */
async function connectedItems(client: SupabaseClient): Promise<ItemRow[]> {
  const out: ItemRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("list_items")
      .select("list_id, unit_id, legacy, legacy_sibling, recruited")
      .or("legacy.eq.true,legacy_sibling.eq.true,recruited.neq.none")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`list_items: ${error.message}`);
    out.push(...(data as ItemRow[]));
    if (data.length < PAGE) return out;
  }
}

/** The row's columns as a ConnectionEntry, or null when none of the three is actually set (a defensive check; the
 * query above should already only return rows with at least one). */
function connectionFromRow(row: ItemRow): ConnectionEntry | null {
  const family: ConnectionEntry["family"] = [];
  if (row.legacy) family.push("parent");
  if (row.legacy_sibling) family.push("sibling");
  const recruited: RecruitedPick = (RECRUITED_PICKS as readonly string[]).includes(row.recruited ?? "") ? (row.recruited as RecruitedPick) : "none";
  if (family.length === 0 && recruited === "none") return null;
  return { id: `backfill-${row.unit_id}`, unitId: row.unit_id, family, recruited };
}

async function main() {
  const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
  const dryRun = values["dry-run"] === true;
  const client = supabaseClient("publish");

  const [lists, items] = await Promise.all([allLists(client), connectedItems(client)]);
  const studentByList = new Map(lists.filter((l) => l.student_id).map((l) => [l.id, l.student_id!]));

  const rowsByStudent = new Map<string, ItemRow[]>();
  for (const item of items) {
    const studentId = studentByList.get(item.list_id);
    if (!studentId) continue;
    const rows = rowsByStudent.get(studentId);
    if (rows) rows.push(item);
    else rowsByStudent.set(studentId, [item]);
  }

  let studentsTouched = 0;
  let connectionsAdded = 0;
  for (const [studentId, rows] of rowsByStudent) {
    const { data, error } = await client.from("student_profiles").select("data").eq("student_id", studentId).maybeSingle();
    if (error) {
      console.error(`student ${studentId}: reading the profile failed: ${error.message}`);
      continue;
    }
    const profile = sanitizeProfile((data as { data: unknown } | null)?.data ?? {});
    const existing = new Set(profile.academics.connections.map((c) => c.unitId));
    const additions: ConnectionEntry[] = [];
    for (const row of rows) {
      if (existing.has(row.unit_id)) continue;
      const entry = connectionFromRow(row);
      if (!entry) continue;
      additions.push(entry);
      existing.add(row.unit_id);
    }
    if (additions.length === 0) continue;

    studentsTouched++;
    connectionsAdded += additions.length;
    console.log(`${dryRun ? "[dry run] " : ""}student ${studentId}: +${additions.length} connection(s) (${additions.map((a) => a.unitId).join(", ")})`);
    if (dryRun) continue;

    const next = sanitizeProfile({ ...profile, academics: { ...profile.academics, connections: [...profile.academics.connections, ...additions] } });
    const { error: writeError } = await client
      .from("student_profiles")
      .upsert({ student_id: studentId, data: next, updated_at: new Date().toISOString() }, { onConflict: "student_id" });
    if (writeError) console.error(`  student ${studentId}: write failed: ${writeError.message}`);
  }

  console.log(`${dryRun ? "Dry run: " : ""}${studentsTouched} student(s), ${connectionsAdded} connection(s) ${dryRun ? "would be added" : "added"}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
