import Link from "next/link";
import { LogoMark } from "@/components/layout/Logo";
import { ErrorTracker } from "@/components/analytics/ErrorTracker";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <ErrorTracker kind="not_found" />
      <LogoMark className="size-16 animate-[spin_6s_linear_infinite]" />
      <h1 className="mt-6 font-display text-5xl font-extrabold tracking-tight">
        Off the <span className="highlight">map</span>
      </h1>
      <p className="mt-3 text-muted-foreground">We couldn&apos;t find that page or school. Our data covers operating 4-year colleges in the U.S.</p>
      <div className="mt-8 flex gap-2">
        <Link href="/explore" className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
          Explore schools
        </Link>
        <Link href="/" className="rounded-full border px-5 py-2.5 text-sm font-semibold">
          Home
        </Link>
      </div>
    </div>
  );
}
