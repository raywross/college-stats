"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountMenu } from "@/components/account/AccountMenu";
import { Logo } from "@/components/layout/Logo";
import { SchoolSearch } from "@/components/search/SchoolSearch";
import { useCompareIds } from "@/lib/compare";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Explore", href: "/explore" },
  { label: "Compare", href: "/compare" },
  { label: "Glossary", href: "/glossary" },
  { label: "Data", href: "/data" },
];

/** Top bar. On phones it's the logo and the account control, at the top of the page and scrolling away with it
 * (navigation, search, and theme live in BottomNav); from md it stays pinned. */
export function Header() {
  const pathname = usePathname();
  const compareIds = useCompareIds();
  const [searchOpen, setSearchOpen] = useState(false);

  // Close the search row on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setSearchOpen(false);
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const compareHref = compareIds.length ? `/compare?ids=${compareIds.join(",")}` : "/compare";
  const showHeaderSearch = pathname !== "/";

  return (
    <header
      className="relative z-40 border-b border-border/70 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 md:sticky md:top-0"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="mx-auto flex h-(--header-h) max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="group shrink-0" aria-label="Quad home">
          <Logo />
        </Link>

        {/* Phones: the account control sits opposite the logo; everything else lives in BottomNav. */}
        <div className="ml-auto md:hidden">
          <AccountMenu />
        </div>

        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href === "/compare" ? compareHref : item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors",
                  active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {item.label}
                {item.href === "/compare" && compareIds.length > 0 && (
                  <span className="inline-flex size-5 animate-pop-in items-center justify-center rounded-full bg-pop text-[11px] font-bold text-pop-foreground">
                    {compareIds.length}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-1.5 md:flex">
          {showHeaderSearch && (
            <SchoolSearch size="compact" placeholder="Jump to a school…" className="hidden w-64 lg:block" />
          )}
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Search schools"
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden",
              !showHeaderSearch && "hidden"
            )}
          >
            <Search className="size-[18px]" />
          </button>
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>

      {/* Tablet search row (phones search from the tab bar) */}
      {searchOpen && (
        <div className="hidden border-t px-4 py-3 md:block lg:hidden">
          <SchoolSearch size="compact" autoFocus onNavigate={() => setSearchOpen(false)} />
        </div>
      )}
    </header>
  );
}
