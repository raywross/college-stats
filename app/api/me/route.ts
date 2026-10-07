import { cookies } from "next/headers";
import { authConfigured, getAccount, getUser } from "@/lib/auth";
import type { MeState } from "@/lib/accounts";

/**
 * The header's account state (components/account/AccountMenu.tsx fetches it in the browser), so public pages never
 * read cookies and stay static. Signed-out visitors (no Supabase auth cookie) get an answer without a call to
 * Supabase. Never cached: it's per person.
 */
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  // Reading cookies first also keeps this route dynamic when sign-in isn't configured at build time.
  const hasAuthCookie = (await cookies()).getAll().some((c) => c.name.startsWith("sb-"));
  if (!authConfigured()) return Response.json({ configured: false, signedIn: false, id: null, name: null, email: null } satisfies MeState, { headers });
  if (!hasAuthCookie) return Response.json({ configured: true, signedIn: false, id: null, name: null, email: null } satisfies MeState, { headers });

  const user = await getUser();
  if (!user) return Response.json({ configured: true, signedIn: false, id: null, name: null, email: null } satisfies MeState, { headers });
  let name: string | null = null;
  try {
    name = (await getAccount())?.profile.display_name ?? null;
  } catch {
    // The accounts tables may not be set up yet; the menu still works with the email.
  }
  return Response.json({ configured: true, signedIn: true, id: user.id, name, email: user.email ?? null } satisfies MeState, { headers });
}
