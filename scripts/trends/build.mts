/**
 * Builds data/history/trends/ from the committed history (specs/national-trends.md#shared-computation-and-tests):
 * runs every builder in scripts/trends/index.mts, writes one file per unit plus index.json (the /trends cards), and
 * removes files no builder wrote. Deterministic: the same committed inputs always give byte-identical files, so tests
 * recompute them and compare.
 *
 * Called by `npm run build-trends` (scripts/build-trends.mts) and at the end of `npm run sync-history`.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STUDIES } from "../../lib/trend-studies.ts";
import type { TrendCard, TrendIndex } from "../../lib/trends.ts";
import { loadTrendContext, type TrendContext, type TrendOutput } from "./context.mts";
import { BUILDERS } from "./index.mts";

export const TRENDS_DIR = join("data", "history", "trends");

/**
 * JSON with two-space indentation, except arrays of plain values (yearly lines, then-now pairs) stay on one line, so
 * a data release shows as a few changed lines per group.
 */
export function formatTrendJson(value: unknown, indent = ""): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== "object")) return JSON.stringify(value);
    return `[\n${value.map((v) => inner + formatTrendJson(v, inner)).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatTrendJson(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** A file exactly as build-trends writes it (tests compare committed files with this). */
export const trendFileText = (file: unknown) => `${formatTrendJson(file)}\n`;

/** Every unit's output plus index.json, computed without writing anything. */
export function computeTrends(ctx: TrendContext): { outputs: TrendOutput[]; index: TrendIndex } {
  const names = new Set<string>();
  const outputs = BUILDERS.map((b) => {
    if (names.has(b.name) || b.name === "index") throw new Error(`build-trends: duplicate output name "${b.name}"`);
    names.add(b.name);
    const out = b.build(ctx);
    if (out.name !== b.name || out.file.name !== b.name) throw new Error(`build-trends: builder "${b.name}" returned "${out.name}"/"${out.file.name}"`);
    return out;
  });
  // Cards in registry order; a study whose builder isn't registered yet simply has no card.
  const cards: TrendCard[] = STUDIES.flatMap((s) => outputs.find((o) => o.name === s.slug)?.card ?? []);
  const index: TrendIndex = { built: ctx.hmeta.built, cards, files: [...names].sort() };
  return { outputs, index };
}

/** Writes data/history/trends/ and returns the file names written (index last). */
export function buildTrends(root: string, log: (line: string) => void = console.log): string[] {
  const dir = join(root, TRENDS_DIR);
  const { outputs, index } = computeTrends(loadTrendContext(root));
  mkdirSync(dir, { recursive: true });
  const written: { name: string; file: unknown }[] = [...outputs.map((o) => ({ name: o.name, file: o.file })), { name: "index", file: index }];
  for (const { name, file } of written) writeFileSync(join(dir, `${name}.json`), trendFileText(file));
  const keep = new Set(written.map((w) => `${w.name}.json`));
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".json") && !keep.has(f)) rmSync(join(dir, f));
  for (const o of outputs) log(`  trends/${o.name}.json: ${o.file.n.toLocaleString("en-US")} colleges, ${o.file.from} to ${o.file.to}`);
  log(`  trends/index.json: ${index.cards.length} study card(s); files: ${index.files.join(", ") || "none"}`);
  return written.map((w) => w.name);
}
