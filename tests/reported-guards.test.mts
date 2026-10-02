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

/** `school.reported`, and never used for comparisons, ranks, medians, or charts (profiles only). */
const REPORTED_REFERENCE = /reported\??\.admissions|school\.reported/;

const BANNED_FILES = [join(ROOT, "lib/metrics.ts"), join(ROOT, "lib/dataset.ts"), join(ROOT, "lib/compare.ts"), join(ROOT, "lib/insights.ts"), join(ROOT, "lib/indicators.ts"), join(ROOT, "app/page.tsx")];
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

const ADMISSIONS_FILES = [join(ROOT, "app/schools/[id]/admissions/page.tsx"), join(ROOT, "components/profile/AdmissionsCard.tsx"), join(ROOT, "components/profile/ReportedAdmissions.tsx")];
const DISPLAYED_PATHS = ["applicants", "admitted", "enrolled", "acceptance_rate"];

test("every college-reported value the admissions page can show is cited by name", () => {
  const combined = ADMISSIONS_FILES.map((f) => code(f)).join("\n");
  for (const field of DISPLAYED_PATHS) {
    assert.match(combined, new RegExp(`citeField\\("reported\\.admissions\\.${field}`), `missing citeField("reported.admissions.${field}", …) somewhere in the admissions page`);
  }
});
