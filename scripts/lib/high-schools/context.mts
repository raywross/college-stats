/**
 * The context every high school adapter gets (./types.mts AdapterContext): cache directory, a download-once fetch, zip
 * readers (the system `unzip`, like scripts/lib/ipeds.mts), a logger, and `now`. CSV parsing: reuse `parseCsv` /
 * `forEachCsvRow` from scripts/lib/ipeds.mts.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { HighSchool } from "../../../lib/high-school-types.ts";
import type { AdapterContext, FetchCachedOptions } from "./types.mts";

export const USER_AGENT = "Quad college data explorer (high school sync; https://github.com/raywross/college-stats)";

/** `.cache/high-schools/` under the repository root. */
export function hsCacheDir(root: string): string {
  return join(root, ".cache", "high-schools");
}

/** A safe cache file name for a URL: its last path segment, or "download". */
export function cacheFileName(url: string): string {
  const seg = basename(new URL(url).pathname) || "download";
  return seg.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export interface ContextOptions {
  root: string;
  outDir: string;
  cacheDir?: string;
  now?: Date;
  existing?: ReadonlyMap<string, HighSchool>;
  flags?: Record<string, string | true>;
  offline?: boolean;
  /** Replace the network (tests). */
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export function createAdapterContext(opts: ContextOptions): AdapterContext {
  const cacheDir = opts.cacheDir ?? hsCacheDir(opts.root);
  const now = opts.now ?? new Date();
  const doFetch = opts.fetchImpl ?? fetch;
  const offline = opts.offline ?? false;
  const log = opts.log ?? ((m: string) => console.log(m));
  const warn = opts.warn ?? ((m: string) => console.warn(`Warning: ${m}`));

  async function fetchCached(url: string, o: FetchCachedOptions = {}): Promise<string> {
    mkdirSync(cacheDir, { recursive: true });
    const path = join(cacheDir, o.file ?? cacheFileName(url));
    if (existsSync(path)) {
      const fresh = o.maxAgeDays === undefined || now.getTime() - statSync(path).mtimeMs < o.maxAgeDays * 86_400_000;
      if (fresh || offline) return path;
    }
    if (offline) throw new Error(`${url}: not cached and --offline is set`);
    log(`  downloading ${url}`);
    const res = await doFetch(url, { headers: { "User-Agent": USER_AGENT, ...o.headers }, redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
    const tmp = `${path}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(tmp));
      renameSync(tmp, path);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
    // Where it came from, beside it (the cache is keyed by file name).
    writeFileSync(`${path}.url`, `${url}\n`);
    return path;
  }

  function listZip(zipPath: string): string[] {
    return execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  }

  function readZipEntry(zipPath: string, entry: string | RegExp, encoding: BufferEncoding = "latin1"): string {
    const name = typeof entry === "string" ? entry : listZip(zipPath).find((f) => entry.test(f));
    if (!name) throw new Error(`${zipPath}: no entry matching ${entry}`);
    return execFileSync("unzip", ["-p", zipPath, name], { encoding, maxBuffer: 2 * 1024 * 1024 * 1024 });
  }

  return {
    root: opts.root,
    cacheDir,
    outDir: opts.outDir,
    now,
    today: now.toISOString().slice(0, 10),
    existing: opts.existing ?? new Map(),
    flags: opts.flags ?? {},
    offline,
    log,
    warn,
    fetchCached,
    listZip,
    readZipEntry,
  };
}

/** `--only ccd,pss --year 2023 --offline` → { only: "ccd,pss", year: "2023", offline: true }. */
export function parseFlags(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}
