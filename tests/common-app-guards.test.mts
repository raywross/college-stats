/**
 * Static guards for the Common App build (specs/data-expansion/common-app.md; common-app-build/brief.md "Lineage"):
 * the site never links any commonapp.org page but the homepage (only the two source readers under
 * scripts/lib/common-app/ and lib/common-app/ name the grid PDF and the member pages), and no cycle string ("2026-27")
 * is typed in app/, components/, or lib/: the cycle comes from lineage. Each guard is proved to fail on a bad string.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");

interface SourceFile {
  path: string;
  text: string;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sourceFiles(p);
    return /\.(tsx?|mts)$/.test(name) ? [p] : [];
  });
}

/** Code with comments removed (as tests/citation-guards.test.mts does), so documentation doesn't trip the guards. */
function code(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const read = (dirs: string[]): SourceFile[] =>
  dirs.flatMap((d) => sourceFiles(join(ROOT, d))).map((p) => ({ path: relative(ROOT, p), text: code(readFileSync(p, "utf8")) }));

/** Where the source readers live: the only files that may name a commonapp.org page, and only the source URLs. */
const READERS = /^(scripts\/lib\/common-app|lib\/common-app)\//;
/** The two sources: the Requirements Grid PDF, and the member pages (the sitemap and each page's page-data). */
const SOURCE_URLS = [/^content\.commonapp\.org\/Files\/ReqGrid\.pdf/, /^www\.commonapp\.org\/sitemap[^/]*\.xml/, /^www\.commonapp\.org\/page-data\/(explore\/|sq\/)/];
const PAGE = /((?:[a-z0-9-]+\.)*commonapp\.org)\/([^\s"'`)]*)/gi;

/** Every commonapp.org URL with a path (anything after the slash) outside the allowed source URLs in the readers. */
export function commonAppLinkProblems(files: readonly SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    f.text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(PAGE)) {
        if (!m[2]) continue; // "https://www.commonapp.org/" alone is the homepage
        const url = `${m[1].toLowerCase()}/${m[2]}`;
        if (READERS.test(f.path) && SOURCE_URLS.some((r) => r.test(url))) continue;
        out.push(`${f.path}:${i + 1}: ${m[0]}`);
      }
    });
  }
  return out;
}

const CYCLE = /["'`]20\d\d[-–]\d\d["'`]/;
/** The one file allowed a quoted edition string: the CDS template table of one edition (tests/citation-guards.test.mts). */
const CYCLE_ALLOW = new Set(["lib/cds-template.ts"]);

/** A quoted cycle literal like "2026-27" in UI or lib code. */
export function cycleLiteralProblems(files: readonly SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (CYCLE_ALLOW.has(f.path)) continue;
    f.text.split("\n").forEach((line, i) => {
      if (CYCLE.test(line)) out.push(`${f.path}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

test("no commonapp.org page but the homepage in app/, components/, lib/, or scripts/ (the readers name only the sources)", () => {
  assert.deepEqual(commonAppLinkProblems(read(["app", "components", "lib", "scripts"])), []);
});

test("the link guard fails on an Explore link, a page outside the readers, and a stray page inside them", () => {
  const bad = (path: string, text: string) => commonAppLinkProblems([{ path, text }]);
  assert.equal(bad("components/school/WhatItTakes.tsx", `<a href="https://www.commonapp.org/explore/vanderbilt-university">`).length, 1);
  assert.equal(bad("lib/planner/requirements.ts", `const u = "https://commonapp.org/apply";`).length, 1);
  assert.equal(bad("app/page.tsx", `const grid = "https://content.commonapp.org/Files/ReqGrid.pdf";`).length, 1, "a source URL outside the readers");
  assert.equal(bad("scripts/lib/common-app/members.mts", `const u = "https://www.commonapp.org/explore/" + slug;`).length, 1, "an Explore page, even in a reader");
  // Allowed: the homepage anywhere, and the source URLs in the readers.
  assert.deepEqual(bad("components/x.tsx", `const home = "https://www.commonapp.org"; const h2 = "https://www.commonapp.org/";`), []);
  assert.deepEqual(bad("scripts/lib/common-app/grid.mts", `const GRID = "https://content.commonapp.org/Files/ReqGrid.pdf";`), []);
  assert.deepEqual(bad("scripts/lib/common-app/members.mts", "const S = \"https://www.commonapp.org/sitemap-0.xml\"; const P = `https://www.commonapp.org/page-data/explore/${slug}/page-data.json`;"), []);
});

test("no quoted cycle string in app/, components/, or lib/ (the cycle comes from lineage)", () => {
  assert.deepEqual(cycleLiteralProblems(read(["app", "components", "lib"])), []);
});

test("the cycle guard fails on a typed cycle", () => {
  assert.equal(cycleLiteralProblems([{ path: "components/school/WhatItTakes.tsx", text: `const label = "2026-27";` }]).length, 1);
  assert.equal(cycleLiteralProblems([{ path: "lib/common-app/display.ts", text: "return `2026–27`;" }]).length, 1);
  assert.deepEqual(cycleLiteralProblems([{ path: "lib/common-app/display.ts", text: "return `${cycle} cycle`;" }]), []);
});
