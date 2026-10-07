import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { headers } from "next/headers";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { UpdatesSection } from "@/components/me/UpdatesSection";
import { Term } from "@/components/ui/info-tip";
import { authConfigured, requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Updates", robots: { index: false } };

/**
 * /me/updates (specs/product/follow-colleges.md#in-the-app): every digest you received and anything else noticed
 * about colleges on your list (components/me/UpdatesSection.tsx, which the list page also shows under the list).
 * Kept as a page because every digest email links here.
 */
export default async function UpdatesPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const user = await requireUser("/me/updates");

  const h = await headers();
  const siteUrl = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Term term="update-digest">Updates</Term>
        </h1>
        <p className="mt-1 text-muted-foreground">
          Every digest you&apos;ve received, and anything else noticed about colleges on your list. Choose which colleges you hear about with each
          one&apos;s <Term term="updates">Updates</Term> switch on{" "}
          <Link href="/me/list" className="font-semibold text-primary hover:underline">
            your list
          </Link>
          , and turn the emails on or off on{" "}
          <Link href="/account#updates" className="font-semibold text-primary hover:underline">
            your account page
          </Link>
          .
        </p>
      </header>

      <UpdatesSection userId={user.id} siteUrl={siteUrl} />
    </div>
  );
}
