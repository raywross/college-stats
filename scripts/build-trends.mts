/**
 * Builds the national trend files in data/history/trends/ from the committed history (specs/national-trends.md).
 *
 *   npm run build-trends
 *
 * Reads only committed files (no network), so any branch can run it; `npm run sync-history` runs it at its end.
 */
import { join } from "node:path";
import { buildTrends } from "./trends/build.mts";

console.log("Building national trends from data/history/ …");
buildTrends(join(import.meta.dirname, ".."));
