/**
 * Builds the national trend files from the bundled copy (specs/national-trends.md), for a local look.
 *
 *   npm run build-trends                      # writes .cache/trends/ from .data/snapshot/
 *   npm run build-trends -- --out <dir>       # writes elsewhere
 *   npm run build-trends -- --snapshot <dir>  # another snapshot folder (the bundled layout)
 *
 * Reads only the bundled copy (no network). Since the data platform's phase 2 it is no workflow step: the publisher
 * derives the trend files from the composed colleges and the history layer (scripts/lib/data-platform/compose.mts,
 * `computeTrends`). The script stays for a local look. Over the mini fixture (38 colleges) a builder that ranks every
 * college may refuse; fetch the real snapshot first (`npm run fetch-snapshot`).
 */
import { isAbsolute, join } from "node:path";
import { flagValue } from "./lib/data-platform/store.mts";
import { buildTrends } from "./trends/build.mts";
import { loadBundledTrendContext } from "./trends/context.mts";

const argv = process.argv.slice(2);
const abs = (p: string) => (isAbsolute(p) ? p : join(process.cwd(), p));
const out = abs(flagValue(argv, "--out") ?? join(import.meta.dirname, "..", ".cache", "trends"));
const snapshot = flagValue(argv, "--snapshot");
console.log(`Building national trends from ${snapshot ?? "the bundled copy"} into ${out} …`);
buildTrends(out, loadBundledTrendContext(snapshot ? abs(snapshot) : undefined));
