import Link from "next/link";
import { lapsedLine, shortDay, TRIAL_DAYS, trialEndsLine } from "@/lib/billing";
import { advisorBillingFor } from "@/lib/entitlements";

/**
 * The Advisor tab's one line about money (specs/product/advisor.md "2. The trial"; commercialization.md "When a plan
 * lapses"). During a trial with no card yet: "Trial ends Nov 28 · Add a card to keep it", a quiet line for the
 * student's first days and a fuller one in the last three. During a trial a card already pays for: "Trial ends Nov 28
 * · Manage". A plan that lapsed: a banner saying the advisor is read-only and the button to subscribe. Nothing while
 * the price isn't live, for an early account, or for a paid year. `welcome` is the one-time line after a checkout.
 */
export async function BillingLine({ studentId, viewerId, firstName, welcome }: { studentId: string; viewerId: string | null; firstName: string | null; welcome?: "started" | "subscribed" | "pending" | null }) {
  const billing = await advisorBillingFor(studentId, viewerId);
  const welcomeLine =
    welcome === "started" ? "Your card is saved. Nothing is charged until the trial ends, and the advisor carries on without a gap."
    : welcome === "subscribed" ? "You're subscribed. The whole advisor, for the year."
    : welcome === "pending" ? "Thanks. Your subscription is being set up; give it a moment and reload."
    : null;
  if (billing.status === "preview") return welcomeLine ? <Status>{welcomeLine}</Status> : null;
  const startHref = `/advisor/start?for=${encodeURIComponent(studentId)}`;

  if (!billing.whole) {
    return (
      <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm print:hidden">
        <p>{lapsedLine(billing.status === "lapsed" ? "lapsed" : "none", firstName)}</p>
        <Link href={startHref} className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">
          Subscribe
        </Link>
      </div>
    );
  }

  if (billing.status === "trial" && billing.trialEnd) {
    if (!billing.paid) {
      const whose = firstName ? `${firstName}'s advisor` : "your advisor";
      if ((billing.trialDaysLeft ?? 99) <= 3) {
        return (
          <div className="space-y-2">
            {welcomeLine && <Status>{welcomeLine}</Status>}
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm print:hidden">
              <p>
                The free trial ends {shortDay(billing.trialEnd)}. Add a card and {whose} carries on; do nothing and it turns read-only, with nothing charged.
              </p>
              <Link href={startHref} className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">
                Add a card
              </Link>
            </div>
          </div>
        );
      }
      return (
        <div className="space-y-2">
          {welcomeLine && <Status>{welcomeLine}</Status>}
          <p className="text-xs text-muted-foreground print:hidden">
            {trialEndsLine(billing.trialEnd)} · {TRIAL_DAYS} days free, no card needed ·{" "}
            <Link href={startHref} className="font-semibold text-primary hover:underline">
              Add a card to keep it
            </Link>
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {welcomeLine && <Status>{welcomeLine}</Status>}
        <p className="text-xs text-muted-foreground print:hidden">
          {trialEndsLine(billing.trialEnd)}
          {billing.cancelAtPeriodEnd ? ", then nothing is charged" : ", then the year starts"}
          {billing.mine && (
            <>
              {" · "}
              <Link href="/account#advisor" className="font-semibold text-primary hover:underline">
                Manage
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }
  return welcomeLine ? <Status>{welcomeLine}</Status> : null;
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm print:hidden">
      {children}
    </p>
  );
}
