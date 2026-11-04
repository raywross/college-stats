import { cookies } from "next/headers";
import { authConfigured, getAccount, getUser } from "@/lib/auth";
import { myOrganization } from "@/lib/orgs";
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
  if (!authConfigured()) return Response.json({ configured: false, signedIn: false, id: null, name: null, email: null, org: false } satisfies MeState, { headers });
  if (!hasAuthCookie) return Response.json({ configured: true, signedIn: false, id: null, name: null, email: null, org: false } satisfies MeState, { headers });

  const user = await getUser();
  if (!user) return Response.json({ configured: true, signedIn: false, id: null, name: null, email: null, org: false } satisfies MeState, { headers });
  const [name, org] = await Promise.all([
    getAccount()
      .then((a) => a?.profile.display_name ?? null)
      // The accounts tables may not be set up yet; the menu still works with the email.
      .catch(() => null),
    // A member of a counselor organization gets Caseload in the menu; before the portal's tables exist, nobody is.
    myOrganization()
      .then((o) => o !== null)
      .catch(() => false),
  ]);
  return Response.json({ configured: true, signedIn: true, id: user.id, name, email: user.email ?? null, org } satisfies MeState, { headers });
}
