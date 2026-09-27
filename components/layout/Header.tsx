"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, Compass, GitCompareArrows, Menu, Search, X } from "lucide-react";
import { ThemeSegmented, ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/layout/Logo";
import { SchoolSearch } from "@/components/search/SchoolSearch";
import { useCompareIds } from "@/lib/compare";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Explore", href: "/explore", icon: Compass },
  { label: "Compare", href: "/compare", icon: GitCompareArrows },
  { label: "Glossary", href: "/glossary", icon: BookOpen },
];

export function Header() {
  const pathname = usePathname();
  const compareIds = useCompareIds();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Close overlays on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
    setSearchOpen(false);
  }

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const compareHref = compareIds.length ? `/compare?ids=${compareIds.join(",")}` : "/compare";
  const showHeaderSearch = pathname !== "/";

  return (
    <header
      className="sticky top-0 z-40 border-b border-border/70 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="group shrink-0" aria-label="Quad home">
          <Logo />
        </Link>

        {/* Desktop nav */}
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

        <div className="ml-auto flex items-center gap-1.5">
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
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="relative inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          >
            <Menu className="size-5" />
            {compareIds.length > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-coral" />}
          </button>
        </div>
      </div>

      {/* Mobile / tablet search row */}
      {searchOpen && (
        <div className="border-t px-4 py-3 lg:hidden">
          <SchoolSearch size="compact" autoFocus onNavigate={() => setSearchOpen(false)} />
        </div>
      )}

      {/* Mobile menu sheet */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in-0" onClick={() => setMenuOpen(false)} />
          <div
            className="absolute inset-x-0 top-0 animate-in slide-in-from-top-4 fade-in-0 rounded-b-3xl border-b bg-background p-4 shadow-2xl"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
          >
            <div className="flex items-center justify-between">
              <Logo />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="mt-5 grid gap-2" aria-label="Main">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href === "/compare" ? compareHref : item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-4 py-3.5 text-base font-semibold transition-colors",
                      active ? "bg-foreground text-background" : "bg-muted/60 hover:bg-muted"
                    )}
                  >
                    <Icon className="size-5" />
                    {item.label}
                    {item.href === "/compare" && compareIds.length > 0 && (
                      <span className="ml-auto rounded-full bg-pop px-2 py-0.5 text-xs font-bold text-pop-foreground">
                        {compareIds.length} picked
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-5 flex items-center justify-between border-t pt-4">
              <span className="text-sm font-medium text-muted-foreground">Appearance</span>
              <ThemeSegmented />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
