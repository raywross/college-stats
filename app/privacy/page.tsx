import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Clock, EyeOff, Gauge, History, ListChecks, ServerCog, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { SITE_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Quad measures how the site is used, what it never records, and the choices you have.",
};

/** Same shell as the Data page's sections: eyebrow, display heading, body. */
function Section({ id, eyebrow, title, icon, children }: { id: string; eyebrow: string; title: ReactNode; icon: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-14 scroll-mt-24 space-y-4 first:mt-0">
      <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase">
        {icon} {eyebrow}
      </p>
      <h2 id={`${id}-h`} className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <div className="max-w-3xl space-y-3 text-[15px] leading-relaxed text-muted-foreground [&_b]:text-foreground">{children}</div>
    </section>
  );
}

const link = "font-semibold text-primary hover:underline";

const TOC = [
  ["short-version", "The short version"],
  ["measure", "What we measure"],
  ["never", "What we never record"],
  ["signed-in", "If you sign in"],
  ["performance", "Performance and errors"],
  ["choices", "Your choices"],
  ["processors", "Who processes it"],
  ["retention", "How long"],
  ["changes", "Changes"],
] as const;

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-5 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-10">
        <p className="mb-2 hidden text-xs font-bold tracking-[0.18em] text-primary uppercase sm:block">Privacy</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          What we <span className="highlight">measure</span>, and what we never will
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {SITE_NAME} is used by students, many of them under 18, and by their parents and counselors. This page says in plain words how we
          count visits so we can improve the site, and which numbers we will never touch.
        </p>
        <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold hover:border-primary hover:text-primary">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <Section id="short-version" eyebrow="Summary" title="The short version" icon={<ShieldCheck className="size-4" aria-hidden />}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>We count which pages and features get used, so we know what to fix and what to build next.</li>
          <li>
            <b>No tracking cookies</b>, no ads, no selling or sharing data, and nothing that follows you to other websites.
          </li>
          <li>
            We <b>never record</b> your grades, test scores, income, name, email, the colleges on your lists, or anything you type.
          </li>
          <li>If your browser sends a privacy signal, we send nothing at all.</li>
          <li>
            If you have an account, you can download or delete everything we keep about you from your{" "}
            <Link href="/account" className={link}>
              account page
            </Link>
            .
          </li>
        </ul>
      </Section>

      <Section id="measure" eyebrow="Usage" title="What we measure" icon={<ListChecks className="size-4" aria-hidden />}>
        <p>
          When you use the site, your browser tells us things like: you opened a page, you searched, you changed a filter, you opened a
          college, you added a college to Compare, you opened a source note or a glossary term. For colleges, we note <b>which</b> college
          (that is public information), never anything about you.
        </p>
        <p>
          This is anonymous. Measuring visits sets <b>no cookies</b> and stores nothing in your browser to recognize you, so there is no banner to click
          and nothing to clear. Because nothing is stored, one visit is one session: if you come back tomorrow, we can&apos;t tell it&apos;s you.
          Your approximate country or region (worked out from your connection, then the connection address is thrown away) helps us see
          where visits come from.
        </p>
        <p>
          We only ever send a fixed list of named events. Pages and fields we add later can&apos;t start reporting on their own, and no
          typed text is collected automatically.
        </p>
      </Section>

      <Section id="never" eyebrow="Off limits" title="What we never record" icon={<EyeOff className="size-4" aria-hidden />}>
        <p>These never leave your device as part of our measurements, whether or not you have an account:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>Grades and test scores</b>, including what you type into a score checker. We only note that someone used it and, at most,
            whether a score landed inside a college&apos;s usual range, never the score.
          </li>
          <li>
            <b>Income, assets, or any money amount</b> from you or your family.
          </li>
          <li>
            <b>Names, email addresses, home addresses, phone numbers, birth dates</b>, and your high school.
          </li>
          <li>
            <b>The contents of your lists</b> and anything you type into a search box or form. We note that a search found results, not
            what you searched for.
          </li>
          <li>
            <b>Recordings of your screen</b>, mouse movements, or heat maps. We don&apos;t make them.
          </li>
        </ul>
        <p>
          This is enforced in the code: each event we can send has a fixed list of allowed details, and an automatic check fails the build
          if one is named after something personal.
        </p>
      </Section>

      <Section id="signed-in" eyebrow="Accounts" title="If you sign in" icon={<UserRound className="size-4" aria-hidden />}>
        <p>
          Signing in is optional. When you do, our measurements carry a random account number (not your name or email) instead of being
          anonymous. That lets us see whether the site is useful over time, for example whether people come back to finish what they
          started, and whether students, parents, and counselors use it differently. We also count when an account is created, and
          whether you came through an invitation.
        </p>
        <p>
          Signed-in visits are not given even a country or region. Signing in sets the cookies the site needs to remember that you are
          signed in; they aren&apos;t used for measuring.
        </p>
        <p>
          What an account stores (your profile, your household, your lists) is shown on your{" "}
          <Link href="/account" className={link}>
            account page
          </Link>
          , where you can{" "}
          <Link href="/account#data" className={link}>
            download it
          </Link>{" "}
          or{" "}
          <Link href="/account#delete" className={link}>
            delete your account
          </Link>
          . You must be 13 or older to make one. See the <Link href="/glossary#household" className={link}>household</Link> and{" "}
          <Link href="/glossary#access-log" className={link}>access log</Link> entries in the glossary for how families share information.
        </p>
      </Section>

      <Section id="performance" eyebrow="Speed" title="Performance and errors" icon={<Gauge className="size-4" aria-hidden />}>
        <p>
          We use Vercel Speed Insights to see how fast pages load and respond on phones and computers. It reports timings for a page, not
          anything about you, and it doesn&apos;t use cookies.
        </p>
        <p>
          When a page breaks or a college can&apos;t be found, we count it by page address so we can fix it. We don&apos;t record who saw
          it or what they were doing.
        </p>
      </Section>

      <Section id="choices" eyebrow="You decide" title="Your choices" icon={<SlidersHorizontal className="size-4" aria-hidden />}>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>Global Privacy Control and Do Not Track.</b> If your browser or an extension sends either signal, we load nothing and send
            nothing, not even a page view. There&apos;s nothing to switch off on our side.
          </li>
          <li>
            <b>Ad and tracker blockers.</b> Ordinary blockers can stop our measurements. That&apos;s fine: you are simply not counted, and
            the site works the same.
          </li>
          <li>
            <b>Signing out.</b> Signing out returns your visits to anonymous.
          </li>
          <li>
            <b>Your account.</b> Download or delete it any time from the{" "}
            <Link href="/account" className={link}>
              account page
            </Link>
            .
          </li>
        </ul>
      </Section>

      <Section id="processors" eyebrow="Services" title="Who processes it" icon={<ServerCog className="size-4" aria-hidden />}>
        <p>These companies handle data for us, only to run the site. We don&apos;t sell data to anyone.</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b>PostHog</b> (servers in the United States) receives the usage events described above, and shows them to us in charts.
          </li>
          <li>
            <b>Vercel</b> hosts the site and provides Speed Insights.
          </li>
          <li>
            <b>Supabase</b> stores accounts and what an account holds.
          </li>
          <li>
            <b>Resend</b> sends the emails you ask for: sign-in links, invitations, and update emails you opt into.
          </li>
        </ul>
        <p>
          The college figures themselves are public data, with sources and years listed on the{" "}
          <Link href="/data#method" className={link}>
            Data page
          </Link>
          .
        </p>
      </Section>

      <Section id="retention" eyebrow="Time" title="How long" icon={<Clock className="size-4" aria-hidden />}>
        <p>
          Usage events are kept for 12 months, then deleted. Summaries that no longer point to any one visit (for example, how many
          visits a month) are kept longer. Account data stays until you delete your account.
        </p>
      </Section>

      <Section id="changes" eyebrow="Updates" title="Changes" icon={<History className="size-4" aria-hidden />}>
        <p>
          Last updated: October 2026. If we ever want to measure something new about people, rather than about pages, we will change this
          page first and say what changed in the{" "}
          <Link href="/release-notes" className={link}>
            release notes
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}
