/**
 * The SessionStart hook that keeps the main checkout current
 * (.claude/hooks/sync-main.mjs), run against throwaway repos. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dirname, "..", ".claude", "hooks", "sync-main.mjs");
const ID = ["-c", "user.email=t@t", "-c", "user.name=t"];

const root = realpathSync(mkdtempSync(join(tmpdir(), "sync-main-")));
test.after(() => rmSync(root, { recursive: true, force: true }));
const git = (dir: string, ...args: string[]) => execFileSync("git", [...ID, ...args], { cwd: dir, encoding: "utf8" }).trim();

/** A bare origin, the main checkout cloned from it, and a second clone that lands new commits on origin. */
function setup(name: string) {
  const origin = join(root, `${name}-origin.git`);
  const main = join(root, `${name}-main`);
  const other = join(root, `${name}-other`);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, other], { stdio: "ignore" }); // "cloned an empty repository" is expected
  git(other, "commit", "-q", "--allow-empty", "-m", "first");
  git(other, "push", "-q", "origin", "HEAD:main");
  execFileSync("git", ["clone", "-q", origin, main]);
  git(other, "commit", "-q", "--allow-empty", "-m", "merged PR");
  git(other, "push", "-q", "origin", "HEAD:main");
  return { main, originHead: git(other, "rev-parse", "HEAD") };
}
const run = (cwd: string) => execFileSync("node", [HOOK], { input: JSON.stringify({ cwd }), encoding: "utf8" });

test("a clean main checkout is fast-forwarded to origin/main", () => {
  const { main, originHead } = setup("clean");
  run(main);
  assert.equal(git(main, "rev-parse", "HEAD"), originHead);
});

test("a main checkout with local changes is left alone (but still fetched)", () => {
  const { main, originHead } = setup("dirty");
  const before = git(main, "rev-parse", "HEAD");
  writeFileSync(join(main, "wip.txt"), "local work");
  run(main);
  assert.equal(git(main, "rev-parse", "HEAD"), before);
  assert.equal(git(main, "rev-parse", "origin/main"), originHead);
});

test("a main checkout on another branch is left alone", () => {
  const { main } = setup("branch");
  git(main, "checkout", "-q", "-b", "feature/x");
  const before = git(main, "rev-parse", "HEAD");
  run(main);
  assert.equal(git(main, "rev-parse", "HEAD"), before);
  assert.equal(git(main, "rev-parse", "--abbrev-ref", "HEAD"), "feature/x");
});
