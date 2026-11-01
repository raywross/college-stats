/**
 * Downloads the current data snapshot into the bundled copy, `.data/snapshot/` (specs/data-platform/publish.md "The
 * loader", "Build"), which next.config.ts traces into every function and lib/data-platform/loader.ts reads.
 *
 *   npm run fetch-snapshot                  pointer → manifest → every object, checked by sha256
 *   npm run fetch-snapshot -- --if-configured   the prebuild: does nothing unless DATA_SNAPSHOT_URL is set
 *   npm run fetch-snapshot -- --fixture     copies the mini fixture (tests/fixtures/snapshot-mini/snapshot/) instead
 *   npm run fetch-snapshot -- --ensure      the postinstall: nothing when .data/snapshot/manifest.json exists, else
 *                                           a download when DATA_SNAPSHOT_URL is set, else the mini fixture
 *   npm run fetch-snapshot -- --check       exits 0 when .data/snapshot/manifest.json exists, 1 otherwise
 *   --dir <path>                            another folder than .data/snapshot (relative to the working directory)
 *
 * The layout mirrors the object names, with `.gz` objects stored ungzipped (`colleges.json`, `history/shared.json`).
 * An object already on disk with the manifest's hash is skipped, so a fetch after a small publish downloads only what
 * changed; files the new manifest doesn't list are removed. The manifest is removed first and written last, so the
 * loader never takes a half-written folder for a copy. `.objects.json` remembers the hashes of the gzipped objects,
 * whose bytes on disk differ from the object's.
 *
 * Reads the bucket's public URL (DATA_SNAPSHOT_URL); no key.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { BUNDLED_SNAPSHOT_DIR, POINTER_OBJECT, SNAPSHOT_OBJECTS, snapshotPath, type SnapshotManifest, type SnapshotPointer } from "../lib/data-platform/snapshot.ts";

const ROOT = join(import.meta.dirname, "..");
export const FIXTURE_DIR = join(ROOT, "tests", "fixtures", "snapshot-mini", "snapshot");
/** The hashes of the gzipped objects as published, keyed by object name (their bytes on disk are ungzipped). */
const OBJECTS_FILE = ".objects.json";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The name on disk for an object: `.gz` objects are stored ungzipped. */
export const localName = (object: string) => object.replace(/\.gz$/, "");

export interface FetchResult {
  id: number;
  downloaded: number;
  skipped: number;
  removed: number;
  bytes: number;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function getBytes(fetcher: Fetch, url: string): Promise<Buffer> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetcher(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => statSync(join(dir, f)).isFile())
    .map((f) => f.split("\\").join("/"));
}

/** Downloads snapshot `pointer.id` (the current one unless `id` is given) from `base` into `dir`. */
export async function fetchSnapshot(options: { base: string; dir: string; fetch?: Fetch; concurrency?: number; log?: (line: string) => void }): Promise<FetchResult> {
  const base = options.base.trim().replace(/\/+$/, "");
  const dir = options.dir;
  const fetcher = options.fetch ?? fetch;
  const log = options.log ?? (() => {});
  const pointer = JSON.parse((await getBytes(fetcher, `${base}/${POINTER_OBJECT}?t=${Date.now()}`)).toString("utf8")) as SnapshotPointer;
  if (!Number.isInteger(pointer.id)) throw new Error(`${POINTER_OBJECT} names no snapshot id`);
  const manifestBytes = await getBytes(fetcher, `${base}/${snapshotPath(pointer.id, SNAPSHOT_OBJECTS.manifest)}`);
  if (pointer.manifest_sha256 && sha256(manifestBytes) !== pointer.manifest_sha256) {
    throw new Error(`snapshot ${pointer.id}: the manifest doesn't match the pointer's hash`);
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as SnapshotManifest;
  if (manifest.id !== pointer.id) throw new Error(`snapshot ${pointer.id}: the manifest says id ${manifest.id}`);

  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, SNAPSHOT_OBJECTS.manifest), { force: true });
  const known: Record<string, string> = existsSync(join(dir, OBJECTS_FILE)) ? JSON.parse(readFileSync(join(dir, OBJECTS_FILE), "utf8")) : {};
  const gzipped: Record<string, string> = {};

  const names = Object.keys(manifest.objects).filter((name) => name !== SNAPSHOT_OBJECTS.manifest).sort();
  let downloaded = 0;
  let skipped = 0;
  let bytes = 0;

  const present = (name: string, expected: string): boolean => {
    const path = join(dir, localName(name));
    if (!existsSync(path)) return false;
    const onDisk = sha256(readFileSync(path));
    // A gzipped object is present when it was fetched with this hash and its ungzipped file hasn't changed since.
    if (name.endsWith(".gz")) return known[name] === expected && known[`${name}#local`] === onDisk;
    return onDisk === expected;
  };

  const one = async (name: string) => {
    const expected = manifest.objects[name].sha256;
    if (present(name, expected)) {
      skipped++;
      if (name.endsWith(".gz")) {
        gzipped[name] = expected;
        gzipped[`${name}#local`] = known[`${name}#local`];
      }
      return;
    }
    const body = await getBytes(fetcher, `${base}/${snapshotPath(manifest.id, name)}`);
    if (sha256(body) !== expected) throw new Error(`snapshot ${manifest.id}: ${name} doesn't match its hash`);
    const plain = name.endsWith(".gz") ? gunzipSync(body) : body;
    const path = join(dir, localName(name));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, plain);
    if (name.endsWith(".gz")) {
      gzipped[name] = expected;
      gzipped[`${name}#local`] = sha256(plain);
    }
    downloaded++;
    bytes += body.length;
  };

  const queue = [...names];
  const workers = Array.from({ length: Math.max(1, options.concurrency ?? 16) }, async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) await one(name);
  });
  await Promise.all(workers);

  // Anything the manifest doesn't list (an older snapshot's shards) goes, so the folder is exactly this snapshot.
  const keep = new Set([...names.map(localName), OBJECTS_FILE, SNAPSHOT_OBJECTS.manifest]);
  let removed = 0;
  for (const file of filesUnder(dir)) {
    if (keep.has(file)) continue;
    rmSync(join(dir, file));
    removed++;
  }
  writeFileSync(join(dir, OBJECTS_FILE), `${JSON.stringify(gzipped, null, 2)}\n`);
  writeFileSync(join(dir, SNAPSHOT_OBJECTS.manifest), manifestBytes);
  log(`[fetch-snapshot] snapshot ${manifest.id}: ${downloaded} downloaded (${(bytes / 1e6).toFixed(1)} MB), ${skipped} already present, ${removed} removed`);
  return { id: manifest.id, downloaded, skipped, removed, bytes };
}

/** The mini fixture copied in place of a download (D5 builds the fixture; specs/data-platform/git-ci-tests.md). */
export function copyFixture(dir: string, from = FIXTURE_DIR): void {
  if (!existsSync(join(from, SNAPSHOT_OBJECTS.manifest))) {
    throw new Error(`the mini fixture isn't built yet: ${relative(ROOT, from) || from}/manifest.json is missing (npm run build-mini-fixture)`);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  cpSync(from, dir, { recursive: true });
}

/** The CLI; returns the exit code. */
export async function main(argv: string[], env: Record<string, string | undefined> = process.env, cwd = process.cwd()): Promise<number> {
  const flag = (name: string) => argv.includes(name);
  const value = (name: string) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const dir = join(cwd, value("--dir") ?? BUNDLED_SNAPSHOT_DIR);
  const base = env.DATA_SNAPSHOT_URL?.trim();

  if (flag("--check")) {
    const ok = existsSync(join(dir, SNAPSHOT_OBJECTS.manifest));
    console.log(ok ? `[fetch-snapshot] ${relative(cwd, dir)} holds a snapshot` : `[fetch-snapshot] no snapshot in ${relative(cwd, dir)}`);
    return ok ? 0 : 1;
  }
  if (flag("--ensure")) {
    // The postinstall: make sure a bundled copy exists, so a clean clone typechecks, tests and builds. A copy already
    // there is kept as it is (the prebuild refreshes it when configured).
    const manifest = join(dir, SNAPSHOT_OBJECTS.manifest);
    if (existsSync(manifest)) {
      const id = (JSON.parse(readFileSync(manifest, "utf8")) as SnapshotManifest).id;
      console.log(`[fetch-snapshot] ${relative(cwd, dir)} already holds snapshot ${id}`);
      return 0;
    }
    if (!base) {
      try {
        copyFixture(dir);
        console.log(`[fetch-snapshot] no DATA_SNAPSHOT_URL: copied the mini fixture into ${relative(cwd, dir)}`);
        return 0;
      } catch (err) {
        console.error(`[fetch-snapshot] ${(err as Error).message}`);
        return 1;
      }
    }
  }
  if (flag("--fixture")) {
    try {
      copyFixture(dir);
      console.log(`[fetch-snapshot] copied the mini fixture into ${relative(cwd, dir)}`);
      return 0;
    } catch (err) {
      console.error(`[fetch-snapshot] ${(err as Error).message}`);
      return 1;
    }
  }
  if (!base) {
    // The prebuild: with nothing configured, today's builds are untouched (no folder, no output).
    if (flag("--if-configured")) return 0;
    console.error("[fetch-snapshot] DATA_SNAPSHOT_URL is not set (the snapshots bucket's public URL), and --fixture wasn't given");
    return 1;
  }
  try {
    await fetchSnapshot({ base, dir, log: (line) => console.log(line) });
    return 0;
  } catch (err) {
    console.error(`[fetch-snapshot] ${(err as Error).message}`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
