import Link from "next/link";
import { cardNeededLine, lapsedLine, trialEndsLine } from "@/lib/billing";
import { advisorBillingFor } from "@/lib/entitlements";

/**
 * The Advisor tab's one line about money (specs/product/advisor.md "2. The trial"; commercialization.md "When a plan
 * lapses"). A trial waiting for its card (owner, 2026-11-14: a card is collected whenever a student is created): a
 * banner with the trial's end, that nothing is charged until then, and the button to add the card; the plan under it is
 * read-only until the card is saved. A trial a card pays for: quietly, "Trial ends Nov 28, then the year starts ·
 * Manage". A plan that lapsed: the read-only banner and Subscribe. Nothing while the price isn't live, for an early
 * account, or for a paid year. `welcome` is the one-time line after a checkout.
 */
export async function BillingLine({ studentId, viewerId, firstName, welcome }: { studentId: string; viewerId: string | null; firstName: string | null; welcome?: "started" | "subscribed" | "pending" | null }) {
  const billing = await advisorBillingFor(studentId, viewerId);
  const welcomeLine =
    welcome === "started" ? "Your card is saved and the trial is on. Nothing is charged until it ends; cancel before then from your account page and pay nothing."
    : welcome === "subscribed" ? "You're subscribed. The whole advisor, for the year."
    : welcome === "pending" ? "Thanks. Your subscription is being set up; give it a moment and reload."
    : null;
  if (billing.status === "preview") return welcomeLine ? <Status>{welcomeLine}</Status> : null;
  const startHref = `/advisor/start?for=${encodeURIComponent(studentId)}`;

  if (billing.needsCard && billing.trialEnd) {
    return (
      <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm print:hidden">
        <p>{cardNeededLine(billing.trialEnd, firstName)}</p>
        <Link href={startHref} className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">
          Add a card
        </Link>
      </div>
    );
  }

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
