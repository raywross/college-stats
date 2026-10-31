/**
 * The publisher (specs/data-platform/publish.md "The publisher"): composes the layers into the documents the app
 * reads, checks lineage, renders a snapshot, uploads it to the `snapshots` bucket, moves the pointer, and records the
 * change log and tier history.
 *
 *   npm run publish-snapshot -- --store supabase                         the data project (DATA_SUPABASE_*)
 *   npm run publish-snapshot -- --store file:/tmp/dp-import --dry-run --out /tmp/dp-out
 *   npm run publish-snapshot -- --store supabase --force                 publish with nothing new, or past a hold
 *   npm run publish-snapshot -- --store supabase --point 41              point back at snapshot 41 (no rebuild)
 *   … --skip-changelog          no change log or tier history (a re-publish, a test)
 *   … --previous auto|git|none  what the tiers' hysteresis, the carried trends and the change log compare with:
 *                               the last published snapshot (auto), falling back to data/schools.json while git still
 *                               holds it (phase 1); `none` for a first publish from nothing
 *   … --today YYYY-MM-DD        the day the compose uses (the open essay cycle); default today
 *   … --revalidate-wait <s>     seconds between moving the pointer and revalidating (default 75)
 *   … --skip-trends             leave out the national trend files (a fixture of a few colleges, whose builders need
 *                               every college; never for the real data)
 *
 * Steps: (1) the change sets since the last published snapshot: any held one stops the run (exit 2) unless --force;
 * none stops it ("nothing to publish") unless --force. (2) Load the layers, the live field edits and the console's
 * hand-read prompts. (3) Compose (scripts/lib/data-platform/compose.mts); a lineage failure records the snapshot as
 * failed, prints the first ten problems and exits 1, uploading nothing. (4) Render (render.mts). (5) Upload the
 * objects, then the manifest, then the pointer (upload.mts); wait 75 s (a warm instance re-reads the pointer at most
 * once a minute, so revalidating sooner would rebuild pages from the old snapshot) and POST /api/revalidate on each
 * site. (6) Record: data_finish_snapshot, the change log and tier history (changelog.mts). (7) Prune old snapshots'
 * objects. `--dry-run` stops after (4), writing the objects and the manifest under `--out` when given, and writes
 * nothing anywhere else.
 *
 * With `--store file:<dir>` the ledger is the folder's (`_change_sets.json`, `_snapshots.json`) and the bucket is
 * `<dir>/_bucket/`; nothing touches the network. Env: DATA_SUPABASE_URL / DATA_SUPABASE_SECRET_KEY (falling back to
 * SUPABASE_URL / SUPABASE_SECRET_KEY), REVALIDATE_SECRET and REVALIDATE_URLS (comma-separated site origins; else
 * SITE_URL) for the revalidate call, NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN for the `data_publish` event.
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { userInfo } from "node:os";
import { gunzipSync } from "node:zlib";
import type { DatasetMeta, School } from "../lib/types";
import { SNAPSHOT_OBJECTS, snapshotPath } from "../lib/data-platform/snapshot.ts";
import { sanitizeProperties } from "../lib/analytics.ts";
import { flagValue, parseStoreFlag, storeFromFlag, type Env } from "./lib/data-platform/store.mts";
import { composeSnapshot, loadPublishLayers, type ComposedSnapshot } from "./lib/data-platform/compose.mts";
import { renderSnapshot, renderedBytes, sha256, type RenderedSnapshot } from "./lib/data-platform/render.mts";
import { fileBucket, movePointer, pointerFor, prune, snapshotsToKeep, supabaseBucket, uploadSnapshot, type BucketClient } from "./lib/data-platform/upload.mts";
import { fileLedger, lastPublished, supabaseLedger, type PublishLedger } from "./lib/data-platform/ledger.mts";
import { recordChanges, recordTiers, tierSuppression } from "./lib/data-platform/changelog.mts";
import { readRecorded, type HistoryClient } from "./lib/selectivity-history.mts";
import { SELECTIVITY_METHOD } from "../lib/selectivity.ts";

const ROOT = join(import.meta.dirname, "..");

/** Exit codes: 0 published (or nothing to do), 1 a lineage failure or an error, 2 held change sets block the run. */
export const EXIT = { ok: 0, failed: 1, held: 2 } as const;

/** Seconds between moving the pointer and revalidating (publish.md step 5). */
export const REVALIDATE_WAIT_S = 75;

export interface PublishOptions {
  store: string | undefined;
  dryRun: boolean;
  out?: string;
  force: boolean;
  skipChangelog: boolean;
  point?: number;
  previous: "auto" | "git" | "none";
  today: string;
  skipTrends?: boolean;
  revalidateWaitS: number;
  env: Env;
  log: (line: string) => void;
  /** Where data/ lives for `--previous git` (the repository). */
  root: string;
  /** Overrides for tests: the bucket, the ledger, the change-log client, fetch. */
  deps?: Partial<{ bucket: BucketClient; ledger: PublishLedger; changelogClient: unknown; fetch: typeof fetch; now: () => Date }>;
}

/** Parses argv into options (process.env and console for the rest). */
export function parseArgs(argv: readonly string[], env: Env = process.env): PublishOptions {
  const point = flagValue(argv, "--point");
  const previous = (flagValue(argv, "--previous") ?? "auto") as PublishOptions["previous"];
  if (!["auto", "git", "none"].includes(previous)) throw new Error(`--previous ${previous}: expected auto, git or none`);
  const wait = flagValue(argv, "--revalidate-wait");
  return {
    store: flagValue(argv, "--store"),
    dryRun: argv.includes("--dry-run"),
    out: flagValue(argv, "--out"),
    force: argv.includes("--force"),
    skipChangelog: argv.includes("--skip-changelog"),
    point: point === undefined ? undefined : Number(point),
    previous,
    today: flagValue(argv, "--today") ?? new Date().toISOString().slice(0, 10),
    skipTrends: argv.includes("--skip-trends"),
    revalidateWaitS: wait === undefined ? REVALIDATE_WAIT_S : Number(wait),
    env,
    log: (line) => console.log(line),
    root: ROOT,
  };
}

interface Backend {
  ledger: PublishLedger;
  bucket: BucketClient;
  /** The secret-key client for the change log and tier history (null for the file store). */
  client: (HistoryClient & Parameters<typeof recordChanges>[0]) | null;
}

async function backend(opts: PublishOptions): Promise<Backend> {
  const spec = parseStoreFlag(opts.store, opts.env);
  if (spec.kind === "file") {
    return { ledger: opts.deps?.ledger ?? fileLedger(spec.root, { now: opts.deps?.now }), bucket: opts.deps?.bucket ?? fileBucket(join(spec.root, "_bucket")), client: (opts.deps?.changelogClient as Backend["client"]) ?? null };
  }
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(spec.url, spec.key, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    ledger: opts.deps?.ledger ?? supabaseLedger(client),
    bucket: opts.deps?.bucket ?? (await supabaseBucket(spec.url, spec.key)),
    client: (opts.deps?.changelogClient as Backend["client"]) ?? (client as unknown as Backend["client"]),
  };
}

async function download(bucket: BucketClient, path: string): Promise<Buffer> {
  const { data, error } = await bucket.download(path);
  if (error || !data) throw new Error(`reading ${path} from the bucket: ${error?.message ?? "no body"}`);
  return Buffer.from(await data.arrayBuffer());
}

/** A published snapshot's colleges and meta, from the bucket. */
export async function readSnapshot(bucket: BucketClient, id: number): Promise<{ schools: School[]; meta: DatasetMeta }> {
  const colleges = await download(bucket, snapshotPath(id, SNAPSHOT_OBJECTS.colleges));
  const meta = await download(bucket, snapshotPath(id, SNAPSHOT_OBJECTS.meta));
  return { schools: JSON.parse(gunzipSync(colleges).toString("utf8")) as School[], meta: JSON.parse(meta.toString("utf8")) as DatasetMeta };
}

/** data/schools.json and data/meta.json while git still holds them (phase 1's stand-in for a first snapshot's previous). */
function readGitDataset(root: string): { schools: School[]; meta: DatasetMeta } | null {
  const schools = join(root, "data", "schools.json");
  const meta = join(root, "data", "meta.json");
  if (!existsSync(schools) || !existsSync(meta)) return null;
  return { schools: JSON.parse(readFileSync(schools, "utf8")) as School[], meta: JSON.parse(readFileSync(meta, "utf8")) as DatasetMeta };
}

/** Writes the rendered objects and the manifest under `dir` (a dry run's `--out`). */
export function writeRendered(dir: string, rendered: RenderedSnapshot): void {
  for (const [name, o] of rendered.objects) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), o.bytes);
  }
  writeFileSync(join(dir, SNAPSHOT_OBJECTS.manifest), rendered.manifestBytes);
}

/** POST /api/revalidate on each configured site; failures are logged, never thrown (the pointer has already moved). */
async function revalidate(opts: PublishOptions): Promise<void> {
  const secret = opts.env.REVALIDATE_SECRET;
  const sites = (opts.env.REVALIDATE_URLS || opts.env.SITE_URL || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  if (!secret || !sites.length) {
    opts.log("revalidate: REVALIDATE_SECRET or REVALIDATE_URLS/SITE_URL not set; skipped (pages pick the snapshot up as they regenerate)");
    return;
  }
  if (opts.revalidateWaitS > 0) {
    opts.log(`revalidate: waiting ${opts.revalidateWaitS} s so warm instances have read the new pointer`);
    await new Promise((r) => setTimeout(r, opts.revalidateWaitS * 1000));
  }
  const f = opts.deps?.fetch ?? fetch;
  for (const site of sites) {
    try {
      const res = await f(`${site}/api/revalidate`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
      opts.log(`revalidate: ${site} answered ${res.status}`);
    } catch (err) {
      opts.log(`revalidate: ${site} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** The `data_publish` server event, over PostHog's capture endpoint (no SDK in scripts). Never throws. */
async function trackPublish(opts: PublishOptions, props: { snapshot: number; change_sets: number; ms: number }): Promise<void> {
  const key = opts.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!key) return;
  const properties = sanitizeProperties("data_publish", props);
  if (!properties) return;
  try {
    const host = (opts.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com").replace(/\/+$/, "");
    await (opts.deps?.fetch ?? fetch)(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key, event: "data_publish", distinct_id: "publisher", properties: { ...properties, $process_person_profile: false } }),
    });
  } catch (err) {
    opts.log(`analytics: data_publish not sent (${err instanceof Error ? err.message : String(err)})`);
  }
}

/** `--point <id>`: moves the pointer back to a published snapshot (no rebuild, no change log), then revalidates. */
async function pointBack(opts: PublishOptions, b: Backend, id: number): Promise<number> {
  const row = (await b.ledger.snapshots()).find((r) => r.id === id);
  if (!row || row.status !== "published") {
    opts.log(`--point ${id}: no published snapshot ${id}`);
    return EXIT.failed;
  }
  const manifest = await download(b.bucket, snapshotPath(id, SNAPSHOT_OBJECTS.manifest));
  const pointer = pointerFor(id, sha256(manifest), (opts.deps?.now?.() ?? new Date()).toISOString());
  if (opts.dryRun) {
    opts.log(`--point ${id} (--dry-run): would move the pointer to ${JSON.stringify(pointer)}`);
    return EXIT.ok;
  }
  await movePointer(b.bucket, pointer, { log: opts.log });
  opts.log(`pointer moved back to snapshot ${id}`);
  await revalidate(opts);
  return EXIT.ok;
}

/** The whole run; resolves to the exit code. */
export async function publishSnapshot(opts: PublishOptions): Promise<number> {
  const started = Date.now();
  const b = await backend(opts);
  if (opts.point !== undefined) {
    if (!Number.isInteger(opts.point) || opts.point < 1) throw new Error("--point needs a snapshot id");
    return pointBack(opts, b, opts.point);
  }

  // 1. Whether to publish.
  const pending = await b.ledger.pendingChangeSets();
  const held = pending.filter((s) => s.status === "held");
  if (held.length && !opts.force) {
    opts.log(`publish-snapshot: ${held.length} held change set(s) block the publish:`);
    for (const s of held) opts.log(`  ${s.id} (${s.source}): ${s.held_reason ?? "held"}`);
    opts.log("Publish anyway or revert them in the console (Publish now passes --force).");
    return EXIT.held;
  }
  if (held.length) opts.log(`publish-snapshot: --force: publishing past ${held.length} held change set(s) (${held.map((s) => s.id).join(", ")}); their documents are in the layers`);
  if (!pending.length && !opts.force) {
    opts.log("publish-snapshot: nothing to publish (no change set since the last snapshot)");
    return EXIT.ok;
  }
  const changeSetIds = pending.map((s) => s.id);

  // 2. The layers, the edits, the hand-read prompts; the previous snapshot.
  const store = storeFromFlag(opts.store, opts.env, { log: opts.log });
  const [edits, promptOverrides] = [await b.ledger.fieldEdits(), await b.ledger.promptOverrides()];
  const layers = await loadPublishLayers(store, { edits, promptOverrides });
  const last = await lastPublished(b.ledger);
  let previous: { schools: School[]; meta: DatasetMeta } | null = null;
  if (opts.previous === "auto" && last) previous = await readSnapshot(b.bucket, last.id);
  else if (opts.previous !== "none") previous = readGitDataset(opts.root);
  opts.log(`publish-snapshot: ${changeSetIds.length} change set(s); previous: ${last && opts.previous === "auto" ? `snapshot ${last.id}` : previous ? "data/schools.json (git)" : "none"}`);

  // 3. Compose.
  const composed: ComposedSnapshot = composeSnapshot(layers, { previous: previous?.schools ?? null, today: opts.today, trends: !opts.skipTrends });
  for (const w of composed.warnings.slice(0, 20)) opts.log(`  warning: ${w}`);
  if (composed.warnings.length > 20) opts.log(`  …and ${composed.warnings.length - 20} more warnings`);
  if (composed.problems.length) {
    opts.log(`publish-snapshot: lineage check failed (${composed.problems.length}); nothing uploaded:`);
    for (const p of composed.problems.slice(0, 10)) opts.log(`  ${p}`);
    if (!opts.dryRun) {
      const id = await b.ledger.begin(changeSetIds, last?.id ?? null);
      await b.ledger.finish(id, "failed", null, composed.problems.slice(0, 10).join("\n"));
      opts.log(`snapshot ${id} recorded as failed`);
    }
    return EXIT.failed;
  }

  // 4. Render.
  const id = opts.dryRun ? (last?.id ?? 0) + 1 : await b.ledger.begin(changeSetIds, last?.id ?? null);
  const createdAt = (opts.deps?.now?.() ?? new Date()).toISOString();
  const rendered = renderSnapshot(composed, id, last?.id ?? null, changeSetIds, { createdAt });
  const mb = (renderedBytes(rendered) / 1e6).toFixed(1);
  opts.log(`publish-snapshot: ${composed.schools.length} colleges, ${rendered.objects.size} objects, ${mb} MB${composed.edits.applied ? `, ${composed.edits.applied} edit(s) at ${composed.edits.colleges} college(s)` : ""}`);
  if (opts.dryRun) {
    if (opts.out) {
      writeRendered(opts.out, rendered);
      opts.log(`publish-snapshot (--dry-run): snapshot ${id} rendered to ${opts.out}; nothing uploaded or recorded`);
    } else opts.log(`publish-snapshot (--dry-run): snapshot ${id} rendered; nothing uploaded or recorded (pass --out <dir> to keep it)`);
    return EXIT.ok;
  }

  // 5. Upload: objects, manifest, then the pointer.
  try {
    const up = await uploadSnapshot(b.bucket, rendered, { log: opts.log });
    opts.log(`uploaded ${up.uploaded} objects (${(up.bytes / 1e6).toFixed(1)} MB)${up.present ? `, ${up.present} already there` : ""}`);
    await movePointer(b.bucket, pointerFor(id, rendered.manifestSha256, createdAt), { log: opts.log });
  } catch (err) {
    await b.ledger.finish(id, "failed", rendered.manifest, err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
  await b.ledger.finish(id, "published", rendered.manifest, null);
  opts.log(`snapshot ${id} published; the pointer names it`);

  // 6. Record the change log and tier history, then revalidate (after the wait).
  if (opts.skipChangelog) opts.log("change log: skipped (--skip-changelog)");
  else if (!b.client) opts.log("change log: skipped (the file store has no change-log tables)");
  else {
    const recorded = await readRecorded(b.client);
    const { result } = await recordChanges(b.client, previous, { schools: composed.schools, meta: composed.meta }, composed.releaseCalendar, id, {
      publishedBy: opts.env.GITHUB_ACTOR ?? userInfo().username,
      suppressTiers: tierSuppression(recorded.lastMethod, composed.selectivity.method ?? SELECTIVITY_METHOD),
      log: opts.log,
    });
    await recordTiers(b.client, { schools: composed.schools, meta: composed.meta, index: composed.selectivity }, id, { publishId: result.publish_id, recorded, log: opts.log });
  }
  await revalidate(opts);

  // 7. Prune: the newest snapshots and every one pointed back to stay.
  const rows = await b.ledger.snapshots();
  const keep = snapshotsToKeep(rows, id);
  const candidates = rows.filter((r) => !keep.has(r.id) && r.status === "published");
  for (const r of candidates) r.manifest = (await b.ledger.manifest(r.id)) ?? {};
  const removed = await prune(b.bucket, candidates, keep, { log: opts.log });
  if (removed) opts.log(`pruned ${removed} objects`);

  const ms = Date.now() - started;
  await trackPublish(opts, { snapshot: id, change_sets: changeSetIds.length, ms });
  opts.log(`publish-snapshot: done in ${(ms / 1000).toFixed(0)} s`);
  return EXIT.ok;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  publishSnapshot(parseArgs(process.argv.slice(2))).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`publish-snapshot: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(EXIT.failed);
    }
  );
}
