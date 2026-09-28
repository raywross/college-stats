/**
 * The one-worktree-per-session hook (.claude/hooks/require-worktree.mjs), run
 * against a throwaway repo with a worktree under .claude/worktrees/. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dirname, "..", ".claude", "hooks", "require-worktree.mjs");

const main = realpathSync(mkdtempSync(join(tmpdir(), "wt-hook-")));
const wt = join(main, ".claude", "worktrees", "a");
const g = (...args: string[]) => execFileSync("git", args, { cwd: main, stdio: "ignore" });
g("init", "-q", "-b", "main");
g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
g("worktree", "add", "-q", wt, "-b", "worktree-a");
test.after(() => rmSync(main, { recursive: true, force: true }));

function decide(input: object, env: Record<string, string> = {}): "allow" | "deny" {
  const out = execFileSync("node", [HOOK], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } });
  if (!out.trim()) return "allow";
  return JSON.parse(out).hookSpecificOutput.permissionDecision;
}
const edit = (cwd: string, file: string) => ({ tool_name: "Edit", cwd, tool_input: { file_path: file } });
const bash = (cwd: string, command: string) => ({ tool_name: "Bash", cwd, tool_input: { command } });

test("file edits in the main checkout are blocked", () => {
  assert.equal(decide(edit(main, join(main, "lib", "data.ts"))), "deny");
  assert.equal(decide({ tool_name: "Write", cwd: wt, tool_input: { file_path: join(main, "new.md") } }), "deny");
});

test("file edits in a worktree, or outside the repo, are allowed", () => {
  assert.equal(decide(edit(wt, join(wt, "lib", "data.ts"))), "allow");
  assert.equal(decide(edit(main, join(tmpdir(), "notes.md"))), "allow");
});

test("git commands that change the main checkout are blocked", () => {
  for (const cmd of ["git checkout -b feature/x", "git switch main", "git add -A && git commit -m x", "git stash", "git pull", "git branch -D old", "git reset --hard"]) {
    assert.equal(decide(bash(main, cmd)), "deny", cmd);
  }
});

test("read-only git in the main checkout, and anything in a worktree, is allowed", () => {
  for (const cmd of ["git status --short", "git log --oneline -3", "git diff", "git fetch origin", "git branch -a", "git worktree list"]) {
    assert.equal(decide(bash(main, cmd)), "allow", cmd);
  }
  assert.equal(decide(bash(wt, "git add -A && git commit -m x")), "allow");
});

test("fast-forwarding the main checkout is allowed; other pulls and merges aren't", () => {
  assert.equal(decide(bash(main, "git pull --ff-only")), "allow");
  assert.equal(decide(bash(main, "git merge --ff-only origin/main")), "allow");
  assert.equal(decide(bash(main, "git pull")), "deny");
  assert.equal(decide(bash(main, "git pull --ff-only && git checkout -b x")), "deny");
});

test("CLAUDE_ALLOW_MAIN_CHECKOUT=1 turns the hook off", () => {
  assert.equal(decide(edit(main, join(main, "lib", "data.ts")), { CLAUDE_ALLOW_MAIN_CHECKOUT: "1" }), "allow");
});
