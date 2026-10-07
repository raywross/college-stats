/**
 * Where the app's data comes from (specs/serving-architecture.md#1-the-deploy-carries-the-dataset): the college
 * dataset is loaded from data/ once per instance (lib/dataset-loader.ts, lib/data.ts) and never from Supabase; a
 * leftover DATA_SOURCE is ignored with one warning; high schools have their own switch (lib/high-schools.ts); and the
 * revalidation endpoint's auth (lib/revalidate.ts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import { extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDatasetLoader } from "../lib/dataset-loader.ts";
import { isAuthorized } from "../lib/revalidate.ts";

const ROOT = join(import.meta.dirname, "..");

// lib/data.ts and lib/high-schools.ts are written for Next.js: `import "server-only"`, `@/` paths, and relative
// imports without extensions. Resolve those the way Next.js does so the real modules load here.
// (module.registerHooks is in Node 22.15+ and 24; the installed @types/node predates it.)
type ResolveResult = { url: string; shortCircuit?: boolean };
type ResolveContext = { parentURL?: string };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: ResolveContext, next: (s: string, c: ResolveContext) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    const fromRoot = specifier.startsWith("@/");
    if (fromRoot || ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:"))) {
      const path = fromRoot ? join(ROOT, specifier.slice(2)) : fileURLToPath(new URL(specifier, context.parentURL));
      if (!extname(path) || !existsSync(path)) {
        const found = [".ts", ".tsx", "/index.ts"].map((ext) => path + ext).find((p) => existsSync(p) && statSync(p).isFile());
        if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
      }
      if (fromRoot) return { url: pathToFileURL(path).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

/** A fresh copy of lib/data.ts (its own once-per-instance state), as a new server instance would have. */
async function freshDataModule(tag: string): Promise<typeof import("../lib/data.ts")> {
  return import(`${pathToFileURL(join(ROOT, "lib", "data.ts")).href}?instance=${tag}`);
}

/** Runs `fn` with env vars set (undefined deletes) and console.warn/info/error captured, then restores both. */
async function withEnvAndConsole<T>(env: Record<string, string | undefined>, fn: (logs: Record<"warn" | "info" | "error", string[]>) => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const original = { warn: console.warn, info: console.info, error: console.error };
  const logs: Record<"warn" | "info" | "error", string[]> = { warn: [], info: [], error: [] };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const level of ["warn", "info", "error"] as const) console[level] = (...args: unknown[]) => void logs[level].push(args.map(String).join(" "));
  try {
    return await fn(logs);
  } finally {
    Object.assign(console, original);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const COLLEGES = (JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as unknown[]).length;
const LOADED_LINE = /^\[data\] loaded (\d+) colleges from data\/ in \d+ ms$/;
const IGNORED = "[data] DATA_SOURCE is ignored: the deploy carries the dataset (specs/serving-architecture.md)";

/* ------------------------------------------------------------------ */
/* The loader: load once, serve forever                                */
/* ------------------------------------------------------------------ */

test("the loader loads once and never checks again; concurrent first calls share the one load", async () => {
  let loads = 0;
  const get = createDatasetLoader(async () => ({ copy: ++loads }));
  const first = await Promise.all([get(), get(), get()]);
  assert.equal(loads, 1);
  assert.ok(first.every((v) => v === first[0]), "every caller gets the same object");
  assert.equal(await get(), first[0]);
  assert.equal(loads, 1, "later calls are served from memory");
});

test("the first load failing is loud: the call throws (no empty site), and a later call tries again", async () => {
  let loads = 0;
  const get = createDatasetLoader(async () => {
    if (++loads === 1) throw new Error("data/schools.json is missing");
    return "dataset";
  });
  await assert.rejects(get(), /schools\.json is missing/);
  assert.equal(await get(), "dataset");
  assert.equal(await get(), "dataset");
  assert.equal(loads, 2);
});

/* ------------------------------------------------------------------ */
/* lib/data.ts reads the files                                         */
/* ------------------------------------------------------------------ */

test("a leftover DATA_SOURCE gets one warning and the dataset still loads from data/, once", async () => {
  await withEnvAndConsole({ DATA_SOURCE: "supabase", SUPABASE_URL: undefined, SUPABASE_PUBLISHABLE_KEY: undefined }, async (logs) => {
    const { getData, getHistoryFiles } = await freshDataModule("leftover-setting");
    const data = await getData();
    assert.equal(data.getAllSchools().length, COLLEGES);
    assert.equal(await getData(), data, "the same copy on every call");
    await getHistoryFiles();
    assert.deepEqual(logs.warn, [IGNORED], "exactly one warning");
    assert.equal(logs.info.length, 1, "one load line per instance");
    assert.equal(Number(logs.info[0].match(LOADED_LINE)?.[1]), COLLEGES, logs.info[0]);
  });
});

test("without DATA_SOURCE there is no warning, only the load line", async () => {
  await withEnvAndConsole({ DATA_SOURCE: undefined }, async (logs) => {
    const { getData } = await freshDataModule("no-setting");
    await getData();
    await getData();
    assert.deepEqual(logs.warn, []);
    assert.equal(logs.info.length, 1);
    assert.match(logs.info[0], LOADED_LINE);
  });
});

test("per-college files read from disk and are fail-soft; What changed is empty without Supabase", async () => {
  await withEnvAndConsole({ SUPABASE_URL: undefined, CHANGES_FIXTURE: undefined }, async (logs) => {
    const { getHistory, getDetail, getTrendFile, getSchoolChanges } = await freshDataModule("per-item");
    const withHistory = readdirSync(join(ROOT, "data", "history", "schools"))[0].replace(/\.json$/, "");
    assert.equal((await getHistory(withHistory))?.unit_id, withHistory);
    const withDetail = readdirSync(join(ROOT, "data", "detail", "schools"))[0].replace(/\.json$/, "");
    assert.ok(await getDetail(withDetail));
    assert.equal(await getHistory("999999999"), null, "no file reads as none");
    assert.equal(await getDetail("999999999"), null);
    assert.equal(await getTrendFile("no-such-trend" as never), null);
    assert.deepEqual(await getSchoolChanges(withHistory), [], "no Supabase, no client, no panel");
    assert.deepEqual(logs.error, []);
  });
});

/* ------------------------------------------------------------------ */
/* High schools: their own switch                                      */
/* ------------------------------------------------------------------ */

test("highSchoolsSource(): supabase only when both the URL and the publishable key are set, unless HIGH_SCHOOLS_SOURCE says", async () => {
  const { highSchoolsSource } = await import("../lib/high-schools.ts");
  const URL_ = "https://example.supabase.co";
  const KEY = "sb_publishable_x";
  // The four combinations of the two Supabase settings, with HIGH_SCHOOLS_SOURCE unset.
  assert.equal(highSchoolsSource({}), "json");
  assert.equal(highSchoolsSource({ SUPABASE_URL: URL_ }), "json");
  assert.equal(highSchoolsSource({ SUPABASE_PUBLISHABLE_KEY: KEY }), "json");
  assert.equal(highSchoolsSource({ SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEY: KEY }), "supabase");
  // Empty counts as unset, like a variable created in a dashboard without a value.
  assert.equal(highSchoolsSource({ SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: KEY }), "json");
  assert.equal(highSchoolsSource({ HIGH_SCHOOLS_SOURCE: " ", SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEY: KEY }), "supabase");
  // An explicit setting wins either way.
  assert.equal(highSchoolsSource({ HIGH_SCHOOLS_SOURCE: "json", SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEY: KEY }), "json");
  assert.equal(highSchoolsSource({ HIGH_SCHOOLS_SOURCE: " Supabase " }), "supabase");
  assert.throws(() => highSchoolsSource({ HIGH_SCHOOLS_SOURCE: "postgres" }), /HIGH_SCHOOLS_SOURCE must be "json" or "supabase"/);
  // With no argument it reads process.env.
  await withEnvAndConsole({ HIGH_SCHOOLS_SOURCE: undefined, SUPABASE_URL: undefined, SUPABASE_PUBLISHABLE_KEY: undefined }, async () => {
    assert.equal(highSchoolsSource(), "json");
  });
});

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx|mts)$/.test(f))
    .map((f) => join(dir, f));
}

test("guard: DATA_SOURCE appears in app code only in the one warning that says it's ignored", () => {
  const mentions = ["lib", "app", "components"]
    .flatMap(sourceFiles)
    .flatMap((file) =>
      readFileSync(join(ROOT, file), "utf8")
        .split("\n")
        .map((line, i) => ({ where: `${relative(ROOT, join(ROOT, file))}:${i + 1}`, line }))
        .filter(({ line }) => line.includes("DATA_SOURCE")),
    );
  assert.deepEqual(
    mentions.map((m) => m.where.replace(/:\d+$/, "")),
    ["lib/data.ts"],
    `only lib/data.ts's warning may name it; found:\n${mentions.map((m) => `${m.where}: ${m.line.trim()}`).join("\n")}`,
  );
  assert.ok(mentions[0].line.includes(IGNORED), "and that one line is the warning");
});

test("guard: lib/ and components/ never read the retired dataset tables from Supabase", () => {
  const RETIRED = ["schools", "school_staging", "dataset_files", "school_aliases", "history_files", "history_staging", "school_histories", "school_details", "detail_staging"];
  const reads = ["lib", "components"].flatMap(sourceFiles).flatMap((file) =>
    [...readFileSync(join(ROOT, file), "utf8").matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g)]
      .filter((m) => RETIRED.includes(m[1]))
      .map((m) => `${file}: from("${m[1]}")`),
  );
  assert.deepEqual(reads, [], "the deploy carries the dataset; read it with lib/data.ts");
  assert.equal(existsSync(join(ROOT, "lib", "supabase-detail.ts")), false, "lib/supabase-detail.ts is gone");
});

/* ------------------------------------------------------------------ */
/* /api/revalidate                                                     */
/* ------------------------------------------------------------------ */

test("revalidation requires the exact bearer secret, and is off when no secret is configured", () => {
  assert.equal(isAuthorized("Bearer s3cret", "s3cret"), true);
  assert.equal(isAuthorized("Bearer s3cret!", "s3cret"), false);
  assert.equal(isAuthorized("Bearer ", "s3cret"), false);
  assert.equal(isAuthorized("s3cret", "s3cret"), false);
  assert.equal(isAuthorized(null, "s3cret"), false);
  assert.equal(isAuthorized("Bearer ", ""), false);
  assert.equal(isAuthorized("Bearer undefined", undefined), false);
});
