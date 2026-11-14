import Link from "next/link";
import { lapsedLine, TRIAL_DAYS, trialEndsLine } from "@/lib/billing";
import { advisorBillingFor } from "@/lib/entitlements";

/**
 * The Advisor tab's one line about money (specs/product/advisor.md "2. The trial"; commercialization.md "When a plan
 * lapses"): during the trial, quietly, "Trial ends Nov 28 · Manage"; a plan that lapsed, or one that never started
 * once the price is live, a banner saying the advisor is read-only and the button to start. Nothing while the price
 * isn't live, for an early account, or for a paid year. `welcome` is the one-time line after a checkout.
 */
export async function BillingLine({ studentId, viewerId, firstName, welcome }: { studentId: string; viewerId: string | null; firstName: string | null; welcome?: "started" | "subscribed" | "pending" | null }) {
  const billing = await advisorBillingFor(studentId, viewerId);
  const welcomeLine =
    welcome === "started" ? `Your ${TRIAL_DAYS}-day trial started. Everything here is yours to use; cancel before it ends and nothing is charged.`
    : welcome === "subscribed" ? "You're subscribed. The whole advisor, for the year."
    : welcome === "pending" ? "Thanks. Your subscription is being set up; give it a moment and reload."
    : null;
  if (billing.status === "preview") return welcomeLine ? <Status>{welcomeLine}</Status> : null;

  if (!billing.whole) {
    return (
      <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm print:hidden">
        <p>{lapsedLine(billing.status === "lapsed" ? "lapsed" : "none", firstName)}</p>
        <Link href={`/advisor/start?for=${encodeURIComponent(studentId)}`} className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">
          {billing.status === "lapsed" ? "Subscribe" : `Start your ${TRIAL_DAYS}-day free trial`}
        </Link>
      </div>
    );
  }

  if (billing.status === "trial" && billing.trialEnd) {
    return (
      <div className="space-y-2">
        {welcomeLine && <Status>{welcomeLine}</Status>}
        <p className="text-xs text-muted-foreground print:hidden">
          {trialEndsLine(billing.trialEnd)}
          {billing.cancelAtPeriodEnd ? ", then nothing is charged" : ""}
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
