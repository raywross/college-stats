/**
 * The count rule (specs/product/essays/workspace.md "The editor"; the Essays build brief "Shared contracts"): words are
 * whitespace-separated tokens after trimming, the Common App's rule; characters are code points. One pure function
 * both the editor and the server call, with the forms' examples pinned in tests/essays-count.test.mts:
 * - a hyphenated word is one word ("well-known");
 * - an em dash with spaces around it is a separator, not a word ("this — that" is two words);
 * - "650 of 650" is allowed; 651 is over.
 *
 * The bar's colors: amber from 95% of the limit, red over it, and a minimum (the Common App's 250) shown as short.
 * Pure; safe in server code, client components, and tests.
 */
import { normalizeForCount } from "./normalize.ts";

export type CountKind = "words" | "characters";
export interface EssayLimit {
  kind: CountKind;
  max: number;
  min?: number;
}

/** Amber from this share of the limit (workspace.md: "amber from 95%"). */
export const AMBER_AT = 0.95;

/** A token made only of dashes is a separator the forms skip (an em dash, en dash, or hyphen set off by spaces). */
const DASH_ONLY = /^[\u2010-\u2015\u2212\-]+$/u;

/** Words: whitespace-separated tokens after trimming, a dash-only token not counted. */
export function countWords(text: string): number {
  const t = normalizeForCount(text).trim();
  if (t === "") return 0;
  return t.split(/\s+/u).filter((tok) => tok !== "" && !DASH_ONLY.test(tok)).length;
}

/** Characters: Unicode code points (an emoji is one, a `\r\n` pair is one line break). */
export function countCharacters(text: string): number {
  return [...normalizeForCount(text)].length;
}

/** The count as the limit's kind reads it (words when there is no limit). */
export function countText(text: string, kind: CountKind = "words"): number {
  return kind === "characters" ? countCharacters(text) : countWords(text);
}

/** Where a count stands against its limit: `none` without one, `under` below the minimum, `ok`, `near` (amber), `over` (red). */
export type CountState = "none" | "under" | "ok" | "near" | "over";

export function countState(count: number, limit: EssayLimit | null): CountState {
  if (!limit) return "none";
  if (count > limit.max) return "over";
  if (limit.min !== undefined && count > 0 && count < limit.min) return "under";
  if (count >= Math.ceil(limit.max * AMBER_AT)) return "near";
  return "ok";
}

/** "412 of 650 words", "1,180 of 1,500 characters", or "412 words" without a limit. */
export function countLabel(count: number, limit: EssayLimit | null, kind: CountKind = limit?.kind ?? "words"): string {
  const n = count.toLocaleString("en-US");
  const unit = (k: CountKind, v: number) => (k === "words" ? (v === 1 ? "word" : "words") : v === 1 ? "character" : "characters");
  if (!limit) return `${n} ${unit(kind, count)}`;
  return `${n} of ${limit.max.toLocaleString("en-US")} ${unit(limit.kind, limit.max)}`;
}

/** A short line for the count's state, read by the live region only at a threshold; null when nothing needs saying. */
export function countStateLine(state: CountState, count: number, limit: EssayLimit | null): string | null {
  if (!limit) return null;
  const unit = limit.kind === "words" ? "words" : "characters";
  if (state === "over") return `${(count - limit.max).toLocaleString("en-US")} ${unit} over the limit`;
  if (state === "under" && limit.min !== undefined) return `${(limit.min - count).toLocaleString("en-US")} ${unit} short of the ${limit.min.toLocaleString("en-US")} minimum`;
  if (state === "near") return "Close to the limit";
  return null;
}
