import "server-only";
/**
 * Supabase for signed-in users: an @supabase/ssr client bound to the request's cookies, so every query runs with the
 * user's own token and row-level security applies (specs/product/accounts.md). Server only: the browser never talks
 * to Supabase (specs/supabase.md#keys), so there's no NEXT_PUBLIC_ key.
 *
 * Cookies can be written only in Server Actions and Route Handlers. In a Server Component render, a token refresh
 * can't be saved; proxy.ts refreshes it before account pages render, so that's harmless.
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/** SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY, or null when sign-in isn't configured (e.g. CI builds). */
export function supabaseAuthEnv(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/**
 * The session cookies are httpOnly: only the server reads them (the browser never talks to Supabase), so page scripts
 * have no reason to see the tokens. @supabase/ssr's default is readable by scripts. Shared with proxy.ts.
 */
export const AUTH_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } as const;

/** A new client per request (never shared). Throws when Supabase isn't configured; check authConfigured() first. */
export async function createServerSupabase(): Promise<SupabaseClient> {
  const env = supabaseAuthEnv();
  if (!env) throw new Error("Sign-in isn't configured: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (specs/product/accounts.md).");
  const store = await cookies();
  return createServerClient(env.url, env.key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component render, where cookies are read-only; proxy.ts keeps the session fresh.
        }
      },
    },
  });
}
