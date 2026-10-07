/**
 * Guard for next.config.ts `outputFileTracingIncludes["/*"]` (specs/serving-architecture.md#4-fewer-bytes-per-function):
 * the deploy carries the dataset, so every data file the runtime reads must be traced into the server functions, and
 * nothing else (working files such as data/site-probe.json stay out). Reads next.config.ts as text. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** Exactly what the runtime reads under data/ (lib/data.ts, lib/high-schools.ts, lib/organizations.ts, lib/zip-centroids.ts). */
const EXPECTED = [
  "./data/schools.json",
  "./data/meta.json",
  "./data/release-calendar.json",
  "./data/aliases.json",
  "./data/history/**/*.json",
  "./data/detail/**/*.json",
  "./data/high-schools/**/*.json",
  "./data/directories/organizations.json",
  "./data/reference/zcta-centroids.csv",
];

/** The string entries of the `"/*": [ ... ]` list in next.config.ts, comments ignored. */
function tracedForAllRoutes(): string[] {
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
  const list = config.match(/"\/\*":\s*\[([\s\S]*?)\]/);
  assert.ok(list, 'next.config.ts has an outputFileTracingIncludes "/*" list');
  const body = list[1].replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
}

/** "./data/history/**\/*.json" → "data/history"; a plain path → itself without "./". */
function rootOf(include: string): string {
  const path = include.replace(/^\.\//, "");
  const star = path.indexOf("*");
  return star < 0 ? path : path.slice(0, star).replace(/\/$/, "");
}

const isGlob = (include: string) => include.includes("*");

/** Whether `path` (relative, e.g. "data/history/schools") is shipped by `include`. */
function covers(include: string, path: string): boolean {
  const root = rootOf(include);
  return isGlob(include) ? path === root || path.startsWith(`${root}/`) : path === root;
}

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" }).filter((f) => statSync(join(ROOT, dir, f)).isFile());
}

/**
 * The data paths app code reads with fs: the literal segments after "data" in `join(<root>, "data", "a", …)` (one level
 * of nested calls, like `process.cwd()`, is fine). A segment built at run time (`${id}.json`) ends the path, so a
 * per-college read shows up as its directory (data/history/schools); a read with no literal segment after "data"
 * shows up as "data" itself.
 */
function dataPathsRead(): { path: string; where: string }[] {
  const literal = (arg: string) => arg.trim().match(/^"([^"$]*)"$/)?.[1];
  const leadingLiterals = (args: string[]) => {
    const out: string[] = [];
    for (const arg of args) {
      const value = literal(arg);
      if (value === undefined) break;
      out.push(value);
    }
    return out;
  };
  const files = ["lib", "app", "components"]
    .flatMap((dir) => filesUnder(dir).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => join(dir, f)))
    .concat(existsSync(join(ROOT, "proxy.ts")) ? ["proxy.ts"] : []);
  const found: { path: string; where: string }[] = [];
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const m of text.matchAll(/\bjoin\(((?:[^()]|\([^()]*\))*)\)/g)) {
      const args = m[1].split(",");
      const at = args.findIndex((a) => literal(a) === "data");
      if (at < 0) continue;
      found.push({ path: ["data", ...leadingLiterals(args.slice(at + 1))].join("/"), where: file });
    }
  }
  return found;
}

test('outputFileTracingIncludes["/*"] is exactly the files the runtime reads', () => {
  assert.deepEqual(tracedForAllRoutes(), EXPECTED);
});

test("every traced path exists (a glob's root is a directory holding matching files)", () => {
  for (const include of tracedForAllRoutes()) {
    const root = rootOf(include);
    assert.ok(existsSync(join(ROOT, root)), `${include}: ${root} does not exist`);
    if (isGlob(include)) {
      assert.ok(statSync(join(ROOT, root)).isDirectory(), `${include}: ${root} is not a directory`);
      const ext = include.match(/\*(\.[a-z]+)$/)?.[1] ?? "";
      assert.ok(filesUnder(root).some((f) => f.endsWith(ext)), `${include}: no ${ext || ""} files under ${root}`);
    } else {
      assert.ok(statSync(join(ROOT, root)).isFile(), `${include} is not a file`);
    }
  }
});

test("every read under data/ names its folder or file literally, so the bundler doesn't trace all of data/", () => {
  // e.g. join(process.cwd(), "data", name) lets Next's file tracer ship every working file in data/ with each function.
  const vague = dataPathsRead().filter((r) => r.path === "data");
  assert.deepEqual(vague, [], 'spell out the folder or file after "data" at the read');
});

test("the list and the paths app code reads haven't drifted apart", () => {
  const includes = tracedForAllRoutes();
  const reads = dataPathsRead().filter((r) => r.path !== "data");
  assert.ok(reads.some((r) => r.path === "data/schools.json"), "the scan finds lib/data.ts's reads (sanity check)");
  const untraced = reads.filter((r) => !includes.some((i) => covers(i, r.path)));
  assert.deepEqual(untraced, [], "read at runtime but not traced into the deploy: add it to next.config.ts");
  const unread = includes.filter((i) => !reads.some((r) => covers(i, r.path)));
  assert.deepEqual(unread, [], "traced but nothing in lib/, app/, or components/ reads it: drop it from next.config.ts");
});
