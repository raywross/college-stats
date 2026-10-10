"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Compass, Database, Ellipsis, GitCompareArrows, GraduationCap, LineChart, ListChecks, LogIn, Map as MapIcon, Search, Sparkles, UserRound, X } from "lucide-react";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { SchoolSearch } from "@/components/search/SchoolSearch";
import { useMe } from "@/components/account/useMe";
import { loginHref } from "@/lib/accounts";
import { useCompareIds } from "@/lib/compare";
import { cn } from "@/lib/utils";

/**
 * Whether a deadline is due within a week, fetched client-side after mount from `/api/plan/next` (page.md
 * "Navigation"): never computed on the server, so public pages stay static. Signed-out visitors and any fetch
 * error read as false.
 */
function usePlanDueSoon(signedIn: boolean | undefined): boolean {
  const [fetched, setFetched] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    fetch("/api/plan/next", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<{ dueSoon: boolean }>) : null))
      .then((data) => {
        if (active) setFetched(Boolean(data?.dueSoon));
      })
      .catch(() => {
        if (active) setFetched(false);
      });
    return () => {
      active = false;
    };
  }, [signedIn]);
  return Boolean(signedIn) && fetched;
}

type Sheet = "search" | "more" | null;

/**
 * Phone navigation (below md): a thumb-reach tab bar with the four main jobs always visible, replacing the
 * hamburger menu and the floating compare pill. Search opens a full-screen sheet; secondary pages live under More.
 * See specs/mobile.md.
 */
export function BottomNav() {
  const pathname = usePathname();
  const compareIds = useCompareIds();
  const me = useMe();
  const planDueSoon = usePlanDueSoon(me?.signedIn);
  const [sheet, setSheet] = useState<Sheet>(null);

  // Close sheets on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setSheet(null);
  }

  useEffect(() => {
    document.body.style.overflow = sheet ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sheet]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const compareHref = compareIds.length ? `/compare?ids=${compareIds.join(",")}` : "/compare";
  const moreActive = isActive("/trends") || isActive("/high-schools") || isActive("/glossary") || isActive("/data") || isActive("/sources") || isActive("/roadmap") || isActive("/release-notes") || isActive("/account") || isActive("/login");

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/85 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
          <Tab href="/explore" label="Explore" icon={<Compass />} active={isActive("/explore") && !sheet} />
          <Tab label="Search" icon={<Search />} active={sheet === "search"} onClick={() => setSheet(sheet === "search" ? null : "search")} />
          <Tab href="/plan" label="Plan" icon={<ListChecks />} active={isActive("/plan") && !sheet} dot={planDueSoon} />
          <Tab
            href={compareHref}
            label="Compare"
            icon={<GitCompareArrows />}
            active={isActive("/compare") && !sheet}
            badge={compareIds.length || undefined}
          />
          <Tab label="More" icon={<Ellipsis />} active={sheet === "more" || (moreActive && !sheet)} onClick={() => setSheet(sheet === "more" ? null : "more")} />
        </ul>
      </nav>

      {sheet === "search" && (
        <div className="fixed inset-0 z-[45] flex flex-col bg-background md:hidden" role="dialog" aria-modal="true" aria-label="Search schools">
          <div className="flex items-center gap-2 border-b px-4 py-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}>
            <SchoolSearch source="tabbar" size="compact" autoFocus className="flex-1" onNavigate={() => setSheet(null)} />
            <button type="button" onClick={() => setSheet(null)} className="shrink-0 px-2 text-sm font-semibold text-primary">
              Cancel
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-5 text-sm text-muted-foreground">
            <p>Search by college name, city, or state.</p>
            <Link href="/explore" className="mt-4 inline-flex items-center gap-2 font-semibold text-primary">
              <Compass className="size-4" /> Or browse and filter all schools
            </Link>
          </div>
        </div>
      )}

      {sheet === "more" && (
        <div className="fixed inset-0 z-[45] md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <div className="absolute inset-0 animate-in bg-black/40 backdrop-blur-sm fade-in-0" onClick={() => setSheet(null)} />
          <div
            className="absolute inset-x-0 animate-in rounded-t-3xl border-t bg-background p-4 shadow-2xl slide-in-from-bottom-4 fade-in-0"
            style={{ bottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="flex items-center justify-between">
              <p className="font-display text-lg font-bold">More</p>
              <button type="button" onClick={() => setSheet(null)} aria-label="Close" className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted">
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-3 grid gap-2">
              {me?.configured && (me.signedIn ? (
                <MoreLink href="/account" icon={<UserRound className="size-5" />} title="Account" sub={me.name ?? me.email ?? "Your profile and household"} active={isActive("/account")} />
              ) : (
                <MoreLink href={loginHref(pathname === "/login" ? undefined : pathname)} icon={<LogIn className="size-5" />} title="Sign in" sub="Save your colleges and plans" active={isActive("/login")} />
              ))}
              <MoreLink href="/trends" icon={<LineChart className="size-5" />} title="National trends" sub="How college is changing" active={isActive("/trends")} />
              <MoreLink href="/high-schools" icon={<GraduationCap className="size-5" />} title="High schools" sub="Rigor, outcomes & where graduates go" active={isActive("/high-schools")} />
              <MoreLink href="/glossary" icon={<BookOpen className="size-5" />} title="Glossary" sub="Every term in plain English" active={isActive("/glossary")} />
              <MoreLink href="/data" icon={<Database className="size-5" />} title="Data" sub="Sources, years & updates" active={isActive("/data")} />
              <MoreLink href="/roadmap" icon={<MapIcon className="size-5" />} title="Roadmap" sub="What's coming next" active={isActive("/roadmap")} />
              <MoreLink href="/release-notes" icon={<Sparkles className="size-5" />} title="Release notes" sub="What's new" active={isActive("/release-notes")} />
            </div>
            <div className="mt-4 flex items-center justify-between border-t pt-4">
              <span className="text-sm font-medium text-muted-foreground">Appearance</span>
              <ThemeSegmented />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Tab({
  href,
  label,
  icon,
  active,
  badge,
  dot,
  onClick,
}: {
  href?: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  badge?: number;
  /** A plain dot (no count), for the Plan tab's "a deadline is due soon" (page.md "Navigation"). */
  dot?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span
        className={cn(
          "relative inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors [&>svg]:size-5",
          active && "bg-foreground text-background"
        )}
      >
        {icon}
        {badge !== undefined && (
          <span className="absolute -top-1 -right-0.5 inline-flex size-4 animate-pop-in items-center justify-center rounded-full bg-pop text-[10px] font-bold text-pop-foreground ring-2 ring-background">
            {badge}
          </span>
        )}
        {dot && <span className="absolute top-0.5 right-1.5 inline-flex size-2 animate-pop-in rounded-full bg-pop ring-2 ring-background" aria-label="A deadline in the next 7 days" />}
      </span>
      <span className={cn("text-[11px] font-semibold", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
    </>
  );
  const cls = "flex h-full w-full flex-col items-center justify-center gap-0.5 text-muted-foreground active:scale-95 transition-transform";
  return (
    <li>
      {href ? (
        <Link href={href} aria-current={active ? "page" : undefined} className={cls}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={onClick} aria-expanded={active} className={cls}>
          {inner}
        </button>
      )}
    </li>
  );
}

function MoreLink({ href, icon, title, sub, active }: { href: string; icon: ReactNode; title: string; sub: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn("flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors", active ? "bg-foreground text-background" : "bg-muted/60 hover:bg-muted")}
    >
      {icon}
      <span className="min-w-0">
        <span className="block text-base font-semibold">{title}</span>
        <span className={cn("block truncate text-xs", active ? "text-background/70" : "text-muted-foreground")}>{sub}</span>
      </span>
    </Link>
  );
}
