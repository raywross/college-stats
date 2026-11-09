import { cookies } from "next/headers";
import { authConfigured, getUser, readProfileRow } from "@/lib/auth";
import { meBundle, type MeBundle } from "@/lib/bundles";
import { householdChildren } from "@/lib/households";
import { myOrganization } from "@/lib/orgs";
import { createServerSupabase } from "@/lib/supabase-server";
import { initialsFor, meRoleOf, type MeChild, type MeState, type RoleHint } from "@/lib/accounts";
import { clearMeHint, writeMeHint } from "@/lib/me-hint-server";

const signedOut = (configured: boolean): MeState => ({ configured, signedIn: false, id: null, name: null, email: null, org: false, admin: false, role: null, children: [] });

/** The household menu's order (lib/planner/load.ts myPlanChildren): by the day each joined the roster, then by id. */
const byJoined = (a: { joined: string; id: string }, b: { joined: string; id: string }) => a.joined.localeCompare(b.joined) || a.id.localeCompare(b.id);

/** me_bundle()'s answer as the header's state; a paused profile is signed out, as on the fallback path. */
function fromBundle(b: MeBundle, user: { id: string; email?: string | null }): MeState {
  if ((b.profile?.suspended_at ?? null) !== null) return signedOut(true);
  const children: MeChild[] = [...(b.children ?? [])].sort(byJoined).map((c) => ({ id: c.id, name: c.name }));
  const roleHint = (b.profile?.role_hint ?? null) as RoleHint | null;
  const role = meRoleOf({ org: b.org === true, roleHint, children: children.length });
  return { configured: true, signedIn: true, id: user.id, name: b.profile?.display_name ?? null, email: user.email ?? null, org: b.org === true, admin: b.admin === true, role, children };
}

/**
 * The answer, with the header's hint cookie (lib/me-hint.ts) kept in step: written on every signed-in answer (the
 * initials and the role this answer shows, so the next page paints them before any script), cleared on a signed-out
 * one that still carries it. Set-Cookie only when the value changes.
 */
async function answer(me: MeState, headers: Record<string, string>): Promise<Response> {
  if (me.signedIn) await writeMeHint(initialsFor(me.name, me.email), me.role);
  else if (me.configured) await clearMeHint();
  return Response.json(me, { headers });
}

/**
 * The header's account state (components/account/AccountMenu.tsx and the role item fetch it in the browser), so
 * public pages never read cookies and stay static. Signed-out visitors (no Supabase auth cookie) get an answer without
 * a call to Supabase. Never cached: it's per person. The name and role hint come from the profile row alone
 * (lib/auth.ts readProfileRow), not the account read that loads the viewer bundle; the profile, the organization, the
 * admin check, and the household's children are one database wave; with me_bundle() installed they are one call.
 */
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  // Reading cookies first also keeps this route dynamic when sign-in isn't configured at build time.
  const hasAuthCookie = (await cookies()).getAll().some((c) => c.name.startsWith("sb-"));
  if (!authConfigured()) return Response.json(signedOut(false), { headers });
  if (!hasAuthCookie) return answer(signedOut(true), headers);

  const user = await getUser();
  if (!user) return answer(signedOut(true), headers);
  // me_bundle() (supabase/migrations/20261108130000_essay_and_me_bundles.sql) answers the whole state in one call;
  // null while it isn't installed (or on an error), and then the four reads below, as before.
  const bundle = await meBundle().catch(() => null);
  if (bundle) return answer(fromBundle(bundle, user), headers);
  const [profile, org, admin, children] = await Promise.all([
    readProfileRow()
      .then((p) => ({ name: p?.display_name ?? null, roleHint: (p?.role_hint ?? null) as RoleHint | null, paused: (p?.suspended_at ?? null) !== null }))
      // The accounts tables may not be set up yet; the menu still works with the email.
      .catch(() => ({ name: null, roleHint: null as RoleHint | null, paused: false })),
    // A member of a counselor organization is a counselor: the role item says Caseload (specs/product/role-nav.md);
    // before the portal's tables exist, nobody is.
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
    // The students on the person's household roster, in the order they were added (the same order as the advisor's
    // people line, lib/planner/load.ts myPlanChildren): the Household menu's "Jordan's advisor" entries.
    householdChildren()
      .then((cs): MeChild[] =>
        cs
          .map((c) => ({ id: c.access.student.id, name: c.access.student.display_name, joined: c.joined }))
          .sort(byJoined)
          .map(({ id, name }) => ({ id, name })),
      )
      .catch((): MeChild[] => []),
  ]);
  // A paused account (profiles.suspended_at, set by the admin console) is signed out everywhere, here too.
  if (profile.paused) return answer(signedOut(true), headers);
  const role = meRoleOf({ org, roleHint: profile.roleHint, children: children.length });
  return answer({ configured: true, signedIn: true, id: user.id, name: profile.name, email: user.email ?? null, org, admin, role, children } satisfies MeState, headers);
}
