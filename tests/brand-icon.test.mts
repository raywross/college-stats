/**
 * Marks (specs/school-identity/brand.md, Checks; scripts/lib/brand-icons.mts): which of the probe's icon candidates
 * comes first, what is decoded and how (ICO parsed here: its PNG entries, and its 32-, 24-, 8-, 4-, and 1-bit BMP
 * entries), what is rejected (under 64 px, more than 10% from square, fully transparent, blank on the white tile),
 * and what a run does with removals, passing failures, and orphan files. Fixtures are made here with sharp. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { BrandLogoEntry, SiteProbeEntry } from "../lib/identity-files";
import { bmpToRgba, describeCandidate, parseIco, processIcon, rankIconCandidates, syncIcons, type IconCandidate } from "../scripts/lib/brand-icons.mts";

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

/** The 1-bit AND mask block for a BMP icon entry: bottom-up, each row padded to 4 bytes. */
function andMaskBuf(width: number, height: number, mask?: (x: number, y: number) => boolean): Buffer {
  const maskRow = Math.ceil(width / 32) * 4;
  const buf = Buffer.alloc(maskRow * height);
  if (mask) {
    for (let row = 0; row < height; row++) {
      const y = height - 1 - row; // bottom-up
      for (let x = 0; x < width; x++) if (mask(x, y)) buf[row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return buf;
}

/** A 24-bit BMP icon entry: BITMAPINFOHEADER, bottom-up BGR rows (no alpha channel), then the 1-bit AND mask. */
function bmp24Entry(width: number, height: number, pixel: (x: number, y: number) => [number, number, number], mask?: (x: number, y: number) => boolean): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(24, 14);
  header.writeUInt32LE(0, 16); // BI_RGB
  const rowBytes = Math.ceil((width * 24) / 32) * 4;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row; // bottom-up
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      pixels.set([b, g, r], row * rowBytes + x * 3);
    }
  }
  return Buffer.concat([header, pixels, andMaskBuf(width, height, mask)]);
}

/**
 * A 1-, 4-, or 8-bit palette BMP icon entry: BITMAPINFOHEADER, a BGRx palette (RGBQUAD, 4 bytes a color, the 4th
 * unused), bottom-up rows of packed palette indexes (8, 2, or 1 pixels a byte), then the 1-bit AND mask.
 */
function paletteBmpEntry(
  width: number,
  height: number,
  bpp: 1 | 4 | 8,
  colors: [number, number, number][],
  index: (x: number, y: number) => number,
  mask?: (x: number, y: number) => boolean,
): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(bpp, 14);
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(colors.length, 32); // biClrUsed
  const palette = Buffer.alloc(colors.length * 4);
  colors.forEach(([r, g, b], i) => palette.set([b, g, r, 0], i * 4));
  const rowBytes = Math.ceil((width * bpp) / 32) * 4;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row; // bottom-up
    for (let x = 0; x < width; x++) {
      const i = index(x, y);
      if (bpp === 8) pixels[row * rowBytes + x] = i;
      else if (bpp === 4) pixels[row * rowBytes + (x >> 1)] |= (i & 0x0f) << (x % 2 ? 0 : 4);
      else if (i & 1) pixels[row * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, palette, pixels, andMaskBuf(width, height, mask)]);
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

test("candidates: the largest touch icon first, then declared icons by size, then the conventional fallbacks, then tab-sized icons", () => {
  const ranked = rankIconCandidates([
    c("https://u.edu/favicon.ico", "icon"),
    c("https://u.edu/img/icon-32.png", "icon", "32x32", "image/png"),
    c("https://u.edu/img/touch-120.png", "apple-touch-icon", "120x120"),
    c("https://u.edu/img/safari-pinned.svg", "mask-icon"),
    c("https://u.edu/img/touch-180.png", "apple-touch-icon", "180x180"),
    c("https://u.edu/apple-touch-icon.png", "apple-touch-icon"),
    c("https://u.edu/img/android-chrome-192x192.png", "icon"),
    c("https://u.edu/img/touch-180.png", "apple-touch-icon", "180x180"),
    c("data:image/svg+xml,%3Csvg%3E%3C/svg%3E", "icon", "any", "image/svg+xml"),
    c("/img/relative.png", "apple-touch-icon", "512x512"),
  ]);
  assert.deepEqual(
    ranked.map((r) => r.url.replace("https://u.edu", "")),
    ["/img/touch-180.png", "/img/touch-120.png", "/img/android-chrome-192x192.png", "/apple-touch-icon.png", "/favicon.ico", "/img/icon-32.png"],
  );
});

test("candidates as the site probe writes them: fallbacks after declared icons of a known size", () => {
  // UGA's entry in data/site-probe.json (2026-10-04): a declared /favicon.ico of unknown size, then the probe's fallback.
  const uga = rankIconCandidates([c("https://www.uga.edu/favicon.ico", "icon"), c("https://www.uga.edu/apple-touch-icon.png", "fallback")]);
  assert.deepEqual(uga.map((r) => r.url), ["https://www.uga.edu/apple-touch-icon.png", "https://www.uga.edu/favicon.ico"]);
  const stanford = rankIconCandidates([
    c("https://www.stanford.edu/favicon.ico?x", "icon", "48x48", "image/x-icon"),
    c("https://www.stanford.edu/icon1.png", "icon", "192x192", "image/png"),
    c("https://www.stanford.edu/apple-touch-icon.png", "fallback"),
    c("https://www.stanford.edu/favicon.ico", "fallback"),
  ]);
  assert.deepEqual(stanford.map((r) => new URL(r.url).pathname), ["/icon1.png", "/apple-touch-icon.png", "/favicon.ico", "/favicon.ico"]);
  assert.equal(describeCandidate(c("https://www.uga.edu/apple-touch-icon.png", "fallback"), "https://www.uga.edu/"), "/apple-touch-icon.png at the site's root (https://www.uga.edu)");
  assert.equal(describeCandidate(stanford[0], "https://www.stanford.edu/"), '<link rel="icon" sizes="192x192" type="image/png"> on https://www.stanford.edu/');
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

test("32-bit BMP entries become RGBA top-down (alpha from the mask when the alpha bytes are all zero)", async () => {
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
});

test("16-bit and compressed BMP entries stay skipped", async () => {
  // A 16-bit entry (bytes per pixel aside, the depth alone is enough to reject it).
  const bmp16 = bmpEntry(64, 64, () => [1, 2, 3, 255]);
  bmp16.writeUInt16LE(16, 14);
  assert.equal(bmpToRgba(bmp16), null);
  // A 32-bit entry declaring BI_BITFIELDS (3) instead of BI_RGB (0).
  const compressed = bmpEntry(64, 64, () => [1, 2, 3, 255]);
  compressed.writeUInt32LE(3, 16);
  assert.equal(bmpToRgba(compressed), null);
  const r = await processIcon(ico([{ width: 64, height: 64, bpp: 16, data: bmp16 }]));
  assert.deepEqual(r.ok ? null : r.reason, "undecodable");
});

test("a 24-bit BMP entry becomes RGBA with no alpha channel of its own: transparency always comes from the AND mask", async () => {
  // Navy everywhere, except an 8 px corner the AND mask marks transparent.
  const entry = bmp24Entry(64, 64, () => [0, 43, 92], (x, y) => x < 8 && y < 8);
  const raw = bmpToRgba(entry)!;
  const at = (x: number, y: number) => [...raw.rgba.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
  assert.equal(raw.width, 64);
  assert.equal(raw.height, 64);
  assert.deepEqual(at(0, 0), [0, 43, 92, 0], "the masked corner: navy's color, but transparent");
  assert.deepEqual(at(30, 30), [0, 43, 92, 255], "elsewhere: opaque");
  const r = await processIcon(ico([{ width: 64, height: 64, bpp: 24, data: entry }]));
  assert.ok(r.ok);
  assert.equal(r.source.format, "ico/bmp24");
});

test("an 8-bit palette BMP entry reads its colors from the BGRx palette; transparency from the AND mask", async () => {
  const colors: [number, number, number][] = [
    [255, 255, 255], // 0: white
    [186, 12, 47], // 1: crimson
    [0, 43, 92], // 2: navy
  ];
  // Top half crimson (index 1), bottom half navy (index 2); an 8 px corner masked transparent.
  const entry = paletteBmpEntry(64, 64, 8, colors, (_x, y) => (y < 32 ? 1 : 2), (x, y) => x >= 56 && y >= 56);
  const raw = bmpToRgba(entry)!;
  const at = (x: number, y: number) => [...raw.rgba.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
  assert.deepEqual(at(0, 0), [186, 12, 47, 255], "top half: crimson, top-down");
  assert.deepEqual(at(0, 63), [0, 43, 92, 255], "bottom half: navy");
  assert.deepEqual(at(60, 60), [0, 43, 92, 0], "the masked corner: navy's color, but transparent");
  const r = await processIcon(ico([{ width: 64, height: 64, bpp: 8, data: entry }]));
  assert.ok(r.ok);
  assert.equal(r.source.format, "ico/bmp8");
});

test("4- and 1-bit palette BMP entries pack their indexes into nibbles and single bits; transparency from the AND mask", async () => {
  // 4-bit: a 16-color palette, left half index 1, right half index 2, one pixel masked.
  const colors4: [number, number, number][] = Array.from({ length: 16 }, (_, i) => [i * 16, 0, 0]);
  const raw4 = bmpToRgba(paletteBmpEntry(16, 16, 4, colors4, (x) => (x < 8 ? 1 : 2), (x, y) => x === 0 && y === 0))!;
  const at4 = (x: number, y: number) => [...raw4.rgba.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  assert.deepEqual(at4(1, 5), [16, 0, 0, 255], "left half: index 1's color");
  assert.deepEqual(at4(9, 5), [32, 0, 0, 255], "right half: index 2's color");
  assert.deepEqual(at4(0, 0), [16, 0, 0, 0], "the masked pixel: index 1's color, but transparent");

  // 1-bit: a black/white palette, a single white pixel at (3,2) on an otherwise black 8×8.
  const raw1 = bmpToRgba(paletteBmpEntry(8, 8, 1, [[0, 0, 0], [255, 255, 255]], (x, y) => (x === 3 && y === 2 ? 1 : 0)))!;
  const at1 = (x: number, y: number) => [...raw1.rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
  assert.deepEqual(at1(3, 2), [255, 255, 255, 255]);
  assert.deepEqual(at1(0, 0), [0, 0, 0, 255]);
  assert.deepEqual(at1(7, 7), [0, 0, 0, 255], "the last pixel in its packed byte, read correctly");
});

test("an ICO with a 16 px 32-bit entry and a 64 px 8-bit entry gives the 64 px one", async () => {
  const small = bmpEntry(16, 16, () => [255, 0, 0, 255]);
  const big = paletteBmpEntry(64, 64, 8, [[0, 43, 92]], () => 0);
  const r = await processIcon(
    ico([
      { width: 16, height: 16, bpp: 32, data: small },
      { width: 64, height: 64, bpp: 8, data: big },
    ]),
  );
  assert.ok(r.ok);
  assert.deepEqual(r.source, { width: 64, height: 64, format: "ico/bmp8" });
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
  // A near-white glyph (one college's real touch icon, 2026-10-04) vanishes too; a small dark one is a mark.
  const onTransparent = async (glyph: Buffer, at: number) =>
    sharp({ create: { width: 180, height: 180, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: glyph, left: at, top: at }]).png().toBuffer();
  const faint = await processIcon(await onTransparent(await png(120, 120, "#F2F2F2"), 30));
  assert.deepEqual(faint.ok ? null : faint.reason, "blank on white");
  const small = await processIcon(await onTransparent(await png(30, 30, "#002B5C"), 75)); // 2.8% of the tile
  assert.ok(small.ok, "a small dark mark passes");
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

test("a host that doesn't answer keeps its mark; one whose robots.txt disallows us loses it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brand-"));
  for (const id of ["100006", "100007"]) writeFileSync(join(dir, `${id}.webp`), "old");
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://silent.edu/")) throw new Error("getaddrinfo ENOTFOUND silent.edu");
    if (url === "https://private.edu/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { status: 200 });
    return new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  const run = await syncIcons({
    probe: [probeFor("100006", "silent.edu"), probeFor("100007", "private.edu")],
    previous: [
      { unit_id: "100006", source_url: "https://silent.edu/touch.png", retrieved: "2026-09-01", width: 192 },
      { unit_id: "100007", source_url: "https://private.edu/touch.png", retrieved: "2026-09-01", width: 192 },
    ],
    overrides: {},
    brandDir: dir,
    deps: { fetch, now: () => 0, sleep: async () => {}, log: () => {} },
  });
  assert.deepEqual(run.entries.map((e) => e.unit_id), ["100006"]);
  assert.ok(existsSync(join(dir, "100006.webp")), "no answer: yesterday's mark stays");
  assert.equal(existsSync(join(dir, "100007.webp")), false, "robots.txt says no: the mark goes");
  const why = run.outcomes.find((o) => o.unit_id === "100007");
  assert.ok(why?.status === "none" && why.reasons.every((r) => r.endsWith("robots.txt disallows it")));
});

test("a platform's default is never a mark: WordPress's own logo, or one image on three unrelated sites", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brand-"));
  const stock = await png(180, 180, "#3858E9"); // the same "stock" icon from every CMS site
  const own = await png(180, 180, "#BA0C2F");
  const system = await png(180, 180, "#7A0019");
  const seal = await png(180, 180, "#00843D");
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    const image = (bytes: Buffer, finalUrl?: string) => {
      const res = new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } });
      if (finalUrl) Object.defineProperty(res, "url", { value: finalUrl });
      return res;
    };
    // WordPress answers a missing /favicon.ico with a redirect to its own logo.
    if (url === "https://wp.edu/touch.png") return image(own, "https://wp.edu/wp-includes/images/w-logo-blue-white-bg.png");
    if (/^https:\/\/(a|b|c)\.edu\/touch\.png$/.test(url)) return image(stock);
    if (url === "https://a.edu/favicon.ico") return image(own);
    if (/^https:\/\/(north|south)\.state\.edu\/touch\.png$/.test(url)) return image(system);
    if (/^https:\/\/(www\.uprb\.edu|cayey\.upr\.edu|www\.uprh\.edu)\/touch\.png$/.test(url)) return image(seal);
    return new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  const run = await syncIcons({
    probe: [
      probeFor("200001", "a.edu"),
      probeFor("200002", "b.edu"),
      probeFor("200003", "c.edu"),
      probeFor("200004", "wp.edu"),
      probeFor("200005", "north.state.edu"),
      probeFor("200006", "south.state.edu"),
      probeFor("243133", "www.uprb.edu"),
      probeFor("243151", "cayey.upr.edu"),
      probeFor("243179", "www.uprh.edu"),
    ],
    previous: [],
    overrides: {},
    brandDir: dir,
    deps: { fetch, now: () => 0, sleep: async () => {}, log: () => {} },
    names: new Map([
      ["243133", "University of Puerto Rico"],
      ["243151", "University of Puerto Rico at Cayey"],
      ["243179", "University of Puerto Rico-Humacao"],
    ]),
  });
  const stored = new Map(run.entries.map((e) => [e.unit_id, e.source_url]));
  assert.equal(stored.get("200001"), "https://a.edu/favicon.ico", "a.edu falls back to its own icon");
  assert.ok(!stored.has("200002") && !stored.has("200003"), "b.edu and c.edu had only the stock icon");
  assert.ok(!existsSync(join(dir, "200002.webp")) && !existsSync(join(dir, "200003.webp")));
  assert.ok(!stored.has("200004"), "WordPress's logo is never a college's mark");
  const wp = run.outcomes.find((o) => o.unit_id === "200004");
  assert.ok(wp?.status === "none" && wp.reasons[0].includes("a platform's default icon"));
  assert.ok(stored.has("200005") && stored.has("200006"), "one system's colleges sharing its icon on one site keep it");
  assert.ok(["243133", "243151", "243179"].every((id) => stored.has(id)), "and on three sites under one name");
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
