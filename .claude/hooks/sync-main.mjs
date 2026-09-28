#!/usr/bin/env node
/**
 * SessionStart hook: keep the main checkout current, since sessions only read
 * it (they work in their own worktrees; see CLAUDE.md "One worktree per session").
 *
 * Fetches origin so new worktrees branch from the latest main, then fast-forwards
 * the main checkout when it's on `main` with no local changes. Never merges,
 * rebases, or touches a dirty tree. Silent, and never blocks the session.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

let cwd = process.cwd();
try {
  cwd = JSON.parse(readFileSync(0, "utf8")).cwd || cwd;
} catch {}

const git = (args, dir = cwd) => {
  try {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }).trim();
  } catch {
    return null;
  }
};

const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
if (!common) process.exit(0);
const main = resolve(dirname(common));

git(["fetch", "--quiet", "origin"], main);
if (git(["rev-parse", "--abbrev-ref", "HEAD"], main) === "main" && git(["status", "--porcelain"], main) === "") {
  git(["merge", "--ff-only", "--quiet", "origin/main"], main);
}
process.exit(0);
