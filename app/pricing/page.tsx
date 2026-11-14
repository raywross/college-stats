import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { FEATURE_MAP, MINOR_TERMS_SENTENCE, parsePriceLiveAt, PRICE_LIVE_SETTING, priceLabel, REFUND_RULE, TRIAL_DAYS } from "@/lib/billing";
import { BILLING_EMAIL, HELLO_EMAIL, mailto } from "@/lib/contacts";
import { billingConfigured } from "@/lib/entitlements";
import { ADVISOR_NAME } from "@/lib/planner/advisor";
import { supabaseClient } from "@/lib/supabase";

/** A public page, so no session: the setting is read with the anonymous client (anyone may read a setting) and the page is rebuilt hourly. */
export const revalidate = 3600;

async function priceIsLive(): Promise<boolean> {
  if (!billingConfigured() || !process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) return false;
  try {
    const { data } = await supabaseClient("read").from("app_settings").select("value").eq("key", PRICE_LIVE_SETTING).maybeSingle();
    return parsePriceLiveAt((data as { value: unknown } | null)?.value) !== null;
  } catch {
    return false;
  }
}

export const metadata: Metadata = {
  title: "Pricing",
  description: `Everything on Quad is free except ${ADVISOR_NAME}: ${priceLabel("student")} per student after a ${TRIAL_DAYS}-day free trial. Parents and counselors use Quad free.`,
  alternates: { canonical: "/pricing" },
};

/**
 * /pricing (specs/product/commercialization.md "Pricing page"): the plain reference the splash page links to. Two
 * cards, one sentence on what the advisor is and that everything else is free, the feature map as a Free · Advisor
 * table, a line for counselors, the questions, and what the money never buys. While the price isn't live the cards
 * say so and the buttons open the advisor; once it is, they start the trial. Public and prerendered (rebuilt hourly),
 * so it reads no session.
 */
export default async function PricingPage() {
  const live = await priceIsLive();
  const startHref = live ? "/advisor/start" : "/advisor";
  const free = [
    "Every college's page, Explore, Compare, Data, the glossary, the trends, the high school pages",
    "An account, your household, the student's record",
    "Quad's estimate on every college page and in Compare, with what went into it",
    "Following colleges and the update emails; each college's event calendar",
    "A personal API key for the data",
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6 sm:py-14">
      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Pricing</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Everything on Quad is free. {ADVISOR_NAME}, built on your record, is the one thing that costs money: {priceLabel("student")} per student, after {TRIAL_DAYS} days free with a card on file. Parents and counselors pay nothing for their own accounts.
        </p>
        {!live && <p className="mt-3 rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">While Quad is in preview, the advisor is free for every account. These are the prices to come; accounts made before they go live keep the advisor free through the end of this application cycle.</p>}
      </header>

      <section aria-labelledby="pricing-cards" className="grid gap-4 sm:grid-cols-2">
        <h2 id="pricing-cards" className="sr-only">
          The price
        </h2>
        <PriceCard title={ADVISOR_NAME} price={priceLabel("student")} lines={["One student's advisor through senior year, per student", "Paid by the student, or by a parent with one card for the household", `${TRIAL_DAYS} days free from the day the student is added, card on file, charged when the trial ends unless cancelled`]} href={startHref} live={live} />
        <div className="flex flex-col justify-center rounded-3xl border bg-muted/30 p-6 text-sm text-muted-foreground">
          <h3 className="font-display text-xl font-bold text-foreground">Parents and counselors: free</h3>
          <p className="mt-2">A parent&apos;s account, the household, and everything a parent sees of a student&apos;s advisor cost nothing. The student&apos;s advisor is what&apos;s paid for, once, whoever pays.</p>
          <p className="mt-2">Counselors and consultants run their caseload on Quad free.</p>
        </div>
      </section>

      <section aria-labelledby="pricing-free">
        <h2 id="pricing-free" className="font-display text-2xl font-bold">
          What stays free
        </h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {free.map((f) => (
            <li key={f} className="flex gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> {f}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pricing-map">
        <h2 id="pricing-map" className="font-display text-2xl font-bold">
          Free, and the advisor
        </h2>
        <div className="mt-4 overflow-hidden rounded-3xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-semibold">What</th>
                <th className="px-4 py-2 text-center font-semibold">Free</th>
                <th className="px-4 py-2 text-center font-semibold">Advisor</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {FEATURE_MAP.map((r) => (
                <tr key={r.capability}>
                  <td className="px-4 py-2">{r.label}</td>
                  <td className="px-4 py-2 text-center">{r.free ? <Check className="inline size-4 text-primary" aria-label="Included" /> : <span className="text-muted-foreground">{r.capability === "planner.tab" ? `${TRIAL_DAYS}-day trial` : ""}</span>}</td>
                  <td className="px-4 py-2 text-center">
                    <Check className="inline size-4 text-primary" aria-label="Included" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="pricing-counselors" className="rounded-3xl border bg-card p-5 sm:p-6">
        <h2 id="pricing-counselors" className="font-display text-xl font-bold">
          Counselors
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Counselors and consultants use Quad free: see your students&apos; advisors and bring your school&apos;s data.{" "}
          <Link href="/org" className="font-semibold text-primary hover:underline">
            Open the counselor portal
          </Link>{" "}
          or write to{" "}
          <a href={mailto(HELLO_EMAIL, { subject: "Counselor access to Quad" })} className="font-semibold text-primary hover:underline">
            {HELLO_EMAIL}
          </a>
          .
        </p>
      </section>

      <section aria-labelledby="pricing-questions">
        <h2 id="pricing-questions" className="font-display text-2xl font-bold">
          Questions
        </h2>
        <dl className="mt-4 space-y-4 text-sm">
          <QA q="How does the trial work?" a={`${TRIAL_DAYS} days, the whole advisor, from the day a student's record is made, with a card on file. When the trial ends the card is charged ${priceLabel("student")} and the advisor carries on; cancel before then and nothing is charged. One trial per student.`} />
          <QA q="Who pays?" a={`Either the student or a parent. A parent keeps one card for the household and pays ${priceLabel("student")} for each student they add. A student can start their own trial and pay for their own advisor.`} />
          <QA q="Refunds" a={REFUND_RULE} />
          <QA q="Minors" a={`A student of any age may start their own trial. ${MINOR_TERMS_SENTENCE}`} />
          <QA q="What happens when a subscription lapses?" a="The advisor turns read-only: the list, its levels, the calendar, and the offers stay visible; the guides, the changes, the texts, and the alerts stop. Nothing is deleted. Subscribing again restores everything." />
          <QA q="Can I cancel any time?" a="Yes, from your account page or the billing portal. A cancelled trial runs to its end; a cancelled year runs to its renewal date, then turns read-only." />
          <QA q="Prices and offers" a="Prices may differ by offer, and the price shown at checkout is the one charged; the price you start at is the price you renew at. A yearly renewal reminder comes two weeks before." />
          <QA q="Billing questions" a={`Receipts, refunds, and anything about a charge: ${BILLING_EMAIL}.`} />
        </dl>
      </section>

      <section aria-labelledby="pricing-never" className="rounded-3xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
        <h2 id="pricing-never" className="font-display text-xl font-bold">
          What the money never buys
        </h2>
        <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          <li>No ads.</li>
          <li>No featured listings or sponsored placements.</li>
          <li>No leads sold to colleges.</li>
          <li>No advisor commissions.</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">Quad&apos;s data stays open and cited, for everyone, signed out. Paid is the advisor, never access to a number.</p>
      </section>
    </div>
  );
}

function PriceCard({ title, price, lines, href, live }: { title: string; price: string; lines: string[]; href: string; live: boolean }) {
  return (
    <div className="flex flex-col rounded-3xl border bg-card p-6">
      <h3 className="font-display text-2xl font-bold">{title}</h3>
      <p className="mt-2 text-3xl font-extrabold tracking-tight">
        {price.split(" ")[0]} <span className="text-base font-semibold text-muted-foreground">a year</span>
      </p>
      <p className="text-sm font-semibold text-primary">{TRIAL_DAYS} days free</p>
      <ul className="mt-4 flex-1 space-y-1.5 text-sm text-muted-foreground">
        {lines.map((l) => (
          <li key={l} className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> {l}
          </li>
        ))}
      </ul>
      <Link href={href} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
        {live ? `Start your ${TRIAL_DAYS}-day free trial` : "Open the advisor"}
      </Link>
    </div>
  );
}

function QA({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-semibold">{q}</dt>
      <dd className="mt-1 text-muted-foreground">{a}</dd>
    </div>
  );
}
