/**
 * Helpers for the `health.colleges` document, the compact input of the admin console's data health page
 * (specs/product/admin.md; lib/admin/health-files.ts). The document is built from the store by
 * scripts/college-health.mts (and by a college-reported run before it closes its change set, derived.mts); its check
 * is scripts/check-college-health.mts.
 */

/** Unit ids whose line differs between two documents' text (in either), for the staleness message. */
export function differingColleges(committed: string, built: string): string[] {
  const lines = (text: string) => new Map(text.split("\n").flatMap((l) => (/^"\d+": /.test(l) ? [[l.slice(1, l.indexOf('"', 1)), l.replace(/,$/, "")] as const] : [])));
  const a = lines(committed);
  const b = lines(built);
  return [...new Set([...a.keys(), ...b.keys()])].filter((u) => a.get(u) !== b.get(u)).sort((x, y) => Number(x) - Number(y));
}
