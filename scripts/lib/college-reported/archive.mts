/**
 * The permanent document archive (specs/college-reported-round-3.md Decision 1): every CDS file and class-profile page
 * we fetch is stored once, keyed by the sha256 of its bytes, with each PDF's numbered line text beside it as
 * `<sha256>.lines.json.gz`. Every later read (re-extraction after a schema bump, escalation, a reader change) uses the
 * archived bytes and never fetches again.
 *
 * Two backends behind one interface, chosen by the environment:
 * - `local` (default): `.cache/college-docs/archive/<sha>.<ext>` and `<sha>.lines.json.gz` (git-ignored).
 * - `github-release` (when `COLLEGE_DOCS_REPO` is set): release assets in a private repo, one release per month
 *   (`docs-2026-10`, then `docs-2026-10.2` … when a release reaches the asset limit), asset name `<sha>.<ext>`, through
 *   the GitHub REST API with `COLLEGE_REPORTED_TOKEN` (or `GITHUB_TOKEN`). The local directory stays as a hot cache in
 *   front of it. Setup: specs/college-reported-setup.md "Archive repo and token".
 * Moving to another store later (Supabase Storage) is a third backend here and nothing else.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { entryYearOf, linkKind, type FoundLink } from "./documents.mts";
import { USER_AGENT, sha256 as sha256Of, type FetchFn } from "./http.mts";
import { SHA256 } from "../../../lib/cds-reads.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
export const DEFAULT_ARCHIVE_DIR = join(ROOT, ".cache", "college-docs", "archive");
const LINES_SUFFIX = "lines.json.gz";

/** One archive, whatever the backend. Every method is keyed by the sha256 (hex) of the document's bytes. */
export interface Archive {
  readonly backend: "local" | "github-release";
  /** Whether the permanent store holds the document's bytes. */
  has(sha: string): Promise<boolean>;
  /** The bytes, or null when the archive doesn't hold them. */
  get(sha: string): Promise<Uint8Array | null>;
  /**
   * Stores the bytes (a no-op when they are already stored) and returns where they live, for the manifest's `archive`
   * field: "local:<sha>.<ext>" or "gh:<release>/<sha>.<ext>". Throws when the bytes don't hash to `sha`.
   */
  put(sha: string, bytes: Uint8Array, ext: string): Promise<string>;
  /** Stores a document's numbered line text (any JSON; the layout reader owns its shape), gzipped. */
  putLines(sha: string, lines: unknown): Promise<string>;
  getLines<T = unknown>(sha: string): Promise<T | null>;
}

export interface ArchiveOptions {
  /** The local directory (the whole archive for `local`; the hot cache for `github-release`). */
  dir?: string;
  /** Overrides the environment's choice. */
  backend?: "local" | "github-release";
  /** Defaults to process.env: COLLEGE_DOCS_REPO, COLLEGE_REPORTED_TOKEN, GITHUB_TOKEN. */
  env?: Record<string, string | undefined>;
  /** "owner/name"; defaults to env.COLLEGE_DOCS_REPO. */
  repo?: string;
  token?: string;
  /** Injectable for tests (a fake GitHub API). */
  fetch?: FetchFn;
  /** The month's release is named from this clock (default: now). */
  now?: () => Date;
  /** Assets per release before the next one of the month is opened (default 1,000, GitHub's limit as assumed). */
  assetLimit?: number;
  apiBase?: string;
  uploadBase?: string;
  log?: (msg: string) => void;
}

/** The archive the environment asks for: GitHub release assets when COLLEGE_DOCS_REPO is set, else the local directory. */
export function createArchive(opts: ArchiveOptions = {}): Archive {
  const env = opts.env ?? process.env;
  const local = new LocalArchive(opts.dir ?? DEFAULT_ARCHIVE_DIR);
  const repo = opts.repo ?? env.COLLEGE_DOCS_REPO;
  const backend = opts.backend ?? (repo ? "github-release" : "local");
  if (backend === "local") return local;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`archive: COLLEGE_DOCS_REPO must be "owner/name" (got ${JSON.stringify(repo ?? null)})`);
  const token = opts.token ?? env.COLLEGE_REPORTED_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) throw new Error("archive: COLLEGE_DOCS_REPO is set but neither COLLEGE_REPORTED_TOKEN nor GITHUB_TOKEN is");
  return new GitHubReleaseArchive(local, {
    repo,
    token,
    fetch: opts.fetch ?? globalThis.fetch,
    now: opts.now ?? (() => new Date()),
    assetLimit: opts.assetLimit ?? 1000,
    apiBase: opts.apiBase ?? "https://api.github.com",
    uploadBase: opts.uploadBase ?? "https://uploads.github.com",
    log: opts.log ?? (() => {}),
  });
}

function checkSha(sha: string) {
  if (!SHA256.test(sha)) throw new Error(`archive: "${sha}" isn't a sha256`);
}
function checkExt(ext: string) {
  if (!/^[a-z0-9]{1,5}$/.test(ext)) throw new Error(`archive: bad extension "${ext}"`);
}
const linesName = (sha: string) => `${sha}.${LINES_SUFFIX}`;
const encodeLines = (lines: unknown) => new Uint8Array(gzipSync(JSON.stringify(lines)));
const decodeLines = <T,>(bytes: Uint8Array) => JSON.parse(gunzipSync(bytes).toString("utf8")) as T;

/* ------------------------------------------------------------------ */
/* Local directory                                                     */
/* ------------------------------------------------------------------ */

export class LocalArchive implements Archive {
  readonly backend = "local" as const;
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  /** The document's file name ("<sha>.<ext>"), or null. */
  fileOf(sha: string): string | null {
    if (!existsSync(this.dir)) return null;
    return readdirSync(this.dir).find((f) => f.startsWith(`${sha}.`) && !f.endsWith(LINES_SUFFIX) && !f.includes(".tmp-")) ?? null;
  }

  private write(name: string, bytes: Uint8Array) {
    mkdirSync(this.dir, { recursive: true });
    const tmp = join(this.dir, `${name}.tmp-${process.pid}`);
    writeFileSync(tmp, bytes);
    renameSync(tmp, join(this.dir, name));
  }

  async has(sha: string) {
    checkSha(sha);
    return this.fileOf(sha) !== null;
  }

  async get(sha: string) {
    checkSha(sha);
    const f = this.fileOf(sha);
    return f ? new Uint8Array(readFileSync(join(this.dir, f))) : null;
  }

  async put(sha: string, bytes: Uint8Array, ext: string) {
    checkSha(sha);
    checkExt(ext);
    if (sha256Of(bytes) !== sha) throw new Error(`archive: bytes don't hash to ${sha}`);
    const existing = this.fileOf(sha);
    if (existing) return `local:${existing}`;
    this.write(`${sha}.${ext}`, bytes);
    return `local:${sha}.${ext}`;
  }

  /** Writes a sidecar already gzipped (the GitHub backend's download path). */
  putLinesBytes(sha: string, gz: Uint8Array) {
    this.write(linesName(sha), gz);
  }

  async putLines(sha: string, lines: unknown) {
    checkSha(sha);
    this.write(linesName(sha), encodeLines(lines));
    return `local:${linesName(sha)}`;
  }

  linesBytes(sha: string): Uint8Array | null {
    const file = join(this.dir, linesName(sha));
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
  }

  async getLines<T = unknown>(sha: string) {
    checkSha(sha);
    const b = this.linesBytes(sha);
    return b ? decodeLines<T>(b) : null;
  }
}

/* ------------------------------------------------------------------ */
/* GitHub release assets in a private repo                             */
/* ------------------------------------------------------------------ */

interface GhDeps {
  repo: string;
  token: string;
  fetch: FetchFn;
  now: () => Date;
  assetLimit: number;
  apiBase: string;
  uploadBase: string;
  log: (msg: string) => void;
}
interface Release {
  id: number;
  tag: string;
  count: number;
}
interface Asset {
  id: number;
  tag: string;
}

export class GitHubReleaseArchive implements Archive {
  readonly backend = "github-release" as const;
  private index: Promise<{ releases: Map<string, Release>; assets: Map<string, Asset> }> | null = null;

  private readonly local: LocalArchive;
  private readonly gh: GhDeps;
  constructor(local: LocalArchive, gh: GhDeps) {
    this.local = local;
    this.gh = gh;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.gh.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      ...extra,
    };
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
    const res = await this.gh.fetch(`${this.gh.apiBase}${path}`, {
      method,
      headers: this.headers(body ? { "Content-Type": "application/json" } : {}),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok && res.status !== 404 && res.status !== 422) throw new Error(`archive: GitHub ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
    return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
  }

  /** Every `docs-*` release and its assets, listed once per run (a release holds up to `assetLimit`; 100 per page). */
  private loadIndex() {
    this.index ??= (async () => {
      const releases = new Map<string, Release>();
      const assets = new Map<string, Asset>();
      for (let page = 1; ; page++) {
        const { status, json } = await this.api<{ id: number; tag_name: string }[]>("GET", `/repos/${this.gh.repo}/releases?per_page=100&page=${page}`);
        if (status === 404) throw new Error(`archive: repo ${this.gh.repo} not found, or the token can't read it`);
        for (const r of json.filter((r) => r.tag_name.startsWith("docs-"))) {
          const rel: Release = { id: r.id, tag: r.tag_name, count: 0 };
          releases.set(rel.tag, rel);
          for (let ap = 1; ; ap++) {
            const { json: list } = await this.api<{ id: number; name: string }[]>("GET", `/repos/${this.gh.repo}/releases/${r.id}/assets?per_page=100&page=${ap}`);
            for (const a of list ?? []) assets.set(a.name, { id: a.id, tag: rel.tag });
            rel.count += list?.length ?? 0;
            if (!list || list.length < 100) break;
          }
        }
        if (json.length < 100) break;
      }
      return { releases, assets };
    })();
    return this.index;
  }

  private async assetOf(sha: string): Promise<[string, Asset] | null> {
    const { assets } = await this.loadIndex();
    for (const [name, a] of assets) if (name.startsWith(`${sha}.`) && !name.endsWith(LINES_SUFFIX)) return [name, a];
    return null;
  }

  /** This month's release with room for one more asset, created when needed. */
  private async releaseForUpload(): Promise<Release> {
    const { releases } = await this.loadIndex();
    const base = `docs-${this.gh.now().toISOString().slice(0, 7)}`;
    for (let n = 1; ; n++) {
      const tag = n === 1 ? base : `${base}.${n}`;
      const known = releases.get(tag);
      if (known && known.count < this.gh.assetLimit) return known;
      if (known) continue;
      const created = await this.api<{ id: number; tag_name: string }>("POST", `/repos/${this.gh.repo}/releases`, {
        tag_name: tag,
        name: tag,
        body: "College documents archived by the college-reported pipeline (specs/college-reported-round-3.md Decision 1). Private: never republish.",
        draft: false,
        prerelease: false,
      });
      let rel: Release;
      if (created.status === 422) {
        // Created meanwhile by another run: use it.
        const { status, json } = await this.api<{ id: number; tag_name: string }>("GET", `/repos/${this.gh.repo}/releases/tags/${tag}`);
        if (status !== 200) throw new Error(`archive: couldn't create or find release ${tag}`);
        rel = { id: json.id, tag, count: 0 };
      } else {
        rel = { id: created.json.id, tag, count: 0 };
        this.gh.log(`  archive: opened release ${tag}`);
      }
      releases.set(tag, rel);
      if (rel.count < this.gh.assetLimit) return rel;
    }
  }

  private async upload(name: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const { assets } = await this.loadIndex();
    const known = assets.get(name);
    if (known) return `gh:${known.tag}/${name}`;
    const rel = await this.releaseForUpload();
    const res = await this.gh.fetch(`${this.gh.uploadBase}/repos/${this.gh.repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "Content-Length": String(bytes.length) }),
      body: new Uint8Array(bytes),
    });
    const text = await res.text();
    // 422: an asset of that name is already there (another run uploaded it); the bytes are keyed by their hash.
    if (!res.ok && res.status !== 422) throw new Error(`archive: upload ${name} → ${res.status} ${text.slice(0, 200)}`);
    const id = res.ok ? (JSON.parse(text) as { id: number }).id : -1;
    assets.set(name, { id, tag: rel.tag });
    rel.count++;
    return `gh:${rel.tag}/${name}`;
  }

  private async download(asset: Asset, name: string): Promise<Uint8Array> {
    if (asset.id < 0) {
      this.index = null; // uploaded by another run during this one: list again for its id
      const again = (await this.loadIndex()).assets.get(name);
      if (!again || again.id < 0) throw new Error(`archive: ${name} is listed but has no id`);
      asset = again;
    }
    const res = await this.gh.fetch(`${this.gh.apiBase}/repos/${this.gh.repo}/releases/assets/${asset.id}`, {
      headers: this.headers({ Accept: "application/octet-stream" }),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`archive: download ${name} → ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async has(sha: string) {
    checkSha(sha);
    return (await this.assetOf(sha)) !== null;
  }

  async get(sha: string) {
    checkSha(sha);
    const cached = await this.local.get(sha);
    if (cached) return cached;
    const found = await this.assetOf(sha);
    if (!found) return null;
    const bytes = await this.download(found[1], found[0]);
    if (sha256Of(bytes) !== sha) throw new Error(`archive: ${found[0]} doesn't hash to its name`);
    await this.local.put(sha, bytes, found[0].slice(sha.length + 1));
    return bytes;
  }

  async put(sha: string, bytes: Uint8Array, ext: string) {
    await this.local.put(sha, bytes, ext);
    const found = await this.assetOf(sha);
    if (found) return `gh:${found[1].tag}/${found[0]}`;
    return this.upload(`${sha}.${ext}`, bytes, "application/octet-stream");
  }

  async putLines(sha: string, lines: unknown) {
    await this.local.putLines(sha, lines);
    return this.upload(linesName(sha), this.local.linesBytes(sha)!, "application/gzip");
  }

  async getLines<T = unknown>(sha: string) {
    checkSha(sha);
    const cached = await this.local.getLines<T>(sha);
    if (cached !== null) return cached;
    const { assets } = await this.loadIndex();
    const asset = assets.get(linesName(sha));
    if (!asset) return null;
    const gz = await this.download(asset, linesName(sha));
    this.local.putLinesBytes(sha, gz);
    return decodeLines<T>(gz);
  }
}

/* ------------------------------------------------------------------ */
/* Prior editions (`--archive-prior`, off by default)                  */
/* ------------------------------------------------------------------ */

export interface PriorEditionLink extends FoundLink {
  /** "2024-25" */
  edition: string;
}

/**
 * CDS files on an index page for editions older than `currentEdition` ("2025-26"), one per edition (an .xlsx over a
 * .pdf of the same edition), newest first, at most `max`. The pipeline archives these only with `--archive-prior`
 * (owner decision: off by default); history backfill then reads them from the archive.
 */
export function priorEditionLinks(links: readonly FoundLink[], currentEdition: string, max = Infinity): PriorEditionLink[] {
  const current = Number(/^(\d{4})/.exec(currentEdition)?.[1]);
  if (!Number.isFinite(current)) throw new Error(`priorEditionLinks: "${currentEdition}" isn't an edition`);
  const byYear = new Map<number, PriorEditionLink>();
  for (const link of links) {
    if (linkKind(link) !== "cds") continue;
    const year = entryYearOf(`${link.url} ${link.text}`);
    if (year === null || year >= current) continue;
    const edition = `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
    const had = byYear.get(year);
    const isXlsx = (u: string) => /\.xlsx($|\?)/i.test(u);
    if (!had || (isXlsx(link.url) && !isXlsx(had.url))) byYear.set(year, { ...link, edition });
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, max)
    .map(([, l]) => l);
}
