/**
 * The prefetch diet (specs/serving-architecture.md "Prefetching"): no page downloads hundreds of KB of other pages it
 * may never open. Next's `Link` prefetches a static route in full as soon as the link enters the viewport (production
 * only), so a link to a heavy static page, or one of a list of many links, prefetches on intent instead
 * (`HoverPrefetchLink`, components/ui/hover-prefetch-link.tsx) or not at all (`prefetch={false}`).
 *
 * Two guards read source as text, each with a "guard:" test that feeds it a broken source:
 * 1. Everywhere in app/ and components/: a `<Link>` whose href is a heavy static page (a college profile, /data,
 *    /developers, /release-notes, /roadmap, /trends, the home page) must not prefetch on viewport.
 * 2. In the inventoried files (the header, the tab bar, the footer, compare, the profile, Explore, the home page, the
 *    plan's lists, the caseload): every `<Link>` that still prefetches on viewport is in VIEWPORT_ALLOWLIST, with the
 *    reason. A new `<Link>` there fails until it is either hover-only or added to the list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ------------------------------------------------------------------ */
/* The scanner                                                          */
/* ------------------------------------------------------------------ */

export interface LinkTag {
  /** The href expression as written: the string's contents for `href="…"`, the braces' contents for `href={…}`. */
  href: string;
  /** Whether the tag sets `prefetch` itself (any value). */
  prefetch: boolean;
  line: number;
}

/** The end of a JSX opening tag that starts at `start` (the `<`): the first `>` outside braces and strings. */
function tagEnd(src: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return src.length;
}

function hrefOf(tag: string): string {
  const m = /\bhref=(["{])/.exec(tag);
  if (!m) return "";
  const from = m.index + m[0].length;
  if (m[1] === '"') return tag.slice(from, tag.indexOf('"', from));
  let depth = 1;
  for (let i = from; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}" && --depth === 0) return tag.slice(from, i).trim();
  }
  return tag.slice(from).trim();
}

/** Every `<Link …>` opening tag in a source (next/link's component; `HoverPrefetchLink` is a different name). */
export function linkTags(src: string): LinkTag[] {
  const tags: LinkTag[] = [];
  for (const m of src.matchAll(/<Link(?=[\s/>])/g)) {
    const tag = src.slice(m.index, tagEnd(src, m.index) + 1);
    tags.push({ href: hrefOf(tag), prefetch: /\sprefetch=/.test(tag), line: src.slice(0, m.index).split("\n").length });
  }
  return tags;
}

/**
 * A heavy static page (over ~40 KB of payload; measured from `next build`'s `.rsc` files on the mini fixture): a college
 * profile (125–210 KB), /data (184 KB), /developers (493 KB), /release-notes (329 KB), /roadmap (54–67 KB), /trends
 * (44 KB), and the home page (218 KB). Recognized from a literal or template href, or a helper that returns one.
 */
export function isHeavyHref(href: string): boolean {
  const literal = /^["'`]?(\/[^"'`?#]*)/.exec(href.replace(/^\{?\s*/, ""));
  if (literal) {
    const path = literal[1];
    if (path === "/") return /^["'`]?\/(["'`?#]|$)/.test(href);
    if (/^\/schools\//.test(path)) return true;
    if (/^\/(data|developers|release-notes|roadmap)(\/|$)/.test(path)) return true;
    if (path === "/trends") return true;
  }
  return /\boverviewHref\(|\bprofileHref\b/.test(href);
}

/* ------------------------------------------------------------------ */
/* Guard 1: heavy pages never prefetch on viewport                      */
/* ------------------------------------------------------------------ */

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...tsxFiles(rel));
    else if (name.endsWith(".tsx")) out.push(relative(ROOT, join(ROOT, rel)));
  }
  return out;
}

function heavyProblems(files: { file: string; src: string }[]): string[] {
  return files.flatMap(({ file, src }) =>
    linkTags(src)
      .filter((t) => !t.prefetch && isHeavyHref(t.href))
      .map((t) => `${file}:${t.line} href={${t.href}}`),
  );
}

test("isHeavyHref: profiles, /data and the other large static pages are heavy; small and dynamic pages are not", () => {
  for (const h of ['"/data"', '"/data#edits"', "`/schools/${s.unit_id}`", '"/schools/166027"', '"/developers"', '"/release-notes"', '"/roadmap"', '"/"', '"/trends"', "overviewHref(unitId)", "facts.profileHref"]) {
    assert.equal(isHeavyHref(h), true, h);
  }
  for (const h of ['"/explore"', '"/compare"', '"/glossary#x"', '"/trends/states"', "`/explore?states=${s}`", "compareHref(ids)", "topicHref(id, k)", '"/advisor"', "href", '"/high-schools"']) {
    assert.equal(isHeavyHref(h), false, h);
  }
});

test("linkTags reads hrefs and the prefetch prop across lines and nested braces", () => {
  const src = `<Link\n  href={\`/schools/\${s.id}\`}\n  onClick={() => a > b}\n  prefetch={false}\n>x</Link>\n<Link href="/data">d</Link>\n<LinkItem href="/data" />`;
  assert.deepEqual(linkTags(src), [
    { href: "`/schools/${s.id}`", prefetch: true, line: 1 },
    { href: "/data", prefetch: false, line: 6 },
  ]);
});

test("no Link to a heavy static page prefetches on viewport", () => {
  const files = [...tsxFiles("app"), ...tsxFiles("components")].map((file) => ({ file, src: read(file) }));
  assert.deepEqual(heavyProblems(files), []);
});

test("guard: a heavy Link without prefetch is flagged", () => {
  assert.equal(heavyProblems([{ file: "x.tsx", src: `<Link href={\`/schools/\${id}\`} className="a">x</Link>` }]).length, 1);
  assert.equal(heavyProblems([{ file: "x.tsx", src: `<Link href="/data">x</Link>` }]).length, 1);
  assert.equal(heavyProblems([{ file: "x.tsx", src: `<HoverPrefetchLink href="/data">x</HoverPrefetchLink>` }]).length, 0);
  assert.equal(heavyProblems([{ file: "x.tsx", src: `<Link href="/data" prefetch={false}>x</Link>` }]).length, 0);
});

/* ------------------------------------------------------------------ */
/* Guard 2: the inventory's viewport allowlist                          */
/* ------------------------------------------------------------------ */

/**
 * The links in the inventoried files that still prefetch when they enter the viewport: the next click is likely and
 * the payload small (a dynamic page's shell is 3–17 KB; /glossary, a static page, 20 KB).
 * Key: `file|href expression`. Everything else in these files is `HoverPrefetchLink` or `prefetch={false}`.
 */
export const VIEWPORT_ALLOWLIST: Record<string, string> = {
  // The header: the main jobs. Explore's shell (its loading.tsx) is 17 KB, Compare and High schools 3 KB each.
  "components/layout/Header.tsx|item.href === \"/compare\" ? compareHref : item.href": "Explore, Compare, High schools: dynamic shells, 3–17 KB (Glossary and Data are hover-only)",
  "components/layout/RoleNavItem.tsx|nav.href": "the role item (Advisor, Household, Caseload): dynamic with a loading.tsx, 7 KB",
  "components/layout/RoleNavItem.tsx|href": "the role menu's entries: only mounted while the menu is open",
  // The phone tab bar: the four tabs are the site's main jobs, all dynamic shells.
  "components/layout/BottomNav.tsx|href": "the tab bar's Explore, role, and Compare tabs: dynamic shells, 3–17 KB",
  "components/layout/BottomNav.tsx|/explore": "the search sheet's Explore link: only mounted while the sheet is open, 17 KB",
  // Compare: the topic pills and the topic cards are the page's own navigation; each topic page is dynamic (3 KB).
  "components/compare/CompareTopicCard.tsx|compareHref(ids, topic)": "a compare topic page: dynamic, 3 KB",
  "components/compare/CompareTopicNav.tsx|compareHref(ids, topic.key)": "the next or previous compare topic: dynamic, 3 KB",
  "components/compare/CompareTopicNav.tsx|compareHref(ids)": "back to the compare overview: dynamic, 3 KB",
  "app/compare/page.tsx|compareHref(ids, \"table\")": "the compare table: dynamic, 3 KB",
  "app/compare/page.tsx|`/compare?ids=${school.unit_id},${s.unit_id}`": "a suggested pairing on the one-college prompt: dynamic, 3 KB, four links",
  "app/compare/page.tsx|`/compare?ids=${ids.join(\",\")}`": "the empty state's matchups: dynamic, 3 KB, six links",
  "app/compare/page.tsx|/explore": "the empty state's Browse all schools: 17 KB",
  // The profile: its links to Explore are dynamic shells.
  "components/profile/ProfileHero.tsx|/explore": "the breadcrumb's Explore: 17 KB",
  "components/profile/ProfileHero.tsx|`/explore?states=${school.location.state}`": "the breadcrumb's state: Explore's shell, shared",
  "components/profile/TopicNav.tsx|topicHref(unitId, topic.key)": "the next or previous topic page: rendered on demand, so prefetched only to its route tree (1 KB)",
  // Explore: sorting and paging are the page's own controls (the same dynamic shell, fetched once).
  "components/explore/SchoolTable.tsx|sortHref(params, k, sortBy, sortDir)": "a column sort: Explore's shell, shared",
  "components/explore/SchoolTable.tsx|changesHref(params, !changes)": "the changes toggle: Explore's shell, shared",
  "components/explore/Pagination.tsx|hrefFor(params, page - 1)": "the previous page: Explore's shell, shared",
  "components/explore/Pagination.tsx|hrefFor(params, p)": "a page number: Explore's shell, shared",
  "components/explore/Pagination.tsx|hrefFor(params, page + 1)": "the next page: Explore's shell, shared",
  "components/explore/FilterPanel.tsx|loginHref(\"/explore\")": "sign in, from the For you filter: a small static page",
  "components/explore/FilterPanel.tsx|group?.recordHref ?? `${ADVISOR_PATH}?record=1`": "the record, from the For you filter: the advisor's 7 KB shell",
  // The home page: Explore's shell and the advisor's, each fetched once however many links point at them.
  "app/page.tsx|ADVISOR_PATH": "Try Quad Advisor: 7 KB",
  "app/page.tsx|`/explore?${l.query}`": "the quick lists: Explore's shell, shared",
  "app/page.tsx|/explore?view=chart": "the chart's Explore link: Explore's shell, shared",
  "app/page.tsx|`/compare?ids=${ids.join(\",\")}`": "the matchups: dynamic, 3 KB, six links",
  "app/page.tsx|/glossary": "Full glossary: a static page of 20 KB",
  "app/page.tsx|`/glossary#${key}`": "the lingo cards: the same 20 KB glossary payload, fetched once for all four",
  // The plan: its tab switch is owned by PlanTabSwitch (prefetch={false} for in-place tabs).
  "components/planner/PlanList.tsx|/household": "the household page, for a parent with no student: one link",
  "components/planner/PlanList.tsx|guideHref(\"list\", { person: ctx.viewer.relation === \"self\" ? null : ctx.student.id, from: \"pill\" })": "the Build your list guide: the advisor's shell",
  "components/planner/EdSheet.tsx|guideHref(\"interest\", { college: row.item.unit_id, person, from: \"card\" })": "the show-interest guide, inside an open sheet",
  // The caseload's two calls to action.
  "components/org/CaseloadView.tsx|/org/students/new": "Add students: the counselor's main action, one link",
};

/** The files whose every Link was decided (specs/serving-architecture.md "Prefetching", the inventory). */
export const INVENTORY = [
  "components/layout/Header.tsx",
  "components/layout/RoleNavItem.tsx",
  "components/layout/BottomNav.tsx",
  "components/layout/Footer.tsx",
  "components/ui/pill-row.tsx",
  "components/compare/CompareHeader.tsx",
  "components/compare/CompareTopicCard.tsx",
  "components/compare/CompareTopicNav.tsx",
  "app/compare/page.tsx",
  "components/profile/ProfileHero.tsx",
  "components/profile/TopicNav.tsx",
  "components/profile/CompactHeader.tsx",
  "components/explore/SchoolTable.tsx",
  "components/explore/Pagination.tsx",
  "components/explore/FilterPanel.tsx",
  "components/school/SchoolCard.tsx",
  "components/school/SchoolRow.tsx",
  "components/charts/Leaderboard.tsx",
  "components/charts/ScatterPlot.tsx",
  "components/charts/StateTileMap.tsx",
  "app/page.tsx",
  "components/planner/PlanList.tsx",
  "components/planner/CollegeChip.tsx",
  "components/planner/EdSheet.tsx",
  "components/lists/ListBoard.tsx",
  "components/essays/CollegeEssayCard.tsx",
  "components/org/CaseloadView.tsx",
] as const;

function allowlistProblems(files: { file: string; src: string }[], allow: Record<string, string>): string[] {
  return files.flatMap(({ file, src }) =>
    linkTags(src)
      .filter((t) => !t.prefetch && !(`${file}|${t.href}` in allow))
      .map((t) => `${file}:${t.line} href={${t.href}}`),
  );
}

test("in the inventoried files, every Link that prefetches on viewport is on the allowlist", () => {
  const files = INVENTORY.map((file) => ({ file, src: read(file) }));
  assert.deepEqual(allowlistProblems(files, VIEWPORT_ALLOWLIST), []);
});

test("every allowlist entry still names a Link that exists (no stale entries)", () => {
  const seen = new Set(INVENTORY.flatMap((file) => linkTags(read(file)).filter((t) => !t.prefetch).map((t) => `${file}|${t.href}`)));
  assert.deepEqual(Object.keys(VIEWPORT_ALLOWLIST).filter((k) => !seen.has(k)), []);
});

test("guard: a new Link in an inventoried file fails until it is allowlisted or hover-only", () => {
  const src = `<Link href={\`/explore?x=1\`}>x</Link>`;
  assert.equal(allowlistProblems([{ file: "app/page.tsx", src }], {}).length, 1);
  assert.equal(allowlistProblems([{ file: "app/page.tsx", src }], { "app/page.tsx|`/explore?x=1`": "why" }).length, 0);
  assert.equal(allowlistProblems([{ file: "app/page.tsx", src: `<HoverPrefetchLink href="/x">x</HoverPrefetchLink>` }], {}).length, 0);
});

/* ------------------------------------------------------------------ */
/* The hover link                                                       */
/* ------------------------------------------------------------------ */

test("HoverPrefetchLink starts with prefetch off and turns the default on at hover, touch, or focus", () => {
  const src = read("components/ui/hover-prefetch-link.tsx");
  assert.match(src, /^"use client";/);
  assert.match(src, /prefetch=\{intent \? null : false\}/);
  for (const handler of ["onMouseEnter", "onTouchStart", "onFocus"]) assert.match(src, new RegExp(`${handler}=\\{\\(e\\) => \\{\\s*setIntent\\(true\\);`), handler);
});

test("the profile's topic pills prefetch on hover (the overview is a heavy static page)", () => {
  assert.match(read("components/profile/TopicPills.tsx"), /<PillRow[^>]*\bhoverPrefetch\b/);
  assert.match(read("components/ui/pill-row.tsx"), /hoverPrefetch \? HoverPrefetchLink : Link/);
});
