/**
 * Pure parts of `scripts/measure-profile.mts` (specs/profile-redesign.md#measurement, specs/compare-redesign.md#budget):
 * the pages and widths it loads, the height budgets, the checks on each measurement, and the printed table. Tested in
 * tests/profile-measure.test.mts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TOPIC_KEYS, type TopicKey } from "../../lib/profile-topics.ts";

export type ProfilePage = "overview" | TopicKey;

/** The overview, then each topic page, in pill order. */
export const PROFILE_PAGES: readonly ProfilePage[] = ["overview", ...TOPIC_KEYS];

/** Harvard, Ohio State, UCLA, a small test-blind college, an open-admission college (the redesign's pilot set). */
export const DEFAULT_IDS = ["166027", "204796", "110662", "172866", "142832"] as const;

/**
 * The compare overview, its six topic pages (same keys as the profile's topics), and the table
 * (specs/compare-redesign.md). String literals, not imported from `lib/compare-topics.ts`: that module is built by
 * a parallel unit and may not exist on this branch, and this script only needs the route segment, not its types.
 */
export type ComparePage = "overview" | "admissions" | "students" | "academics" | "cost" | "outcomes" | "history" | "table";

/** The compare overview, then each topic page, then the table, in pill order. */
export const COMPARE_PAGES: readonly ComparePage[] = ["overview", "admissions", "students", "academics", "cost", "outcomes", "history", "table"];

export type ViewportName = "desktop" | "tablet" | "phone";

export interface ProfileViewport {
  name: ViewportName;
  width: number;
  /** Playwright device descriptor to start from (its viewport width is replaced by `width`). */
  device?: string;
  height: number;
}

/** 1440×900 desktop, an iPad at 810 (portrait), an iPhone 13 at 390 (isMobile, so the layout-viewport rules apply). */
export const PROFILE_VIEWPORTS: readonly ProfileViewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 810, height: 1080, device: "iPad (gen 7)" },
  { name: "phone", width: 390, height: 664, device: "iPhone 13" },
];

/** `/schools/{id}` or `/schools/{id}/{topic}`. */
export function pagePath(id: string, page: ProfilePage): string {
  return page === "overview" ? `/schools/${id}` : `/schools/${id}/${page}`;
}

/** `/compare?ids=a,b,c` or `/compare/{page}?ids=a,b,c` (ids comma-joined, in the given order). */
export function comparePagePath(ids: readonly string[], page: ComparePage): string {
  const query = `?ids=${ids.join(",")}`;
  return page === "overview" ? `/compare${query}` : `/compare/${page}${query}`;
}

/**
 * Height budgets in CSS pixels (specs/profile-redesign.md): the overview is at most 3 desktop screens and 6 phone
 * screens; a topic page at most 6,000px on desktop. Null where the spec sets none.
 */
export function heightBudget(page: ProfilePage, viewport: ViewportName): number | null {
  if (page === "overview") return viewport === "desktop" ? 2700 : viewport === "phone" ? 5000 : null;
  return viewport === "desktop" ? 6000 : null;
}

/**
 * Compare height budgets in CSS pixels (specs/compare-redesign.md#budget), measured with three colleges: the
 * overview is at most 2,500px desktop and 4,000px phone; each of the six topic pages is at most 4,000px desktop. The
 * table page has no budget: it is the complete view (every row for every college), so its height is its row count.
 * Null where the spec sets none (tablet throughout; phone on every page but the overview).
 */
export function compareHeightBudget(page: ComparePage, viewport: ViewportName): number | null {
  if (page === "overview") return viewport === "desktop" ? 2500 : viewport === "phone" ? 4000 : null;
  if (page === "table") return null;
  return viewport === "desktop" ? 4000 : null;
}

export interface Measurement {
  /** A college's unit id (a profile measurement), or the compare set's ids joined with "," (a compare one). */
  id: string;
  /**
   * The compared colleges' ids, in URL order; set (non-empty) for a compare measurement and absent for a profile
   * one. `ProfilePage` and `ComparePage` share most of their literal strings, so this field, not `page`, is what
   * tells `problems`/`formatTable` which budget and path-builder apply.
   */
  ids?: readonly string[];
  page: ProfilePage | ComparePage;
  viewport: ViewportName;
  width: number;
  status: number;
  /** Content height after load: the bottom of <main> (the site footer excluded), or scrollHeight without a main. */
  height: number;
  /** window.innerWidth when DOMContentLoaded fired (the server HTML, before hydration). */
  innerWidthAtDcl: number;
  /** window.innerWidth after hydration and load. */
  innerWidth: number;
  scrollWidth: number;
  /** Profile or compare topic links (pills, previous/next) on this page that didn't load. */
  brokenLinks: string[];
}

/** The budget that applies to one measurement: `compareHeightBudget` for a compare row, `heightBudget` otherwise. */
function budgetFor(m: Pick<Measurement, "page" | "viewport" | "ids">): number | null {
  return m.ids && m.ids.length ? compareHeightBudget(m.page, m.viewport) : heightBudget(m.page as ProfilePage, m.viewport);
}

/** The printed table's row label: "compare a+b+c" for a compare measurement, the college id otherwise. */
function rowLabel(m: Pick<Measurement, "id" | "ids">): string {
  return m.ids && m.ids.length ? `compare ${m.ids.join("+")}` : m.id;
}

/**
 * What's wrong with one measurement, as short phrases (empty when it passes). A 404 page is a college without that
 * topic, not a failure; its pills shouldn't link to it, which the broken-links check catches.
 */
export function problems(m: Measurement): string[] {
  if (m.status === 404) return [];
  const out: string[] = [];
  if (m.status >= 400 || m.status === 0) out.push(`HTTP ${m.status || "error"}`);
  const budget = budgetFor(m);
  if (budget !== null && m.height > budget) out.push(`${m.height - budget}px over budget`);
  if (m.innerWidthAtDcl !== m.width) out.push(`innerWidth ${m.innerWidthAtDcl} at load`);
  else if (m.innerWidth !== m.width) out.push(`innerWidth ${m.innerWidth} after hydration`);
  if (m.scrollWidth > m.width) out.push(`scrolls sideways (${m.scrollWidth})`);
  if (m.brokenLinks.length) out.push(`broken links: ${m.brokenLinks.join(", ")}`);
  return out;
}

/** A fixed-width text table: page, width, height, budget, innerWidth at load and after, scrollWidth, result. */
export function formatTable(rows: readonly Measurement[]): string {
  const header = ["page", "width", "height", "budget", "iw@DCL", "iw", "scrollW", "result"];
  const body = rows.map((m) => {
    const budget = budgetFor(m);
    const issues = problems(m);
    const result = m.status === 404 ? "404 (no topic)" : issues.length ? `FAIL: ${issues.join("; ")}` : budget === null ? "ok" : "ok, within budget";
    return [
      `${rowLabel(m)} ${m.page}`,
      String(m.width),
      m.status === 404 ? "-" : m.height.toLocaleString("en-US"),
      budget === null ? "-" : budget.toLocaleString("en-US"),
      m.status === 404 ? "-" : String(m.innerWidthAtDcl),
      m.status === 404 ? "-" : String(m.innerWidth),
      m.status === 404 ? "-" : String(m.scrollWidth),
      result,
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (r: string[]) =>
    r
      .map((c, i) => (i === r.length - 1 ? c : i >= 1 && i <= 6 ? c.padStart(widths[i]) : c.padEnd(widths[i])))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

/**
 * Where to load Playwright from, in order: `PLAYWRIGHT_DIR` (a folder where `npm i playwright` ran, or the package
 * folder itself), then this repo's node_modules (it is deliberately not a dependency, but may be installed by hand).
 * Returns the package folder of the first that exists, or null.
 */
export function findPlaywright(dir: string | undefined, repoRoot: string): string | null {
  const candidates = [...(dir ? [join(resolve(dir), "node_modules", "playwright"), resolve(dir)] : []), join(repoRoot, "node_modules", "playwright")];
  for (const c of candidates) {
    const pkg = join(c, "package.json");
    if (!existsSync(pkg)) continue;
    try {
      if ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name === "playwright") return c;
    } catch {
      // Not a package folder; try the next.
    }
  }
  return null;
}
