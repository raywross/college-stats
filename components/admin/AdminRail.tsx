"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AdminSearch } from "@/components/admin/AdminSearch";
import { DOOR_ICONS } from "@/components/admin/doorIcons";
import { ADMIN_DOORS, activeDoor, activeScreen } from "@/lib/admin/console";
import { cn } from "@/lib/utils";

/**
 * The console's navigation from `md` (specs/product/admin-redesign.md "Navigation"). From `lg`, a left rail: the
 * search at the top, then the four doors as groups with every screen under its door and its hint beneath, so nothing
 * is a second level to discover. From `md` to `lg`, a compact rail: each door's icon and label, and the current
 * door's screens under it. Below `md` the rail is hidden and the tab bar (AdminTabBar) takes its place. The active door
 * and screen are `aria-current`; every link is 44px tall.
 */
export function AdminRail({ needsYou }: { needsYou?: number | null }) {
  const pathname = usePathname();
  const door = activeDoor(pathname);
  const screen = activeScreen(pathname);
  return (
    <aside className="hidden border-r bg-background md:sticky md:top-(--header-h) md:block md:h-[calc(100dvh-var(--header-h))] md:w-44 md:shrink-0 md:self-start md:overflow-y-auto lg:w-64">
      <div className="space-y-3 p-3 lg:p-5">
        <Link href="/admin" className="flex min-h-11 items-center gap-2 font-display text-lg font-extrabold tracking-tight">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          Admin
        </Link>
        <AdminSearch id="admin-rail-search" className="hidden lg:block" />
      </div>

      {/* From lg: every door and every screen. */}
      <nav aria-label="Admin" className="hidden px-3 pb-6 lg:block">
        {ADMIN_DOORS.map((d) => {
          const Icon = DOOR_ICONS[d.key];
          return (
            <section key={d.key} aria-labelledby={`rail-${d.key}`} className="mt-4 first:mt-0">
              <h2 id={`rail-${d.key}`} className="flex items-center gap-2 px-3.5 pb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                <Icon className="size-3.5" aria-hidden />
                {d.label}
              </h2>
              <ul className="space-y-0.5">
                {d.screens.map((s) => {
                  const on = screen?.key === s.key && door === d.key;
                  return (
                    <li key={s.key}>
                      <Link
                        href={s.href}
                        aria-current={on ? "page" : undefined}
                        className={cn("flex min-h-11 flex-col justify-center rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-colors", on ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                      >
                        <span className="flex items-center justify-between gap-2">
                          {s.label}
                          {s.key === "inbox" && needsYou ? <Badge n={needsYou} on={on} /> : null}
                        </span>
                        <span className={cn("text-xs font-normal", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{s.hint}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </nav>

      {/* From md to lg: the doors with icons, and the current door's screens. */}
      <nav aria-label="Admin doors" className="px-2 pb-6 lg:hidden">
        <ul className="space-y-1">
          {ADMIN_DOORS.map((d) => {
            const Icon = DOOR_ICONS[d.key];
            const on = door === d.key;
            return (
              <li key={d.key}>
                <Link
                  href={d.href}
                  aria-current={on && pathname === d.href ? "page" : undefined}
                  className={cn("flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold transition-colors", on ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">{d.label}</span>
                  {d.key === "steward" && needsYou ? <Badge n={needsYou} on={on} /> : null}
                </Link>
                {on && (
                  <ul className="mt-1 mb-2 space-y-0.5 border-l pl-2 ml-5">
                    {d.screens.map((s) => (
                      <li key={s.key}>
                        <Link
                          href={s.href}
                          aria-current={screen?.key === s.key ? "page" : undefined}
                          className={cn("flex min-h-11 items-center rounded-lg px-2.5 text-sm transition-colors", screen?.key === s.key ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                        >
                          {s.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function Badge({ n, on }: { n: number; on: boolean }) {
  return (
    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums", on ? "bg-primary-foreground text-primary" : "bg-pop text-pop-foreground")}>
      <span className="sr-only">Needs you: </span>
      {n > 99 ? "99+" : n}
    </span>
  );
}
