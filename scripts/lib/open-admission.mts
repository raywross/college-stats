/**
 * The newest IPEDS IC file that answers OPENADMP (lib/open-admission.ts), for `npm run sync-data`. A just-released IC{Y} leaves the column blank, so older files are tried in turn.
 */
import { fetchIpedsTable } from "./ipeds.mts";
import { hasOpenAdmissionAnswers } from "../../lib/open-admission.ts";

export async function fetchOpenAdmissionFile(
  names: readonly string[],
  cacheDir: string,
): Promise<{ name: string; url: string; rows: Map<string, Record<string, string>> } | null> {
  for (const name of names) {
    const t = await fetchIpedsTable(name, { cacheDir, maxAgeDays: 7 });
    if (!t || !t.columns.has("OPENADMP")) continue;
    if (!hasOpenAdmissionAnswers(t.rows.values())) {
      console.log(`  IPEDS ${name}: OPENADMP is blank (not revised yet); trying an older file`);
      continue;
    }
    return { name, url: t.url, rows: t.rows };
  }
  return null;
}
