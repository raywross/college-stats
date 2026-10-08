/**
 * Record what changed in the dataset for the What changed panel and the update digest
 * (specs/serving-architecture.md section 2; specs/product/follow-colleges.md).
 *
 *   npm run publish-changes                          # HEAD against the last recorded publish
 *   npm run publish-changes -- --head <sha>          # the deployed commit (the "Publish changes" Action passes it)
 *   npm run publish-changes -- --base <sha>          # diff from this commit instead of the last recorded publish
 *   npm run publish-changes -- --dry-run [--base <sha>]  # print the summary and the change list; write nothing
 *
 * The deploy carries the dataset, so nothing is uploaded: data/schools.json, data/meta.json and
 * data/release-calendar.json are read from git at both commits (`git show`), diffed (lib/changes.ts), staged, and
 * recorded with publish_changes() in one transaction (scripts/lib/publish-changes.mts). Re-running for a commit already
 * recorded prints "reused" and writes nothing.
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (environment variables win over .env.local, which is how the Action points
 * it at production). Without them it says so and exits 0; a dry run still prints the diff (pass --base, or it diffs as a
 * first publish).
 */
import { userInfo } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { supabaseClient } from "../lib/supabase.ts";
import { gitAccess, publishChanges } from "./lib/publish-changes.mts";

const ROOT = join(import.meta.dirname, "..");

const { values } = parseArgs({
  options: {
    head: { type: "string", default: "HEAD" },
    base: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
const dryRun = values["dry-run"];
const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

if (!configured && !dryRun) {
  console.log("SUPABASE_URL or SUPABASE_SECRET_KEY is not set; no changes recorded. (Use --dry-run to see the diff.)");
  process.exit(0);
}

const client = configured ? supabaseClient("publish") : null;
if (client) console.log(`Recording changes on ${new URL(process.env.SUPABASE_URL!).host}${dryRun ? " [dry run]" : ""}`);

try {
  await publishChanges({
    git: gitAccess(ROOT),
    head: values.head,
    base: values.base ?? null,
    dryRun,
    client,
    publishedBy: process.env.GITHUB_ACTOR ?? userInfo().username,
  });
} catch (err) {
  console.error(`Publish changes failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
