/**
 * Builds the national trend files in data/history/trends/ from the committed history (specs/national-trends.md).
 *
 *   npm run build-trends
 *
 * Reads only committed files (no network), so any branch can run it. Since the data platform's phase 2 it is no
 * longer a workflow step: the publisher derives the trend files from the composed colleges and the history layer
 * (scripts/lib/data-platform/compose.mts, `computeTrends`). The script stays for a local look.
 */
import { join } from "node:path";
import { buildTrends } from "./trends/build.mts";

console.log("Building national trends from data/history/ …");
buildTrends(join(import.meta.dirname, ".."));
