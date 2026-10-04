import { ExternalLink } from "lucide-react";
import { citeListing, type CreditedListing } from "@/lib/directories";
import { SourceTip } from "@/components/ui/info-tip";

/**
 * Listings compiled by others (specs/campus-directories.md, owner decision 4: "publish with credit"): each item with its
 * own ⓘ naming the organization, its list, the date read, and its tier. Quiet: nothing next to the item but its name,
 * a link to the chapter's page when the list gives one, and the organization's figure for a tier C estimate.
 * Shared by the faith, Greek, and LGBTQ+ blocks; each domain decides grouping and wording around it.
 */
export function CreditedList({ items, className }: { items: readonly CreditedListing[]; className?: string }) {
  if (!items.length) return null;
  return (
    <ul className={className ?? "space-y-1.5"}>
      {items.map((l) => {
        const label = l.name ?? l.credit.organization;
        return (
          <li key={`${l.org}|${l.name ?? ""}|${l.url ?? ""}`} className="flex items-start gap-1.5 text-sm">
            <span className="min-w-0">
              {l.url ? (
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-4 hover:text-primary">
                  {label}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : (
                label
              )}
              {l.status && !/^active$/i.test(l.status) && <span className="text-muted-foreground"> ({l.status.toLowerCase()})</span>}
              {l.tier === "C" && l.fact && <span className="text-muted-foreground">: {l.credit.organization} estimates {l.fact}</span>}
              {l.multi && <span className="text-muted-foreground"> (serves several colleges)</span>}
            </span>
            <SourceTip cited={citeListing(l)} className="mt-0.5" />
          </li>
        );
      })}
    </ul>
  );
}
