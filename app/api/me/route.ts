import { cookies } from "next/headers";
import { authConfigured, getAccount, getUser } from "@/lib/auth";
import { myOrganization } from "@/lib/orgs";
import { createServerSupabase } from "@/lib/supabase-server";
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
  if (!authConfigured()) return Response.json({ configured: false, signedIn: false, id: null, name: null, email: null, org: false, admin: false } satisfies MeState, { headers });
  if (!hasAuthCookie) return Response.json({ configured: true, signedIn: false, id: null, name: null, email: null, org: false, admin: false } satisfies MeState, { headers });

  const user = await getUser();
  if (!user) return Response.json({ configured: true, signedIn: false, id: null, name: null, email: null, org: false, admin: false } satisfies MeState, { headers });
  const [name, org, admin] = await Promise.all([
    getAccount()
      .then((a) => a?.profile.display_name ?? null)
      // The accounts tables may not be set up yet; the menu still works with the email.
      .catch(() => null),
    // A member of a counselor organization gets Caseload in the menu; before the portal's tables exist, nobody is.
    myOrganization()
      .then((o) => o !== null)
      .catch(() => false),
    // An admin gets Admin in the menu, the way into the console (specs/product/admin.md "The console"): the same
    // is_admin_any_aal() the console's layout asks, so the link shows before the second factor and the console
    // then asks for it. Before the admin migration exists, nobody is.
    createServerSupabase()
      .then((supabase) => supabase.rpc("is_admin_any_aal"))
      .then(({ data }) => data === true)
      .catch(() => false),
  ]);
  return Response.json({ configured: true, signedIn: true, id: user.id, name, email: user.email ?? null, org, admin } satisfies MeState, { headers });
}
