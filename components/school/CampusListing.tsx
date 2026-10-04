import Image from "next/image";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import type { Cited } from "@/lib/lineage";
import { citeListing } from "@/lib/directories";
import type { ListingView } from "@/lib/campus-view";
import type { OrgBadgeData } from "@/lib/organizations";
import { DOMAINS } from "@/lib/metrics";
import { SourceTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * Shared pieces of the campus-life blocks (Religious, Greek, and LGBTQ+ life; specs/campus-directories.md "Display"):
 * an organization's badge, a listing card, a fact chip, and a small section heading, in the profile's visual
 * language (rounded tiles, the campus domain color for icons and tints, quiet ⓘ for every source).
 */

const color = DOMAINS.size.color;
const tint = (pct: number) => `color-mix(in oklch, ${color} ${pct}%, transparent)`;

const BADGE_SIZE = {
  sm: "size-9 rounded-lg",
  md: "size-11 rounded-xl",
} as const;

/**
 * An organization's mark: its logo on a light tile (so dark-on-transparent and colored marks both read in dark mode,
 * and mixed shapes line up), else its Greek letters on its color (or the neutral surface), else `icon` on a tint of
 * the campus color. Decorative: the name always sits beside it.
 */
export function OrgBadge({ badge, icon: Icon, size = "md", className }: { badge: OrgBadgeData; icon: LucideIcon; size?: keyof typeof BADGE_SIZE; className?: string }) {
  const box = cn("inline-flex shrink-0 items-center justify-center overflow-hidden", BADGE_SIZE[size], className);
  if (badge.kind === "logo") {
    return (
      <span aria-hidden className={cn(box, "bg-white p-1 ring-1 ring-black/10 dark:ring-white/15")}>
        <Image src={badge.src} alt="" width={44} height={44} unoptimized className="size-full object-contain" />
      </span>
    );
  }
  if (badge.kind === "letters") {
    const n = [...badge.letters].length;
    return (
      <span
        aria-hidden
        className={cn(
          box,
          "font-display leading-none font-extrabold tracking-tight",
          n >= 4 ? "text-[10px]" : n === 3 ? (size === "sm" ? "text-[11px]" : "text-[13px]") : "text-sm",
          !badge.background && "bg-surface-2 text-foreground ring-1 ring-border"
        )}
        style={badge.background ? { backgroundColor: badge.background, color: badge.foreground ?? undefined } : undefined}
      >
        {badge.letters}
      </span>
    );
  }
  return (
    <span aria-hidden className={box} style={{ backgroundColor: tint(14) }}>
      <Icon className={size === "sm" ? "size-4" : "size-5"} style={{ color }} />
    </span>
  );
}

/** An external link with the site's small arrow, dotted underline until hovered. */
export function OutLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("group/link hover:text-primary", className)}>
      <span className="underline decoration-dotted decoration-from-font underline-offset-4 group-hover/link:decoration-solid">{children}</span>
      <ArrowUpRight className="ml-0.5 inline size-3 align-[-1px] opacity-60" aria-hidden />
    </a>
  );
}

/** A listing's ⓘ: the list's credit, plus the logo's credit when a logo shows. */
export function listingCited(v: ListingView): Cited {
  const cited = citeListing(v.listing);
  if (v.badge.kind !== "logo") return cited;
  const { attribution, license, source } = v.badge.logo;
  return { ...cited, image: { what: `${v.org} logo`, attribution, license, source } };
}

/**
 * One organization at one college: badge, the organization's name linked to its own site, then the chapter's own
 * name linked to its page when the list gives one, then any `detail` (an estimate, "serves several colleges").
 * `card` frames it as a tile (faith communities, LGBTQ+ support); bare, it's a row (chapters inside a council).
 */
export function ListingCard({ view, icon, card = false, detail, kicker }: { view: ListingView; icon: LucideIcon; card?: boolean; detail?: ReactNode; kicker?: string }) {
  const l = view.listing;
  const status = l.status && !/^active$/i.test(l.status) ? l.status.toLowerCase() : null;
  const extra = [status, l.tier === "C" && l.fact ? `${l.credit.organization} estimates ${l.fact}` : null, l.multi ? "serves several colleges" : null].filter(Boolean).join(" · ");
  return (
    <div className={cn("flex min-w-0 items-center gap-3", card ? "rounded-2xl border bg-surface-2/60 p-3" : "py-1.5")}>
      <OrgBadge badge={view.badge} icon={icon} size={card ? "md" : "sm"} />
      <div className="min-w-0 flex-1">
        {kicker && <p className="mb-0.5 text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">{kicker}</p>}
        <p className="text-sm leading-snug font-semibold [overflow-wrap:anywhere]">
          <span className="min-w-0">{view.website ? <OutLink href={view.website}>{view.org}</OutLink> : view.org}</span>
          {" "}<SourceTip cited={listingCited(view)} className="align-[-3px]" />
        </p>
        {(view.chapter || view.chapterUrl) && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {view.chapterUrl ? <OutLink href={view.chapterUrl}>{view.chapter ?? "Campus page"}</OutLink> : view.chapter}
          </p>
        )}
        {(extra || detail) && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {extra}
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

/** A fact as a chip: icon in the campus color, the fact, and its ⓘ. */
export function FactChip({ icon: Icon, children, tip }: { icon: LucideIcon; children: ReactNode; tip?: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: tint(35), backgroundColor: tint(9) }}>
      <Icon className="size-3.5 shrink-0" style={{ color }} aria-hidden />
      {children}
      {tip}
    </li>
  );
}

/** A small heading inside a block ("Faith communities", "Policies"), with an optional count and trailing ⓘ. */
export function SubHead({ icon: Icon, children, tip, aside, className }: { icon?: LucideIcon; children: ReactNode; tip?: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2", className)}>
      <h4 className="flex items-center gap-1.5 text-sm font-semibold">
        {Icon && <Icon className="size-4" style={{ color }} aria-hidden />}
        {children}
        {tip}
      </h4>
      {aside}
    </div>
  );
}
