/**
 * The console's old addresses (specs/product/admin-redesign.md "Model and files"): every page that moved to its door
 * keeps working by a redirect, so bookmarks, emails, and links in specs still land. Read by next.config.ts
 * `redirects()` (`permanent: false`: the addresses may move again) and tested in tests/admin-console.test.mts, which
 * holds every page the console had before the redesign to a row here and every target to a page that exists.
 *
 * A row's `from` and `to` use Next.js's path syntax (`:unit`, `:path*`); a row with `query` matches only when that
 * query parameter is present, and its value is captured under the key's name for `to`. Rows are tried in order, so the
 * narrower rows come first. Next.js passes the query string through to the target.
 */
export interface AdminRedirect {
  from: string;
  to: string;
  /** Matches only when this query parameter is present; `:<key>` in `to` takes its value. */
  query?: string;
}

export const ADMIN_REDIRECTS: readonly AdminRedirect[] = [
  // The Steward door: the Data console's Steward screens, Jobs, Operations (folded into each job's page), and Holds
  // (folded into a college's Review page, Changes, and the Inbox).
  { from: "/admin/steward", to: "/admin" },
  { from: "/admin/data/issues", to: "/admin/steward/findings" },
  { from: "/admin/data/proposals", to: "/admin/steward/proposals" },
  { from: "/admin/data/proposals/:key", to: "/admin/steward/proposals/:key" },
  { from: "/admin/data/todo", to: "/admin/steward/todo" },
  { from: "/admin/data/decisions", to: "/admin/steward/decisions" },
  { from: "/admin/data/audits", to: "/admin/steward/audits" },
  { from: "/admin/jobs", to: "/admin/steward/jobs" },
  { from: "/admin/jobs/:path*", to: "/admin/steward/jobs/:path*" },
  { from: "/admin/operations", query: "unit", to: "/admin/data/colleges/:unit/review" },
  { from: "/admin/operations", to: "/admin/steward/jobs" },
  { from: "/admin/data/holds", query: "unit", to: "/admin/data/colleges/:unit/review" },
  { from: "/admin/data/holds", to: "/admin/steward/findings" },
  // The Data door: the renames, and the screens that had their own top-level address.
  { from: "/admin/data/change-sets", to: "/admin/data/changes" },
  { from: "/admin/data/change-sets/:path*", to: "/admin/data/changes/:path*" },
  { from: "/admin/data/snapshots", to: "/admin/data/versions" },
  { from: "/admin/health/files", to: "/admin/data/health?tab=sources" },
  { from: "/admin/health", to: "/admin/data/health" },
  { from: "/admin/health/:path*", to: "/admin/data/health/:path*" },
  { from: "/admin/colleges", to: "/admin/data/colleges" },
  { from: "/admin/colleges/:path*", to: "/admin/data/colleges/:path*" },
  { from: "/admin/high-schools/:path*", to: "/admin/data/high-schools/:path*" },
  { from: "/admin/essays", to: "/admin/data/essays" },
  { from: "/admin/essays/:path*", to: "/admin/data/essays/:path*" },
  { from: "/admin/selectivity", to: "/admin/data/selectivity" },
  // More: the second-factor page became a panel on Admins.
  { from: "/admin/mfa", to: "/admin/admins#second-factor" },
];

/** next.config.ts `redirects()` rows. */
export function nextAdminRedirects(): { source: string; destination: string; permanent: false; has?: { type: "query"; key: string; value: string }[] }[] {
  return ADMIN_REDIRECTS.map((r) => ({
    source: r.from,
    destination: r.to,
    permanent: false as const,
    ...(r.query ? { has: [{ type: "query" as const, key: r.query, value: `(?<${r.query}>[^&]+)` }] } : {}),
  }));
}

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** A `from` pattern as a regular expression with named groups (`:name` one segment, `:name*` the rest, maybe none). */
function patternRegex(from: string): RegExp {
  const body = from
    .split("/")
    .map((part) => {
      const star = /^:(\w+)\*$/.exec(part);
      if (star) return `(?<${star[1]}>.*)`;
      const one = /^:(\w+)$/.exec(part);
      return one ? `(?<${one[1]}>[^/]+)` : escape(part);
    })
    .join("/")
    .replace(/\/\(\?<(\w+)>\.\*\)$/, "(?:/(?<$1>.*))?");
  return new RegExp(`^${body}$`);
}

/**
 * Where an old address goes, as Next.js would send it (the first matching row; the query string passed through), or
 * null when no row matches. Pure, for the tests: `resolveAdminRedirect("/admin/colleges/123")` →
 * "/admin/data/colleges/123".
 */
export function resolveAdminRedirect(url: string): string | null {
  const [pathAndQuery, hash] = url.split("#");
  const [path, search = ""] = pathAndQuery.split("?");
  const params = new URLSearchParams(search);
  for (const row of ADMIN_REDIRECTS) {
    const m = patternRegex(row.from).exec(path);
    if (!m) continue;
    const groups: Record<string, string> = { ...(m.groups ?? {}) };
    if (row.query) {
      const v = params.get(row.query);
      if (!v) continue;
      groups[row.query] = v;
    }
    let to = row.to.replace(/:(\w+)\*?/g, (_, k: string) => groups[k] ?? "");
    to = to.replace(/\/+$/, "") || "/";
    const [toBase, toHash] = to.split("#");
    const [toPath, toSearch = ""] = toBase.split("?");
    const merged = new URLSearchParams(toSearch);
    for (const [k, v] of params) if (!merged.has(k)) merged.append(k, v);
    const q = merged.toString();
    const anchor = toHash ?? hash;
    return `${toPath}${q ? `?${q}` : ""}${anchor ? `#${anchor}` : ""}`;
  }
  return null;
}
