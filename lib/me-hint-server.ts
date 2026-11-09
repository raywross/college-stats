import "server-only";
/**
 * Writing the header's hint cookie (lib/me-hint.ts) on the server: after a sign-in (app/login/actions.ts,
 * app/auth/confirm/actions.ts) and on every signed-in /api/me answer. Readable by scripts and with the marker's
 * lifetime (lib/accounts.ts signedInCookieFor copies the session cookie's options: AUTH_COOKIE_OPTIONS and
 * @supabase/ssr's 400 days), so the two travel together.
 */
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { initialsFor, meRoleOf, type MeRole, type RoleHint } from "@/lib/accounts";
import { callBundle, type MeBundle } from "@/lib/bundle-read";
import { ME_HINT_COOKIE, meHintValue } from "@/lib/me-hint";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase-server";

/** @supabase/ssr's own session cookie lifetime (DEFAULT_COOKIE_OPTIONS.maxAge), which the marker copies. */
const SESSION_MAX_AGE = 400 * 24 * 60 * 60;

export const ME_HINT_OPTIONS = { ...AUTH_COOKIE_OPTIONS, httpOnly: false, maxAge: SESSION_MAX_AGE } as const;

/** Sets the hint, unless the request already carries this exact value. Fails soft (a Server Component render can't write). */
export async function writeMeHint(initials: string, role: MeRole | null): Promise<void> {
  try {
    const store = await cookies();
    const value = meHintValue(initials, role);
    if (store.get(ME_HINT_COOKIE)?.value === value) return;
    store.set(ME_HINT_COOKIE, value, ME_HINT_OPTIONS);
  } catch {
    /* read-only cookies: the next /api/me answer writes it */
  }
}

/** Clears the hint (a signed-out /api/me answer while one is left over). */
export async function clearMeHint(): Promise<void> {
  try {
    const store = await cookies();
    if (store.get(ME_HINT_COOKIE)) store.set(ME_HINT_COOKIE, "", { ...ME_HINT_OPTIONS, maxAge: 0 });
  } catch {
    /* read-only cookies */
  }
}

/**
 * After a sign-in, with the client that holds the new session: one me_bundle() call (the profile's name and role
 * hint, the organization, the household's children) gives the initials and the role, the way /api/me will. Without
 * the bundle, the profile row alone (no organization or children: the role may read student until /api/me answers);
 * on any failure, the email's initial and no role. Never throws: a sign-in never fails over the header.
 */
export async function writeMeHintAfterSignIn(supabase: SupabaseClient, user: { id: string; email?: string | null }): Promise<void> {
  const email = user.email ?? null;
  try {
    const bundle = await callBundle<MeBundle | null>(supabase, "me_bundle");
    if (bundle.kind === "ok" && bundle.data) {
      const b = bundle.data;
      const role = meRoleOf({ org: b.org === true, roleHint: (b.profile?.role_hint ?? null) as RoleHint | null, children: b.children?.length ?? 0 });
      return await writeMeHint(initialsFor(b.profile?.display_name ?? null, email), role);
    }
    const { data } = await supabase.from("profiles").select("display_name, role_hint").eq("id", user.id).maybeSingle();
    const row = data as { display_name: string | null; role_hint: RoleHint | null } | null;
    const role = row ? meRoleOf({ org: false, roleHint: row.role_hint ?? null, children: 0 }) : null;
    return await writeMeHint(initialsFor(row?.display_name ?? null, email), role);
  } catch {
    await writeMeHint(initialsFor(null, email), null);
  }
}
