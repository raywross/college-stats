import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { AccountSection } from "@/components/account/AccountSection";
import { Crest } from "@/components/school/Crest";
import { Term } from "@/components/ui/info-tip";
import { authConfigured, requireUser } from "@/lib/auth";
import { myFollows, unfollow } from "@/lib/follows";
import { getEmailUpdates, setEmailUpdates } from "@/lib/notification-prefs";
import { getData, getSchoolChanges } from "@/lib/data";
import { crestBrand } from "@/lib/brand";
import { dateLabel } from "@/lib/releases";

export const metadata: Metadata = { title: "Following", robots: { index: false } };

/** Inline Server Actions: a plain `<form action>` must return void/Promise<void>, so these discard the result. */
async function toggleEmailUpdates(enabled: boolean) {
  "use server";
  await setEmailUpdates(enabled);
}

async function unfollowAction(unitId: string) {
  "use server";
  await unfollow(unitId);
}

/**
 * /me/following (specs/product/follow-colleges.md#in-the-app): the colleges you follow, the date each last
 * changed, "on your list" for an automatic follow, and the email-updates switch. Unfollowing here or on a profile's
 * Follow button is the same Server Action (lib/follows.ts), so either place reflects the other immediately.
 */
export default async function FollowingPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/me/following");

  const [follows, emailUpdates, data] = await Promise.all([myFollows(), getEmailUpdates(), getData()]);
  const rows = await Promise.all(
    follows.map(async (f) => {
      const school = data.getSchoolById(f.unit_id);
      const changes = await getSchoolChanges(f.unit_id);
      return { ...f, school, lastChangedAt: changes[0]?.published_at ?? null };
    }),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Term term="follow">Following</Term>
        </h1>
        <p className="mt-1 text-muted-foreground">Colleges you&apos;ll hear about when their numbers change.</p>
      </header>

      <AccountSection id="prefs" title="Update emails" description="One email when a college you follow changes, at most once a day.">
        <form action={toggleEmailUpdates.bind(null, !emailUpdates)}>
          <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
            {emailUpdates ? "Turn off update emails" : "Turn on update emails"}
          </button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Currently <strong>{emailUpdates ? "on" : "off"}</strong>. Every digest also has a one-click unsubscribe link, and keeps your follows either way.
        </p>
      </AccountSection>

      <AccountSection id="colleges" title={rows.length ? `${rows.length} college${rows.length === 1 ? "" : "s"}` : "No colleges yet"}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You&apos;re not following any colleges yet. Follow one from its profile, or add it to{" "}
            <Link href="/me/list" className="font-semibold text-primary hover:underline">
              your list
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.unit_id} className="flex items-center gap-3 py-3">
                <Crest id={r.unit_id} name={r.school?.name ?? r.unit_id} size="sm" brand={r.school ? crestBrand(r.school) : undefined} className="size-9 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <Link href={`/schools/${r.unit_id}`} className="block truncate font-semibold hover:text-primary">
                    {r.school?.name ?? r.unit_id}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.source === "list" ? "On your list" : "Followed"}
                    {" · "}
                    {r.lastChangedAt ? `Last changed ${dateLabel(r.lastChangedAt.slice(0, 10))}` : "No changes recorded yet"}
                  </p>
                </div>
                <form action={unfollowAction.bind(null, r.unit_id)}>
                  <button type="submit" className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
                    Unfollow
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </AccountSection>
    </div>
  );
}
