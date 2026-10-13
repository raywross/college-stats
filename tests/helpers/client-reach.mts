/**
 * What client code can reach: the import graph from every "use client" file, for the guards that keep the estimate's
 * method out of browser bundles (specs/chances/README.md "Quad's estimate is proprietary"). Used by
 * tests/selectivity.test.mts and tests/chances-client-guard.test.mts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

export /** Every source file under dir, as path -> text. */
function walk(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|mts)$/.test(name)) out.set(rel, read(rel));
  }
  return out;
}

/** Files a "use client" file reaches through relative and `@/` imports (stopping at "use server" modules) that are in `forbidden`. */
export function reachedFromClient(files: Map<string, string>, forbidden: string[]): string[] {
  const resolveImport = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = spec.slice(2);
    else if (spec.startsWith(".")) base = relative(ROOT, resolve(ROOT, dirname(from), spec));
    else return null;
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts"), join(base, "index.tsx")]) if (files.has(cand)) return cand;
    return null;
  };
  const found: string[] = [];
  let seen = new Set<string>();
  const visit = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = files.get(file) ?? "";
    if (/^\s*["']use server["']/.test(text)) return;
    if (forbidden.includes(file)) found.push([...chain, file].join(" -> "));
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveImport(file, m[1] ?? m[2] ?? m[3]);
      if (target) visit(target, [...chain, file]);
    }
  };
  for (const [file, text] of files) {
    if (!/^\s*["']use client["']/.test(text)) continue;
    seen = new Set();
    visit(file, []);
  }
  return found;
}

