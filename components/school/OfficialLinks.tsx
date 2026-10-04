import { ExternalLink } from "lucide-react";
import type { School } from "@/lib/types";
import type { FieldPath } from "@/lib/fields";
import { linkHost } from "@/lib/links";
import { SourceNote } from "@/components/sources/SourceNote";

interface Pill {
  label: string;
  href: string;
  field: FieldPath;
}

/** Website · Admissions · Apply · Visit (or Virtual tour) · Financial aid, skipping whichever the college lacks. */
function pillsFor(school: School): Pill[] {
  const l = school.links;
  const pills: (Pill | null)[] = [
    l?.website ? { label: "Website", href: l.website, field: "links.website" } : null,
    l?.admissions ? { label: "Admissions", href: l.admissions, field: "links.admissions" } : null,
    l?.apply ? { label: "Apply", href: l.apply, field: "links.apply" } : null,
    l?.visit
      ? { label: "Visit", href: l.visit, field: "links.visit" }
      : l?.virtual_tour
        ? { label: "Virtual tour", href: l.virtual_tour, field: "links.virtual_tour" }
        : null,
    l?.financial_aid ? { label: "Financial aid", href: l.financial_aid, field: "links.financial_aid" } : null,
  ];
  return pills.filter((p): p is Pill => p !== null);
}

/**
 * Website · Admissions · Apply · Visit · Financial aid, as outlined pill links (specs/school-identity/links.md,
 * Display). Each opens the college's own site in a new tab, with its domain as the tooltip; missing links are left
 * out, never shown disabled. Scrolls sideways on phones like the hero's "Known for" chips; wraps normally from `sm:`
 * up. Nothing when the college has none of these (and then no source note either).
 */
export function OfficialLinks({ school }: { school: School }) {
  const pills = pillsFor(school);
  if (pills.length === 0) return null;
  return (
    <div className="min-w-0 max-sm:w-full">
      <div className="no-scrollbar flex items-center gap-2 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 sm:flex-wrap [&>*]:shrink-0">
        {pills.map((p) => (
          <a
            key={p.field}
            href={p.href}
            target="_blank"
            rel="noopener"
            title={linkHost(p.href)}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary"
          >
            {p.label}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ))}
      </div>
      <SourceNote fields={[...new Set(pills.map((p) => p.field))]} school={school} className="mt-2" />
    </div>
  );
}
