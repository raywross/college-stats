/**
 * What `npm run purge-accounts` hard-deletes (specs/product/accounts.md "Data handling"): accounts, student records,
 * and households soft-deleted more than the grace period ago. The selection itself lives in
 * supabase/functions/_shared/purge-plan.ts, shared with the admin-auth Edge Function's one-account `purge` op
 * (specs/product/admin.md), and is re-exported here so the script and tests/purge-accounts.test.mts keep their import.
 * This file adds the script's argument parsing.
 */
export {
  planPurge,
  planPurgeForUser,
  type PurgeHousehold,
  type PurgePlan,
  type PurgeProfile,
  type PurgeStudent,
  type PurgeUserPlan,
  type PurgeUserRows,
  type PurgeUserStudent,
} from "../../supabase/functions/_shared/purge-plan.ts";

/** `--apply` deletes; anything else (including `--dry-run`, the default) only prints the plan. */
export function parsePurgeArgs(argv: string[]): { apply: boolean; days: number } {
  let apply = false;
  let days = 30;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") apply = false;
    else if (a === "--days") days = Number(argv[++i]);
    else throw new Error(`purge-accounts: unknown argument ${a} (use --dry-run, --apply, --days N)`);
  }
  if (argv.includes("--apply") && argv.includes("--dry-run")) throw new Error("purge-accounts: choose --dry-run or --apply, not both");
  return { apply, days };
}
