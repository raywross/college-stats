/**
 * Shared text helpers for NPC sorority adapters (specs/campus-directories.md). Prefixed with `_` so the registry
 * (registry.mts) skips this file: it is not itself an adapter.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  "#39": "'",
  "#x27": "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  "#8211": "–",
  "#8217": "’",
  "#038": "&",
};

/** Decodes the small set of HTML entities these sites use ("&#8211;" en dash, "&amp;", …). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#?\w+);/g, (m, e: string) => {
    const key = e.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (/^#\d+$/.test(key)) return String.fromCodePoint(Number(key.slice(1)));
    return m;
  });
}

/** "Alpha Beta Chapter &#8211; University of Iowa" -> ["Alpha Beta Chapter", "University of Iowa"], split on the first en/em dash or hyphen surrounded by spaces. */
export function splitChapterCollege(s: string): [string, string] | null {
  const t = decodeEntities(s).replace(/\s+/g, " ").trim();
  const m = t.match(/^(.*?)\s+[–—-]\s+(.*)$/);
  if (!m) return null;
  return [m[1].trim(), m[2].trim()];
}
