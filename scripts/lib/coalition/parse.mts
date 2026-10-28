/**
 * The two pages the Coalition sync reads (specs/data-expansion/coalition-app.md "Sources"): the Coalition's member
 * list (a Squarespace summary block, one item per member with its admissions link) and Scoir's list of colleges that
 * take applications through it (one paragraph, names separated by <br>, under an "As of {date}" line). Pure.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** Every member on the Coalition's page: its printed name and the admissions link it carries (or null). */
export function parseMemberPage(html: string): { name: string; admissions_url: string | null }[] {
  const out: { name: string; admissions_url: string | null }[] = [];
  const re = /<div class="summary-title">\s*<a\s+href="([^"]*)"[^>]*class="summary-title-link"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const name = clean(m[2]);
    if (!name) continue;
    const href = decodeEntities(m[1]).trim();
    out.push({ name, admissions_url: /^https?:\/\//i.test(href) ? href : null });
  }
  return out;
}

/** "As of October 20, 2026" → "2026-10-20"; null when the page prints no such line. */
export function parseAsOf(html: string): string | null {
  const m = /As of\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(html);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}

/** A paragraph with at least this many <br>-separated lines is a column of the list; the rest of the page has none. */
export const LIST_COLUMN_MIN_LINES = 8;

/**
 * Scoir's names: the page lays the list out in columns, each a paragraph of <br>-separated lines (four of about 29
 * on 2026-10-28). Every paragraph with LIST_COLUMN_MIN_LINES or more lines is a column; their lines are joined in
 * page order, trimmed, blanks dropped.
 */
export function parseScoirPage(html: string): { as_of: string | null; names: string[] } {
  const names: string[] = [];
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const lines = m[1]
      .split(/<br\s*\/?>/i)
      .map((l) => clean(l))
      .filter(Boolean);
    if (lines.length >= LIST_COLUMN_MIN_LINES) names.push(...lines);
  }
  return { as_of: parseAsOf(html), names };
}
