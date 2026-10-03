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

/**
 * `lib/newest.ts` resolves the newest-figures display rule (specs/college-reported-round-2.md, Decision 1); the same
 * files that must never read `school.reported` directly must also never import it, since that would let a newer
 * college-reported class leak into a comparison across colleges on different years.
 */
const NEWEST_REFERENCE = /from ["']@?\.?\.?\/?(lib\/)?newest(\.ts)?["']|newestAdmissions/;

const BANNED_FILES = [
  join(ROOT, "lib/metrics.ts"),
  join(ROOT, "lib/dataset.ts"),
  join(ROOT, "lib/compare.ts"),
  join(ROOT, "lib/insights.ts"),
  join(ROOT, "lib/indicators.ts"),
  join(ROOT, "app/page.tsx"),
];
const BANNED_DIRS = [join(ROOT, "app/explore"), join(ROOT, "app/compare"), join(ROOT, "components/charts")];

/** `lib/newest.ts` is banned from a narrower set: lib/insights.ts is allowed to use it (admissionsTakeaway). */
const NEWEST_BANNED_FILES = [join(ROOT, "lib/metrics.ts"), join(ROOT, "lib/dataset.ts"), join(ROOT, "lib/compare.ts"), join(ROOT, "lib/indicators.ts"), join(ROOT, "app/page.tsx")];
const NEWEST_BANNED_DIRS = [join(ROOT, "app/explore"), join(ROOT, "app/compare"), join(ROOT, "components/charts")];

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

function newestOffenders(): string[] {
  const files = [...NEWEST_BANNED_FILES.filter((f) => statSync(f, { throwIfNoEntry: false })), ...NEWEST_BANNED_DIRS.flatMap(sourceFiles)];
  const out: string[] = [];
  for (const f of files) {
    code(f)
      .split("\n")
      .forEach((line, i) => {
        if (NEWEST_REFERENCE.test(line)) out.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
      });
  }
  return out;
}

test("college-reported values never reach comparisons, ranks, medians, or charts", () => {
  assert.deepEqual(offenders(), []);
});

test("lib/newest (the newest-figures resolver) never reaches comparisons, ranks, medians, or charts", () => {
  assert.deepEqual(newestOffenders(), []);
});

const ADMISSIONS_FILES = [join(ROOT, "app/schools/[id]/admissions/page.tsx"), join(ROOT, "components/profile/AdmissionsCard.tsx"), join(ROOT, "components/profile/ReportedAdmissions.tsx")];
const DISPLAYED_PATHS = ["applicants", "admitted", "enrolled", "acceptance_rate"];

test("every college-reported value the admissions page can show is cited by name", () => {
  const combined = ADMISSIONS_FILES.map((f) => code(f)).join("\n");
  for (const field of DISPLAYED_PATHS) {
    assert.match(combined, new RegExp(`citeField\\("reported\\.admissions\\.${field}`), `missing citeField("reported.admissions.${field}", …) somewhere in the admissions page`);
  }
});
