/**
 * Times the parts of a cold dataset load (specs/serving-architecture.md "6. Cold starts"). Each run is a fresh
 * process, so nothing in the process is warm. Prints, per step, the median of N runs of the wall time and of the main
 * thread's CPU time (the CPU time barely moves when other work shares the machine, the wall time does): the whole
 * first load through lib/data-platform/loader.ts (what the `[data] loaded … in N ms` line measures), the first lookup,
 * the first `school.lineage` access (one college's lineage/<unit>.json, read lazily since the lineage split) and every
 * college's (a page that cites them all, Explore), then the parts: reading each file, JSON.parse of each (lineage.json
 * too, the object the split took out of colleges.json), and createDataset.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/measure-cold-start.mts [--dir .data/snapshot] [--runs 5]
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/measure-cold-start.mts --dir tests/fixtures/snapshot-mini/snapshot
 *
 * For the real snapshot, fetch it first (DATA_SNAPSHOT_URL=<the bucket's public base> npm run fetch-snapshot).
 *
 * A QA tool, not part of `npm run verify`.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as nodeModule from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = resolve(flag("--dir") ?? join(ROOT, ".data", "snapshot"));
const runs = Number(flag("--runs") ?? 5);

if (!args.includes("--child")) {
  const results: Record<string, number>[] = [];
  for (let i = 0; i < runs; i++) {
    const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", fileURLToPath(import.meta.url), "--child", "--dir", dir], { encoding: "utf8" });
    if (r.status !== 0) {
      process.stderr.write(r.stderr);
      process.exit(1);
    }
    results.push(JSON.parse(r.stdout.trim().split("\n").at(-1)!));
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(`${dir} (median of ${runs} cold runs, ms)`);
  console.log(`  ${"step".padEnd(44)} ${"wall".padStart(8)} ${"cpu".padStart(8)}`);
  for (const key of Object.keys(results[0]).filter((k) => !k.endsWith(" cpu"))) {
    console.log(`  ${key.padEnd(44)} ${median(results.map((r) => r[key])).toFixed(1).padStart(8)} ${median(results.map((r) => r[`${key} cpu`])).toFixed(1).padStart(8)}`);
  }
  process.exit(0);
}

// The child: resolve lib/ the way Next.js does (server-only, @/ paths, extensionless imports), as the tests do.
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
        const found = [".ts", ".tsx", "/index.ts"].map((ext) => path + ext).find((p) => existsSync(p));
        if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
      }
      if (fromRoot) return { url: pathToFileURL(path).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const out: Record<string, number> = {};
// The main thread's CPU time (Node 23.9+; not in this repo's @types/node yet).
const { threadCpuUsage } = process as unknown as { threadCpuUsage(since?: NodeJS.CpuUsage): NodeJS.CpuUsage };
const cpuMs = (since: NodeJS.CpuUsage) => {
  const used = threadCpuUsage(since);
  return (used.user + used.system) / 1000;
};
const record = (key: string, wall: number, cpu: number) => {
  out[key] = (out[key] ?? 0) + wall;
  out[`${key} cpu`] = (out[`${key} cpu`] ?? 0) + cpu;
};
const time = <T,>(key: string, fn: () => T): T => {
  const cpu = threadCpuUsage();
  const start = performance.now();
  const value = fn();
  record(key, performance.now() - start, cpuMs(cpu));
  return value;
};

const { createDataset } = await import("../lib/dataset.ts");
const { createSnapshotHolder } = await import("../lib/data-platform/loader.ts");
// The loader reads `<root>/.data/snapshot/`; another folder (the mini fixture) is copied under a temporary root.
let root = dirname(dirname(dir));
if (join(root, ".data", "snapshot") !== dir) {
  root = mkdtempSync(join(tmpdir(), "measure-cold-start-"));
  cpSync(dir, join(root, ".data", "snapshot"), { recursive: true });
  process.on("exit", () => rmSync(root, { recursive: true, force: true }));
}

// The whole first load, while nothing in the process is warm (what production's line measures).
const info = console.info;
console.info = () => {};
const holder = createSnapshotHolder({ source: { kind: "bundled" }, root, build: (content) => createDataset(content.files) });
const cpu = threadCpuUsage();
const start = performance.now();
const served = await holder.load();
record("whole first load (holder.load)", performance.now() - start, cpuMs(cpu));
console.info = info;
const harvard = time("first getSchoolById after the load", () => served.value.getSchoolById("166027"));
time("first school.lineage access (one college)", () => harvard?.lineage);
time("every college's school.lineage after that", () => served.value.getAllSchools().reduce((n, s) => n + (s.lineage ? 1 : 0), 0));

// Then the parts, from disk again.
const files = ["manifest.json", "colleges.json", "lineage.json", "meta.json", "release-calendar.json", "aliases.json", "history/shared.json"];
const parsed: Record<string, unknown> = {};
for (const f of files) {
  const path = join(dir, f);
  if (!existsSync(path)) continue;
  const text = time(`read ${f} (${(statSync(path).size / 1e6).toFixed(2)} MB)`, () => readFileSync(path).toString("utf8"));
  parsed[f] = time(`parse ${f}`, () => JSON.parse(text));
}
time("createDataset", () =>
  createDataset({
    schools: parsed["colleges.json"] as never,
    meta: parsed["meta.json"] as never,
    releaseCalendar: parsed["release-calendar.json"] as never,
    aliases: (parsed["aliases.json"] as never) ?? [],
  }),
);
process.stdout.write(`\n${JSON.stringify(out)}\n`);
