import { getData } from "@/lib/data";
import { getUser } from "@/lib/auth";
import { myOwnProfile } from "@/lib/student-profile-store";
import { fitsPreferences, fitsScores } from "@/lib/student-profile";

/**
 * Explore's "fit=scores" / "fit=prefs" chips (specs/product/student-profile.md "Display"), read client-side by
 * components/me/ExploreFitChips.tsx: Explore's page itself is public and must stay static (tests/accounts.test.mts
 * forbids reading cookies while rendering it), so the signed-in student's own profile is resolved here instead,
 * against the WHOLE dataset (not the page's other filters — see the chip component's note on that limitation).
 *
 * Response: { signedIn, hasScores, hasPreferences, ids: { scores?: string[], prefs?: string[] } }. `ids.scores`/
 * `ids.prefs` are the unit_ids that are "in" (lib/student-profile.ts Fit); "out" and "unknown" colleges are both
 * left off, by design (see that module's Fit doc comment).
 */
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await getUser().catch(() => null);
  if (!user) return Response.json({ signedIn: false, hasScores: false, hasPreferences: false, ids: {} }, { headers });

  const profile = await myOwnProfile().catch(() => null);
  if (!profile) return Response.json({ signedIn: true, hasScores: false, hasPreferences: false, ids: {} }, { headers });

  const { getAllSchools } = await getData();
  const schools = getAllSchools();
  const hasScores = profile.tests.satTotal !== null || profile.tests.actComposite !== null;
  const hasPreferences =
    profile.preferences.sizes.length > 0 ||
    profile.preferences.settings.length > 0 ||
    profile.preferences.statesOrRegions.length > 0 ||
    profile.preferences.types.length > 0 ||
    profile.preferences.maxAverageCost !== null;

  const ids: { scores?: string[]; prefs?: string[] } = {};
  if (hasScores) ids.scores = schools.filter((s) => fitsScores(s, profile) === "in").map((s) => s.unit_id);
  if (hasPreferences) ids.prefs = schools.filter((s) => fitsPreferences(s, profile) === "in").map((s) => s.unit_id);

  return Response.json({ signedIn: true, hasScores, hasPreferences, ids }, { headers });
}
