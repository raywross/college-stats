/**
 * The rendered contrast check for college colors (specs/school-identity/brand.md, Checks): opens profile heroes in
 * both themes in a real browser, and measures every piece of hero text against the pixels actually behind it (the
 * college's tint, the dots, a chip), so no college color can push text under WCAG AA: 4.5:1, or 3:1 for large text
 * (24 px, or 18.66 px bold). It also measures the crest's monogram against its tile. Run once per change to the
 * colors' display (results are recorded in the spec), against a running server:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-hero-contrast.mts \
 *     --base http://localhost:3150 --ids 139959,221999,243744 [--playwright <path to playwright/index.mjs>]
 *
 * Playwright isn't a dependency of the app: pass the path to an installed copy (or PLAYWRIGHT_PATH). Exit code 1 when
 * any text fails.
 */
import sharp from "sharp";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const BASE = opt("--base", "http://localhost:3000");
const IDS = opt("--ids", "139959,221999,243744").split(",");
const PLAYWRIGHT = opt("--playwright", process.env.PLAYWRIGHT_PATH ?? "playwright");
/** Desktop and phone: the hero's layout (and where its text meets the tint) differs between them. */
const WIDTHS = opt("--widths", "1280,390").split(",").map(Number);

type Rgb = [number, number, number];
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: Rgb) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

interface TextBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: [number, number, number, number];
  size: number;
  weight: number;
  crest: boolean;
}

const { chromium } = (await import(PLAYWRIGHT)) as typeof import("playwright");
const browser = await chromium.launch();
const rows: { id: string; width: number; theme: string; worst: { text: string; ratio: number; need: number }; texts: number; failures: string[]; crest: string }[] = [];

const runs = IDS.flatMap((id) => WIDTHS.flatMap((width) => (["light", "dark"] as const).map((theme) => ({ id, width, theme }))));
for (const { id, width, theme } of runs) {
  {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: theme, isMobile: width < 640 });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {}
    }, theme);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/schools/${id}`, { waitUntil: "load", timeout: 180_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    // Let the hero's entrance animations finish.
    await page.waitForTimeout(2500);
    const hero = page.locator("section").first();
    const box = (await hero.boundingBox())!;
    const texts: TextBox[] = await hero.evaluate((root) => {
      const out: TextBox[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      // Computed colors come back in their own space (oklch(…), color-mix(…)): let a canvas turn them into sRGB.
      const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      const parse = (c: string) => {
        canvas.clearRect(0, 0, 1, 1);
        canvas.fillStyle = c;
        canvas.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent ?? "").trim();
        if (!text) continue;
        const el = n.parentElement!;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const [cr, cg, cb, ca = 1] = parse(cs.color);
        out.push({ text: text.slice(0, 40), x: r.x, y: r.y + scrollY, w: r.width, h: r.height, color: [cr, cg, cb, ca], size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400, crest: !!el.closest("[data-crest]") });
      }
      return out;
    });
    const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
    // The same hero with every glyph and icon hidden: what's behind the text.
    await page.addStyleTag({ content: "section:first-of-type, section:first-of-type * { color: transparent !important; text-shadow: none !important; filter: none !important; }" });
    await page.waitForTimeout(300);
    const shot = await page.screenshot({ clip });
    const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number): Rgb => {
      const px = Math.min(info.width - 1, Math.max(0, Math.round(x - box.x)));
      const py = Math.min(info.height - 1, Math.max(0, Math.round(y - box.y)));
      const i = (py * info.width + px) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const failures: string[] = [];
    let worst = { text: "", ratio: Infinity, need: 4.5 };
    let crest = "mark (no text)";
    for (const t of texts) {
      const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
      const need = large ? 3 : 4.5;
      // The background's low end: the 10th percentile of the box's pixel contrasts, so the hero's 1 px dot texture (one
      // pixel in 22×22, 5% ink) doesn't stand in for the background, while the tint's gradient still counts.
      const contrasts: number[] = [];
      for (let y = t.y + 1; y < t.y + t.h - 1; y += 1) {
        for (let x = t.x + 1; x < t.x + t.w - 1; x += 1) {
          const bg = pixel(x, y);
          const a = t.color[3];
          const fg: Rgb = [0, 1, 2].map((k) => t.color[k] * a + bg[k] * (1 - a)) as Rgb;
          contrasts.push(ratio(fg, bg));
        }
      }
      contrasts.sort((p, q) => p - q);
      const min = contrasts.length ? contrasts[Math.floor(contrasts.length / 10)] : Infinity;
      if (t.crest) {
        crest = `monogram "${t.text}" ${min.toFixed(2)}:1`;
        continue; // decoration (aria-hidden), reported apart
      }
      if (min < worst.ratio) worst = { text: t.text, ratio: min, need };
      if (min < need) failures.push(`"${t.text}" ${min.toFixed(2)}:1 (needs ${need})`);
    }
    rows.push({ id, width, theme, worst, texts: texts.filter((t) => !t.crest).length, failures, crest });
    await ctx.close();
  }
}
await browser.close();

for (const r of rows) {
  console.log(`${r.id} ${String(r.width).padStart(4)} ${r.theme.padEnd(5)} ${r.texts} texts; lowest "${r.worst.text}" ${r.worst.ratio.toFixed(2)}:1 (needs ${r.worst.need}); crest ${r.crest}${r.failures.length ? `\n  FAIL ${r.failures.join("\n  FAIL ")}` : ""}`);
}
process.exit(rows.some((r) => r.failures.length) ? 1 : 0);
