/**
 * Tiny HTML helpers shared by the Greek-life adapters (specs/greek-life.md phase 4): decoding entities in plain
 * text pulled out of markup. Prefixed with `_` so the adapter registry skips this file.
 */
const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", "#39": "'", "#x27": "'", lt: "<", gt: ">", nbsp: " ", "#8217": "’", "#8216": "‘", "#8211": "–", "#8212": "—" };

export const decodeEntities = (s: string): string =>
  s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (/^#\d+$/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : m));

/** Strips tags from an HTML fragment, decodes entities, and collapses whitespace. */
export const textOf = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
