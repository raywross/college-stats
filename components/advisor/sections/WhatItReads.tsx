import Link from "next/link";
import { SplashSection } from "@/components/advisor/Frame";
import { MetricLabel } from "@/components/ui/info-tip";
import type { SplashData } from "@/components/advisor/sample";
import { num } from "@/lib/format";

const CARD = "splash-rise animate-rise rounded-3xl border bg-card p-4 sm:p-5";

/** What it reads: three short facts, each counted from the dataset and pointing at its sources. */
export function WhatItReads({ data }: { data: SplashData }) {
  const r = data.reads;
  return (
    <SplashSection id="what-it-reads" title="What it reads" line="Public data, each college's own filings, and your record.">
      <ul className="grid gap-3 sm:grid-cols-3">
        <li className={CARD}>
          <p className="font-display text-3xl font-extrabold">{num(r.colleges)} colleges</p>
          <p className="mt-1 text-sm text-muted-foreground">Every number with its source and year.</p>
          <Link href="/data" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
            Sources, years &amp; updates
          </Link>
        </li>
        <li className={CARD} style={{ animationDelay: "90ms" }}>
          <p className="font-display text-3xl font-extrabold">Their own filings</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Common Data Sets from {num(r.cdsColleges)} colleges, and{" "}
            <MetricLabel cited={r.commonAppCite}>
              <span>Common App requirements for {num(r.commonAppColleges)}.</span>
            </MetricLabel>
          </p>
        </li>
        <li className={CARD} style={{ animationDelay: "180ms" }}>
          <p className="font-display text-3xl font-extrabold">Your record</p>
          <p className="mt-1 text-sm text-muted-foreground">Grades, tests, courses, and activities, entered once and read by every page.</p>
        </li>
      </ul>
    </SplashSection>
  );
}
