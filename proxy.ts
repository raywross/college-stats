/**
 * Keeps the Supabase session fresh on account routes (specs/product/accounts.md). Server Components can't write
 * cookies, so a token that is about to expire is refreshed here, before the page renders, and the new cookies go to
 * both the page (request) and the browser (response). It uses auth.getClaims(), which refreshes an expiring token and
 * verifies the signature locally against the project's JWKS (cached in memory), so the common case makes no round
 * trip to Supabase Auth; a project still signing with a symmetric secret falls back to a server check.
 *
 * Scoped by `matcher` to the routes that read the session: running on the public pages would be wasted work and
 * those pages must stay static. Server Actions called from a public page (Follow, Add to list) refresh the session
 * themselves, since actions may write cookies. Authorization never relies on this file: every page, action, and
 * query checks the user itself (lib/auth.ts getUser() and row-level security).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase-server";

export async function proxy(request: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  // Unconfigured (CI) or signed out (no auth cookie): nothing to refresh, and no call to Supabase.
  if (!url || !key || !request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet, headers) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  // Refreshes a token that expires within 90 seconds (setAll above saves the new cookies), then verifies its signature
  // locally against the project's cached JWKS; the result itself isn't needed here. A malformed token can throw:
  // treat it as signed out and let the page decide.
  await supabase.auth.getClaims().catch(() => null);
  return response;
}

export const config = {
  matcher: ["/login", "/auth/:path*", "/account/:path*", "/household/:path*", "/me/:path*", "/invite/:path*", "/l/:path*", "/api/me"],
};
