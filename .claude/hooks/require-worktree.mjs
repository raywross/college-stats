#!/usr/bin/env node
/**
 * PreToolUse hook: every Claude session works in its own git worktree, never in
 * the main checkout, so parallel sessions can't switch branches or edit files
 * under each other. See CLAUDE.md ("One worktree per session").
 *
 * Blocks, when the target is the main checkout:
 *   - Edit / Write / NotebookEdit of a file inside it
 *   - git commands that change its branch, index, or files (checkout, commit, …)
 * Read-only work (reading, git status/log/diff/fetch, git worktree) is allowed.
 *
 * Escape hatch: start Claude Code with CLAUDE_ALLOW_MAIN_CHECKOUT=1.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

if (process.env.CLAUDE_ALLOW_MAIN_CHECKOUT === "1") process.exit(0);

const input = JSON.parse(readFileSync(0, "utf8"));
const cwd = input.cwd || process.cwd();

function git(args, dir) {
  try {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const inside = (p, dir) => p === dir || p.startsWith(dir + sep);

// The main checkout is the parent of the shared .git directory.
const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
if (!commonDir) process.exit(0); // not in a git repo: nothing to protect
const main = real(dirname(commonDir));
const worktreesDir = join(main, ".claude", "worktrees");

/** A path is protected when it's in the main checkout and not inside a worktree. */
const inMainCheckout = (p) => {
  const abs = real(isAbsolute(p) ? p : resolve(cwd, p));
  if (!inside(abs, main) || inside(abs, worktreesDir)) return false;
  // A worktree made with `git worktree add` somewhere else inside the repo has its own top level.
  const top = git(["rev-parse", "--show-toplevel"], dirname(abs));
  return !top || real(top) === main;
};

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    })
  );
  process.exit(0);
}

const HOW =
  "This project gives every Claude session its own git worktree (CLAUDE.md: \"One worktree per session\"). " +
  "Call EnterWorktree first, then redo this in the worktree. " +
  "To override for one session, start Claude Code with CLAUDE_ALLOW_MAIN_CHECKOUT=1.";

const { tool_name: tool, tool_input: args = {} } = input;

if (tool === "Edit" || tool === "Write" || tool === "NotebookEdit") {
  const target = args.file_path || args.notebook_path;
  if (target && inMainCheckout(target)) deny(`Blocked: ${tool} of ${target} is in the main checkout. ${HOW}`);
}

if (tool === "Bash" && inMainCheckout(cwd)) {
  // git subcommands that change the checkout's branch, index, working files, or history.
  const mutating =
    /\bgit\s+(?:-[Cc]\s+\S+\s+)*(checkout|switch|commit|merge|rebase|reset|pull|stash|cherry-pick|revert|restore|clean|am|apply|rm|mv|add|tag|push)\b|\bgit\s+branch\s+(-[dDmMfc]|--(delete|move|force|copy))/;
  // Fast-forwarding main to origin is safe (the checkout holds no local work) and keeps it current.
  const fastForward = /^\s*git\s+(pull|merge)\s+--ff-only(\s+origin(\s+main|\/main)?)?\s*$/;
  const command = args.command || "";
  if (mutating.test(command) && !fastForward.test(command)) deny(`Blocked: \`${args.command}\` would change the main checkout. ${HOW}`);
}

process.exit(0);
