/**
 * Marks (specs/school-identity/brand.md, Checks; scripts/lib/brand-icons.mts): which of the probe's icon candidates
 * comes first, what is decoded and how (ICO parsed here, its PNG and 32-bit BMP entries), what is rejected (under
 * 64 px, more than 10% from square, fully transparent, blank on the white tile), and what a run does with removals,
 * passing failures, and orphan files. Fixtures are made here with sharp. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { BrandLogoEntry, SiteProbeEntry } from "../lib/identity-files";
import { bmpToRgba, parseIco, processIcon, rankIconCandidates, syncIcons, type IconCandidate } from "../scripts/lib/brand-icons.mts";

const png = (width: number, height: number, background: string | { r: number; g: number; b: number; alpha: number } = "#BA0C2F") =>
  sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();

/** A 32-bit BMP icon entry: BITMAPINFOHEADER, bottom-up BGRA rows, then the 1-bit AND mask. */
function bmpEntry(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number], mask?: (x: number, y: number) => boolean): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(width * height * 4, 20);
  const pixels = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row; // bottom-up
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      pixels.set([b, g, r, a], (row * width + x) * 4);
    }
  }
  const maskRow = Math.ceil(width / 32) * 4;
  const andMask = Buffer.alloc(maskRow * height);
  if (mask) {
    for (let row = 0; row < height; row++) {
      const y = height - 1 - row;
      for (let x = 0; x < width; x++) if (mask(x, y)) andMask[row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, andMask]);
}

/** An ICO file from entries (the directory's 0 means 256). */
function ico(entries: { width: number; height: number; bpp: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach((e, k) => {
    const at = 6 + 16 * k;
    head[at] = e.width >= 256 ? 0 : e.width;
    head[at + 1] = e.height >= 256 ? 0 : e.height;
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(e.bpp, at + 6);
    head.writeUInt32LE(e.data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += e.data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

async function webpSize(webp: Buffer) {
  const m = await sharp(webp).metadata();
  return { format: m.format, width: m.width, height: m.height };
}

/* ---------------- Ranking ---------------- */

const c = (url: string, rel: string, sizes: string | null = null, type: string | null = null): IconCandidate => ({ url, rel, sizes, type });

test("candidates: the largest touch icon first, then declared icons by size, then the conventional fallbacks", () => {
  const ranked = rankIconCandidates([
    c("https://u.edu/favicon.ico", "icon"),
    c("https://u.edu/img/icon-32.png", "icon", "32x32", "image/png"),
    c("https://u.edu/img/touch-120.png", "apple-touch-icon", "120x120"),
    c("https://u.edu/img/safari-pinned.svg", "mask-icon"),
    c("https://u.edu/img/touch-180.png", "apple-touch-icon", "180x180"),
    c("https://u.edu/apple-touch-icon.png", "apple-touch-icon"),
    c("https://u.edu/img/android-chrome-192x192.png", "icon"),
    c("https://u.edu/img/touch-180.png", "apple-touch-icon", "180x180"),
  ]);
  assert.deepEqual(
    ranked.map((r) => r.url.replace("https://u.edu", "")),
    ["/img/touch-180.png", "/img/touch-120.png", "/img/android-chrome-192x192.png", "/img/icon-32.png", "/apple-touch-icon.png", "/favicon.ico"],
  );
});

/* ---------------- Decoding and checks ---------------- */

test("a 32 px icon is rejected as too small; a 180 px PNG is stored as a 192 px WebP", async () => {
  const small = await processIcon(await png(32, 32));
  assert.deepEqual(small.ok ? null : small.reason, "too small");
  const ok = await processIcon(await png(180, 180));
  assert.ok(ok.ok);
  assert.deepEqual(await webpSize(ok.webp), { format: "webp", width: 192, height: 192 });
  assert.equal(ok.source.width, 180);
});

test("an image within 10% of square is center-cropped; a wide one is rejected", async () => {
  const near = await processIcon(await png(200, 190));
  assert.ok(near.ok, "200×190 is 5% off square");
  assert.deepEqual(await webpSize(near.webp), { format: "webp", width: 192, height: 192 });
  const wide = await processIcon(await png(300, 100));
  assert.deepEqual(wide.ok ? null : wide.reason, "not square");
  const justOver = await processIcon(await png(229, 256)); // Penn's shield, measured 2026-10-04
  assert.deepEqual(justOver.ok ? null : justOver.reason, "not square");
});

test("an ICO with several sizes gives its largest entry", async () => {
  const file = ico([
    { width: 16, height: 16, bpp: 32, data: bmpEntry(16, 16, () => [0, 0, 255, 255]) },
    { width: 32, height: 32, bpp: 32, data: await png(32, 32) },
    { width: 128, height: 128, bpp: 32, data: await png(128, 128, "#002B5C") },
    { width: 48, height: 48, bpp: 32, data: bmpEntry(48, 48, () => [0, 255, 0, 255]) },
  ]);
  const entries = parseIco(file);
  assert.deepEqual(entries.map((e) => [e.width, e.format]), [[16, "bmp"], [32, "png"], [128, "png"], [48, "bmp"]]);
  const r = await processIcon(file);
  assert.ok(r.ok);
  assert.deepEqual(r.source, { width: 128, height: 128, format: "ico/png" });
  const { data } = await sharp(r.webp).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[2] > 60 && data[0] < 30, "the 128 px navy entry, not the green 48 px one");
});

test("32-bit BMP entries become RGBA top-down (alpha from the mask when the alpha bytes are all zero); other depths are skipped", async () => {
  // Top half red, bottom half blue: rows must come out top-down.
  const entry = bmpEntry(64, 64, (_x, y) => (y < 32 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  const raw = bmpToRgba(entry)!;
  assert.equal(raw.width, 64);
  assert.equal(raw.height, 64);
  assert.deepEqual([...raw.rgba.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...raw.rgba.subarray(raw.rgba.length - 4)], [0, 0, 255, 255]);
  const r = await processIcon(ico([{ width: 64, height: 64, bpp: 32, data: entry }]));
  assert.ok(r.ok);
  assert.equal(r.source.format, "ico/bmp32");
  // Old icons: alpha bytes all 0, transparency in the AND mask (left half transparent).
  const masked = bmpToRgba(bmpEntry(64, 64, () => [10, 20, 30, 0], (x) => x < 32))!;
  assert.equal(masked.rgba[3], 0);
  assert.equal(masked.rgba[63 * 4 + 3], 255);
  // A 24-bit entry isn't decoded.
  const bmp24 = bmpEntry(64, 64, () => [1, 2, 3, 255]);
  bmp24.writeUInt16LE(24, 14);
  assert.equal(bmpToRgba(bmp24), null);
  const only24 = await processIcon(ico([{ width: 64, height: 64, bpp: 24, data: bmp24 }]));
  assert.deepEqual(only24.ok ? null : only24.reason, "undecodable");
});

test("fully transparent and blank-on-white icons are rejected; SVG is rasterized; HTML is not an image", async () => {
  const clear = await processIcon(await png(180, 180, { r: 0, g: 0, b: 0, alpha: 0 }));
  assert.deepEqual(clear.ok ? null : clear.reason, "fully transparent");
  const whiteGlyph = await sharp({ create: { width: 180, height: 180, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await png(90, 90, "#FFFFFF"), left: 45, top: 45 }])
    .png()
    .toBuffer();
  const blank = await processIcon(whiteGlyph);
  assert.deepEqual(blank.ok ? null : blank.reason, "blank on white");
  const svg = await processIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="6" fill="#8C1515"/></svg>'));
  assert.ok(svg.ok, "a 32-unit SVG is vector: rasterized large, not too small");
  assert.deepEqual(await webpSize(svg.webp), { format: "webp", width: 192, height: 192 });
  const wordmark = await processIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="#000"/></svg>'));
  assert.deepEqual(wordmark.ok ? null : wordmark.reason, "not square");
  const html = await processIcon(Buffer.from("<!doctype html><html><body>Not found</body></html>"));
  assert.deepEqual(html.ok ? null : html.reason, "not an image");
});

/* ---------------- A run ---------------- */

function probeFor(id: string, host: string): SiteProbeEntry {
  return {
    unit_id: id,
    retrieved: "2026-10-04",
    homepage: { url: `https://${host}/`, final_url: `https://${host}/`, status: 200 },
    admissions: null,
    visit: null,
    virtual_tour: null,
    social: {},
    icons: [c(`https://${host}/touch.png`, "apple-touch-icon", "180x180"), c(`https://${host}/favicon.ico`, "icon")],
  };
}

test("a run stores icons, honors logo: false, keeps a mark through a passing failure, and drops orphans", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brand-"));
  const good = await png(180, 180);
  const fetched: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    if (url.startsWith("https://ok.edu/")) return new Response(good, { status: 200, headers: { "content-type": "image/png" } });
    if (url.startsWith("https://down.edu/")) throw new Error("connect ETIMEDOUT");
    return new Response("gone", { status: 404 });
  }) as typeof globalThis.fetch;
  let clock = 0;
  const deps = { fetch, now: () => clock, sleep: async (ms: number) => void (clock += ms), log: () => {}, concurrency: 2 };
  // Before the run: a removed college's file, a mark for the host that's down, one for the host that's gone, an orphan.
  for (const id of ["100001", "100002", "100003", "999999"]) writeFileSync(join(dir, `${id}.webp`), "old");
  const prev = (id: string): BrandLogoEntry => ({ unit_id: id, source_url: `https://x/${id}`, retrieved: "2026-09-01", width: 192 });
  const run = await syncIcons({
    probe: [probeFor("100000", "ok.edu"), probeFor("100001", "ok.edu"), probeFor("100002", "down.edu"), probeFor("100003", "gone.edu")],
    previous: [prev("100001"), prev("100002"), prev("100003")],
    overrides: { _readme: { logo: false }, "100001": { logo: false } } as Record<string, { logo: false }>,
    brandDir: dir,
    deps,
    today: "2026-10-04",
  });
  const ids = run.entries.map((e) => e.unit_id);
  assert.deepEqual(ids, ["100000", "100002"]);
  assert.equal(run.entries[0].source_url, "https://ok.edu/touch.png");
  assert.match(run.entries[0].tag ?? "", /^<link rel="apple-touch-icon" sizes="180x180"> on https:\/\/ok\.edu\/$/);
  assert.ok(existsSync(join(dir, "100000.webp")));
  assert.equal(existsSync(join(dir, "100001.webp")), false, "logo: false leaves no file");
  assert.ok(!fetched.some((u) => u.includes("100001")) && run.outcomes.some((o) => o.unit_id === "100001" && o.status === "removed"));
  assert.equal(readFileSync(join(dir, "100002.webp"), "utf8"), "old", "a timeout keeps yesterday's mark");
  assert.equal(existsSync(join(dir, "100003.webp")), false, "404s everywhere: the mark goes");
  assert.equal(existsSync(join(dir, "999999.webp")), false, "a full run leaves no orphan file");
  assert.equal(fetched.filter((u) => u.endsWith("/robots.txt")).length, 3, "robots.txt once per host");
});

test("a removal is honored on a partial run too, and the other colleges' marks are left alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brand-"));
  for (const id of ["100001", "100005"]) writeFileSync(join(dir, `${id}.webp`), "old");
  const fetch = (async () => new Response("", { status: 404 })) as unknown as typeof globalThis.fetch;
  const run = await syncIcons({
    probe: [probeFor("100005", "x.edu")],
    previous: [
      { unit_id: "100001", source_url: "https://x/1", retrieved: "2026-09-01", width: 192 },
      { unit_id: "100005", source_url: "https://x/5", retrieved: "2026-09-01", width: 192 },
    ],
    overrides: { "100001": { logo: false } },
    brandDir: dir,
    deps: { fetch, now: () => 0, sleep: async () => {}, log: () => {} },
    ids: new Set(["100009"]),
  });
  assert.equal(existsSync(join(dir, "100001.webp")), false);
  assert.deepEqual(run.entries.map((e) => e.unit_id), ["100005"]);
  assert.ok(existsSync(join(dir, "100005.webp")), "outside --ids: untouched");
});
