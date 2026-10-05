/**
 * Measures the college profile and compare pages (specs/profile-redesign.md#measurement,
 * specs/compare-redesign.md#budget): loads the overview and each topic page for a list of colleges at 1440×900
 * (desktop), 810 (iPad, portrait), and 390 (iPhone 13, isMobile), and, for every `--compare` set, the compare
 * overview and its seven topic pages at the same three widths. It prints each page's height against its budget,
 * window.innerWidth at DOMContentLoaded and after hydration, and scrollWidth (specs/mobile.md#checking-a-change).
 * It also loads every topic pill and previous/next link once (profile and compare) and reports any that fail.
 * Exits 1 when any check fails. A QA tool, not part of `npm run verify`.
 *
 * Playwright is not a dependency of this repo. Install it somewhere else and point the script at it:
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright && npx playwright install chromium
 *   PLAYWRIGHT_DIR=/tmp/pw npm run measure-profile
 *
 * Options (environment): BASE (default http://localhost:3000, a running dev or production server), PLAYWRIGHT_DIR,
 * CONCURRENCY (pages loaded at once, default 4). Unit ids as arguments replace the default five; `--compare a,b,c`
 * (repeatable) measures a compare set's overview and seven topic pages, instead of the default profile ids unless
 * profile ids are also given:
 *
 *   npm run measure-profile -- 166027 110662
 *   npm run measure-profile -- --compare 166027,204796,110662
 *   npm run measure-profile -- 166027 --compare 166027,204796,110662 --compare 172866,142832
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  COMPARE_PAGES,
  DEFAULT_IDS,
  PROFILE_PAGES,
  PROFILE_VIEWPORTS,
  comparePagePath,
  findPlaywright,
  formatTable,
  pagePath,
  problems,
  type ComparePage,
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
const concurrency = Math.max(1, Number(process.env.CONCURRENCY) || 4);

// Positional ids measure the profile; repeatable `--compare a,b,c` measures a compare set's overview and seven
// topic pages instead. `--compare` alone (no positional ids) skips the default five profile ids, so a
// compare-only run doesn't also pay for 35 profile loads it didn't ask for.
const rawArgs = process.argv.slice(2);
const compareSets: string[][] = [];
const idArgs: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === "--compare") {
    const value = rawArgs[++i];
    if (!value) {
      console.error("--compare needs a comma-separated id list, e.g. --compare 166027,204796,110662");
      process.exit(2);
    }
    compareSets.push(
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  } else {
    idArgs.push(arg);
  }
}
const ids = idArgs.length ? idArgs : compareSets.length ? [] : [...DEFAULT_IDS];

// Records the layout viewport when the server HTML is parsed: mobile Chrome locks in a widened one at load.
const DCL_SCRIPT = `document.addEventListener("DOMContentLoaded", () => { window.__dclInnerWidth = window.innerWidth; }, { once: true });`;

function contextOptions(v: ProfileViewport): Record<string, unknown> {
  const device = v.device ? devices[v.device] : {};
  return { ...device, viewport: { width: v.width, height: v.height } };
}

const browser = await chromium.launch();
const linkHrefs = new Map<string, Set<string>>(); // href → pages that link to it

/** The path+query this measurement loaded: `comparePagePath` for a compare row, `pagePath` otherwise. */
function measurementPath(m: Measurement): string {
  return m.ids && m.ids.length ? comparePagePath(m.ids, m.page as ComparePage) : pagePath(m.id, m.page as ProfilePage);
}

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
      // Profile pills ("Profile topics") and previous/next ("Other topics"), plus the compare header's pills
      // ("Compare topics"): a profile page only ever has the first two, so collecting all three here is harmless.
      // Inlined (not a shared constant) because `evaluate`'s callback is serialized and run in the browser, where
      // it can't see this module's scope; `measureCompare` below repeats the same literal for the same reason.
      links: [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Profile topics"] a, nav[aria-label="Other topics"] a, nav[aria-label="Compare topics"] a')].map((a) => a.pathname),
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

async function measureCompare(ctx: PwContext, v: ProfileViewport, compareIds: readonly string[], page: ComparePage): Promise<Measurement> {
  const tab = await ctx.newPage();
  try {
    const res = await tab.goto(base + comparePagePath(compareIds, page), { waitUntil: "networkidle", timeout: 180_000 });
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
      links: [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Profile topics"] a, nav[aria-label="Other topics"] a, nav[aria-label="Compare topics"] a')].map((a) => a.pathname),
    }));
    if (v.name === "desktop" && status === 200) {
      const from = comparePagePath(compareIds, page);
      for (const href of r.links) linkHrefs.set(href, (linkHrefs.get(href) ?? new Set()).add(from));
    }
    return {
      id: compareIds.join(","),
      ids: compareIds,
      page,
      viewport: v.name,
      width: v.width,
      status,
      height: r.height,
      innerWidthAtDcl: r.innerWidthAtDcl,
      innerWidth: r.innerWidth,
      scrollWidth: r.scrollWidth,
      brokenLinks: [],
    };
  } catch (e) {
    console.error(`${comparePagePath(compareIds, page)} at ${v.width}: ${(e as Error).message.split("\n")[0]}`);
    return { id: compareIds.join(","), ids: compareIds, page, viewport: v.name, width: v.width, status: 0, height: 0, innerWidthAtDcl: 0, innerWidth: 0, scrollWidth: 0, brokenLinks: [] };
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
    const profileTasks = ids.flatMap((id) => PROFILE_PAGES.map((page) => () => measure(ctx, v, id, page)));
    const compareTasks = compareSets.flatMap((set) => COMPARE_PAGES.map((page) => () => measureCompare(ctx, v, set, page)));
    rows.push(...(await pool([...profileTasks, ...compareTasks], concurrency)));
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
          const row = rows.find((m) => m.viewport === "desktop" && measurementPath(m) === from);
          row?.brokenLinks.push(href);
        }
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

const order = (m: Measurement) =>
  m.ids && m.ids.length
    ? [1, compareSets.findIndex((s) => s.join(",") === m.ids!.join(",")), COMPARE_PAGES.indexOf(m.page as ComparePage), PROFILE_VIEWPORTS.findIndex((v) => v.name === m.viewport)]
    : [0, ids.indexOf(m.id), PROFILE_PAGES.indexOf(m.page as ProfilePage), PROFILE_VIEWPORTS.findIndex((v) => v.name === m.viewport)];
rows.sort((a, b) => {
  const [x, y] = [order(a), order(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3];
});
console.log(`${base}, ${rows.length} loads in ${Math.round((Date.now() - started) / 1000)}s\n`);
console.log(formatTable(rows));
const failed = rows.filter((m) => problems(m).length);
console.log(failed.length ? `\n${failed.length} of ${rows.length} failed.` : `\nAll ${rows.length} passed.`);
process.exit(failed.length ? 1 : 0);
