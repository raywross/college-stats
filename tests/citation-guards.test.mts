/**
 * Static guards on the UI code so citations can't drift from the data.
 * `npm test`. See specs/data-lineage.md#enforcement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(tsx?|mts)$/.test(name) ? [p] : [];
  });
}

/** Code with comments removed, so documentation examples don't trip the guards. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const UI = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))];
/** UI plus lib/, where takeaway sentences are written. */
const APP_CODE = [...UI, ...sourceFiles(join(ROOT, "lib"))];
const rel = (p: string) => relative(ROOT, p);

function offenders(pattern: RegExp, allow: (file: string) => boolean = () => false, files = UI): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (allow(rel(f))) continue;
    code(f)
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line)) out.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
      });
  }
  return out;
}

test("no hard-coded data years in app code (years come from lineage, so they update with each release)", () => {
  // e.g. "Fall 2024", "2023–24", "2024-25": these go stale silently when the data is refreshed.
  assert.deepEqual(offenders(/\b[Ff]all 20\d\d\b|\b20\d\d[–-]\d\d\b/, () => false, APP_CODE), []);
});

test("UI reads sources through the lineage API, not raw metadata", () => {
  // Only the Data page lists datasets' editions directly; everything else uses citeField / sourcesForFields.
  const allow = (f: string) => f === "app/data/page.tsx";
  assert.deepEqual(offenders(/getMeta\(\)\.(sources|vintages)|\bmeta\.(sources|vintages)\b|\.edition\b/, allow), []);
});

test("topic-level provenance is gone for good", () => {
  assert.deepEqual(offenders(/\bprovenance\b|\bresolveSource\b|topics=\{/), []);
});
