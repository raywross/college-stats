"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AdminSearch } from "@/components/admin/AdminSearch";
import { ADMIN_SECTIONS, activeSection } from "@/lib/admin/console";
import { cn } from "@/lib/utils";

/**
 * The console's navigation (specs/product/admin.md "The console"): a left rail from `lg` with the global search in
 * its header, and on phones a top strip (search, then the sections in one swipeable row). The console supports
 * phones but does not favor them (specs/mobile.md): every control is 44px tall, nothing scrolls sideways but the
 * strip. The active section is `aria-current`.
 */
export function AdminRail() {
  const pathname = usePathname();
  const active = activeSection(pathname);
  return (
    <aside className="border-b bg-background lg:sticky lg:top-(--header-h) lg:h-[calc(100dvh-var(--header-h))] lg:w-60 lg:shrink-0 lg:self-start lg:overflow-y-auto lg:border-r lg:border-b-0">
      <div className="space-y-3 px-4 pt-4 pb-3 lg:p-5">
        <Link href="/admin" className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          Admin
        </Link>
        <AdminSearch />
      </div>
      <nav aria-label="Admin sections" className="pb-2 lg:px-3 lg:pb-5">
        <ul className="flex gap-1.5 overflow-x-auto px-4 pb-1 max-lg:snap-x lg:flex-col lg:overflow-visible lg:px-0">
          {ADMIN_SECTIONS.map((s) => (
            <li key={s.key} className="max-lg:snap-start max-lg:shrink-0">
              <Link
                href={s.href}
                aria-current={active === s.key ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-col justify-center rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-colors",
                  active === s.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {s.label}
                <span className={cn("hidden text-xs font-normal lg:block", active === s.key ? "text-primary-foreground/80" : "text-muted-foreground")}>{s.hint}</span>
              </Link>
            </li>
          ))}
          <li className="max-lg:snap-start max-lg:shrink-0 lg:mt-3 lg:border-t lg:pt-3">
            <Link
              href="/admin/data"
              aria-current={pathname.startsWith("/admin/data") ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-xl px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                pathname.startsWith("/admin/data") && "bg-muted text-foreground",
              )}
            >
              Data
            </Link>
          </li>
          <li className="max-lg:snap-start max-lg:shrink-0">
            <Link
              href="/admin/admins"
              aria-current={pathname.startsWith("/admin/admins") ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-xl px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                pathname.startsWith("/admin/admins") && "bg-muted text-foreground",
              )}
            >
              Who is an admin
            </Link>
          </li>
          <li className="max-lg:snap-start max-lg:shrink-0">
            <Link
              href="/admin/settings"
              aria-current={pathname.startsWith("/admin/settings") ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-xl px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                pathname.startsWith("/admin/settings") && "bg-muted text-foreground",
              )}
            >
              Settings
            </Link>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
