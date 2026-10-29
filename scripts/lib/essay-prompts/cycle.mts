/**
 * Application cycles for the essay prompts (specs/product/essays/prompts.md "Checks"): a cycle is named by the two
 * years it spans, "2026-27", and opens on 1 August (the day Common App and most colleges open the year's
 * applications). A page with no cycle, or one older than the open cycle, is held for review. Pure.
 */

/** The cycle open on `today` (ISO date): from 1 August of a year to 31 July of the next. */
export function openCycle(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const start = m >= 8 ? y : y - 1;
  return cycleFrom(start);
}

/** "2026" → "2026-27". */
export function cycleFrom(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** The first year of a cycle ("2026-27" → 2026), or null when the text isn't a normalized cycle. */
export function cycleStart(cycle: string): number | null {
  const m = /^(20\d\d)-(\d\d)$/.exec(cycle);
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) return null;
  return Number(m[1]);
}

/**
 * A cycle named in a page's own words, normalized: "2026-2027", "2026–27", "2026/27" → "2026-27"; an entry term
 * ("Fall 2027 applicants", "for entry in 2027") → the cycle that applies for it, "2026-27". Null when the text names
 * none. Ranges whose years aren't consecutive ("2020-2024") are not cycles.
 */
export function normalizeCycle(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const m of text.matchAll(/(20\d\d)\s*[-–—/]\s*(?:20)?(\d\d)(?!\d)/g)) {
    if ((Number(m[1]) + 1) % 100 === Number(m[2])) return cycleFrom(Number(m[1]));
  }
  const entry = /\b(?:fall|autumn|entry|enroll(?:ing|ment)?|entering)\s+(?:in\s+|term\s+)?(20\d\d)\b/i.exec(text) ?? /\b(20\d\d)\s+(?:fall|entry)\b/i.exec(text);
  if (entry) return cycleFrom(Number(entry[1]) - 1);
  return null;
}
