import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { householdSeats, memberName, type HouseholdView } from "@/lib/household-rules";
import { CreateHouseholdForm } from "./HouseholdForms";

/**
 * The household section on /account: who's in the household, its seats, and a link to manage it, or a form to
 * start one. An account is in one household at a time; `households` is a list only for accounts from before that
 * rule, which still see each of theirs.
 */
export function HouseholdSummary({ households, defaultRole }: { households: HouseholdView[]; defaultRole: "guardian" | "student" }) {
  if (households.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          You&apos;re not in a household yet. Start one, then invite {defaultRole === "student" ? "a parent or guardian" : "your student"} with a link.
          If someone invited you, open the link they sent.
        </p>
        <CreateHouseholdForm defaultRole={defaultRole} compact />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {households.map((h) => {
          const seats = householdSeats(h);
          return (
            <li key={h.id} className="rounded-2xl border px-3.5 py-3">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-semibold break-words">{h.name}</span>
                <span className="text-xs text-muted-foreground">
                  {seats.taken} of {seats.max} seats
                </span>
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {h.members.map((m) => `${memberName(m)}${m.is_me ? " (you)" : ""}`).join(" · ")}
                {h.invitations.length > 0 && ` · ${h.invitations.length} invited`}
              </p>
            </li>
          );
        })}
      </ul>
      <Link href="/account/household" className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
        Manage your household, invitations, and edit access
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
