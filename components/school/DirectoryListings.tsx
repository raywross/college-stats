import { Users } from "lucide-react";
import { groupListings, listingsFor, type DirectoryDomain } from "@/lib/directories";
import type { SchoolDetail } from "@/lib/detail";
import { DOMAINS } from "@/lib/metrics";
import { InfoTip } from "@/components/ui/info-tip";
import { BLOCK_SCROLL } from "@/components/profile/Panel";
import { CreditedList } from "./CreditedList";

const TITLES: Record<DirectoryDomain, string> = {
  faith: "Faith communities listed by national organizations",
  greek: "Chapters listed by national organizations",
  lgbtq: "LGBTQ+ listings by national organizations",
};

/**
 * A domain's national-directory listings, grouped by tradition, council, or kind (specs/campus-directories.md).
 * The generic block the infrastructure ships with; each domain's own block (ReligiousLife, GreekLife, LgbtqLife)
 * can take over by calling `listingsFor` + `groupListings` + `<CreditedList>` itself. Hidden when there's nothing.
 */
export function DirectoryListings({ detail, domain }: { detail: SchoolDetail | null; domain: DirectoryDomain }) {
  const groups = groupListings(listingsFor(detail?.tables.directories?.rows, domain));
  if (!groups.length) return null;
  const color = DOMAINS.size.color;
  return (
    <div id={`listings-${domain}`} className={`mt-4 rounded-3xl border bg-card p-4 sm:p-6 ${BLOCK_SCROLL}`}>
      <h3 className="mb-4 flex items-center gap-1.5 font-display text-lg font-bold">
        {TITLES[domain]} <InfoTip term="national-directory" />
      </h3>
      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.key}>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Users className="size-4" style={{ color }} /> {g.label}
            </p>
            <CreditedList items={g.listings} />
          </div>
        ))}
      </div>
    </div>
  );
}
