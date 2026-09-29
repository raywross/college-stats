import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { Term } from "@/components/ui/info-tip";
import { SITE_TAGLINE } from "@/lib/brand";

export function Footer() {
  return (
    <footer className="mt-16 border-t bg-surface-2 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom,0px)+1rem)] sm:mt-24 md:pb-28">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:gap-10 sm:px-6 sm:py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">
            {SITE_TAGLINE} Explore admissions, test scores, and who actually goes to college, with charts
            first and jargon explained.
          </p>
          <ThemeSegmented className="mt-2 hidden md:inline-flex" />
        </div>
        {/* Phones reach these pages from the tab bar, so only "About the data" stays. */}
        <div className="hidden md:block">
          <h3 className="mb-3 text-sm font-bold">Explore</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link className="hover:text-foreground" href="/explore">All schools</Link></li>
            <li><Link className="hover:text-foreground" href="/explore?view=chart">Admissions landscape</Link></li>
            <li><Link className="hover:text-foreground" href="/compare">Compare side-by-side</Link></li>
            <li><Link className="hover:text-foreground" href="/glossary">Glossary of terms</Link></li>
            <li><Link className="hover:text-foreground" href="/data">Data: sources, years &amp; updates</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-bold">About the data</h3>
          <p className="text-sm text-muted-foreground">
            Every operating 4-year U.S. college, from the <Term term="scorecard">College Scorecard</Term> and{" "}
            <Term term="ipeds">IPEDS</Term> admissions survey. Ranks and medians compare each college against all
            others that report the same measure.{" "}
            <Link href="/data" className="font-semibold text-foreground hover:text-primary">
              See all sources
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
