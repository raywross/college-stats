import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { headers } from "next/headers";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { AccountSection } from "@/components/account/AccountSection";
import { Term } from "@/components/ui/info-tip";
import { authConfigured, requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { myFollows } from "@/lib/follows";
import { getUnsubscribeToken } from "@/lib/notification-prefs";
import { getData, getSchoolChanges } from "@/lib/data";
import { describeChange } from "@/lib/changes";
import { buildDigest, type DigestCollegeInput } from "@/lib/digest";
import { dateLabel } from "@/lib/releases";

export const metadata: Metadata = { title: "Updates", robots: { index: false } };

interface DigestRow {
  id: number;
  publish_id: number;
  published_at: string;
  sent_at: string | null;
  unit_ids: string[];
}

/**
 * /me/updates (specs/product/follow-colleges.md#in-the-app): every digest you received, newest first, rendered with
 * the same blocks lib/digest.ts builds for the email, plus changes to colleges you follow that are never emailed
 * (`disappeared`: a figure no longer reported). Reconstructed from the public `dataset_changes` rows rather than
 * stored on the `digests` row itself, so the two never drift.
 */
export default async function UpdatesPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const user = await requireUser("/me/updates");

  const h = await headers();
  const siteUrl = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const supabase = await createServerSupabase();

  const [digestsRes, follows, token, data] = await Promise.all([
    supabase.from("digests").select("id, publish_id, published_at, sent_at, unit_ids").eq("user_id", user.id).order("published_at", { ascending: false }),
    myFollows(),
    getUnsubscribeToken(),
    getData(),
  ]);
  if (digestsRes.error) throw new Error(`Reading your updates failed: ${digestsRes.error.message}`);
  const digestRows = (digestsRes.data ?? []) as DigestRow[];
  const sourceOf = new Map(follows.map((f) => [f.unit_id, f.source]));

  const digests = await Promise.all(
    digestRows.map(async (row) => {
      const inputs: DigestCollegeInput[] = await Promise.all(
        row.unit_ids.map(async (unitId) => ({
          unit_id: unitId,
          name: data.getSchoolById(unitId)?.name ?? unitId,
          source: sourceOf.get(unitId) ?? "manual",
          changes: (await getSchoolChanges(unitId)).filter((c) => c.publish_id === row.publish_id),
        })),
      );
      // No cutoff here: a received digest shows every college it covered, not just the first 8.
      const built = buildDigest(inputs, { siteUrl, unsubscribeToken: token ?? "" }, { cutoff: inputs.length || 1 });
      return { row, built };
    }),
  );

  const disappeared = (
    await Promise.all(
      follows.map(async (f) => {
        const changes = (await getSchoolChanges(f.unit_id)).filter((c) => c.kind === "disappeared");
        if (!changes.length) return null;
        return { unit_id: f.unit_id, name: data.getSchoolById(f.unit_id)?.name ?? f.unit_id, changes };
      }),
    )
  ).filter((c): c is { unit_id: string; name: string; changes: Awaited<ReturnType<typeof getSchoolChanges>> } => c !== null);

  const nothing = digests.every((d) => !d.built) && disappeared.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Term term="update-digest">Updates</Term>
        </h1>
        <p className="mt-1 text-muted-foreground">
          Every digest you&apos;ve received, and anything else noticed about colleges you follow. Manage what you follow on{" "}
          <Link href="/me/following" className="font-semibold text-primary hover:underline">
            Following
          </Link>
          .
        </p>
      </header>

      {nothing && <p className="rounded-3xl border bg-card p-6 text-sm text-muted-foreground">Nothing yet. Follow a college and you&apos;ll see its changes here.</p>}

      <div className="space-y-4">
        {digests.map(
          ({ row, built }) =>
            built && (
              <article key={row.id} className="rounded-3xl border bg-card p-4 sm:p-5">
                <p className="text-xs font-semibold text-muted-foreground">
                  {dateLabel(row.published_at.slice(0, 10))}
                  {row.sent_at ? " · Emailed" : " · Recorded (not emailed — update emails were off or not yet set up)"}
                </p>
                <div className="mt-3 space-y-4">
                  {built.colleges.map((c) => (
                    <div key={c.unit_id}>
                      <Link href={`/schools/${c.unit_id}`} className="font-display font-bold hover:text-primary">
                        {c.name}
                      </Link>
                      <ul className="mt-1 space-y-1.5 text-sm">
                        {c.changes.map((change, i) => (
                          <li key={i}>
                            {describeChange(change)}
                            {change.source && <span className="block text-xs text-muted-foreground">{change.source}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </article>
            ),
        )}
      </div>

      {disappeared.length > 0 && (
        <AccountSection
          id="disappeared"
          title="Also noticed"
          description="Figures no longer reported for colleges you follow. Not emailed; shown here and on each college's own profile."
        >
          <ul className="space-y-3">
            {disappeared.map((d) => (
              <li key={d.unit_id}>
                <Link href={`/schools/${d.unit_id}`} className="font-semibold hover:text-primary">
                  {d.name}
                </Link>
                <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                  {d.changes.map((change, i) => <li key={i}>{describeChange(change)}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </AccountSection>
      )}
    </div>
  );
}
