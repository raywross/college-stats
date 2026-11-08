"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RoleNav } from "./role-nav";

/**
 * The header's role item (specs/product/role-nav.md "The item"): one pill holding the label, a link to the role's
 * page (Advisor, Household, or Caseload), and, when the role has a menu, a chevron that opens it. The label is always
 * one click to the page the person uses most; the menu holds the rest of what the avatar menu used to carry for
 * that role. Active (filled) on the role's own paths: the advisor and the household for a guardian, the caseload too
 * for a counselor. The dot is the advisor's (usePlanDot): a deadline in the next week or a new move.
 */
export function RoleNavItem({ nav, dot }: { nav: RoleNav; dot: { lit: boolean; label: string } }) {
  const pathname = usePathname();
  const active = nav.activePaths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isCurrent = (href: string) => {
    const path = href.split("?")[0];
    return pathname === path || pathname.startsWith(`${path}/`);
  };
  const hasMenu = nav.menu.length > 0;
  const children = nav.menu.filter((e) => e.kind === "child");
  const pages = nav.menu.filter((e) => e.kind === "page");
  const itemCls = "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium outline-none data-[highlighted]:bg-muted";
  return (
    <div
      className={cn(
        "relative inline-flex items-center rounded-full text-sm font-semibold transition-colors",
        active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Link
        href={nav.href}
        aria-current={active ? "page" : undefined}
        className={cn("inline-flex items-center gap-1.5 rounded-full py-2 pl-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ring", hasMenu ? "pr-1.5" : "pr-3.5")}
      >
        {nav.label}
        {dot.lit && <span className="inline-flex size-2 animate-pop-in rounded-full bg-pop" aria-label={dot.label} />}
      </Link>
      {hasMenu && (
        <Menu.Root>
          <Menu.Trigger
            aria-label={`${nav.label} menu`}
            className={cn(
              "inline-flex h-9 items-center rounded-full pr-2.5 pl-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "hover:text-background/80" : "hover:text-foreground",
            )}
          >
            <ChevronDown className="size-4 transition-transform data-[popup-open]:rotate-180" aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="start" sideOffset={8} className="z-50">
              <Menu.Popup className="w-64 origin-(--transform-origin) rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-xl outline-none transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
                {/* A child's entry is `/advisor?for=<id>`; which child is open is the people line's to show, not this menu's. */}
                {children.map(({ href, label, icon: Icon }) => (
                  <Menu.LinkItem key={href} closeOnClick render={<Link href={href} />} className={itemCls}>
                    <Icon className="size-4" />
                    {label}
                  </Menu.LinkItem>
                ))}
                {children.length > 0 && pages.length > 0 && <div className="my-1 h-px bg-border" />}
                {pages.map(({ href, label, icon: Icon }) => (
                  <Menu.LinkItem key={href} closeOnClick render={<Link href={href} />} className={cn(itemCls, isCurrent(href) && "text-primary")}>
                    <Icon className="size-4" />
                    {label}
                  </Menu.LinkItem>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  );
}
