import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { HouseholdView } from "@/lib/household-rules";
import { rosterLine } from "@/lib/household-hub";

/**
 * The household section on /account (specs/product/household-hub.md): who's in it, by name ("Alex · Tracy (you) ·
 * Jordan (invited)"), and the way to the household page, where everything else lives. Someone without a household is
 * pointed there to start one. `households` is a list only for accounts from before the one-household rule.
 */
export function HouseholdSummary({ households }: { households: HouseholdView[] }) {
  if (households.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          You&apos;re not in a household yet. Add a parent, guardian, or student to start one. If someone invited you, open the link they sent.
        </p>
        <Link href="/household" className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
          Start your household
          <ArrowRight className="size-4" />
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {households.map((h) => (
          <li key={h.id} className="rounded-2xl border px-3.5 py-3">
            <p className="font-semibold break-words">{h.name}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{rosterLine(h.members)}</p>
          </li>
        ))}
      </ul>
      <Link href="/household" className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
        Open your household
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
