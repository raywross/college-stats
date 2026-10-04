/**
 * Shared helper for NIC chapter-locator pages built on the WordPress "Ninja Tables" plugin (specs/greek-life.md
 * phase 4): the chapter table isn't in the page's HTML, it's fetched client-side from `admin-ajax.php` using a
 * table id and a short-lived public nonce that are both embedded in the page's own inline scripts. An adapter
 * fetches the listing page first, extracts the two values with `ninjaTableRequestUrl`, then fetches that URL as
 * JSON (an array of `{ value: {...fields...} }` rows, or a bare array of field objects on some sites).
 *
 * Used by sigep.mts and kappa-sigma.mts; prefixed with `_` so the adapter registry skips this file.
 */

/** The `admin-ajax.php?action=wp_ajax_ninja_tables_public_action&...` URL embedded in the page, or null. */
export function ninjaTableRequestUrl(html: string): string | null {
  const m = /"data_request_url"\s*:\s*"([^"]+admin-ajax\.php\?action=wp_ajax_ninja_tables_public_action[^"]*)"/.exec(html);
  if (!m) return null;
  return m[1].replace(/\\\//g, "/").replace(/&amp;/g, "&").replace(/\\u0026/g, "&");
}

/** One row's fields, whether the API wraps them in `{ value: {...} }` (older plugin versions) or returns them bare. */
export type NinjaRow = Record<string, string | null | undefined>;

/** Normalizes a Ninja Tables response (array of rows, or array of `{ value }` wrappers) to plain field objects. */
export function ninjaTableRows(json: unknown): NinjaRow[] {
  if (!Array.isArray(json)) return [];
  return json.map((row) => (row && typeof row === "object" && "value" in (row as object) ? ((row as { value: unknown }).value as NinjaRow) : (row as NinjaRow))).filter((r): r is NinjaRow => !!r && typeof r === "object");
}
