/**
 * Each college's mark: its own site icon (specs/school-identity/brand.md, "Source: marks"). The site probe
 * (data/site-probe.json, links.md) lists every icon a homepage declares plus /apple-touch-icon.png and /favicon.ico;
 * this step ranks them, downloads them through PoliteHttp (robots.txt, one request a second per host, honest user
 * agent) best first, and keeps the first that passes:
 *   - decoded with sharp (PNG, JPEG, GIF, WebP, SVG rasterized); ICO is parsed here, since sharp can't read it: its PNG
 *     entries are decoded by sharp and its 32-bit BMP entries converted to raw RGBA; 1-, 4-, 8-, and 24-bit BMP entries
 *     (palette-era icons, 16–48 px, all under the 64 px floor) are skipped;
 *   - at least 64 px on its short side, not fully transparent, and square, or within 10% of square (then the center
 *     square is cut out);
 *   - resized to 192 px and written as WebP quality 85 to public/brand/{unit_id}.webp.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";
import type { BrandLogoEntry, BrandOverride, SiteProbeEntry } from "../../lib/identity-files";
import { PoliteHttp, type FetchFn } from "./college-reported/http.mts";

export const LOGO_SIZE = 192;
export const MIN_ICON = 64;
/** Long side at most 10% over the short side: cut the center square; past it, reject. */
export const SQUARE_TOLERANCE = 0.1;
export const WEBP_QUALITY = 85;
/** No icon comes near this; a bigger body is a mistake. */
export const MAX_ICON_BYTES = 2 * 1024 * 1024;
/** Downloads per college at most, best candidate first. */
export const MAX_TRIES = 4;

export type IconCandidate = SiteProbeEntry["icons"][number];

/* ------------------------------------------------------------------ */
/* Ranking the probe's candidates                                      */
/* ------------------------------------------------------------------ */

/** The largest side in a `sizes` attribute ("180x180", "16x16 32x32", "any" = vector), or null. */
export function parseSizes(sizes: string | null | undefined): number | null {
  if (!sizes) return null;
  if (/\bany\b/i.test(sizes)) return 512;
  const sides = [...sizes.matchAll(/(\d+)\s*[x×]\s*(\d+)/gi)].map((m) => Math.min(Number(m[1]), Number(m[2])));
  return sides.length ? Math.max(...sides) : null;
}

const isSvg = (c: IconCandidate) => /svg/i.test(c.type ?? "") || /\.svg(?:$|[?#])/i.test(c.url);
const relOf = (c: IconCandidate) => c.rel.toLowerCase().split(/\s+/);

/** The size a candidate says it is: its `sizes`, else a size in its file name ("android-chrome-192x192.png"); an SVG
 * counts as large. Null when it says nothing. */
export function statedSize(c: IconCandidate): number | null {
  const declared = parseSizes(c.sizes);
  if (declared) return declared;
  if (isSvg(c)) return 512;
  const m = /(\d{2,4})x(\d{2,4})/i.exec(c.url.split(/[?#]/)[0]);
  return m ? Math.min(Number(m[1]), Number(m[2])) : null;
}

/** The size a candidate is likely to be: what it says, else 180 for a touch icon (Apple's size) and 32 for the rest. */
export function likelySize(c: IconCandidate): number {
  return statedSize(c) ?? (relOf(c).some((r) => r.startsWith("apple-touch-icon")) ? 180 : 32);
}

/**
 * Candidates best first: touch icons (made by the college as a tile, usually 180 px), largest first; then declared
 * icons of a stated size of 64 px or more, largest first (an SVG counts as large); then the conventional
 * /apple-touch-icon.png (the probe's `rel: "fallback"`); then declared icons of unknown size, and /favicon.ico; last,
 * declared icons that say they're under 64 px.
 * Safari's monochrome `mask-icon` is never a mark; data: URIs and malformed URLs are skipped; duplicate URLs are dropped.
 */
export function rankIconCandidates(icons: readonly IconCandidate[]): IconCandidate[] {
  const tier = (c: IconCandidate) => {
    const rel = relOf(c);
    if (rel.includes("mask-icon")) return -1;
    const declared = !isConventional(c);
    if (rel.some((r) => r.startsWith("apple-touch-icon")) && declared) return 0;
    if (rel.includes("icon") && declared) {
      // A declared icon of unknown size is usually a 16-48 px tab icon: the conventional touch icon goes before it,
      // and one that says it's under the floor goes last (it would only be rejected).
      const stated = statedSize(c);
      if (stated === null) return 3;
      return stated >= MIN_ICON ? 1 : 4;
    }
    if (pathOf(c.url).toLowerCase().startsWith("/apple-touch-icon")) return 2;
    return 3;
  };
  const seen = new Set<string>();
  return icons
    .map((c, k) => ({ c, k, t: tier(c), s: likelySize(c) }))
    // Only fetchable files: a data: URI has no URL to cite, and a malformed one would look like a network failure.
    .filter((x) => x.t >= 0 && /^https?:\/\/[^/\s]+/i.test(x.c.url))
    .sort((a, b) => a.t - b.t || b.s - a.s || a.k - b.k)
    .map((x) => x.c)
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};
/**
 * The conventional fallbacks: what the probe marks `rel: "fallback"` (/apple-touch-icon.png and /favicon.ico, which may
 * not exist), or the same paths declared with nothing said about them.
 */
const isConventional = (c: IconCandidate) =>
  c.rel.toLowerCase() === "fallback" || (c.sizes === null && c.type === null && /^\/(?:apple-touch-icon(?:-precomposed)?\.png|favicon\.ico)$/i.test(pathOf(c.url)));

/** How the homepage declared an icon, for the lineage quote. */
export function describeCandidate(c: IconCandidate, homepage: string | null): string {
  if (isConventional(c)) return `${pathOf(c.url)} at the site's root (${new URL(c.url).origin})`;
  const attrs = [`rel="${c.rel}"`, c.sizes ? `sizes="${c.sizes}"` : null, c.type ? `type="${c.type}"` : null].filter(Boolean).join(" ");
  return `<link ${attrs}>${homepage ? ` on ${homepage}` : ""}`;
}

/* ------------------------------------------------------------------ */
/* ICO                                                                  */
/* ------------------------------------------------------------------ */

export interface IcoEntry {
  width: number;
  height: number;
  bpp: number;
  format: "png" | "bmp";
  data: Uint8Array;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const startsWith = (b: Uint8Array, magic: number[]) => magic.every((v, k) => b[k] === v);

export function isIco(b: Uint8Array): boolean {
  return b.length >= 6 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && b[4] + (b[5] << 8) > 0;
}

/** The directory of an ICO file: every entry's size, bit depth, and bytes (PNG or BMP). */
export function parseIco(b: Uint8Array): IcoEntry[] {
  if (!isIco(b)) throw new Error("not an ICO file");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = view.getUint16(4, true);
  const out: IcoEntry[] = [];
  for (let k = 0; k < count; k++) {
    const at = 6 + 16 * k;
    if (at + 16 > b.length) break;
    const size = view.getUint32(at + 8, true);
    const offset = view.getUint32(at + 12, true);
    if (offset + size > b.length || size < 8) continue;
    const data = b.subarray(offset, offset + size);
    const png = startsWith(data, PNG_MAGIC);
    let width = b[at] || 256;
    let height = b[at + 1] || 256;
    let bpp = view.getUint16(at + 6, true);
    if (png && data.length >= 24) {
      // The PNG's own header is the truth when the directory says 0 or lies.
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(16);
      height = dv.getUint32(20);
    } else if (!png && data.length >= 40) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = Math.abs(dv.getInt32(4, true));
      height = Math.abs(dv.getInt32(8, true)) / 2; // XOR bitmap + AND mask
      bpp = dv.getUint16(14, true) || bpp;
    }
    out.push({ width, height, bpp, format: png ? "png" : "bmp", data });
  }
  return out;
}

/**
 * A 32-bit BMP icon entry (BITMAPINFOHEADER, bottom-up BGRA rows, then the 1-bit AND mask) → top-down RGBA. When every
 * alpha byte is 0 (old icons that rely on the mask), the AND mask gives transparency. Other depths return null.
 */
export function bmpToRgba(data: Uint8Array): { width: number; height: number; rgba: Buffer } | null {
  if (data.length < 40) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const header = dv.getUint32(0, true);
  const width = Math.abs(dv.getInt32(4, true));
  const rawHeight = dv.getInt32(8, true);
  const height = Math.abs(rawHeight) / 2;
  const bpp = dv.getUint16(14, true);
  const compression = dv.getUint32(16, true);
  // BI_RGB only: icons don't use BI_BITFIELDS in practice, and guessing its mask layout isn't worth a wrong color.
  if (bpp !== 32 || compression !== 0 || !width || !height || !Number.isInteger(height)) return null;
  const rowBytes = width * 4;
  const pixels = header;
  const maskRow = Math.ceil(width / 32) * 4;
  if (pixels + rowBytes * height > data.length) return null;
  const topDown = rawHeight < 0;
  const rgba = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const src = pixels + (topDown ? y : height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const s = src + x * 4;
      const d = (y * width + x) * 4;
      rgba[d] = data[s + 2];
      rgba[d + 1] = data[s + 1];
      rgba[d + 2] = data[s];
      rgba[d + 3] = data[s + 3];
      if (data[s + 3]) anyAlpha = true;
    }
  }
  if (!anyAlpha) {
    const maskStart = pixels + rowBytes * height;
    const hasMask = maskStart + maskRow * height <= data.length;
    for (let y = 0; y < height; y++) {
      const row = maskStart + (topDown ? y : height - 1 - y) * maskRow;
      for (let x = 0; x < width; x++) {
        const transparent = hasMask && (data[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        rgba[(y * width + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  }
  return { width, height, rgba };
}

/* ------------------------------------------------------------------ */
/* Decoding and checks                                                 */
/* ------------------------------------------------------------------ */

export type IconRejection =
  | "not an image"
  | "undecodable"
  | "too small"
  | "not square"
  | "fully transparent"
  /** Nothing would show on the white tile (a white glyph on transparency, or a blank square). */
  | "blank on white";

export type IconResult = { ok: true; webp: Buffer; source: { width: number; height: number; format: string } } | { ok: false; reason: IconRejection; detail?: string };

const textHead = (b: Uint8Array) => new TextDecoder().decode(b.subarray(0, 512)).trimStart().toLowerCase();
const looksSvg = (b: Uint8Array) => {
  const h = textHead(b);
  return h.startsWith("<svg") || ((h.startsWith("<?xml") || h.startsWith("<!--") || h.startsWith("<!doctype svg")) && h.includes("<svg"));
};

/** A sharp pipeline for the image's best raster, or a rejection. */
async function rasterOf(bytes: Uint8Array): Promise<{ img: Sharp; width: number; height: number; format: string } | { reason: IconRejection; detail?: string }> {
  if (isIco(bytes)) {
    const entries = parseIco(bytes).sort((a, b) => b.width * b.height - a.width * a.height || b.bpp - a.bpp);
    if (!entries.length) return { reason: "undecodable", detail: "empty ICO" };
    for (const e of entries) {
      if (e.format === "png") {
        try {
          const meta = await sharp(e.data).metadata();
          if (meta.width && meta.height) return { img: sharp(e.data), width: meta.width, height: meta.height, format: "ico/png" };
        } catch {
          continue;
        }
      } else {
        const raw = bmpToRgba(e.data);
        if (raw) return { img: sharp(raw.rgba, { raw: { width: raw.width, height: raw.height, channels: 4 } }), width: raw.width, height: raw.height, format: "ico/bmp32" };
      }
    }
    return { reason: "undecodable", detail: `ICO entries: ${entries.map((e) => `${e.width}px ${e.format}${e.format === "bmp" ? ` ${e.bpp}-bit` : ""}`).join(", ")}` };
  }
  if (looksSvg(bytes)) {
    try {
      const meta = await sharp(Buffer.from(bytes)).metadata();
      const short = Math.min(meta.width ?? 0, meta.height ?? 0) || 16;
      // Vector: rasterize so the short side reaches the stored size (72 dpi is 1 px per SVG unit).
      const density = Math.min(2400, Math.max(72, Math.ceil((72 * LOGO_SIZE * 1.1) / short)));
      const img = sharp(Buffer.from(bytes), { density });
      const m2 = await img.clone().metadata();
      return { img, width: m2.width ?? LOGO_SIZE, height: m2.height ?? LOGO_SIZE, format: "svg" };
    } catch (err) {
      return { reason: "undecodable", detail: `SVG: ${err instanceof Error ? err.message : err}` };
    }
  }
  try {
    const img = sharp(Buffer.from(bytes), { animated: false });
    const meta = await img.metadata();
    if (!meta.width || !meta.height || !meta.format || !["png", "jpeg", "webp", "gif", "tiff", "heif"].includes(meta.format)) return { reason: "not an image" };
    return { img, width: meta.width, height: meta.height, format: meta.format };
  } catch {
    return { reason: "not an image" };
  }
}

/**
 * Bytes as downloaded → the stored WebP, or why not: under 64 px on the short side, more than 10% from square, fully
 * transparent, or not an image at all.
 */
export async function processIcon(bytes: Uint8Array): Promise<IconResult> {
  const r = await rasterOf(bytes);
  if ("reason" in r) return { ok: false, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) };
  const { width, height, format } = r;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (format !== "svg" && short < MIN_ICON) return { ok: false, reason: "too small", detail: `${width}×${height}` };
  if (long > short * (1 + SQUARE_TOLERANCE)) return { ok: false, reason: "not square", detail: `${width}×${height}` };
  let img = r.img.ensureAlpha();
  if (width !== height) img = img.extract({ left: Math.floor((width - short) / 2), top: Math.floor((height - short) / 2), width: short, height: short });
  // sharp's stats() reads its input, not the pipeline, so each check measures a rendered buffer.
  const square = await img.png().toBuffer();
  const rgba = await sharp(square).stats();
  if (rgba.channels[3].max === 0) return { ok: false, reason: "fully transparent" };
  // The tile behind a mark is white: a white glyph on transparency (a dark-tab favicon) or a blank square would vanish.
  const onWhite = await sharp(await sharp(square).flatten({ background: "#ffffff" }).png().toBuffer()).stats();
  if (onWhite.channels.slice(0, 3).every((c) => c.min >= 247)) return { ok: false, reason: "blank on white" };
  const webp = await sharp(square).resize(LOGO_SIZE, LOGO_SIZE, { fit: "fill", kernel: "lanczos3" }).webp({ quality: WEBP_QUALITY, alphaQuality: 100 }).toBuffer();
  return { ok: true, webp, source: { width, height, format } };
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

export interface IconDeps {
  fetch: FetchFn;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
  /** Colleges fetched at once (each host still gets one request a second). */
  concurrency?: number;
}

export type IconOutcome =
  | { unit_id: string; status: "stored"; entry: BrandLogoEntry; bytes: number }
  | { unit_id: string; status: "removed"; reason: string }
  | { unit_id: string; status: "none"; reasons: string[]; transient: boolean };

/** One college: candidates best first, at most MAX_TRIES downloads, the first acceptable icon wins. */
export async function iconForCollege(
  probe: SiteProbeEntry,
  http: Pick<PoliteHttp, "get">,
  today: string,
  /** Whether a host failed to answer this run (PoliteHttp returns null both for that and for a robots.txt refusal). */
  unreachable: (url: string) => boolean = () => false,
): Promise<{ entry: Omit<BrandLogoEntry, "unit_id">; webp: Buffer } | { reasons: string[]; transient: boolean }> {
  const reasons: string[] = [];
  let transient = false;
  const homepage = probe.homepage?.final_url ?? probe.homepage?.url ?? null;
  for (const c of rankIconCandidates(probe.icons ?? []).slice(0, MAX_TRIES)) {
    let res: Response | null;
    try {
      res = await http.get(c.url);
    } catch (err) {
      transient = true;
      reasons.push(`${c.url}: ${err instanceof Error ? err.message.split(";")[0] : "network error"}`);
      continue;
    }
    if (!res) {
      // A host that didn't answer is a passing failure; a robots.txt refusal is an answer.
      if (unreachable(c.url)) transient = true;
      reasons.push(`${c.url}: ${unreachable(c.url) ? "no answer" : "robots.txt disallows it"}`);
      continue;
    }
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) transient = true;
      reasons.push(`${c.url}: HTTP ${res.status}`);
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_ICON_BYTES) {
      reasons.push(`${c.url}: ${bytes.length} bytes`);
      continue;
    }
    const out = await processIcon(bytes);
    if (!out.ok) {
      reasons.push(`${c.url}: ${out.reason}${out.detail ? ` (${out.detail})` : ""}`);
      continue;
    }
    return {
      entry: { source_url: res.url || c.url, retrieved: today, width: LOGO_SIZE, tag: describeCandidate(c, homepage) },
      webp: out.webp,
    };
  }
  if (!(probe.icons ?? []).length) reasons.push("the probe found no icon");
  return { reasons, transient };
}

const webpPath = (dir: string, id: string) => join(dir, `${id}.webp`);

/**
 * Icons for every college the probe visited (or `ids`): writes public/brand/{unit_id}.webp and returns the new
 * data/brand-logos.json rows. A college with no acceptable icon this run loses its old mark only when nothing failed
 * for a passing reason (a timeout or a server error keeps yesterday's file). `logo: false` overrides are never
 * fetched and their files are deleted. Without `ids`, files with no row are deleted too.
 */
export async function syncIcons(opts: {
  probe: readonly SiteProbeEntry[];
  previous: readonly BrandLogoEntry[];
  overrides: Record<string, BrandOverride>;
  brandDir: string;
  deps: IconDeps;
  ids?: ReadonlySet<string>;
  today?: string;
}): Promise<{ entries: BrandLogoEntry[]; outcomes: IconOutcome[]; requests: number }> {
  const { deps, brandDir } = opts;
  const today = opts.today ?? new Date(deps.now()).toISOString().slice(0, 10);
  mkdirSync(brandDir, { recursive: true });
  let requests = 0;
  const counting: FetchFn = (input, init) => {
    requests++;
    return deps.fetch(input, init);
  };
  // PoliteHttp says which hosts didn't answer (or answered robots.txt with a server error) in its log; keep them.
  const down = new Set<string>();
  const log = (m: string) => {
    const host = /^\s*(\S+) (?:didn't respond|returned a server error)/.exec(m)?.[1];
    if (host) down.add(host);
  };
  const unreachable = (url: string) => {
    try {
      return down.has(new URL(url).host);
    } catch {
      return false;
    }
  };
  const http = new PoliteHttp({ fetch: counting, now: deps.now, sleep: deps.sleep, minDelayMs: 1000, log, timeoutMs: 30_000, maxBytes: MAX_ICON_BYTES });
  const removed = (id: string) => opts.overrides[id]?.logo === false;
  const rows = new Map(opts.previous.map((e) => [e.unit_id, e]));
  const outcomes: IconOutcome[] = [];

  // Removals first: a removal request is honored even when the run stops early.
  for (const id of Object.keys(opts.overrides)) {
    if (id.startsWith("_") || !removed(id)) continue;
    if (existsSync(webpPath(brandDir, id))) unlinkSync(webpPath(brandDir, id));
    if (rows.delete(id)) outcomes.push({ unit_id: id, status: "removed", reason: "logo: false in data/brand-overrides.json" });
  }

  const queue = opts.probe.filter((p) => (!opts.ids || opts.ids.has(p.unit_id)) && !removed(p.unit_id));
  let done = 0;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const got = await iconForCollege(p, http, today, unreachable);
      if ("webp" in got) {
        writeFileSync(webpPath(brandDir, p.unit_id), got.webp);
        const entry: BrandLogoEntry = { unit_id: p.unit_id, ...got.entry };
        rows.set(p.unit_id, entry);
        outcomes.push({ unit_id: p.unit_id, status: "stored", entry, bytes: got.webp.length });
      } else {
        if (!got.transient && rows.has(p.unit_id)) {
          rows.delete(p.unit_id);
          if (existsSync(webpPath(brandDir, p.unit_id))) unlinkSync(webpPath(brandDir, p.unit_id));
        }
        outcomes.push({ unit_id: p.unit_id, status: "none", reasons: got.reasons, transient: got.transient });
      }
      if (++done % 50 === 0) deps.log(`  icons: ${done} colleges done`);
    }
  };
  // Colleges in flight at once; PoliteHttp still spaces requests to any one host a second apart (icons on a shared
  // CDN wait their turn).
  await Promise.all(Array.from({ length: Math.max(1, opts.deps.concurrency ?? 12) }, worker));

  // A full run leaves no file without a row.
  if (!opts.ids) {
    for (const f of readdirSync(brandDir)) {
      const id = f.replace(/\.webp$/, "");
      if (f.endsWith(".webp") && !rows.has(id)) unlinkSync(join(brandDir, f));
    }
  }
  const entries = [...rows.values()].sort((a, b) => a.unit_id.localeCompare(b.unit_id));
  return { entries, outcomes, requests };
}

const readJson = <T,>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);

/** One row per line, so a refresh's diff shows which colleges changed. */
const formatRows = (rows: readonly object[]) => (rows.length ? `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n` : "[]\n");

/**
 * The icon step on disk: reads data/site-probe.json, data/brand-logos.json, and data/brand-overrides.json, writes
 * public/brand/*.webp and data/brand-logos.json. The site probe may call this after writing its file;
 * `npm run sync-brand -- --icons` runs it alone.
 */
export async function syncBrandIcons(
  root: string,
  opts: { ids?: ReadonlySet<string>; deps?: Partial<IconDeps>; probePath?: string } = {},
): Promise<Awaited<ReturnType<typeof syncIcons>>> {
  const probePath = opts.probePath ?? join(root, "data", "site-probe.json");
  if (!existsSync(probePath)) throw new Error(`${probePath} is missing: run the site probe first (\`npm run probe-sites\`; it lists each college's icons)`);
  const logosPath = join(root, "data", "brand-logos.json");
  const run = await syncIcons({
    probe: JSON.parse(readFileSync(probePath, "utf8")) as SiteProbeEntry[],
    previous: readJson<BrandLogoEntry[]>(logosPath, []),
    overrides: readJson<Record<string, BrandOverride>>(join(root, "data", "brand-overrides.json"), {}),
    brandDir: join(root, "public", "brand"),
    ids: opts.ids,
    deps: {
      fetch: globalThis.fetch,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (m) => console.log(m),
      ...opts.deps,
    },
  });
  writeFileSync(logosPath, formatRows(run.entries));
  return run;
}
