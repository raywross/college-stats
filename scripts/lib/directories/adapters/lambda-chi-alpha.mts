/**
 * Lambda Chi Alpha "Chapters" (specs/greek-life.md phase 4; NIC member). The page's chapter map is driven by a
 * `window.chaptersMapData = [...]` array embedded directly in the page's HTML (no separate request needed).
 * robots.txt allows the page (checked 2026-10-04). Each entry gives the chapter designation, the school's own name
 * (`universitycollege`), and city/state; entries whose `universitycollege` names a regional/alumni body rather than
 * a college (no "college"/"university"/"institute" word) are left out.
 */
import { defineAdapter, type RawEntry } from "../contract.mts";
import { decodeEntities } from "./_html.mts";

const LIST_URL = "https://www.lambdachi.org/chapters/";

interface ChapterRecord {
  title?: string;
  city?: string;
  state?: string;
  universitycollege?: string;
}

const INSTITUTION = /\b(university|college|institute|polytechnic|academy)\b/i;

/** The `window.chaptersMapData = [...]` array embedded in the page, or []. */
export function parseChaptersMapData(html: string): ChapterRecord[] {
  const m = /window\.chaptersMapData\s*=\s*(\[[\s\S]*?\]);/.exec(html);
  if (!m) return [];
  try {
    return JSON.parse(m[1]) as ChapterRecord[];
  } catch {
    return [];
  }
}

export function entriesFrom(records: readonly ChapterRecord[]): RawEntry[] {
  return records.flatMap((r) => {
    const campus = r.universitycollege?.trim();
    if (!campus || !INSTITUTION.test(campus)) return [];
    const entry: RawEntry = { campus: decodeEntities(campus) };
    if (r.title) entry.name = `${decodeEntities(r.title)} (Lambda Chi Alpha)`;
    if (r.city) entry.city = decodeEntities(r.city);
    if (r.state) entry.state = decodeEntities(r.state);
    return [entry];
  });
}

export default defineAdapter({
  key: "lambda-chi-alpha",
  organization: "Lambda Chi Alpha",
  publisher: "Lambda Chi Alpha",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "nic",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const records = parseChaptersMapData(html);
    if (!records.length) throw new Error("lambda-chi-alpha: no window.chaptersMapData found on the chapters page (layout may have changed)");
    const entries = entriesFrom(records);
    ctx.log(`${records.length} map entries, ${entries.length} at colleges`);
    return entries;
  },
});
