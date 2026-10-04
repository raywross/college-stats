/**
 * Phi Sigma Sigma, "Chapters Near You" (onephisigmasigma.org/chapters-near-you — a Wix site; phisigmasigma.org, the
 * domain named in the brief, fails TLS, so the org's actual public site lives at the "one" domain). NPC (Panhellenic)
 * sorority. The page is server-rendered Wix content: every chapter appears twice (a "sort by chapter" and a "sort by
 * school" list), each row a single <span> of free text separated by " - " with no consistent field order
 * ("Adelphi University - Epsilon Chapter - Sarah Alonzo" vs "Beta Alpha Chapter - University of Maryland - MD -
 * Carrie Buente"), sometimes with a two-letter state and always ending in a consultant's name. robots.txt allows
 * everything (checked 2026-10-04). No status field: this is a directory of current chapters only (no colonies or
 * alumnae chapters mentioned on the page).
 */
import { defineAdapter, type RawEntry } from "../contract.mts";

const LIST_URL = "https://www.onephisigmasigma.org/chapters-near-you";

const INSTITUTION = /\b(University|College|Institute|Academy|Tech|State|SUNY|Polytechnic)\b/;
const STATE = /^[A-Z]{2}$/;

/** One "X - Y - Z" span's parts, with the "... Chapter" part and the part naming the college picked out. */
export function parseRow(span: string): { chapter: string; college: string } | null {
  const parts = span
    .split(" - ")
    .map((p) => p.trim())
    .filter(Boolean);
  const chapter = parts.find((p) => /Chapter/.test(p));
  if (!chapter) return null;
  const rest = parts.filter((p) => p !== chapter && !STATE.test(p));
  const college = rest.find((p) => INSTITUTION.test(p));
  return college ? { chapter, college } : null;
}

/** Every unique "<span>...Chapter...</span>" on the page (each chapter appears in two sort orders; dedup by pair). */
export function parseSpans(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<span>([^<]*Chapter[^<]*)<\/span>/g)) out.add(m[1].trim());
  return [...out];
}

export function entriesFrom(html: string): RawEntry[] {
  const seen = new Set<string>();
  const entries: RawEntry[] = [];
  for (const span of parseSpans(html)) {
    const row = parseRow(span);
    if (!row) continue;
    const key = `${row.chapter}|${row.college}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ campus: row.college, name: row.chapter });
  }
  return entries;
}

export default defineAdapter({
  key: "phi-sigma-sigma",
  organization: "Phi Sigma Sigma",
  publisher: "Phi Sigma Sigma",
  listUrl: LIST_URL,
  tier: "D",
  domain: "greek",
  council: "npc",
  async crawl(ctx) {
    const html = await ctx.fetchText(LIST_URL);
    const entries = entriesFrom(html);
    ctx.log(`${parseSpans(html).length} chapter spans (two sort orders), ${entries.length} unique chapters`);
    return entries;
  },
});
