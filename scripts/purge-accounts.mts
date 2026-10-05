/**
 * Hard-deletes accounts soft-deleted more than 30 days ago (specs/product/accounts.md "Data handling"), plus the
 * student records and households deleted with them. Dry run by default: prints what it would delete.
 *
 *   npm run purge-accounts                 # dry run against the project in .env.local
 *   npm run purge-accounts -- --apply      # delete
 *   npm run purge-accounts -- --days 45    # a longer grace period (never shorter than 30)
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (the secret key bypasses row-level security and can delete auth users;
 * it never goes to Vercel). Order: student records, then households, then auth users through the Auth admin API,
 * whose deletion cascades to profiles, memberships, and access-log rows. Selection logic: scripts/lib/purge-accounts-plan.mts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseClient } from "../lib/supabase.ts";
import { parsePurgeArgs, planPurge, type PurgeHousehold, type PurgeProfile, type PurgeStudent } from "./lib/purge-accounts-plan.mts";

const PAGE = 1000;

async function softDeleted<T>(client: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select(columns).not("deleted_at", "is", null).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (data.length < PAGE) return out;
  }
}

async function deleteIds(client: SupabaseClient, table: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await client.from(table).delete().in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`${table}: deleting failed: ${error.message}`);
  }
}

async function main() {
  const { apply, days } = parsePurgeArgs(process.argv.slice(2));
  const client = supabaseClient("publish");
  const [profiles, students, households] = await Promise.all([
    softDeleted<PurgeProfile>(client, "profiles", "id, deleted_at"),
    softDeleted<PurgeStudent>(client, "students", "id, user_id, deleted_at"),
    softDeleted<PurgeHousehold>(client, "households", "id, deleted_at"),
  ]);
  const plan = planPurge({ profiles, students, households }, new Date(), days);

  console.log(`purge-accounts: deleted before ${plan.cutoff} (${days} days)`);
  console.log(`  accounts:   ${plan.users.length}`);
  console.log(`  students:   ${plan.students.length}`);
  console.log(`  households: ${plan.households.length}`);
  if (plan.skippedStudents.length) console.log(`  kept ${plan.skippedStudents.length} deleted student record(s) whose account still exists: ${plan.skippedStudents.join(", ")}`);
  if (!apply) {
    console.log("Dry run: nothing deleted. Run with --apply to delete.");
    return;
  }

  await deleteIds(client, "students", plan.students);
  await deleteIds(client, "households", plan.households);
  let failed = 0;
  for (const id of plan.users) {
    const { error } = await client.auth.admin.deleteUser(id);
    if (error) {
      failed++;
      console.error(`  account ${id}: ${error.message}`);
    }
  }
  console.log(`Deleted ${plan.students.length} student record(s), ${plan.households.length} household(s), ${plan.users.length - failed} account(s).`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
