/**
 * The adapter registry: every file in ./adapters/ is one adapter (`export default defineAdapter({...})`), keyed by
 * its file name. Nothing to register by hand, so parallel tracks adding adapters never edit the same file.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { classificationProblem, DIRECTORY_TIERS } from "../../../lib/directories.ts";
import type { DirectoryAdapter } from "./contract.mts";

export const ADAPTER_DIR = join(import.meta.dirname, "adapters");

/** Problems with one adapter's declaration (empty when sound). */
export function adapterProblems(a: DirectoryAdapter, file?: string): string[] {
  const out: string[] = [];
  const where = file ?? a?.key ?? "adapter";
  if (!a || typeof a !== "object") return [`${where}: no default export (use export default defineAdapter({...}))`];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(a.key ?? "")) out.push(`${where}: key must be lowercase letters, digits, and hyphens`);
  if (file && `${a.key}.mts` !== file) out.push(`${where}: key "${a.key}" must match the file name`);
  if (!a.organization) out.push(`${where}: no organization name`);
  if (!a.publisher) out.push(`${where}: no publisher`);
  if (!/^https:\/\/\S+$/.test(a.listUrl ?? "")) out.push(`${where}: listUrl must be an https link`);
  if (!DIRECTORY_TIERS.includes(a.tier)) out.push(`${where}: tier must be B, C, or D`);
  const cls = classificationProblem(a);
  if (cls) out.push(`${where}: ${cls}`);
  if (typeof a.crawl !== "function") out.push(`${where}: no crawl(ctx) function`);
  return out;
}

/** Every adapter, sorted by key. Throws listing every problem when any adapter is malformed. */
export async function loadAdapters(dir = ADAPTER_DIR): Promise<DirectoryAdapter[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".mts") && !f.startsWith("_"))
    .sort();
  const adapters: DirectoryAdapter[] = [];
  const problems: string[] = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(join(dir, f)).href)) as { default?: DirectoryAdapter };
    const a = mod.default as DirectoryAdapter;
    const p = adapterProblems(a, f);
    if (p.length) problems.push(...p);
    else adapters.push(a);
  }
  if (problems.length) throw new Error(`Directory adapters:\n  ${problems.join("\n  ")}`);
  return adapters;
}
