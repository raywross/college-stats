"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOOR_ICONS } from "@/components/admin/doorIcons";
import { ADMIN_DOORS, activeDoor } from "@/lib/admin/console";
import { cn } from "@/lib/utils";

/**
 * The console's tab bar below `md` (specs/product/admin-redesign.md "Phones"): four tabs, Steward · People · Data ·
 * More, fixed to the bottom like the site's BottomNav (which renders nothing under /admin), at the same height
 * (`--tabbar-h`). Each tab opens its door's landing page; the Steward tab carries the Needs you count.
 */
export function AdminTabBar({ needsYou }: { needsYou?: number | null }) {
  const pathname = usePathname();
  const door = activeDoor(pathname);
  return (
    <nav
      aria-label="Admin"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/85 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto grid h-(--tabbar-h) max-w-md grid-cols-4">
        {ADMIN_DOORS.map((d) => {
          const Icon = DOOR_ICONS[d.key];
          const on = door === d.key;
          const badge = d.key === "steward" && needsYou ? needsYou : null;
          return (
            <li key={d.key}>
              <Link
                href={d.href}
                aria-current={on ? "page" : undefined}
                className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-muted-foreground transition-transform active:scale-95"
              >
                <span className={cn("relative inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors", on && "bg-foreground text-background")}>
                  <Icon className="size-5" aria-hidden />
                  {badge !== null && (
                    <span className="absolute -top-1 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pop px-1 text-[10px] font-bold text-pop-foreground ring-2 ring-background">
                      <span className="sr-only">, needs you: </span>
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span className={cn("text-[11px] font-semibold", on ? "text-foreground" : "text-muted-foreground")}>{d.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
