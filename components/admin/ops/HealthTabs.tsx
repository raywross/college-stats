import Link from "next/link";
import { cn } from "@/lib/utils";
import { HEALTH_TABS, type HealthTab } from "@/lib/admin/health-tabs";

/**
 * The Health page's two tabs, Colleges and Sources (specs/product/admin-redesign.md "Data"), as links so each is its
 * own URL. `hrefs` carries the filters both tabs share (lib/admin/health-tabs.ts `healthTabHref`), so switching tabs
 * keeps them. Each tab is 44 px tall.
 */
export function HealthTabs({ current, hrefs }: { current: HealthTab; hrefs: Readonly<Record<HealthTab, string>> }) {
  return (
    <nav aria-label="Health views" className="flex flex-wrap gap-2 border-b border-border">
      {HEALTH_TABS.map((t) => (
        <Link
          key={t.key}
          href={hrefs[t.key]}
          title={t.hint}
          aria-current={t.key === current ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold",
            t.key === current ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
