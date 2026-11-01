/**
 * Guard for next.config.ts `outputFileTracingIncludes["/*"]` (specs/serving-architecture.md#4-fewer-bytes-per-function;
 * specs/data-platform/git-ci-tests.md): the deploy carries the dataset as the bundled copy (`.data/snapshot/`, written
 * by `npm run fetch-snapshot`), so every file the runtime reads must sit under it and be traced into the server
 * functions. And since phase 4, nothing under lib/, app/, components/ or scripts/ reads or imports a path under
 * data/: the data lives in the store and the snapshot, not in the repository. Reads the sources as text. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** Exactly what the runtime reads: the bundled copy (lib/data-platform/loader.ts and the reference readers in lib/). */
const EXPECTED = ["./.data/snapshot/**"];

/** Traced paths written at build time and absent from a checkout: the existence check skips them when missing. */
const BUILT_AT_BUILD_TIME = ["./.data/snapshot/**"];

/** The string entries of the `"<route>": [ ... ]` list in next.config.ts, comments ignored; null when there is none. */
function tracedFor(route: string): string[] | null {
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
  const key = route.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const list = config.match(new RegExp(`"${key}":\\s*\\[([\\s\\S]*?)\\]`));
  if (!list) return null;
  const body = list[1].replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
}

const tracedForAllRoutes = () => {
  const list = tracedFor("/*");
  assert.ok(list, 'next.config.ts has an outputFileTracingIncludes "/*" list');
  return list;
};

/** "./.data/snapshot/**" → ".data/snapshot"; a plain path → itself without "./". */
function rootOf(include: string): string {
  const path = include.replace(/^\.\//, "");
  const star = path.indexOf("*");
  return star < 0 ? path : path.slice(0, star).replace(/\/$/, "");
}

const isGlob = (include: string) => include.includes("*");

/** Whether `path` (relative, e.g. ".data/snapshot/history") is shipped by `include`. */
function covers(include: string, path: string): boolean {
  const root = rootOf(include);
  return isGlob(include) ? path === root || path.startsWith(`${root}/`) : path === root;
}

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" }).filter((f) => statSync(join(ROOT, dir, f)).isFile());
}

/** The folders app code could read data from: data/ (gone in phase 4) and .data/ (the bundled copy). */
const DATA_ROOTS = ["data", ".data"];

const sourcesUnder = (dirs: string[], ext: RegExp) => dirs.flatMap((dir) => filesUnder(dir).filter((f) => ext.test(f)).map((f) => join(dir, f).split("\\").join("/")));

/** lib/, app/, components/ and proxy.ts: the code that runs in the deploy. */
const appSources = () => sourcesUnder(["lib", "app", "components"], /\.(ts|tsx)$/).concat(existsSync(join(ROOT, "proxy.ts")) ? ["proxy.ts"] : []);

/**
 * The data paths app code reads with fs: the literal segments after "data" (or ".data") in `join(<root>, "data", "a", …)` (one level
 * of nested calls, like `process.cwd()`, is fine). A segment built at run time (`${id}.json`) ends the path, so a
 * per-college read shows up as its directory (.data/snapshot/history); a read with no literal segment after the root
 * shows up as the root itself.
 */
function dataPathsRead(): { path: string; where: string; tail: string[] }[] {
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
  const found: { path: string; where: string; tail: string[] }[] = [];
  for (const file of appSources()) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const m of text.matchAll(/\bjoin\(((?:[^()]|\([^()]*\))*)\)/g)) {
      const args = m[1].split(",");
      const at = args.findIndex((a) => DATA_ROOTS.includes(literal(a) ?? ""));
      if (at < 0) continue;
      const literals = leadingLiterals(args.slice(at + 1));
      found.push({ path: [literal(args[at])!, ...literals].join("/"), where: file, tail: args.slice(at + 1 + literals.length).map((a) => a.trim()) });
    }
  }
  return found;
}

test('outputFileTracingIncludes["/*"] is exactly the bundled copy', () => {
  assert.deepEqual(tracedForAllRoutes(), EXPECTED);
});

test('there is no "/admin/**" list any more: the health document comes from the data store', () => {
  assert.equal(tracedFor("/admin/**"), null);
});

test("every traced path exists (a glob's root is a directory holding matching files)", () => {
  for (const include of tracedForAllRoutes()) {
    const root = rootOf(include);
    if (BUILT_AT_BUILD_TIME.includes(include) && !existsSync(join(ROOT, root))) continue;
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

/** What may follow a read's literal folders: nothing, or one `${id}.ext` file name (the bundler then ships only *.ext). */
const scopedTail = (tail: string[]) => tail.length === 0 || (tail.length === 1 && /^`\$\{[^}]+\}\.[a-z]+`$/.test(tail[0]));

test("a per-item read ends in a literal extension, never a bare variable (which traces the whole project)", () => {
  const unscoped = dataPathsRead().filter((r) => !scopedTail(r.tail));
  assert.deepEqual(unscoped.map((r) => `${r.where}: ${r.path}/${r.tail.join("/")}`), []);
  // The rule bites: a read ending in a variable name is caught.
  assert.equal(scopedTail(["key"]), false);
  assert.equal(scopedTail(["`${key}.json`"]), true);
});

test("every read under .data/ names its folder or file literally, so the bundler doesn't trace all of it", () => {
  // e.g. join(process.cwd(), ".data", name) lets Next's file tracer ship every file under it with each function.
  const vague = dataPathsRead().filter((r) => DATA_ROOTS.includes(r.path) || r.path === ".data/snapshot");
  assert.deepEqual(vague, [], 'spell out the folder or file after ".data", "snapshot" at the read');
});

test("the list and the paths app code reads haven't drifted apart", () => {
  const includes = tracedForAllRoutes();
  const reads = dataPathsRead().filter((r) => !DATA_ROOTS.includes(r.path));
  assert.ok(reads.some((r) => r.path === ".data/snapshot/colleges.json"), "the scan finds the loader's bundled-copy reads (sanity check)");
  assert.ok(reads.some((r) => r.path === ".data/snapshot/reference/organizations.json"), "and the reference readers'");
  const untraced = reads.filter((r) => !includes.some((i) => covers(i, r.path)));
  assert.deepEqual(untraced, [], "read at runtime but not traced into the deploy: add it to next.config.ts");
  const unread = includes.filter((i) => !reads.some((r) => covers(i, r.path)));
  assert.deepEqual(unread, [], "traced but nothing in lib/, app/, or components/ reads it: drop it from next.config.ts");
});

/* ------------------------------------------------------------------ */
/* Nothing reads data/ (phase 4, specs/data-platform/git-ci-tests.md)  */
/* ------------------------------------------------------------------ */

/**
 * What names a path under data/ in a source file: a string starting `data/` (`"data/…"`, `'data/…'`, `` `data/…` ``),
 * `"data"` as a segment in a `join(` or `resolve(` call, an `@/data/` import, or a relative `../data/` / `./data/`.
 * `.data/` (the bundled copy) never matches: each pattern needs a quote, `(`/`,`, `@/` or `./` right before `data`.
 */
const DATA_PATH = [
  /["'`]data\//,
  /\b(?:join|resolve)\((?:[^()]|\([^()]*\))*["']data["']\s*[,)]/,
  /@\/data\//,
  /(?:^|[^.\w])\.{1,2}\/data\//,
];

/**
 * Strings that look like data/ paths and aren't: git branch prefixes of the pipelines' former PRs (lib/github-app.ts
 * DATA_PULL_PREFIXES, kept so a leftover PR can still be listed and closed from Approvals).
 */
const NOT_PATHS: { file: string; line: RegExp }[] = [
  { file: "lib/github-app.ts", line: /DATA_PULL_PREFIXES = \["data\/", "review\/"\]/ },
];

/** Scripts whose job is a data folder a caller names (`--from <dir>`, `--out <dir>`): they may say `data/` in their help. */
const SCRIPT_EXCEPTIONS = new Set(["scripts/build-mini-fixture.mts", "scripts/import-data-from-files.mts"]);

/** Every line of `files` that names a path under data/, comment lines (` * `, `//`) skipped. */
function dataPathLines(files: string[], read: (file: string) => string = (f) => readFileSync(join(ROOT, f), "utf8")): string[] {
  const out: string[] = [];
  for (const file of files) {
    read(file)
      .split("\n")
      .forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
        if (!DATA_PATH.some((re) => re.test(line))) return;
        if (NOT_PATHS.some((n) => n.file === file && n.line.test(line))) return;
        out.push(`${file}:${i + 1}: ${code.slice(0, 160)}`);
      });
  }
  return out;
}

test("nothing under lib/, app/ or components/ imports or reads a path under data/", () => {
  assert.deepEqual(dataPathLines(appSources()), []);
});

const scriptSources = () => sourcesUnder(["scripts"], /\.(mts|ts|mjs|js)$/).filter((f) => !SCRIPT_EXCEPTIONS.has(f));

test(
  "nothing under scripts/ (but the two that take a data folder by name) imports or reads a path under data/",
  // Pending until the scripts unit (G5) lands on the integration branch; drop the todo then (phase 4 brief).
  { todo: dataPathLines(scriptSources()).length > 0 ? "scripts/ still reads data/ until G5 merges" : false },
  () => {
    const lines = dataPathLines(scriptSources());
    assert.equal(lines.length, 0, `${lines.length} lines under scripts/ name a path under data/, e.g.\n${lines.slice(0, 10).join("\n")}`);
  },
);

test("the guard bites: a planted read under data/ is found, the bundled copy and comments are not", () => {
  const planted: Record<string, string> = {
    "lib/planted-a.ts": 'import x from "../data/reference/aid-policies.json" with { type: "json" };',
    "lib/planted-b.ts": 'const p = join(process.cwd(), "data", "schools.json");',
    "lib/planted-c.ts": 'import y from "@/data/reference/sample-plan.json";',
    "lib/planted-d.ts": 'const q = readFileSync("data/meta.json", "utf8");',
    "lib/planted-e.ts": "const r = `data/history/${id}.json`;",
    "lib/clean-a.ts": 'import z from "../.data/snapshot/reference/aid-policies.json" with { type: "json" };',
    "lib/clean-b.ts": 'const s = join(process.cwd(), ".data", "snapshot", "colleges.json");',
    "lib/clean-c.ts": " * the old data/reference/aid-policies.json, in a comment",
    "lib/clean-d.ts": 'res.on("data", (chunk) => chunks.push(chunk));',
  };
  const found = dataPathLines(Object.keys(planted), (f) => planted[f]).map((l) => l.split(":")[0]);
  assert.deepEqual(found, ["lib/planted-a.ts", "lib/planted-b.ts", "lib/planted-c.ts", "lib/planted-d.ts", "lib/planted-e.ts"]);
});
