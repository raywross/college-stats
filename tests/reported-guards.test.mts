/**
 * College-reported data (specs/college-reported-data.md): `school.reported` never leaks into comparisons, ranks,
 * medians, or charts (it's shown only on a college's own profile, next to the federal baseline), and every value the
 * admissions page displays is cited by name. `npm test`. See specs/data-lineage.md#enforcement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const rel = (p: string) => relative(ROOT, p);

function sourceFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(tsx?|mts)$/.test(name) ? [p] : [];
  });
}

/** Code with comments removed, so documentation examples don't trip the guard. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** `school.reported`, and never used for comparisons, ranks, medians, or charts (the newest values already live in `school.admissions`). */
const REPORTED_REFERENCE = /reported\??\.admissions|school\.reported/;

const BANNED_FILES = [
  join(ROOT, "lib/metrics.ts"),
  join(ROOT, "lib/dataset.ts"),
  join(ROOT, "lib/compare.ts"),
  join(ROOT, "lib/insights.ts"),
  join(ROOT, "lib/indicators.ts"),
  // Compare's rows and loaders, which lived in app/compare until the redesign (specs/compare-redesign.md).
  join(ROOT, "lib/compare-topics.ts"),
  join(ROOT, "lib/compare-routes.ts"),
  join(ROOT, "lib/compare-data.ts"),
  join(ROOT, "app/page.tsx"),
];
const BANNED_DIRS = [join(ROOT, "app/explore"), join(ROOT, "app/compare"), join(ROOT, "components/charts")];

function offenders(): string[] {
  const files = [...BANNED_FILES.filter((f) => statSync(f, { throwIfNoEntry: false })), ...BANNED_DIRS.flatMap(sourceFiles)];
  const out: string[] = [];
  for (const f of files) {
    code(f)
      .split("\n")
      .forEach((line, i) => {
        if (REPORTED_REFERENCE.test(line)) out.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
      });
  }
  return out;
}

test("college-reported values never reach comparisons, ranks, medians, or charts", () => {
  assert.deepEqual(offenders(), []);
});

/**
 * No chips (specs/college-reported-round-2.md, Decision 1 revised): the ⓘ popover carries source, year, and what a
 * value replaced, instead of a visible tag next to it. `SourceChip` and `SourceExceptions` are gone from the
 * codebase entirely, and `MetricLabel` no longer takes a `chip` prop.
 */
const CHIP_REFERENCE = /\bSourceChip\b|\bSourceExceptions\b|\bchip=/;
const CHIP_CHECKED_DIRS = [join(ROOT, "app"), join(ROOT, "components")];

function chipOffenders(): string[] {
  const files = CHIP_CHECKED_DIRS.flatMap(sourceFiles);
  const out: string[] = [];
  for (const f of files) {
    code(f)
      .split("\n")
      .forEach((line, i) => {
        if (CHIP_REFERENCE.test(line)) out.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
      });
  }
  return out;
}

test("no source chips anywhere under app/ or components/", () => {
  assert.deepEqual(chipOffenders(), []);
});
