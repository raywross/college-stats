import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { memberName, type HouseholdView } from "@/lib/household-rules";
import { CreateHouseholdForm } from "./HouseholdForms";

/** The household section on /account: who's in each household, a link to manage them, or a form to start one. */
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
        {households.map((h) => (
          <li key={h.id} className="rounded-2xl border px-3.5 py-3">
            <p className="font-semibold break-words">{h.name}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {h.members.map((m) => `${memberName(m)}${m.is_me ? " (you)" : ""}`).join(" · ")}
              {h.invitations.length > 0 && ` · ${h.invitations.length} invited`}
            </p>
          </li>
        ))}
      </ul>
      <Link href="/account/household" className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted">
        Manage households, invitations, and edit access
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
