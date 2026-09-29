/**
 * Fails a pull request that doesn't add or update its release note (specs/release-notes.md). Run by the Verify
 * workflow on pull requests, with PR_NUMBER and BASE_SHA from the event:
 *
 *   PR_NUMBER=31 BASE_SHA=origin/main node scripts/check-release-note.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { RELEASE_NOTES_DIR, releaseNoteProblem } from "../lib/release-notes.ts";

const pr = Number(process.env.PR_NUMBER);
const base = process.env.BASE_SHA || "origin/main";
if (!Number.isInteger(pr) || pr <= 0) {
  console.error("Set PR_NUMBER to the pull request's number.");
  process.exit(2);
}

// Files this PR adds or modifies (not deletes) in release-notes/, compared with where it branched from base.
const changed = execFileSync(
  "git",
  ["diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`, "--", `${RELEASE_NOTES_DIR}/*.md`],
  { encoding: "utf8" },
)
  .split("\n")
  .filter((file) => file && !file.endsWith("README.md"))
  .map((file) => ({ file, text: readFileSync(file, "utf8") }));

const problem = releaseNoteProblem(pr, changed);
if (problem) {
  console.error(`::error::${problem}`);
  process.exit(1);
}
console.log(`PR #${pr} has its release note.`);
