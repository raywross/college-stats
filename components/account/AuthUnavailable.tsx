import Link from "next/link";
import { UserRound } from "lucide-react";

/**
 * What every account page shows where sign-in isn't configured (no SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY, as in
 * CI builds): the rest of the site works without an account, so say so and point back to it.
 */
export function AuthUnavailable({ title = "Sign-in isn't available here" }: { title?: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
        <UserRound className="size-7" />
      </span>
      <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 text-muted-foreground">
        Accounts aren&apos;t switched on for this copy of the site. Everything else works without one: explore, compare,
        and every number and source.
      </p>
      <Link href="/explore" className="mt-8 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
        Explore colleges
      </Link>
    </div>
  );
}
