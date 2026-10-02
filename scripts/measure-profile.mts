/**
 * Measures the college profile (specs/profile-redesign.md#measurement): loads the overview and each topic page for a
 * list of colleges at 1440×900 (desktop), 810 (iPad, portrait), and 390 (iPhone 13, isMobile), and prints each page's
 * height against its budget, window.innerWidth at DOMContentLoaded and after hydration, and scrollWidth
 * (specs/mobile.md#checking-a-change). It also loads every topic pill and previous/next link once and reports any that
 * fail. Exits 1 when any check fails. A QA tool, not part of `npm run verify`.
 *
 * Playwright is not a dependency of this repo. Install it somewhere else and point the script at it:
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright && npx playwright install chromium
 *   PLAYWRIGHT_DIR=/tmp/pw npm run measure-profile
 *
 * Options (environment): BASE (default http://localhost:3000, a running dev or production server), PLAYWRIGHT_DIR,
 * CONCURRENCY (pages loaded at once, default 4). Unit ids as arguments replace the default five:
 *
 *   npm run measure-profile -- 166027 110662
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  DEFAULT_IDS,
  PROFILE_PAGES,
  PROFILE_VIEWPORTS,
  findPlaywright,
  formatTable,
  pagePath,
  problems,
  type Measurement,
  type ProfilePage,
  type ProfileViewport,
} from "./lib/profile-measure.mts";

// The few Playwright shapes this script uses (its types aren't installed here).
interface PwResponse {
  status(): number;
}
interface PwPage {
  goto(url: string, opts: { waitUntil: "load" | "networkidle"; timeout: number }): Promise<PwResponse | null>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  close(): Promise<void>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  addInitScript(script: string): Promise<void>;
  request: { get(url: string, opts: { timeout: number }): Promise<PwResponse> };
  close(): Promise<void>;
}
interface PwBrowser {
  newContext(opts: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: { launch(): Promise<PwBrowser> };
  devices: Record<string, Record<string, unknown>>;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pwDir = findPlaywright(process.env.PLAYWRIGHT_DIR, repoRoot);
if (!pwDir) {
  console.error(
    [
      "Playwright not found. It isn't a dependency of this repo; install it in a scratch folder and set PLAYWRIGHT_DIR:",
      "  mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright && npx playwright install chromium",
      "  PLAYWRIGHT_DIR=/tmp/pw npm run measure-profile",
    ].join("\n")
  );
  process.exit(2);
}
const { chromium, devices } = (await import(pathToFileURL(join(pwDir, "index.mjs")).href)) as Playwright;

const base = (process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");
const ids = process.argv.slice(2).length ? process.argv.slice(2) : [...DEFAULT_IDS];
const concurrency = Math.max(1, Number(process.env.CONCURRENCY) || 4);

// Records the layout viewport when the server HTML is parsed: mobile Chrome locks in a widened one at load.
const DCL_SCRIPT = `document.addEventListener("DOMContentLoaded", () => { window.__dclInnerWidth = window.innerWidth; }, { once: true });`;

function contextOptions(v: ProfileViewport): Record<string, unknown> {
  const device = v.device ? devices[v.device] : {};
  return { ...device, viewport: { width: v.width, height: v.height } };
}

const browser = await chromium.launch();
const linkHrefs = new Map<string, Set<string>>(); // href → pages that link to it

async function measure(ctx: PwContext, v: ProfileViewport, id: string, page: ProfilePage): Promise<Measurement> {
  const tab = await ctx.newPage();
  try {
    const res = await tab.goto(base + pagePath(id, page), { waitUntil: "networkidle", timeout: 180_000 });
    const status = res?.status() ?? 0;
    // Let fonts, ResizeObservers, and the pills' scroll effect settle.
    await tab.waitForTimeout(400);
    const r = await tab.evaluate(() => ({
      // Content height: to the end of <main>, so the site footer (~500px) doesn't count against the budget.
      height: (() => {
        const main = document.querySelector("main");
        return main ? Math.round(main.getBoundingClientRect().bottom + window.scrollY) : document.documentElement.scrollHeight;
      })(),
      innerWidthAtDcl: (window as unknown as { __dclInnerWidth?: number }).__dclInnerWidth ?? -1,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      links: [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Profile topics"] a, nav[aria-label="Other topics"] a')].map((a) => a.pathname),
    }));
    if (v.name === "desktop" && status === 200) {
      for (const href of r.links) linkHrefs.set(href, (linkHrefs.get(href) ?? new Set()).add(pagePath(id, page)));
    }
    return { id, page, viewport: v.name, width: v.width, status, height: r.height, innerWidthAtDcl: r.innerWidthAtDcl, innerWidth: r.innerWidth, scrollWidth: r.scrollWidth, brokenLinks: [] };
  } catch (e) {
    console.error(`${pagePath(id, page)} at ${v.width}: ${(e as Error).message.split("\n")[0]}`);
    return { id, page, viewport: v.name, width: v.width, status: 0, height: 0, innerWidthAtDcl: 0, innerWidth: 0, scrollWidth: 0, brokenLinks: [] };
  } finally {
    await tab.close();
  }
}

/** Runs `tasks` with at most `n` at once, in order of start. */
async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]();
      }
    })
  );
  return out;
}

const started = Date.now();
const rows: Measurement[] = [];
try {
  for (const v of PROFILE_VIEWPORTS) {
    const ctx = await browser.newContext(contextOptions(v));
    await ctx.addInitScript(DCL_SCRIPT);
    const tasks = ids.flatMap((id) => PROFILE_PAGES.map((page) => () => measure(ctx, v, id, page)));
    rows.push(...(await pool(tasks, concurrency)));
    // Links are checked once, from the desktop pass, against the same server.
    if (v.name === "desktop") {
      const broken = await pool(
        [...linkHrefs.keys()].map((href) => async () => {
          const status = await ctx.request
            .get(base + href, { timeout: 180_000 })
            .then((r) => r.status())
            .catch(() => 0);
          return status >= 400 || status === 0 ? href : null;
        }),
        concurrency
      );
      for (const href of broken) {
        if (!href) continue;
        for (const from of linkHrefs.get(href) ?? []) {
          const row = rows.find((m) => m.viewport === "desktop" && pagePath(m.id, m.page) === from);
          row?.brokenLinks.push(href);
        }
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

const order = (m: Measurement) => [ids.indexOf(m.id), PROFILE_PAGES.indexOf(m.page), PROFILE_VIEWPORTS.findIndex((v) => v.name === m.viewport)];
rows.sort((a, b) => {
  const [x, y] = [order(a), order(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
});
console.log(`${base}, ${rows.length} loads in ${Math.round((Date.now() - started) / 1000)}s\n`);
console.log(formatTable(rows));
const failed = rows.filter((m) => problems(m).length);
console.log(failed.length ? `\n${failed.length} of ${rows.length} failed.` : `\nAll ${rows.length} passed.`);
process.exit(failed.length ? 1 : 0);
